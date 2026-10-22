import fs from 'node:fs/promises';
import path from 'node:path';
import { parseDocument } from 'yaml';
import { loadConfig, projectDirectory, readSources, sourceDirectory } from './config.js';
import { parseFrontmatter, stringifyFrontmatter } from './frontmatter.js';
import { parseMemoryDoc, type Issue } from './source.js';
import { memoryLinkIssues, parseNoteLink, resolveNote, rewriteNoteTargets } from './links.js';
import type { MemoryDoc } from './model.js';
import { listFilesRecursive, normalizeEol, pathExists, sha256, writeFileAtomic, writeFileAtomicExclusive } from '../util/fs.js';
import { createRootGuard } from '../util/paths.js';
import { WondevError } from '../util/errors.js';
import { slugFromFilename } from '../commands/adopt.js';

export type VaultResolutions = Record<string, 'source' | 'vault'>;
interface Copy { side: 'source' | 'vault'; rel: string; file: string; raw: string; doc: MemoryDoc }
interface Change { path: string; before: Buffer | null; after: Buffer | null }
export interface VaultReconciliation {
  vault: string;
  reviewHash: string;
  notes: Array<{ destination: string; source?: string; vault?: string; sourceTitle?: string; vaultTitle?: string; status: 'source-only' | 'vault-only' | 'duplicate' | 'conflict' | 'resolved'; choice?: 'source' | 'vault' }>;
  issues: Issue[];
  warnings: string[];
  changes: Change[];
  snapshot: Map<string, Buffer | null>;
}

/** Preview two libraries without guessing which conflicting prose is authoritative. */
export async function planVaultReconciliation(root: string, directory: string, resolutions: VaultResolutions = {}): Promise<VaultReconciliation> {
  const vault = projectDirectory(directory, 'vault');
  const config = await loadConfig(root);
  if (config.vault) throw new WondevError(`A vault is already configured at ${config.vault}. Reconciliation is for projects with separate legacy memory copies.`);
  const source = sourceDirectory('memory', config.sources);
  const nextSources = readSources({ ...config.sources, memory: `${vault}/memory` });
  if (vault.toLowerCase() === source.toLowerCase() || vault.toLowerCase().startsWith(`${source.toLowerCase()}/`) || source.toLowerCase().startsWith(`${vault.toLowerCase()}/`)) throw new WondevError('Vault destination overlaps the active memory source.');
  const guard = createRootGuard(root);
  await guard(`${vault}/.reconcile-check`);
  if (!await fs.stat(path.join(root, vault)).then((s) => s.isDirectory()).catch(() => false)) throw new WondevError(`No existing vault directory: ${vault}`);
  const vaultMemory = await pathExists(path.join(root, vault, 'memory')) ? `${vault}/memory` : vault;
  const snapshot = new Map<string, Buffer | null>();
  const read = async (file: string): Promise<Buffer | null> => {
    await guard(file);
    const bytes = await fs.readFile(path.join(root, file)).catch((err: NodeJS.ErrnoException) => { if (err.code === 'ENOENT') return null; throw err; });
    snapshot.set(file, bytes);
    return bytes;
  };
  const issues: Issue[] = [];
  const copies: Copy[] = [];
  const assets: Array<{ file: string; destination: string; bytes: Buffer }> = [];
  for (const [side, base] of [['source', source], ['vault', vaultMemory]] as const) {
    await guard(`${base}/.reconcile-check`);
    for (const rel of await listFilesRecursive(path.join(root, base))) {
      if (rel.split('/').some((part) => part.startsWith('.')) || (base === vault && (/^(?:skills|commands|agents|sessions|templates|dashboards)\//.test(rel) || ['index.md', 'review.md'].includes(rel)))) continue;
      const file = `${base}/${rel}`;
      const bytes = (await read(file))!;
      if (!rel.endsWith('.md')) { assets.push({ file, destination: `${vault}/memory/${rel}`, bytes }); continue; }
      const raw = normalizeEol(bytes.toString('utf8'));
      copies.push({ side, rel, file, raw, doc: parseMemoryDoc(raw, rel.slice(0, -3), file, issues, side === 'vault' ? vault : undefined) });
    }
  }
  const normalized = (rel: string): string => rel.replace(/\.md$/, '').split('/').map(slugFromFilename).join('/').toLowerCase();
  const groups: Copy[][] = [];
  for (const copy of copies) {
    const found = groups.filter((group) => group.some((other) => (copy.doc.id && other.doc.id === copy.doc.id) || normalized(copy.rel) === normalized(other.rel)));
    if (found.length > 1 || found[0]?.some((other) => other.side === copy.side)) throw new WondevError(`Ambiguous memory identity: ${copy.file}`, 'Resolve duplicate ids or filename identities before reconciliation.');
    if (found[0]) found[0].push(copy); else groups.push([copy]);
  }
  // Keep human filenames. Only identity matching uses slugs; titles and aliases are retained.
  const destinations = new Map<Copy, string>();
  for (const group of groups) {
    const preferred = group.find((copy) => copy.side === 'vault') ?? group[0]!;
    for (const copy of group) destinations.set(copy, `${vault}/memory/${preferred.rel}`);
  }
  const rewritten = (copy: Copy): string => {
    const { data, body } = parseFrontmatter(copy.raw, copy.file);
    const rename = (target: string, relative: boolean): string | undefined => {
      const link = parseNoteLink(target, relative);
      let found = resolveNote(copies.filter((c) => c.side === copy.side).map((c) => c.doc), link, copy.doc);
      if (!found.length) found = resolveNote(copies.map((c) => c.doc), link, copy.doc);
      const targets = [...new Set(found.map((doc) => destinations.get(copies.find((c) => c.doc === doc)!)))];
      if (targets.length !== 1 || !targets[0]) return undefined;
      const destination = targets[0].replace(/\.md$/, '');
      return relative ? path.posix.relative(path.posix.dirname(destinations.get(copy)!), destination) : destination.slice(vault.length + 1);
    };
    if (Array.isArray(data['related'])) data['related'] = data['related'].map((item) => typeof item === 'string' ? rewriteNoteTargets(item.startsWith('[[') ? item : `[[${item}]]`, rename) : item);
    return stringifyFrontmatter(data, rewriteNoteTargets(body, rename));
  };
  const notes: VaultReconciliation['notes'] = [];
  const output = new Map<string, Buffer>();
  const prospective: MemoryDoc[] = [];
  for (const group of groups) {
    const a = group.find((c) => c.side === 'source');
    const b = group.find((c) => c.side === 'vault');
    const destination = destinations.get(group[0]!)!;
    const aText = a ? rewritten(a) : undefined;
    const bText = b ? rewritten(b) : undefined;
    const conflict = !!a && !!b && aText !== bText;
    const choice = Object.hasOwn(resolutions, destination) ? resolutions[destination] : undefined;
    const content = choice === 'source' ? aText : choice === 'vault' ? bText : bText ?? aText;
    if (choice && !content) throw new WondevError(`Resolution selects a missing ${choice} copy: ${destination}`);
    notes.push({ destination, ...(a ? { source: a.file, sourceTitle: a.doc.title } : {}), ...(b ? { vault: b.file, vaultTitle: b.doc.title } : {}),
      status: conflict ? choice ? 'resolved' : 'conflict' : a && b ? 'duplicate' : a ? 'source-only' : 'vault-only', ...(choice ? { choice } : {}) });
    if (conflict && !choice) continue;
    output.set(destination, Buffer.from(content!));
    prospective.push(parseMemoryDoc(content!, destination.slice(`${vault}/memory/`.length, -3), destination, issues, vault));
  }
  for (const key of Object.keys(resolutions)) if (!notes.some((note) => note.destination === key) || !['source', 'vault'].includes(resolutions[key]!)) throw new WondevError(`Invalid vault resolution: ${key}`);
  for (const asset of assets) {
    const existing = output.get(asset.destination);
    if (existing && !existing.equals(asset.bytes)) issues.push({ level: 'error', file: asset.destination, message: 'conflicting binary/resource copies; reconcile them manually before switching' });
    else output.set(asset.destination, asset.bytes);
  }
  issues.push(...memoryLinkIssues(prospective));
  // Source-relative resource links cannot be guessed when id matching relocates a note.
  for (const group of groups) for (const copy of group) if (path.posix.dirname(copy.rel) !== path.posix.dirname(destinations.get(copy)!.slice(`${vault}/memory/`.length)) && /!?\[[^\]]*\]\([^)]*\.(?:png|jpe?g|svg|gif|pdf|webp)/i.test(copy.raw)) issues.push({ level: 'error', file: copy.file, message: 'resource links need review because the matched note changes directory' });
  const configRel = '.wondev/wondev.yaml';
  const configBytes = (await read(configRel))!;
  const doc = parseDocument(configBytes.toString('utf8'));
  doc.set('vault', vault);
  doc.set('sources', nextSources);
  doc.set('index', { ...config.index, file: `${vault}/index.md`, columns: config.index?.columns ?? [] });
  output.set(configRel, Buffer.from(doc.toString({ lineWidth: 0 })));
  const deletes = new Set([...copies.map((c) => c.file), ...assets.map((a) => a.file)].filter((file) => !output.has(file)));
  const changes: Change[] = [];
  for (const [file, after] of output) {
    const before = snapshot.has(file) ? snapshot.get(file)! : await read(file);
    if (before && !copies.some((c) => c.file === file) && !assets.some((a) => a.file === file) && file !== configRel && !before.equals(after)) issues.push({ level: 'error', file, message: 'destination already contains another file' });
    if (!before?.equals(after)) changes.push({ path: file, before, after });
  }
  for (const file of deletes) changes.push({ path: file, before: snapshot.get(file)!, after: null });
  const warnings = ['Only memory is reconciled. Skills, commands, agents and sessions keep their configured paths.', 'Original files and config are backed up under .wondev/vault-backups before switching. Other tools and session proposals may still refer to old paths; review them after migration.'];
  if (notes.some((n) => n.status === 'conflict')) warnings.push('Resolve every conflicting note before applying; link errors may include notes awaiting a choice.');
  const reviewHash = sha256(JSON.stringify({ vault, resolutions, snapshot: [...snapshot].map(([p, b]) => [p, b ? sha256(b) : null]), changes: changes.map((c) => [c.path, c.after ? sha256(c.after) : null]) }));
  return { vault, reviewHash, notes, issues, warnings, changes, snapshot };
}

export async function applyVaultReconciliation(root: string, plan: VaultReconciliation): Promise<void> {
  if (plan.notes.some((note) => note.status === 'conflict') || plan.issues.some((issue) => issue.level === 'error')) throw new WondevError('Vault reconciliation has unresolved conflicts or invalid links. Nothing was changed.');
  const guard = createRootGuard(root);
  for (const [file, before] of plan.snapshot) {
    await guard(file);
    const current = await fs.readFile(path.join(root, file)).catch((err: NodeJS.ErrnoException) => { if (err.code === 'ENOENT') return null; throw err; });
    if (before === null ? current !== null : !current?.equals(before)) throw new WondevError(`Vault changed after preview: ${file}`);
  }
  const backup = `.wondev/vault-backups/${plan.reviewHash}`;
  for (const change of plan.changes) if (change.before) {
    const dest = `${backup}/files/${change.path}`;
    await guard(dest);
    const existing = await fs.readFile(path.join(root, dest)).catch((err: NodeJS.ErrnoException) => { if (err.code === 'ENOENT') return null; throw err; });
    if (existing && !existing.equals(change.before)) throw new WondevError(`Backup already differs: ${dest}`);
    if (!existing) await writeFileAtomicExclusive(path.join(root, dest), change.before);
  }
  await guard(`${backup}/plan.json`);
  await writeFileAtomic(path.join(root, backup, 'plan.json'), `${JSON.stringify({ vault: plan.vault, reviewHash: plan.reviewHash, changes: plan.changes.map((c) => ({ path: c.path, action: c.after === null ? 'remove' : c.before === null ? 'create' : 'update' })) }, null, 2)}\n`);
  const completed: Change[] = [];
  try {
    // Commit config last, after the destination library is complete.
    const ordered = [...plan.changes.filter((c) => c.path !== '.wondev/wondev.yaml'), ...plan.changes.filter((c) => c.path === '.wondev/wondev.yaml')];
    for (const change of ordered) {
      await guard(change.path);
      if (change.after === null) await fs.rm(path.join(root, change.path));
      else if (change.before === null) await writeFileAtomicExclusive(path.join(root, change.path), change.after);
      else await writeFileAtomic(path.join(root, change.path), change.after);
      completed.push(change);
    }
  } catch (error) {
    for (const change of completed.reverse()) {
      if (change.before === null) await fs.rm(path.join(root, change.path), { force: true });
      else await writeFileAtomic(path.join(root, change.path), change.before);
    }
    throw error;
  }
}

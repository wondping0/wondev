import fs from 'node:fs/promises';
import path from 'node:path';
import type { MemoryDoc } from './model.js';
import { readFileIfExists, sha256, normalizeEol, writeFileAtomic } from '../util/fs.js';
import { createRootGuard } from '../util/paths.js';
import { matchesGlob, matchesPatterns } from './matching.js';
import { WondevError } from '../util/errors.js';

export const MEMORY_STATE = '.wondev/.memory.json';
export interface Verification {
  noteHash: string;
  files: Record<string, string>;
  verified: string;
  against: string;
}
export interface MemoryState { version: 1; notes: Record<string, Verification> }
export interface Freshness {
  id: string;
  path: string;
  status: 'unverified' | 'fresh' | 'stale';
  reasons: string[];
  verified?: string;
}

export function memoryId(doc: MemoryDoc): string { return doc.id ?? doc.slug; }

/** Moving a stable-ID note does not invalidate evidence; changing its claims does. */
export function memoryHash(doc: MemoryDoc): string {
  const { sourcePath: _source, vaultPath: _vault, verified: _date, verifiedAgainst: _against, slug: _slug, ...claims } = doc;
  return sha256(JSON.stringify(claims));
}

export async function loadMemoryState(root: string): Promise<MemoryState> {
  await createRootGuard(root)(MEMORY_STATE);
  const raw = await readFileIfExists(path.join(root, MEMORY_STATE));
  if (raw === null) return { version: 1, notes: {} };
  try {
    const state = JSON.parse(raw) as MemoryState;
    if (state.version !== 1 || !state.notes || typeof state.notes !== 'object' || Array.isArray(state.notes)) throw new Error();
    for (const record of Object.values(state.notes)) {
      if (!record || typeof record.noteHash !== 'string' || typeof record.verified !== 'string' || typeof record.against !== 'string' || !record.files || typeof record.files !== 'object' || Array.isArray(record.files) || Object.values(record.files).some((v) => typeof v !== 'string')) throw new Error();
    }
    return state;
  } catch { throw new WondevError(`${MEMORY_STATE} is invalid. Restore it from version control or re-verify the affected notes.`); }
}

export async function saveMemoryState(root: string, state: MemoryState): Promise<void> {
  await createRootGuard(root)(MEMORY_STATE);
  await writeFileAtomic(path.join(root, MEMORY_STATE), `${JSON.stringify(state, null, 2)}\n`);
}

/** Do not descend into dependency, VCS, or wondev state directories. Symlinks are not followed. */
export async function evidenceFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await fs.readdir(path.join(root, dir), { withFileTypes: true })) {
      const rel = dir ? `${dir}/${entry.name}` : entry.name;
      if (entry.isDirectory() && !['.git', 'node_modules', '.wondev', '.obsidian'].includes(entry.name)) await walk(rel);
      else if (entry.isFile()) files.push(rel);
    }
  };
  await walk('');
  return files.sort();
}

export async function fingerprint(root: string, patterns: string[], files: string[], strict = false): Promise<Record<string, string>> {
  for (const pattern of patterns) matchesGlob('', pattern.replace(/^!/, ''));
  const selected = files.filter((file) => matchesPatterns(file, patterns));
  if (strict) {
    const missing = patterns.filter((p) => !p.startsWith('!') && !selected.some((f) => matchesGlob(f, p)));
    if (missing.length || !selected.length) throw new WondevError(`Evidence patterns match no files: ${missing.join(', ') || '(empty evidence)'}`);
  }
  const result: Record<string, string> = {};
  for (const rel of selected) {
    // Hash the actual bytes, so assets and schema files are evidence too.
    const data = await fs.readFile(path.join(root, rel));
    result[rel] = sha256(data.toString('base64'));
  }
  return result;
}

export async function inspectFreshness(root: string, memory: MemoryDoc[]): Promise<Freshness[]> {
  const state = await loadMemoryState(root);
  const files = memory.some((doc) => doc.evidence?.length) ? await evidenceFiles(root) : [];
  const results: Freshness[] = [];
  for (const doc of memory) {
    const id = memoryId(doc);
    const record = Object.hasOwn(state.notes, id) ? state.notes[id] : undefined;
    if (!record) {
      results.push({ id, path: doc.sourcePath, status: 'unverified', reasons: ['No recorded evidence verification.'] });
      continue;
    }
    const current = await fingerprint(root, doc.evidence ?? [], files);
    const reasons: string[] = [];
    if (memoryHash(doc) !== record.noteHash) reasons.push('Memory claims or metadata changed.');
    for (const [file, hash] of Object.entries(record.files)) {
      if (!(file in current)) reasons.push(`Deleted or no longer covered: ${file}`);
      else if (current[file] !== hash) reasons.push(`Changed: ${file}`);
    }
    for (const file of Object.keys(current)) if (!(file in record.files)) reasons.push(`Added: ${file}`);
    results.push({ id, path: doc.sourcePath, status: reasons.length ? 'stale' : 'fresh', reasons, verified: record.verified });
  }
  return results;
}

export async function currentNoteHash(root: string, relative: string): Promise<string> {
  await createRootGuard(root)(relative);
  return sha256(normalizeEol(await fs.readFile(path.join(root, relative), 'utf8')));
}

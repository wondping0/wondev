import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { loadConfig, projectDirectory, sourceDirectory } from './config.js';
import { hasErrors, loadSkillDirectory } from './source.js';
import { validateSkill } from './skill-quality.js';
import { createRootGuard, isInsideRoot } from '../util/paths.js';
import { pathExists, sha256, writeFileAtomic } from '../util/fs.js';
import { withProjectLock } from '../util/lock.js';
import { WondevError } from '../util/errors.js';

const execute = promisify(execFile);
export const PACK_LOCK = '.wondev/skills.lock.json';
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const VERSION = /^\d+\.\d+\.\d+(?:-[\da-zA-Z.-]+)?(?:\+[\da-zA-Z.-]+)?$/;

export interface LockedPack {
  source: string;
  version: string;
  integrity: string;
  /** Upstream checksum the last time this particular file was installed. */
  files: Record<string, string>;
}
export interface PackLock { version: 1; packs: Record<string, LockedPack> }
export interface PackChange { path: string; action: 'create' | 'update' | 'remove' | 'unchanged' | 'conflict'; before?: string; after?: string; diff?: string }
export interface PackResult { name: string; version: string; integrity: string; changes: PackChange[]; dryRun: boolean }
interface PackResource { bytes: Buffer; executable: boolean }
interface ResolvedPack { name: string; version: string; source: string; resources: Map<string, PackResource>; integrity: string }

function resourcePath(rel: string): void {
  if (!isInsideRoot(rel) || rel.includes('\\') || rel.split('/').some((part) => part === '..' || part === '.' || !part) || !/^[a-z0-9][a-z0-9-]*\//.test(rel)) throw new WondevError(`Unsafe skill pack resource: ${rel}`);
}

export async function loadPackLock(root: string): Promise<PackLock> {
  await createRootGuard(root)(PACK_LOCK);
  let raw: string;
  try { raw = await fs.readFile(path.join(root, PACK_LOCK), 'utf8'); }
  catch (err) { if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, packs: {} }; throw err; }
  try {
    const lock = JSON.parse(raw) as PackLock;
    if (lock.version !== 1 || !lock.packs || typeof lock.packs !== 'object' || Array.isArray(lock.packs)) throw new Error();
    for (const [name, pack] of Object.entries(lock.packs)) {
      if (!PACKAGE_NAME.test(name) || !pack || !VERSION.test(pack.version) || typeof pack.source !== 'string' || !/^[a-f\d]{64}$/.test(pack.integrity) || !pack.files || typeof pack.files !== 'object' || Array.isArray(pack.files)) throw new Error();
      for (const [rel, hash] of Object.entries(pack.files)) { resourcePath(rel); if (!/^[a-f\d]{64}$/.test(hash)) throw new Error(); }
    }
    return lock;
  } catch { throw new WondevError(`${PACK_LOCK} is invalid. Restore a valid lockfile before managing packs.`); }
}

async function readPackage(directory: string, source: string): Promise<ResolvedPack> {
  await createRootGuard(directory)('package.json');
  let manifest: { name: string; version: string; wondev?: { skills?: string } };
  try { manifest = JSON.parse(await fs.readFile(path.join(directory, 'package.json'), 'utf8')) as typeof manifest; }
  catch { throw new WondevError('A skill pack needs a valid package.json.'); }
  if (!manifest || typeof manifest.name !== 'string' || !PACKAGE_NAME.test(manifest.name) || typeof manifest.version !== 'string' || !VERSION.test(manifest.version)) throw new WondevError('A skill pack needs a valid npm name and exact semantic version.');
  const skillsDir = projectDirectory(manifest.wondev?.skills ?? 'skills', 'package.json wondev.skills');
  const { skills, issues } = await loadSkillDirectory(directory, skillsDir);
  const invalid = skills.flatMap((skill) => validateSkill(skill).map((message) => `${skill.name}: ${message}`));
  if (!skills.length || hasErrors(issues) || invalid.length) throw new WondevError(`Invalid skill pack: ${[...issues.map((i) => i.message), ...invalid].join('; ') || 'no skills found'}`);
  const resources = new Map<string, PackResource>();
  for (const skill of skills) {
    const files = [{ relPath: 'SKILL.md', path: skill.sourcePath }, ...skill.attachments.map((att) => ({ relPath: att.relPath, path: `${path.posix.dirname(skill.sourcePath)}/${att.relPath}` }))];
    for (const file of files) {
      const rel = `${skill.name}/${file.relPath}`;
      resourcePath(rel);
      await createRootGuard(directory)(file.path);
      const full = path.join(directory, file.path);
      resources.set(rel, { bytes: await fs.readFile(full), executable: ((await fs.stat(full)).mode & 0o111) !== 0 });
    }
  }
  const checksums = [...resources.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([file, resource]) => [file, sha256(resource.bytes)]);
  const integrity = sha256(JSON.stringify({ name: manifest.name, version: manifest.version, files: checksums }));
  return { name: manifest.name, version: manifest.version, source, resources, integrity };
}

async function npmProgram(): Promise<string> {
  const candidates = [process.env['WONDEV_NPM_CLI'], process.env['npm_execpath'],
    path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'),
    '/usr/share/nodejs/npm/bin/npm-cli.js',
    ...(process.env['APPDATA'] ? [path.join(process.env['APPDATA'], 'npm/node_modules/npm/bin/npm-cli.js')] : []),
  ].filter((value): value is string => !!value);
  for (const file of candidates) if (await pathExists(file)) return file;
  throw new WondevError('Cannot locate the npm CLI.', 'Install npm alongside Node.js, or set WONDEV_NPM_CLI to npm-cli.js.');
}

/** Network access happens only in an explicit pack operation; lifecycle scripts never run. */
async function resolvePack(root: string, source: string): Promise<ResolvedPack> {
  if (source.startsWith('local:')) {
    const rel = projectDirectory(source.slice(6), 'local pack');
    await createRootGuard(root)(`${rel}/package.json`);
    return readPackage(path.join(root, rel), source);
  }
  if (!source.startsWith('npm:')) throw new WondevError('Pack source must be local:relative/path or npm:package@version.');
  const spec = source.slice(4);
  const match = /^((?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*)(?:@([a-zA-Z\d.*^~+<>=| -]+))?$/.exec(spec);
  if (!match) throw new WondevError(`Invalid npm pack specifier: ${spec}`);
  const name = match[1]!;
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'wondev-pack-'));
  try {
    await writeFileAtomic(path.join(temp, 'package.json'), '{"name":"wondev-pack-download","private":true,"version":"1.0.0"}\n');
    try {
      await execute(process.execPath, [await npmProgram(), 'install', '--prefix', temp, '--ignore-scripts', '--no-audit', '--no-fund', '--no-bin-links', '--save-exact', '--', spec], { windowsHide: true, timeout: 120000, maxBuffer: 1024 * 1024 });
    } catch (err) { throw new WondevError(`npm could not download ${spec}: ${(err as Error).message}`); }
    const pack = await readPackage(path.join(temp, 'node_modules', name), source);
    if (pack.name !== name) throw new WondevError(`Downloaded package identity does not match ${name}.`);
    return pack;
  } finally {
    const relative = path.relative(os.tmpdir(), temp);
    if (relative.startsWith('wondev-pack-') && !relative.includes(path.sep)) await fs.rm(temp, { recursive: true, force: true });
  }
}

async function bytesIfPresent(file: string): Promise<Buffer | null> {
  try { return await fs.readFile(file); }
  catch (err) { if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null; throw err; }
}

/** All comparisons finish before mutations, and the entire install is serialized with builds. */
export async function installPack(root: string, source: string, options: { update?: string; dryRun?: boolean; frozen?: boolean } = {}): Promise<PackResult> {
  await loadConfig(root);
  const pack = await resolvePack(root, source);
  return withProjectLock(root, async () => {
    const config = await loadConfig(root);
    const lock = await loadPackLock(root);
    const previous = Object.hasOwn(lock.packs, pack.name) ? lock.packs[pack.name] : undefined;
    if (options.update && options.update !== pack.name) throw new WondevError(`Expected pack ${options.update}, received ${pack.name}.`);
    if (previous && !options.update && !options.frozen) throw new WondevError(`${pack.name} is installed. Use skills update to review a new version.`);
    if (options.update && !previous) throw new WondevError(`Pack is not installed: ${pack.name}`);
    if (options.frozen && (!previous || previous.version !== pack.version || previous.integrity !== pack.integrity)) throw new WondevError(`Pack ${pack.name} does not match its locked version and checksum.`);
    const directory = sourceDirectory('skills', config.sources);
    const guard = createRootGuard(root);
    const changes: PackChange[] = [];
    const writes: Array<{ rel: string; bytes: Buffer; executable: boolean }> = [];
    const removals: string[] = [];
    const hashes = { ...previous?.files };
    for (const rel of pack.resources.keys()) {
      const skill = rel.split('/')[0]!;
      for (const [owner, installed] of Object.entries(lock.packs)) {
        if (owner !== pack.name && Object.keys(installed.files).some((file) => file.startsWith(`${skill}/`))) throw new WondevError(`Skill ${skill} is owned by ${owner}.`);
      }
      const owned = previous && Object.keys(previous.files).some((file) => file.startsWith(`${skill}/`));
      if (!owned && (await pathExists(path.join(root, directory, skill)) || await pathExists(path.join(root, directory, `${skill}.md`)))) throw new WondevError(`Skill ${skill} already exists and is not owned by this pack.`);
    }
    const all = [...new Set([...Object.keys(previous?.files ?? {}), ...pack.resources.keys()])].sort();
    for (const rel of all) {
      resourcePath(rel);
      const destination = `${directory}/${rel}`;
      await guard(destination);
      const existing = await bytesIfPresent(path.join(root, destination));
      const before = existing === null ? undefined : sha256(existing);
      const incoming = pack.resources.get(rel);
      const after = incoming ? sha256(incoming.bytes) : undefined;
      const baseline = previous?.files[rel];
      let action: PackChange['action'];
      if (before === after) action = 'unchanged';
      else if (incoming && after === baseline && !options.frozen) action = 'unchanged';
      else if (!incoming) action = before === baseline ? 'remove' : 'conflict';
      else if (existing === null) action = baseline && !options.frozen ? 'conflict' : 'create';
      else if (before === baseline) action = 'update';
      else action = 'conflict';
      const diff = action !== 'unchanged' && /\.(md|json|ya?ml|[cm]?[jt]s|py|sh|txt|css|svg)$/.test(rel) && (existing?.length ?? 0) + (incoming?.bytes.length ?? 0) < 65536
        ? `--- ${destination}\n+++ ${destination} (upstream)\n${existing?.toString('utf8').split('\n').map((line) => `-${line}`).join('\n') ?? ''}\n${incoming?.bytes.toString('utf8').split('\n').map((line) => `+${line}`).join('\n') ?? ''}`
        : undefined;
      changes.push({ path: destination, action, ...(before ? { before } : {}), ...(after ? { after } : {}), ...(diff ? { diff } : {}) });
      if (action === 'conflict') {
        if (options.frozen) throw new WondevError(`Locally modified skill resource: ${destination}`);
        if (incoming) {
          const offer = `.wondev/skill-updates/${pack.name.replace('/', '--')}/${rel}`;
          await guard(offer);
          writes.push({ rel: offer, ...incoming });
        }
      } else if (action === 'remove') { removals.push(destination); delete hashes[rel]; }
      else if (incoming) {
        hashes[rel] = after!;
        if (action !== 'unchanged') writes.push({ rel: destination, ...incoming });
      } else delete hashes[rel];
    }
    if (!options.dryRun) {
      for (const item of writes) {
        await writeFileAtomic(path.join(root, item.rel), item.bytes);
        if (item.executable && process.platform !== 'win32') await fs.chmod(path.join(root, item.rel), 0o755);
      }
      for (const rel of removals) {
        // Root and symlink boundaries were checked above; only individual owned files are deleted.
        await fs.rm(path.join(root, rel), { force: true });
      }
      lock.packs = { ...lock.packs, [pack.name]: { source: options.frozen ? previous!.source : pack.source, version: pack.version, integrity: pack.integrity, files: hashes } };
      await guard(PACK_LOCK);
      await writeFileAtomic(path.join(root, PACK_LOCK), `${JSON.stringify(lock, null, 2)}\n`);
    }
    return { name: pack.name, version: pack.version, integrity: pack.integrity, changes, dryRun: options.dryRun === true };
  });
}

export async function updatePack(root: string, name: string, options: { source?: string; dryRun?: boolean } = {}): Promise<PackResult> {
  const lock = await loadPackLock(root);
  if (!Object.hasOwn(lock.packs, name)) throw new WondevError(`Pack is not installed: ${name}`);
  return installPack(root, options.source ?? lock.packs[name]!.source, { update: name, ...(options.dryRun ? { dryRun: true } : {}) });
}

export async function syncPacks(root: string, dryRun = false): Promise<PackResult[]> {
  const lock = await loadPackLock(root);
  const results: PackResult[] = [];
  for (const [name, pack] of Object.entries(lock.packs)) {
    const source = pack.source.startsWith('npm:') ? `npm:${name}@${pack.version}` : pack.source;
    results.push(await installPack(root, source, { frozen: true, dryRun }));
  }
  return results;
}

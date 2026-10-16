import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { inspectFreshness, loadMemoryState, evidenceFiles, fingerprint } from '../src/core/freshness.js';
import { runMemoryVerify, runMemoryStale } from '../src/commands/memory.js';
import { loadContext } from '../src/commands/context.js';
import { runBuild } from '../src/commands/build.js';
import { runVault } from '../src/commands/vault.js';
import { withProjectLock } from '../src/util/lock.js';
import { matchesGlob, matchesPatterns } from '../src/core/matching.js';
import { cleanup, read, seedProject, silence, tmpRoot, write } from './helpers.js';

let root: string;
const source = '.wondev/memory/auth.md';
const note = '---\nid: auth-module\ntitle: Auth\nevidence: ["src/auth/**"]\n---\nLogin validates tokens.\n';
beforeEach(async () => {
  root = await tmpRoot();
  await seedProject(root, ['agents']);
  await write(root, source, note);
  await write(root, 'src/auth/login.ts', 'export const login = true;\n');
});
afterEach(async () => { vi.restoreAllMocks(); await cleanup(root); });

async function report() { return inspectFreshness(root, (await loadContext(root)).project.memory); }
async function verify() { await silence(() => runMemoryVerify(root, 'auth-module', 'Read login and ran authentication tests')); }

describe('evidence verification', () => {
  it('records explicit verification and detects modifications, additions, and deletions', async () => {
    expect((await report()).find((r) => r.id === 'auth-module')?.status).toBe('unverified');
    await verify();
    expect((await report()).find((r) => r.id === 'auth-module')?.status).toBe('fresh');
    expect(await read(root, source)).toContain('verifiedAgainst: Read login');
    await write(root, 'src/auth/login.ts', 'export const login = false;\n');
    await write(root, 'src/auth/logout.ts', 'logout();');
    let current = (await report()).find((r) => r.id === 'auth-module')!;
    expect(current.reasons).toContain('Changed: src/auth/login.ts');
    expect(current.reasons).toContain('Added: src/auth/logout.ts');
    await verify();
    await fs.rm(path.join(root, 'src/auth/login.ts'));
    current = (await report()).find((r) => r.id === 'auth-module')!;
    expect(current.reasons).toContain('Deleted or no longer covered: src/auth/login.ts');
  });

  it('keeps a stable identity across renames and detects changes to the claims', async () => {
    await verify();
    await fs.rename(path.join(root, source), path.join(root, '.wondev/memory/renamed.md'));
    expect((await report()).find((r) => r.id === 'auth-module')?.status).toBe('fresh');
    await fs.appendFile(path.join(root, '.wondev/memory/renamed.md'), '\nNew claim.');
    expect((await report()).find((r) => r.id === 'auth-module')?.reasons).toContain('Memory claims or metadata changed.');
  });

  it('requires a real note, evidence, a verification rationale, and valid state', async () => {
    await expect(runMemoryVerify(root, 'auth-module', '')).rejects.toThrow('--against');
    await expect(runMemoryVerify(root, 'missing', 'checked')).rejects.toThrow('one note');
    await expect(runMemoryVerify(root, 'architecture', 'checked')).rejects.toThrow('Evidence patterns');
    await write(root, source, note.replace('src/auth/**', 'missing/**'));
    await expect(runMemoryVerify(root, 'auth-module', 'checked')).rejects.toThrow('match no files');
    await write(root, '.wondev/.memory.json', '{}');
    await expect(loadMemoryState(root)).rejects.toThrow('invalid');
    await write(root, '.wondev/.memory.json', JSON.stringify({ version: 1, notes: { x: {} } }));
    await expect(loadMemoryState(root)).rejects.toThrow('invalid');
  });

  it('builds an actionable vault review report and emits live JSON and text reports', async () => {
    await silence(() => runVault(root));
    await verify();
    await write(root, 'src/auth/login.ts', 'changed');
    await silence(() => runBuild(root));
    expect(await read(root, 'knowledge/review.md')).toContain('Changed: src/auth/login.ts');
    const output: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => { output.push(String(chunk)); return true; });
    await runMemoryStale(root, true);
    expect(JSON.parse(output.join('')).find((r: { id: string }) => r.id === 'auth-module').status).toBe('stale');
    output.length = 0;
    await runMemoryStale(root);
    expect(output.join('')).toContain('Changed: src/auth/login.ts');
  });

  it('excludes dependencies and state from scans and supports precise glob exclusions', async () => {
    await write(root, 'node_modules/dependency/test.ts', 'ignore');
    await write(root, '.git/config', 'ignore');
    await write(root, 'src/auth/login.test.ts', 'test');
    const files = await evidenceFiles(root);
    expect(files).not.toContain('node_modules/dependency/test.ts');
    expect(Object.keys(await fingerprint(root, ['src/**/*.ts', '!**/*.test.ts'], files))).toEqual(['src/auth/login.ts']);
    expect(matchesGlob('src/a.ts', 'src/**/*.{ts,js}')).toBe(true);
    expect(matchesGlob('src/a.js', 'src/?.js')).toBe(true);
    expect(matchesPatterns('src/a.js', ['src/**', '!**/*.js'])).toBe(false);
    expect(() => matchesGlob('a', '../*')).toThrow();
    expect(() => matchesGlob('a', '[ab]')).toThrow();
  });
});

describe('cooperating writers', () => {
  it('serializes concurrent operations and releases a lock after failure', async () => {
    const events: string[] = [];
    await Promise.all([1, 2, 3].map((i) => withProjectLock(root, async () => {
      events.push(`start ${i}`);
      await new Promise((resolve) => setTimeout(resolve, 30));
      events.push(`end ${i}`);
    })));
    for (let i = 0; i < events.length; i += 2) expect(events[i + 1]).toBe(events[i]!.replace('start', 'end'));
    await expect(withProjectLock(root, async () => { throw new Error('failure'); })).rejects.toThrow('failure');
    await withProjectLock(root, async () => {});
    await write(root, '.wondev/.lock', 'someone else');
    await expect(withProjectLock(root, async () => {}, 1)).rejects.toThrow('Another wondev');
    expect(await read(root, '.wondev/.lock')).toBe('someone else');
  });
});

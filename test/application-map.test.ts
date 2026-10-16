import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMap } from '../src/commands/map.js';
import { loadContext } from '../src/commands/context.js';
import { scanApplication } from '../src/core/application-map.js';
import { selectContext } from '../src/core/retrieval.js';
import { runMemoryVerify } from '../src/commands/memory.js';
import { inspectFreshness } from '../src/core/freshness.js';
import { runVault } from '../src/commands/vault.js';
import { cleanup, exists, read, seedProject, silence, tmpRoot, write } from './helpers.js';

let root: string;
beforeEach(async () => { root = await tmpRoot(); await seedProject(root); });
afterEach(async () => { await cleanup(root); });

async function fixture(): Promise<void> {
  await write(root, 'package.json', JSON.stringify({ name: 'demo', main: './dist/index.js', exports: { '.': './dist/index.js' }, bin: { demo: './bin.js' }, scripts: { test: 'NEVER EXECUTE' }, dependencies: { '@demo/auth': '*' } }));
  await write(root, 'packages/auth/package.json', JSON.stringify({ name: '@demo/auth', types: 'index.d.ts' }));
  await write(root, 'src/auth/session.ts', 'export const session = true;');
  await write(root, 'src/api/login.ts', "import { session } from '../auth/session.js'; export { session };\n// import 'false-positive';\nconst text = \"require('fake')\";");
  await write(root, 'test/login.test.ts', "import '../src/auth/session.js';");
  await write(root, 'dist/index.js', 'GENERATED OUTPUT');
  await write(root, 'node_modules/foreign/index.js', 'DO NOT READ');
  await write(root, '.private/hidden.ts', 'DO NOT READ');
}

describe('application understanding map', () => {
  it('records source evidence, test consumers, imports and package links without executing code', async () => {
    await fixture();
    const ctx = await loadContext(root);
    const map = await scanApplication(root, ctx.config);
    expect(map.files.map((f) => f.path)).toEqual(['src/api/login.ts', 'src/auth/session.ts', 'test/login.test.ts']);
    expect(map.files[0]!.imports).toEqual([{ specifier: '../auth/session.js', line: 1, resolved: 'src/auth/session.ts' }]);
    expect(map.packages.find((p) => p.name === 'demo')?.scripts).toEqual(['test']);
    await silence(() => runMap(root));
    const mapped = await loadContext(root);
    expect(mapped.issues.filter((i) => i.level === 'error')).toEqual([]);
    const auth = mapped.project.memory.find((m) => m.title === 'Module src/auth')!;
    expect(auth.body).toContain('test/login.test.ts');
    expect(auth.body).toContain('src/api/login.ts');
    expect(selectContext(mapped.project, { files: ['src/auth/session.ts'] }).selected.map((s) => s.id)).toContain(auth.id);
    expect(await read(root, 'AGENTS.md')).toContain('session learn');
    expect(await read(root, 'AGENTS.md')).not.toContain('NEVER EXECUTE');
  });

  it('preserves curated prose and frontmatter, is idempotent, and refreshes observed facts', async () => {
    await fixture();
    await silence(() => runMap(root, { noBuild: true }));
    const ctx = await loadContext(root);
    const auth = ctx.project.memory.find((m) => m.title === 'Module src/auth')!;
    const raw = await read(root, auth.sourcePath);
    await write(root, auth.sourcePath, raw.replace('status: active', 'status: active\nowner: auth-team') + '\nSessions must have one owner.\n');
    const before = await read(root, auth.sourcePath);
    await silence(() => runMap(root, { noBuild: true }));
    expect(await read(root, auth.sourcePath)).toBe(before);
    await silence(() => runMemoryVerify(root, auth.id!, 'Inspected session implementation'));
    await write(root, 'src/auth/refresh.ts', 'export const refresh = true;');
    await silence(() => runMap(root, { noBuild: true }));
    const result = await read(root, auth.sourcePath);
    expect(result).toContain('owner: auth-team');
    expect(result).toContain('Sessions must have one owner.');
    expect(result).toContain('src/auth/refresh.ts');
    const updated = await loadContext(root);
    expect((await inspectFreshness(root, updated.project.memory)).find((f) => f.id === auth.id)?.status).toBe('stale');
  });

  it('creates vault links that resolve and survives source moves and removed modules', async () => {
    await fixture();
    await silence(() => runMap(root, { noBuild: true }));
    await silence(() => runVault(root, 'knowledge'));
    // Conversion changes paths; refreshed map links must use the active vault.
    await silence(() => runMap(root, { noBuild: true }));
    let ctx = await loadContext(root);
    const api = ctx.project.memory.find((m) => m.title === 'Module src/api')!;
    expect(api.body).toContain('[[memory/map/');
    await fs.unlink(path.join(root, 'src/api/login.ts'));
    await silence(() => runMap(root, { noBuild: true }));
    ctx = await loadContext(root);
    expect(ctx.issues.filter((i) => i.level === 'error')).toEqual([]);
    expect((await read(root, api.sourcePath))).toContain('no longer in the application scan');
  });

  it('previews without writing and honors excluded directories', async () => {
    await fixture();
    await silence(() => runMap(root, { dryRun: true, exclude: ['test/**'] }));
    expect(await exists(root, '.wondev/.map.json')).toBe(false);
    expect(await exists(root, '.wondev/memory/map')).toBe(false);
    const ctx = await loadContext(root);
    expect((await scanApplication(root, ctx.config, ['test', 'src/api/**'])).files.map((f) => f.path)).toEqual(['src/auth/session.ts']);
  });

  it('protects edited generated regions and checks all destinations before writing', async () => {
    await fixture();
    await silence(() => runMap(root, { noBuild: true }));
    const ctx = await loadContext(root);
    const auth = ctx.project.memory.find((m) => m.title === 'Module src/auth')!;
    const original = await read(root, auth.sourcePath);
    await write(root, auth.sourcePath, original.replace('Observed file/import', 'MY EDIT file/import'));
    await write(root, 'src/new/index.ts', 'export {};');
    await expect(silence(() => runMap(root))).rejects.toThrow('was edited');
    expect((await loadContext(root)).project.memory.some((m) => m.title === 'Module src/new')).toBe(false);
    expect(await read(root, auth.sourcePath)).toContain('MY EDIT');
    await write(root, auth.sourcePath, original.replace('<!-- wondev:application-map:end -->', ''));
    await expect(silence(() => runMap(root))).rejects.toThrow('markers');
  });

  it('parses JSX, TS import equals, re-exports, require, and dynamic literal imports', async () => {
    await write(root, 'src/index.tsx', "import type { X } from './types'; export * from './types'; const C = () => <span />; import('./lazy'); require('./common.cjs'); import value = require('./common.cjs'); import(variable);");
    await write(root, 'src/types/index.ts', 'export type X = string;');
    await write(root, 'src/lazy.ts', 'export {};');
    await write(root, 'src/common.cjs', 'module.exports = 1;');
    const map = await scanApplication(root, (await loadContext(root)).config);
    expect(map.warnings).toEqual([]);
    const file = map.files.find((f) => f.path === 'src/index.tsx')!;
    expect(file.imports.map((i) => i.resolved)).toEqual(['src/types/index.ts', 'src/types/index.ts', 'src/lazy.ts', 'src/common.cjs', 'src/common.cjs']);
  });

  it('reports syntax gaps and unresolved aliases without inventing relationships', async () => {
    await write(root, 'src/broken.ts', 'const = ;');
    await write(root, 'src/main.mts', "import x from '@/auth'; export default x;");
    await silence(() => runMap(root, { noBuild: true }));
    const ctx = await loadContext(root);
    expect(ctx.project.memory.find((m) => m.title === 'Module src')?.body).toContain('syntax could not be parsed');
    expect(ctx.project.memory.find((m) => m.title === 'Module src')?.body).toContain('external or unresolved');
  });

  it('handles dynamic route directories and empty repositories', async () => {
    await silence(() => runMap(root, { noBuild: true }));
    await write(root, 'src/app/[id]/page.tsx', 'export default () => <div />;');
    await silence(() => runMap(root, { noBuild: true }));
    const ctx = await loadContext(root);
    expect(selectContext(ctx.project, { files: ['src/app/[id]/page.tsx'] }).selected.some((s) => s.id.startsWith('map-module-'))).toBe(true);
  });

  it('keeps stable identities and links after an Obsidian rename and handles CRLF checkouts', async () => {
    await fixture();
    await silence(() => runMap(root, { noBuild: true }));
    const ctx = await loadContext(root);
    const auth = ctx.project.memory.find((m) => m.title === 'Module src/auth')!;
    const renamed = '.wondev/memory/renamed-auth.md';
    for (const doc of ctx.project.memory) {
      const content = (await read(root, doc.sourcePath)).replaceAll(`[[${auth.slug}|`, '[[renamed-auth|').replace(/\r?\n/g, '\r\n');
      await write(root, doc === auth ? renamed : doc.sourcePath, content);
    }
    await fs.unlink(path.join(root, auth.sourcePath));
    // Obsidian updated the owned links too. Allow only the exact new generated facts as a
    // resumable baseline; arbitrary edits elsewhere in those regions still fail.
    await silence(() => runMap(root, { noBuild: true }));
    expect(await exists(root, auth.sourcePath)).toBe(false);
    const updated = await loadContext(root);
    expect(updated.issues.filter((i) => i.level === 'error')).toEqual([]);
    expect(updated.project.memory.find((m) => m.id === auth.id)?.sourcePath).toBe(renamed);
    await silence(() => runMap(root, { noBuild: true }));
  });

  it('refuses invalid state, malformed manifests, source errors and oversized input', async () => {
    await write(root, 'package.json', '{');
    await expect(silence(() => runMap(root))).rejects.toThrow('Invalid package JSON');
    await write(root, 'package.json', 'null');
    await expect(silence(() => runMap(root))).rejects.toThrow('Invalid package manifest');
    await write(root, 'package.json', '{}');
    await write(root, '.wondev/.map.json', '{}');
    await expect(silence(() => runMap(root))).rejects.toThrow('is invalid');
    await fs.unlink(path.join(root, '.wondev/.map.json'));
    await write(root, 'huge.ts', ' '.repeat(2_000_001));
    await expect(silence(() => runMap(root))).rejects.toThrow('input limit');
    await write(root, '.wondev/memory/broken.md', '[[missing]]');
    await expect(silence(() => runMap(root))).rejects.toThrow('source validation');
  });
});

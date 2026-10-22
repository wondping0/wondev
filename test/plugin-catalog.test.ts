import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PLUGIN_CATALOG, catalogPlugin, changePlugin, exportPlugins, loadPluginLock, pluginRelease } from '../src/core/plugin-catalog.js';
import { runPlugins } from '../src/commands/plugins.js';
import { main } from '../src/cli.js';
import { cleanup, exists, read, seedProject, silence, tmpRoot, write } from './helpers.js';

let root: string;
beforeEach(async () => { root = await tmpRoot(); await seedProject(root, ['agents']); process.exitCode = 0; });
afterEach(async () => { process.exitCode = 0; vi.restoreAllMocks(); vi.unstubAllGlobals(); await cleanup(root); });
const entry = catalogPlugin('playwright');
function metadata(version = entry.version!) { return { name: entry.package, version, repository: { url: `${entry.source}.git` }, dist: { integrity: entry.integrity } }; }

it('offers verifiable catalog metadata offline and separates bridge skills from runtime packages', async () => {
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  expect(PLUGIN_CATALOG).toHaveLength(13);
  expect(catalogPlugin('understand-anything')).toMatchObject({ kind: 'bundled-skill', requires: expect.stringContaining('separate upstream') });
  await silence(() => main(['plugins', 'catalog', '--json']));
  await silence(() => runPlugins(root, 'catalog'));
  for (const id of ['playwright', 'understand-anything']) await silence(() => runPlugins(root, 'info', id));
  expect(fetcher).not.toHaveBeenCalled();
  await expect(runPlugins(root, 'info')).rejects.toThrow('Usage');
  expect(() => catalogPlugin('../bad')).toThrow('Unknown');
});

it('pins exact versions disabled by default, enables exports, disables and removes without host mutation', async () => {
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  await silence(() => runPlugins(root, 'pin', 'playwright', { dryRun: true }));
  expect(await exists(root, '.wondev/plugins.lock.json')).toBe(false);
  await silence(() => main(['plugins', 'pin', 'playwright', '--cwd', root]));
  expect((await loadPluginLock(root)).plugins.playwright?.enabled).toBe(false);
  expect(JSON.parse(exportPlugins(await loadPluginLock(root), 'claude')).mcpServers).toEqual({});
  await silence(() => runPlugins(root, 'enable', 'playwright', { json: true }));
  await silence(() => runPlugins(root, 'pin', 'context7'));
  await silence(() => runPlugins(root, 'enable', 'context7'));
  const lock = await loadPluginLock(root);
  const windows = JSON.parse(exportPlugins(lock, 'claude', 'win32'));
  expect(windows.mcpServers.playwright.command).toBe('cmd');
  expect(windows.mcpServers.playwright.args).toContain(`@playwright/mcp@${entry.version}`);
  expect(windows.mcpServers.playwright.args).toContain('--isolated');
  expect(exportPlugins(lock, 'codex', 'linux')).toContain('env_vars = ["CONTEXT7_API_KEY"]');
  expect(exportPlugins(lock, 'generic', 'linux')).toContain('--ignore-scripts');
  await silence(() => runPlugins(root, 'export', undefined, { agent: 'codex' }));
  await silence(() => runPlugins(root, 'status'));
  await silence(() => runPlugins(root, 'check', undefined, { json: true }));
  await silence(() => runPlugins(root, 'disable', 'playwright'));
  expect(exportPlugins(await loadPluginLock(root), 'codex')).not.toContain('[mcp_servers.playwright]');
  await silence(() => runPlugins(root, 'remove', 'playwright'));
  expect((await loadPluginLock(root)).plugins.playwright).toBeUndefined();
  expect(fetcher).not.toHaveBeenCalled();
  for (const file of ['.mcp.json', '.codex/config.toml', '.claude/settings.json']) expect(await exists(root, file)).toBe(false);
});

it('validates registry identity, exact versions and integrity before changing an existing pin', async () => {
  const fetcher = vi.fn(async () => Response.json(metadata('0.0.84'))); vi.stubGlobal('fetch', fetcher);
  await silence(() => main(['plugins', 'pin', 'playwright', '--plugin-version', '0.0.84', '--cwd', root]));
  expect(fetcher.mock.calls).toHaveLength(1);
  const before = await read(root, '.wondev/plugins.lock.json');
  await changePlugin(root, 'playwright', 'pin');
  expect(await read(root, '.wondev/plugins.lock.json')).toBe(before);
  fetcher.mockImplementation(async () => Response.json({ ...metadata('0.0.85'), repository: { url: 'https://github.com/impostor/package' } }));
  await expect(changePlugin(root, 'playwright', 'pin', { version: '0.0.85' })).rejects.toThrow('Unverified');
  expect(await read(root, '.wondev/plugins.lock.json')).toBe(before);
  await expect(changePlugin(root, 'playwright', 'pin', { version: 'latest' })).rejects.toThrow('exact version');
});

it('checks online updates without changing the pin and reports network/integrity failures', async () => {
  await changePlugin(root, 'playwright', 'pin');
  const before = await read(root, '.wondev/plugins.lock.json');
  vi.stubGlobal('fetch', vi.fn(async (url: string) => Response.json(metadata(url.endsWith('latest') ? '0.0.84' : entry.version))));
  await silence(() => main(['plugins', 'check', '--cwd', root, '--online', '--json']));
  expect(await read(root, '.wondev/plugins.lock.json')).toBe(before);
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ...metadata(), dist: { integrity: `sha512-${'A'.repeat(86)}==` } })));
  await silence(() => runPlugins(root, 'check', undefined, { online: true }));
  expect(process.exitCode).toBe(1);
  process.exitCode = 0;
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
  await silence(() => runPlugins(root, 'check', undefined, { online: true, json: true }));
  expect(process.exitCode).toBe(1);
});

it.each([
  { name: 'impostor' }, { version: 'latest' }, { version: '1.0.0' }, { dist: {} }, { deprecated: 'withdrawn' }, { repository: {} },
])('rejects unverified registry metadata: %j', async (patch) => {
  await expect(pluginRelease(entry, entry.version, vi.fn(async () => Response.json({ ...metadata(), ...patch })) as typeof fetch)).rejects.toThrow('Unverified');
});

it('handles malformed and oversized registry responses and rejects nonpackage lookups', async () => {
  for (const response of [new Response('oops', { status: 503 }), new Response('oops'), new Response('{}', { headers: { 'content-length': '2000001' } }), new Response('x'.repeat(2_000_001)), new Response(null)]) {
    await expect(pluginRelease(entry, 'latest', vi.fn(async () => response) as typeof fetch)).rejects.toThrow();
  }
  await expect(pluginRelease(catalogPlugin('debugging'))).rejects.toThrow('package');
});

it('refuses tampered locks and incorrect command combinations', async () => {
  await expect(changePlugin(root, 'playwright', 'enable')).rejects.toThrow('not pinned');
  await expect(changePlugin(root, 'debugging', 'pin')).rejects.toThrow('skills install');
  await expect(runPlugins(root, 'export')).rejects.toThrow('Usage');
  await expect(runPlugins(root, 'invalid')).rejects.toThrow('Usage');
  await expect(runPlugins(root, 'install', 'playwright')).rejects.toThrow('plugins pin');
  expect(() => exportPlugins({ version: 1, plugins: {} }, 'unknown')).toThrow('supports');
  for (const raw of ['null', '{}', '{broken', '{"version":1,"plugins":[]}', '{"version":1,"plugins":{"bad":{}}}']) {
    await write(root, '.wondev/plugins.lock.json', raw);
    await expect(loadPluginLock(root)).rejects.toThrow('invalid');
  }
});

it('routes bundled installation and activation through the existing skill controls', async () => {
  await silence(() => runPlugins(root, 'install', 'context-maintenance', { noBuild: true }));
  expect(await exists(root, '.wondev/skills/context-maintenance/SKILL.md')).toBe(true);
  await silence(() => runPlugins(root, 'disable', 'context-maintenance', { noBuild: true }));
  expect(await read(root, '.wondev/wondev.yaml')).toContain('context-maintenance');
  await silence(() => runPlugins(root, 'enable', 'context-maintenance', { noBuild: true }));
});

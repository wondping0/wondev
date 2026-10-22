import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/core/config.js';
import { scanApplication } from '../src/core/application-map.js';
import { main } from '../src/cli.js';
import { cleanup, exists, read, silence, tmpRoot, write } from './helpers.js';

let root: string;
beforeEach(async () => { root = await tmpRoot(); });
afterEach(async () => { vi.restoreAllMocks(); await cleanup(root); });

it('reports per-service coverage and unsupported languages without inventing cross-language edges', async () => {
  await write(root, '.wondev/wondev.yaml', 'targets: [agents]\nmap:\n  roots:\n    web: apps/web\n    api: services/api\n  exclude: ["apps/web/generated/**"]\n');
  await write(root, 'apps/web/index.ts', "import './util.js'; import '@app/config';");
  await write(root, 'apps/web/util.ts', 'export const x = 1;');
  await write(root, 'apps/web/broken.ts', 'export const = ;');
  await write(root, 'apps/web/App.vue', '<template>hello</template>');
  await write(root, 'apps/web/generated/ignored.ts', 'unused');
  await write(root, 'services/api/main.py', 'print("must not run")');
  await write(root, 'services/api/store.sql', 'SELECT 1;');
  await write(root, 'outside/ignored.ts', 'unused');
  const map = await scanApplication(root, await loadConfig(root));
  expect(map.coverage?.services).toEqual([
    { name: 'web', root: 'apps/web', parsed: 2, parseErrors: 1, packages: 0, unsupported: 1 },
    { name: 'api', root: 'services/api', parsed: 0, parseErrors: 0, packages: 0, unsupported: 2 },
  ]);
  expect(map.coverage?.unsupported.map((f) => f.language).sort()).toEqual(['Python', 'SQL', 'Vue SFC']);
  expect(map.coverage?.unresolvedImports).toBe(1);
  const lines: string[] = [];
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation((text) => { lines.push(String(text)); return true; });
  await main(['map', '--cwd', root, '--dry-run', '--json']);
  expect(JSON.parse(lines.join('')).coverage.services).toHaveLength(2);
  spy.mockRestore();
  expect(await exists(root, '.wondev/map-coverage.json')).toBe(false);
  await silence(() => main(['map', '--cwd', root, '--no-build']));
  expect(JSON.parse(await read(root, '.wondev/map-coverage.json')).unsupported).toHaveLength(3);
});

it.each([
  'map: []', 'map: {}', 'map: {roots: []}', 'map: {roots: {}}',
  'map: {roots: {"Bad Name": app}}', 'map: {roots: {api: ../external}}',
  'map: {roots: {app: apps, nested: apps/api}}', 'map: {roots: {app: ., nested: apps}}',
  'map: {roots: {a: Apps, b: apps}}', 'map: {roots: {app: apps}, exclude: [3]}',
])('rejects invalid map configuration: %s', async (config) => {
  await write(root, '.wondev/wondev.yaml', config);
  await expect(loadConfig(root)).rejects.toThrow();
});

it('refuses missing and excluded scan roots and allows an explicit project root', async () => {
  for (const directory of ['missing', '.wondev', 'node_modules', 'knowledge']) {
    await write(root, '.wondev/wondev.yaml', `vault: knowledge\nmap:\n  roots: {app: ${directory}}\n`);
    await expect(scanApplication(root, await loadConfig(root))).rejects.toThrow(/directory|excluded/);
  }
  await write(root, '.wondev/wondev.yaml', 'map:\n  roots: {app: .}\n');
  expect((await scanApplication(root, await loadConfig(root))).coverage?.roots).toEqual({ app: '.' });
});

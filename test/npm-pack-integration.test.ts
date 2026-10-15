import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterEach, expect, it, vi } from 'vitest';
import { installPack, syncPacks } from '../src/core/packs.js';
import { cleanup, read, seedProject, tmpRoot, write } from './helpers.js';

const execute = promisify(execFile);
afterEach(() => { vi.unstubAllEnvs(); });

it('downloads a real npm tarball through a local registry, without running package lifecycle scripts', async () => {
  const root = await tmpRoot();
  let server: http.Server | undefined;
  try {
    await seedProject(root, ['agents']);
    const directory = path.join(root, 'fixture');
    await write(root, 'fixture/package.json', JSON.stringify({ name: '@wondev-test/skills', version: '1.0.0', files: ['skills'], scripts: { postinstall: 'node -e "process.exit(42)"' } }));
    await write(root, 'fixture/skills/registry-check/SKILL.md', '---\nname: registry-check\ndescription: Inspect registry metadata\n---\nCheck integrity.\n');
    await write(root, 'fixture/skills/registry-check/assets/data.json', '{"value":42}\n');
    const npmCli = process.env['npm_execpath'] ?? path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
    const packed = await execute(process.execPath, [npmCli, 'pack', '--ignore-scripts', '--json'], { cwd: directory, windowsHide: true });
    const tarball = await fs.readFile(path.join(directory, (JSON.parse(packed.stdout) as Array<{ filename: string }>)[0]!.filename));
    let registry = '';
    const requests: string[] = [];
    server = http.createServer((request, response) => {
      requests.push(request.url ?? '');
      if (request.url?.endsWith('.tgz')) { response.setHeader('content-type', 'application/octet-stream'); response.end(tarball); return; }
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({
        name: '@wondev-test/skills', 'dist-tags': { latest: '1.0.0' },
        versions: { '1.0.0': { name: '@wondev-test/skills', version: '1.0.0', dist: {
          tarball: `${registry}/skills.tgz`, shasum: crypto.createHash('sha1').update(tarball).digest('hex'), integrity: `sha512-${crypto.createHash('sha512').update(tarball).digest('base64')}`,
        } } },
      }));
    });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    registry = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    vi.stubEnv('npm_config_registry', registry);
    vi.stubEnv('npm_config_cache', path.join(root, 'npm-cache'));
    vi.stubEnv('WONDEV_NPM_CLI', npmCli);
    const result = await installPack(root, 'npm:@wondev-test/skills@1.0.0');
    expect(result.version).toBe('1.0.0');
    expect(await read(root, '.wondev/skills/registry-check/assets/data.json')).toBe('{"value":42}\n');
    expect(requests.some((url) => url.endsWith('.tgz'))).toBe(true);
    await syncPacks(root);
  } finally {
    if (server) { server.closeAllConnections(); await new Promise<void>((resolve) => server!.close(() => resolve())); }
    await cleanup(root);
  }
}, 60000);

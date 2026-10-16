import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installPack, loadPackLock, syncPacks, updatePack } from '../src/core/packs.js';
import { loadContext } from '../src/commands/context.js';
import { cleanup, exists, read, seedProject, tmpRoot, write } from './helpers.js';

let root: string;
const packageRoot = 'packs/team';
const source = `local:${packageRoot}`;
const skillPath = '.wondev/skills/testing/SKILL.md';
const original = '---\nname: testing\ndescription: Use for unit testing\n---\nWrite a failing test.\n';

async function pack(version = '1.0.0', name = '@team/pack') {
  await write(root, `${packageRoot}/package.json`, JSON.stringify({ name, version, wondev: { skills: 'skills' }, scripts: { postinstall: 'this-must-never-run' } }));
  await write(root, `${packageRoot}/skills/testing/SKILL.md`, original);
  await write(root, `${packageRoot}/skills/testing/scripts/test.js`, 'console.log("testing");\n');
}
beforeEach(async () => { root = await tmpRoot(); await seedProject(root, ['agents']); await pack(); });
afterEach(async () => { vi.unstubAllEnvs(); await cleanup(root); });

describe('versioned skill packs', () => {
  it('previews installation, locks checksums, and copies complete skills', async () => {
    const preview = await installPack(root, source, { dryRun: true });
    expect(preview.changes.map((c) => c.action)).toEqual(['create', 'create']);
    expect(preview.changes.find((c) => c.path === skillPath)?.diff).toContain('+Write a failing test.');
    expect(await exists(root, skillPath)).toBe(false);
    expect(await exists(root, '.wondev/skills.lock.json')).toBe(false);
    const result = await installPack(root, source);
    expect(await read(root, skillPath)).toBe(original);
    expect(result.integrity).toMatch(/^[a-f\d]{64}$/);
    expect((await loadPackLock(root)).packs['@team/pack']?.version).toBe('1.0.0');
    expect((await loadContext(root)).project.skills.find((s) => s.name === 'testing')?.attachments[0]?.relPath).toBe('scripts/test.js');
    await expect(installPack(root, source)).rejects.toThrow('is installed');
  });

  it('updates untouched files, offers conflicts outside active sources, and preserves deletions', async () => {
    await installPack(root, source);
    await fs.appendFile(path.join(root, skillPath), '\nProject customization.\n');
    await pack('1.1.0');
    await write(root, `${packageRoot}/skills/testing/SKILL.md`, original.replace('failing test', 'regression test'));
    await write(root, `${packageRoot}/skills/testing/scripts/test.js`, 'console.log("upstream improved");');
    const preview = await updatePack(root, '@team/pack', { dryRun: true });
    expect(preview.changes.find((c) => c.path === skillPath)?.action).toBe('conflict');
    expect(await exists(root, '.wondev/skill-updates')).toBe(false);
    const result = await updatePack(root, '@team/pack');
    expect(result.version).toBe('1.1.0');
    expect(await read(root, skillPath)).toContain('Project customization');
    expect(await read(root, '.wondev/skill-updates/@team--pack/testing/SKILL.md')).toContain('regression test');
    expect(await read(root, '.wondev/skills/testing/scripts/test.js')).toContain('upstream improved');
    await fs.rm(path.join(root, '.wondev/skills/testing/scripts/test.js'));
    const deleted = await updatePack(root, '@team/pack');
    expect(deleted.changes.find((c) => c.path.endsWith('test.js'))?.action).toBe('unchanged');
    expect(await exists(root, '.wondev/skills/testing/scripts/test.js')).toBe(false);
  });

  it('removes only unchanged obsolete resources and detects local changes during frozen sync', async () => {
    await installPack(root, source);
    await fs.rm(path.join(root, `${packageRoot}/skills/testing/scripts/test.js`));
    const result = await updatePack(root, '@team/pack');
    expect(result.changes.find((c) => c.path.endsWith('test.js'))?.action).toBe('remove');
    expect(await exists(root, '.wondev/skills/testing/scripts/test.js')).toBe(false);
    await fs.rm(path.join(root, skillPath));
    await syncPacks(root);
    expect(await read(root, skillPath)).toBe(original);
    await fs.appendFile(path.join(root, skillPath), 'local change');
    await expect(syncPacks(root)).rejects.toThrow('Locally modified');
    await write(root, `${packageRoot}/skills/testing/SKILL.md`, `${original}\nChanged source.`);
    await expect(syncPacks(root)).rejects.toThrow('locked version and checksum');
  });

  it('rejects malformed packages, escaping paths, collisions, and corrupt lock entries', async () => {
    await expect(installPack(root, 'https://example.com/pack')).rejects.toThrow('Pack source');
    await expect(installPack(root, 'local:../outside')).rejects.toThrow('inside');
    await expect(installPack(root, 'npm:../../escape')).rejects.toThrow('Invalid npm');
    await expect(updatePack(root, 'missing')).rejects.toThrow('not installed');
    await write(root, '.wondev/skills/testing.md', 'mine');
    await expect(installPack(root, source)).rejects.toThrow('already exists');
    await fs.rm(path.join(root, '.wondev/skills/testing.md'));
    await installPack(root, source);
    await pack('1.0.0', '@other/pack');
    await expect(installPack(root, source)).rejects.toThrow('owned by');
    await expect(updatePack(root, '@team/pack')).rejects.toThrow('Expected pack');
    await write(root, `${packageRoot}/package.json`, '{}');
    await expect(installPack(root, source)).rejects.toThrow('valid npm name');
    await write(root, `${packageRoot}/package.json`, 'invalid json');
    await expect(installPack(root, source)).rejects.toThrow('valid package.json');
    await write(root, '.wondev/skills.lock.json', JSON.stringify({ version: 1, packs: { x: { version: '1.0.0', source, integrity: 'a'.repeat(64), files: { '../escape': 'a'.repeat(64) } } } }));
    await expect(loadPackLock(root)).rejects.toThrow('invalid');
  });

  it('does not activate invalid skills or silently claim a newly colliding skill during update', async () => {
    await installPack(root, source);
    await write(root, `${packageRoot}/skills/debugging/SKILL.md`, '---\nname: debugging\ndescription: Debug\n---\nSteps');
    await expect(updatePack(root, '@team/pack')).rejects.toThrow('already exists');
    await write(root, `${packageRoot}/skills/debugging/SKILL.md`, '---\nname: debugging\n---\nSteps');
    await expect(updatePack(root, '@team/pack')).rejects.toThrow('Invalid skill pack');
  });
});

describe('npm pack transport', () => {
  it('uses an isolated npm install with lifecycle scripts disabled and syncs the exact locked version', async () => {
    await write(root, 'npm-fixture.mjs', [
      "import fs from 'node:fs/promises'; import path from 'node:path';",
      'const args = process.argv.slice(2);',
      'if (!args.includes("--ignore-scripts") || !args.includes("--no-bin-links")) process.exit(2);',
      'const prefix = args[args.indexOf("--prefix") + 1];',
      'await fs.writeFile(process.env.WONDEV_TEST_LOG, JSON.stringify(args));',
      'await fs.cp(process.env.WONDEV_TEST_PACK, path.join(prefix, "node_modules/@team/pack"), { recursive: true });',
    ].join('\n'));
    vi.stubEnv('WONDEV_NPM_CLI', path.join(root, 'npm-fixture.mjs'));
    vi.stubEnv('WONDEV_TEST_PACK', path.join(root, packageRoot));
    vi.stubEnv('WONDEV_TEST_LOG', path.join(root, 'npm-args.json'));
    const result = await installPack(root, 'npm:@team/pack@latest');
    expect(result.version).toBe('1.0.0');
    const args = JSON.parse(await read(root, 'npm-args.json')) as string[];
    expect(args).toContain('--ignore-scripts');
    expect(args[args.indexOf('--prefix') + 1]).not.toBe(root);
    expect(await exists(root, 'package.json')).toBe(false);
    await syncPacks(root);
    expect(JSON.parse(await read(root, 'npm-args.json'))).toContain('@team/pack@1.0.0');
    await write(root, 'npm-fixture.mjs', 'process.exit(3);');
    await expect(updatePack(root, '@team/pack')).rejects.toThrow('npm could not download');
  });
});

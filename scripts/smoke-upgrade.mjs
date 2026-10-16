import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const { values } = parseArgs({ options: { from: { type: 'string', default: '1.1.1' } } });
const previous = values.from;
assert.match(previous, /^\d+\.\d+\.\d+(?:-[\da-zA-Z.-]+)?$/, '--from must be an exact version');
const execute = promisify(execFile);
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const npmCli = process.env.npm_execpath ?? path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
// The published 1.1.1 CLI cannot recognize a symlinked entry path. Resolve macOS's
// temporary-directory alias for the baseline; the candidate bin is tested by test:package.
const tempRoot = await fs.realpath(os.tmpdir());
const temp = await fs.mkdtemp(path.join(tempRoot, 'wondev-upgrade-smoke-'));
const app = path.join(temp, 'application');
const version = JSON.parse(await fs.readFile(path.join(repository, 'package.json'), 'utf8')).version;
assert.notEqual(previous, version, 'The upgrade baseline must differ from the version under test');
const npm = async (args, cwd = repository) => (await execute(process.execPath, [npmCli, ...args], { cwd, windowsHide: true, timeout: 120000, maxBuffer: 4 * 1024 * 1024 })).stdout;
const run = async (...args) => (await execute(process.execPath, [path.join(app, 'node_modules/wondev/dist/cli.js'), ...args, '--cwd', app, '--no-color'], { cwd: app, windowsHide: true, timeout: 30000 })).stdout;
const write = async (relative, content) => {
  const file = path.join(app, relative);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content);
};
const read = (relative) => fs.readFile(path.join(app, relative), 'utf8');

try {
  await write('package.json', '{"name":"wondev-upgrade-app","version":"1.0.0","private":true}\n');
  await npm(['install', '--ignore-scripts', '--no-audit', '--no-fund', `wondev@${previous}`], app);
  assert.equal((await run('--version')).trim(), previous);
  await run('init', '--targets', 'claude,agents,cursor');
  await run('check');

  const editedSkill = (await read('.wondev/skills/debugging/SKILL.md')) + '\nKeep the project-specific debugging procedure.\n';
  const editedMemory = (await read('.wondev/memory/architecture.md')) + '\nThe application uses one deployment unit.\n';
  await write('.wondev/skills/debugging/SKILL.md', editedSkill);
  await write('.wondev/memory/architecture.md', editedMemory);
  await write('.wondev/skills/debugging/references/project.md', 'Preserve this authored reference.\r\n');
  const binary = Buffer.from([0, 255, 13, 10, 192]);
  await write('.wondev/skills/debugging/assets/sample.bin', binary);
  await write('AGENTS.md', 'Human-owned introduction.\n\n' + await read('AGENTS.md'));
  await run('build');
  await run('check');

  const packed = JSON.parse(await npm(['pack', '--ignore-scripts', '--json', '--pack-destination', temp]));
  await npm(['install', '--ignore-scripts', '--no-audit', '--no-fund', path.join(temp, packed[0].filename)], app);
  assert.equal((await run('--version')).trim(), version);
  await assert.rejects(() => run('check'), (error) => error.code === 1);
  await run('migrate');
  await run('upgrade');
  await run('build');
  await run('check');
  await run('doctor');
  assert.match(await read('.wondev/.gitignore'), /^\.lock$/m);
  assert.equal(await read('.wondev/skills/debugging/SKILL.md'), editedSkill);
  assert.equal(await read('.wondev/memory/architecture.md'), editedMemory);
  assert.equal(await read('.claude/skills/debugging/references/project.md'), 'Preserve this authored reference.\r\n');
  assert.deepEqual(await fs.readFile(path.join(app, '.claude/skills/debugging/assets/sample.bin')), binary);
  assert.match(await read('AGENTS.md'), /^Human-owned introduction\./);
  assert.equal(parse(await read('.wondev/wondev.yaml')).wondevVersion, version);
  await assert.rejects(() => fs.access(path.join(app, 'knowledge')), { code: 'ENOENT' });

  // Opting into the vault after upgrading must retain authored sources and provenance.
  await run('vault', 'knowledge');
  await run('upgrade');
  await run('build');
  await run('check');
  assert.equal(await read('knowledge/skills/debugging/SKILL.md'), editedSkill);
  assert.equal(await read('knowledge/memory/architecture.md'), editedMemory);
  await assert.rejects(() => fs.access(path.join(app, '.wondev/memory')), { code: 'ENOENT' });
  const packet = JSON.parse(await run('context', '--task', 'debug application failures', '--budget', '8000', '--json'));
  assert(packet.selected.some((item) => item.kind === 'skill' && item.id === 'debugging'));
  assert(packet.tokens <= 8000);
  await run('clean');
  assert.equal((await read('AGENTS.md')).trim(), 'Human-owned introduction.');
  assert.equal(await read('knowledge/memory/architecture.md'), editedMemory);
  console.log(`Upgrade ${previous} -> ${version}: user edits, resources, schema, build/check, vault conversion, context, and clean passed.`);
} finally {
  const relative = path.relative(tempRoot, temp);
  if (relative.startsWith('wondev-upgrade-smoke-') && !relative.includes(path.sep)) await fs.rm(temp, { recursive: true, force: true });
}

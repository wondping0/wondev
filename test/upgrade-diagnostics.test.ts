import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { runBuild } from '../src/commands/build.js';
import { runCheck } from '../src/commands/check.js';
import { runDoctor } from '../src/commands/doctor.js';
import { runAdopt } from '../src/commands/adopt.js';
import { runBundledInstall } from '../src/commands/bundled-skills.js';
import { runUpgrade } from '../src/commands/upgrade.js';
import { runSkillInfo } from '../src/commands/skills.js';
import { inspectGitDistribution } from '../src/core/git-distribution.js';
import { loadTemplateManifest } from '../src/core/templates.js';
import { main } from '../src/cli.js';
import { sha256 } from '../src/util/fs.js';
import { catchWondevError, cleanup, exists, read, seedProject, silence, tmpRoot, write } from './helpers.js';

const exec = promisify(execFile);
let root: string;
beforeEach(async () => { root = await tmpRoot(); process.exitCode = 0; });
afterEach(async () => { process.exitCode = 0; await cleanup(root); });
const git = (args: string[], cwd = root) => exec('git', args, { cwd, windowsHide: true });

it('accepts LF/CRLF-only changes in reference Markdown but refuses prose edits and binary changes', async () => {
  await seedProject(root, ['agents']);
  await write(root, '.wondev/skills/debugging/references/example.md', '# Example\n\nProcedure.\n');
  await write(root, '.wondev/skills/debugging/assets/sample.bin', '\0first\r\nsecond');
  await silence(() => runBuild(root));
  const ref = '.agents/skills/debugging/references/example.md';
  await write(root, ref, (await read(root, ref)).replace(/\n/g, '\r\n'));
  await silence(() => runCheck(root));
  // Also accept old manifests whose raw Markdown hash was written on Windows.
  const manifest = JSON.parse(await read(root, '.wondev/.manifest.json'));
  manifest.files[ref].hash = sha256(await read(root, ref));
  await write(root, '.wondev/.manifest.json', JSON.stringify(manifest));
  await write(root, ref, (await read(root, ref)).replace(/\r\n/g, '\n'));
  await silence(() => runCheck(root));
  await write(root, ref, '# Changed procedure\n');
  await expect(silence(() => runBuild(root))).rejects.toThrow('edited since');
  await write(root, ref, '# Example\n\nProcedure.\n');
  await write(root, '.agents/skills/debugging/assets/sample.bin', '\0first\nsecond');
  await expect(silence(() => runCheck(root))).rejects.toThrow('do not match');
});

it('passes check after a clean Git clone using core.autocrlf=true', async () => {
  await seedProject(root, ['claude', 'agents']);
  await write(root, '.wondev/skills/debugging/references/windows.md', '# Reference\n\nUntouched text.\n');
  await silence(() => runBuild(root));
  await git(['init', '-q']);
  await git(['-c', 'core.autocrlf=false', 'add', '.']);
  await git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture']);
  const clone = await tmpRoot();
  try {
    await git(['clone', '-c', 'core.autocrlf=true', '-q', root, clone]);
    expect(await read(clone, '.agents/skills/debugging/references/windows.md')).toContain('\r\n');
    await silence(() => runCheck(clone));
    await silence(() => runBuild(clone));
    expect((await git(['status', '--porcelain'], clone)).stdout, (await git(['diff', '--', '.wondev/.manifest.json'], clone)).stdout).toBe('');
  } finally { await cleanup(clone); }
});

it('distinguishes ignored, untracked, missing and Git-tracked outputs without changing Git', async () => {
  await seedProject(root, ['agents']);
  await silence(() => runBuild(root));
  await git(['init', '-q']);
  await write(root, '.gitignore', '.agents/\n');
  const report = await inspectGitDistribution(root);
  expect(report.files.find((f) => f.path === 'AGENTS.md')?.status).toBe('untracked');
  expect(report.files.find((f) => f.path.startsWith('.agents/'))).toMatchObject({ managed: true, status: 'ignored', ignoreRule: expect.stringContaining('.agents/') });
  await silence(() => runCheck(root));
  await expect(silence(() => runCheck(root, undefined, { git: true }))).rejects.toThrow('not distributed by Git');
  await silence(() => runDoctor(root, { git: true }));
  await git(['add', '-f', '--', '.']);
  await silence(() => main(['check', '--cwd', root, '--git']));
  expect((await inspectGitDistribution(root)).files.every((f) => f.status === 'tracked')).toBe(true);
  await fs.rm(path.join(root, 'AGENTS.md'));
  expect((await inspectGitDistribution(root)).files.find((f) => f.path === 'AGENTS.md')?.status).toBe('missing');
});

it('reports Git unavailability for a nonrepository, including doctor and explicit check', async () => {
  await seedProject(root, ['agents']);
  await silence(() => runBuild(root));
  expect((await inspectGitDistribution(root)).available).toBe(false);
  await silence(() => main(['doctor', '--cwd', root, '--git']));
  await expect(silence(() => runCheck(root, undefined, { git: true }))).rejects.toThrow('Git is unavailable');
});

it('installs a bundled skill after adopt, and future upgrades only manage selected starters', async () => {
  await write(root, 'AGENTS.md', '# Application\nAuthored rules.\n');
  await silence(() => runAdopt(root));
  const hint = await catchWondevError(() => runSkillInfo(root, 'understand-anything'));
  expect(hint.hint).toContain('install bundled:understand-anything');
  await silence(() => main(['skills', 'install', 'bundled:understand-anything', '--cwd', root, '--dry-run']));
  expect(await exists(root, '.wondev/.templates.json')).toBe(false);
  await silence(() => main(['skills', 'install', 'bundled:understand-anything', '--cwd', root]));
  await silence(() => runBundledInstall(root, 'understand-anything'));
  expect((await loadTemplateManifest(root))?.scope).toEqual(['skills/understand-anything']);
  await silence(() => runUpgrade(root));
  expect(await exists(root, '.wondev/memory/architecture.md')).toBe(false);
  expect(await exists(root, '.wondev/skills/ui-ux-pro-max')).toBe(false);
  await silence(() => runBundledInstall(root, 'ui-ux-pro-max', { noBuild: true }));
  expect((await loadTemplateManifest(root))?.scope).toHaveLength(2);
  expect(await fs.readFile(path.join(root, '.wondev/skills/ui-ux-pro-max/scripts/search.py'))).toEqual(await fs.readFile('templates/skills/ui-ux-pro-max/scripts/search.py'));
});

it('rejects unsafe names, edited resources, flat-name collisions and corrupt starter provenance before writing', async () => {
  await seedProject(root, ['agents']);
  await expect(runBundledInstall(root, '../unsafe')).rejects.toThrow('Unknown bundled');
  await expect(runBundledInstall(root, 'debugging')).rejects.toThrow('overwrite an existing');
  expect(await exists(root, '.wondev/.templates.json')).toBe(false);
  await write(root, '.wondev/skills/understand-anything.md', '# Mine');
  await expect(runBundledInstall(root, 'understand-anything')).rejects.toThrow('already uses this name');
  await write(root, '.wondev/.templates.json', '{bad');
  await expect(runBundledInstall(root, 'ui-ux-pro-max')).rejects.toThrow('provenance is invalid');
});

it('installs all bundles into custom source paths without adding unrelated memory', async () => {
  await write(root, '.wondev/wondev.yaml', 'targets: [agents]\nsources:\n  skills: knowledge/skills\n');
  await silence(() => runBundledInstall(root, 'all', { noBuild: true }));
  expect(await exists(root, 'knowledge/skills/debugging/SKILL.md')).toBe(true);
  expect(await exists(root, '.wondev/skills')).toBe(false);
  await silence(() => runUpgrade(root));
  expect(await exists(root, '.wondev/memory')).toBe(false);
  await write(root, '.wondev/.templates.json', '{"version":"1.0.0","files":{},"scope":["../bad"]}');
  expect(await loadTemplateManifest(root)).toBeNull();
});

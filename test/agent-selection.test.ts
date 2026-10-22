import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { main } from '../src/cli.js';
import { runSelection, inspectAgent, runAgentCheck } from '../src/commands/agent.js';
import { runBuild } from '../src/commands/build.js';
import { loadContext } from '../src/commands/context.js';
import { loadConfig, validateTarget } from '../src/core/config.js';
import { detectAgent, pythonRuntime, understandRuntime } from '../src/core/agent-environment.js';
import { runSkillCatalog, runSkillInfo } from '../src/commands/skills.js';
import { runInit } from '../src/commands/init.js';
import { runVault } from '../src/commands/vault.js';
import { cleanup, exists, read, seedProject, silence, tmpRoot, write } from './helpers.js';

let root: string;
let exitCode: typeof process.exitCode;
beforeEach(async () => { root = await tmpRoot(); exitCode = process.exitCode; process.exitCode = undefined; await seedProject(root, ['claude', 'agents']); });
afterEach(async () => { process.exitCode = exitCode; vi.unstubAllEnvs(); await cleanup(root); });
const select = (action: Parameters<typeof runSelection>[1], name: string, opts = {}) => silence(() => runSelection(root, action, name, opts));

describe('agent evidence and rules', () => {
  it('distinguishes an explicit choice, environment hints, ambiguity and unknown hosts', () => {
    expect(detectAgent({})).toMatchObject({ candidates: [], evidence: [] });
    expect(detectAgent({ CODEX_THREAD_ID: 'private-id' })).toEqual({ agent: 'codex', evidence: ['CODEX_THREAD_ID'], candidates: ['codex'] });
    expect(detectAgent({ CODEX_THREAD_ID: 'x', CLAUDECODE: '1' }).agent).toBeUndefined();
    expect(detectAgent({ CLAUDECODE: '1', WONDEV_AGENT: 'custom' }).agent).toBe('custom');
    expect(detectAgent({ WONDEV_AGENT: 'claude' }, 'codex').agent).toBe('codex');
    expect(detectAgent({ CURSOR_AGENT: '1' }).agent).toBe('cursor');
    expect(detectAgent({ GEMINI_CLI: '1' }).agent).toBe('gemini');
  });

  it('reports configured rules, source paths, host mismatch and drift without modifying files', async () => {
    const before = await read(root, '.wondev/wondev.yaml');
    let report = await inspectAgent(root, { env: {} });
    expect(report.currentAgent.agent).toBeUndefined();
    expect(report.output.changes.length).toBeGreaterThan(0);
    expect(report.rules[0]?.path).toBe('.wondev/memory/architecture.md');
    expect(await read(root, '.wondev/wondev.yaml')).toBe(before);
    await silence(() => runBuild(root));
    report = await inspectAgent(root, { agent: 'codex', env: {} });
    expect(report.currentAgent).toMatchObject({ canonical: 'agents', enabled: true });
    expect(report.output.changes).toEqual([]);
    expect((await inspectAgent(root, { agent: 'cursor' })).currentAgent.enabled).toBe(false);
    await expect(inspectAgent(root, { agent: '__proto__' })).rejects.toThrow('Unknown agent');
    await write(root, '.codex-plugin/plugin.json', '{"name":"custom"}');
    await write(root, '.claude-plugin/plugin.json', '{bad');
    await write(root, 'plugin.json', '{}');
    report = await inspectAgent(root, { env: {} });
    expect(report.plugins.map((p) => p.status)).toEqual(['invalid-json', 'manifest-present; activation-unverified', 'invalid-manifest']);
    await silence(() => runAgentCheck(root, { agent: 'codex', json: true }));
    expect(process.exitCode).toBe(1);
    await silence(() => runAgentCheck(root, { agent: 'cursor' }));
  });

  it('reports optional prerequisites honestly, including a missing or unbuilt upstream runtime', async () => {
    await silence(() => runInit(root, { force: true, targets: ['agents'], skipBuild: true }));
    const report = await inspectAgent(root, { env: {}, python: async () => null });
    expect(report.prerequisites.python).toBeNull();
    expect(report.prerequisites.browser).toContain('not-probed');
    const plugin = path.join(root, 'upstream');
    expect(await understandRuntime(root, {}, root)).toEqual({ status: 'needs-setup' });
    await write(root, 'upstream/skills/understand/SKILL.md', 'upstream');
    await write(root, 'upstream/packages/core/package.json', '{}');
    expect(await understandRuntime(root, { UNDERSTAND_ANYTHING_ROOT: plugin }, root)).toMatchObject({ status: 'needs-build' });
    await write(root, 'upstream/packages/core/dist/index.js', '');
    expect(await understandRuntime(root, { CLAUDE_PLUGIN_ROOT: plugin }, root)).toMatchObject({ status: 'built-files-present' });
    // Missing executables should report a missing prerequisite instead of throwing.
    vi.stubEnv('PATH', path.join(root, 'empty-path'));
    expect(await pythonRuntime()).toBeNull();
  });
});

describe('reversible skill and agent selection', () => {
  it('switches to Codex native skills and preserves authored knowledge and handwritten instructions', async () => {
    await write(root, '.wondev/skills/debugging/scripts/check.mjs', 'export const check = true;\n');
    await silence(() => runBuild(root));
    const claude = await read(root, 'CLAUDE.md');
    await write(root, 'CLAUDE.md', '# Personal rule\n\n' + claude);
    const before = await read(root, '.wondev/wondev.yaml');
    await select('agent', 'codex', { dryRun: true });
    expect(await read(root, '.wondev/wondev.yaml')).toBe(before);
    await select('agent', 'codex');
    expect((await loadConfig(root)).targets).toEqual(['agents']);
    expect(await read(root, 'CLAUDE.md')).toBe('# Personal rule\n');
    expect(await exists(root, '.claude/skills/debugging/SKILL.md')).toBe(false);
    expect(await read(root, '.agents/skills/debugging/scripts/check.mjs')).toBe('export const check = true;\n');
    expect(await exists(root, '.wondev/skills/debugging/SKILL.md')).toBe(true);
  });

  it('disables and restores resources across hosts without deleting source files', async () => {
    await silence(() => runBuild(root));
    await select('disable', 'debugging');
    expect((await loadContext(root)).project.skills).toEqual([]);
    expect(await exists(root, '.agents/skills/debugging/SKILL.md')).toBe(false);
    expect(await exists(root, '.claude/skills/debugging/SKILL.md')).toBe(false);
    expect(await exists(root, '.wondev/skills/debugging/SKILL.md')).toBe(true);
    await select('enable', 'debugging');
    expect(await exists(root, '.agents/skills/debugging/SKILL.md')).toBe(true);
  });

  it('preserves local edits and configuration when selection would overwrite or retire an edited output', async () => {
    await silence(() => runBuild(root));
    const before = await read(root, '.wondev/wondev.yaml');
    await write(root, '.claude/skills/debugging/SKILL.md', 'hand edit');
    await expect(select('disable', 'debugging')).rejects.toThrow('Refusing to retire');
    await expect(select('agent', 'claude')).rejects.toThrow('Refusing to overwrite');
    expect(await read(root, '.wondev/wondev.yaml')).toBe(before);
    expect(await read(root, '.claude/skills/debugging/SKILL.md')).toBe('hand edit');
  });

  it('respects profiles, permits clearing them, and supports no-build and vault sources', async () => {
    await write(root, '.wondev/wondev.yaml', '# Keep this comment\ntargets: [agents]\nprofiles:\n  empty:\n    skills: []\n  core:\n    skills: [debugging]\n');
    await silence(() => runVault(root, 'knowledge'));
    await select('profile', 'empty');
    await select('enable', 'debugging');
    expect((await loadContext(root)).project.skills).toEqual([]);
    expect((await inspectAgent(root, { env: {} })).skills[0]?.status).toBe('outside-profile');
    await select('profile', 'core');
    await select('profile', '*');
    expect(await read(root, '.wondev/wondev.yaml')).toContain('# Keep this comment');
    await select('disable', 'debugging', { noBuild: true });
    expect(await exists(root, '.agents/skills/debugging/SKILL.md')).toBe(true);
    const report = await inspectAgent(root, { env: {} });
    expect(report.skills[0]).toMatchObject({ status: 'disabled', path: 'knowledge/skills/debugging/SKILL.md' });
    expect(report.output.retired).toContain('.agents/skills/debugging/SKILL.md');
  });

  it('rejects invalid selections, malformed config and escaping native skill paths', async () => {
    await expect(select('agent', 'missing')).rejects.toThrow('Unknown agent');
    await expect(select('enable', 'missing')).rejects.toThrow('Unknown project skill');
    await expect(select('profile', 'constructor')).rejects.toThrow('Unknown profile');
    expect(() => validateTarget('custom', { engine: 'single-file', path: 'RULES.md', skills: '../outside' })).toThrow('relative path');
    expect(validateTarget('custom', { engine: 'single-file', path: 'RULES.md', skills: '.tool/skills' })).toMatchObject({ skills: '.tool/skills' });
    await write(root, '.wondev/wondev.yaml', 'disabledSkills: ["../bad"]');
    await expect(loadConfig(root)).rejects.toThrow('disabledSkills');
  });

  it('supports custom host names and generates a skills-only portable plugin with valid JSON manifests', async () => {
    await write(root, '.wondev/wondev.yaml', 'targets: [agents]\ncustomTargets:\n  claude-pro:\n    engine: single-file\n    path: PRO.md\n    skills: .pro/skills\n');
    await select('agent', 'claude-pro');
    expect((await inspectAgent(root, { agent: 'claude-pro', env: {} })).currentAgent.enabled).toBe(true);
    await select('agent', 'plugin');
    expect((await inspectAgent(root, { agent: 'codex', env: {} })).currentAgent).toMatchObject({ enabled: null, delivery: 'plugin-package; activation-unverified' });
    await silence(() => runAgentCheck(root, { agent: 'codex' }));
    expect(process.exitCode).toBeUndefined();
    for (const rel of ['plugin.json', '.codex-plugin/plugin.json', '.claude-plugin/plugin.json']) {
      expect(JSON.parse(await read(root, `.wondev/plugins/project/${rel}`))).toMatchObject({ name: 'wondev-project-skills', version: '1.0.0' });
    }
    expect(await exists(root, '.wondev/plugins/project/skills/debugging/SKILL.md')).toBe(true);
    expect(await exists(root, '.wondev/plugins/project/hooks')).toBe(false);
    expect(() => validateTarget('bad', { engine: 'skill-plugin', path: 'out', name: 'BAD', version: '1.0.0' })).toThrow('name');
    expect(() => validateTarget('bad', { engine: 'skill-plugin', path: 'out', name: 'valid', version: 'latest' })).toThrow('version');
    expect(validateTarget('pack', { engine: 'skill-plugin', path: 'out', name: 'valid', version: '2.0.0' }).engine).toBe('skill-plugin');
  });
});

it('wires the public CLI commands, catalog, setup information and usage errors', async () => {
  await silence(() => runSkillCatalog());
  await silence(() => runSkillCatalog(true));
  await silence(() => runSkillInfo(root, 'debugging'));
  await silence(() => runSkillInfo(root, 'debugging', true));
  await expect(runSkillInfo(root, 'absent')).rejects.toThrow('Unknown project skill');
  for (const argv of [['skills', 'catalog', '--json'], ['skills', 'info', 'debugging'], ['skills', 'disable', 'debugging'], ['skills', 'enable', 'debugging'], ['skills', 'use', '--all'], ['agent', 'use', 'codex'], ['agent', 'check', '--agent', 'codex', '--json']]) {
    expect(await silence(() => main([...argv, '--cwd', root]))).toBe(0);
  }
  for (const argv of [['skills', 'enable'], ['skills', 'use'], ['agent', 'use'], ['agent', 'bad']]) await expect(silence(() => main([...argv, '--cwd', root]))).rejects.toThrow('Usage:');
  await silence(() => runInit(root, { force: true, skipBuild: true, targets: ['agents'] }));
  await silence(() => runSkillInfo(root, 'understand-anything'));
});

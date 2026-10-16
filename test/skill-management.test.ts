import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runBuild } from '../src/commands/build.js';
import { runCheck } from '../src/commands/check.js';
import { runClean } from '../src/commands/clean.js';
import { loadContext } from '../src/commands/context.js';
import { loadConfig } from '../src/core/config.js';
import { evaluateTriggers, validateSkill } from '../src/core/skill-quality.js';
import { targetCapabilities } from '../src/core/registry.js';
import { runSkillEval, runSkillValidate } from '../src/commands/skills.js';
import { cleanup, exists, read, seedProject, silence, tmpRoot, write } from './helpers.js';

let root: string;
beforeEach(async () => { root = await tmpRoot(); await seedProject(root, ['claude', 'agents']); });
afterEach(async () => { await cleanup(root); });

describe('portable skill resources', () => {
  it('preserves metadata, script bytes, Markdown line endings, and binary assets through build/check/clean', async () => {
    await write(root, '.wondev/skills/debugging/SKILL.md', '---\nname: debugging\ndescription: Debug failures\nlicense: MIT\ncompatibility: Requires Node.js\nallowed-tools: Read\nmetadata:\n  version: "1.0"\n---\nRun scripts/check.js and read references/guide.md.\n');
    const script = '#!/usr/bin/env node\r\nprocess.stdout.write("ok");\r\n';
    const markdown = '# Guide\r\n\r\nKeep bytes.\r\n';
    await write(root, '.wondev/skills/debugging/scripts/check.js', script);
    await write(root, '.wondev/skills/debugging/references/guide.md', markdown);
    await fs.mkdir(path.join(root, '.wondev/skills/debugging/assets'));
    const bytes = Buffer.from([0, 255, 192, 128, 10, 13]);
    await fs.writeFile(path.join(root, '.wondev/skills/debugging/assets/example.bin'), bytes);
    await silence(() => runBuild(root));
    expect(await read(root, '.claude/skills/debugging/scripts/check.js')).toBe(script);
    expect(await read(root, '.claude/skills/debugging/references/guide.md')).toBe(markdown);
    expect(await fs.readFile(path.join(root, '.claude/skills/debugging/assets/example.bin'))).toEqual(bytes);
    expect(await read(root, '.claude/skills/debugging/SKILL.md')).toContain('license: MIT');
    expect(await read(root, '.claude/skills/debugging/SKILL.md')).toContain('allowed-tools: Read');
    await silence(() => runCheck(root));
    await write(root, '.claude/skills/debugging/scripts/check.js', 'user edit');
    await expect(silence(() => runBuild(root))).rejects.toThrow('Refusing to overwrite');
    await silence(() => runClean(root));
    expect(await exists(root, '.claude/skills/debugging/assets/example.bin')).toBe(false);
    expect(await exists(root, '.wondev/skills/debugging/assets/example.bin')).toBe(true);
  });

  it('validates optional metadata and portable names without executing resources', async () => {
    const skill = (await loadContext(root)).project.skills[0]!;
    expect(validateSkill(skill)).toEqual([]);
    expect(validateSkill({ ...skill, name: 'Bad--Name', description: '', body: '', frontmatter: { license: false, compatibility: 'x'.repeat(501), metadata: { n: 1 }, 'allowed-tools': [] } })).toHaveLength(8);
    await silence(() => runSkillValidate(root));
    await write(root, '.wondev/skills/debugging/SKILL.md', '---\nname: debugging\ndescription: d\nmetadata: [bad]\n---\nbody');
    await expect(runSkillValidate(root)).rejects.toThrow('metadata');
  });
});

describe('skill profiles and trigger cases', () => {
  it('uses configured and per-command profiles and retires inactive generated skills', async () => {
    await write(root, '.wondev/skills/ui/SKILL.md', '---\nname: ui\ndescription: Design components\n---\nInspect layouts.');
    await write(root, '.wondev/wondev.yaml', 'targets: [claude, agents]\nprofile: backend\nprofiles:\n  backend:\n    skills: [debugging]\n  frontend:\n    skills: [ui]\n  all:\n    skills: ["*", "!ui"]\n');
    await silence(() => runBuild(root));
    expect(await exists(root, '.claude/skills/ui/SKILL.md')).toBe(false);
    await silence(() => runBuild(root, { profile: 'frontend' }));
    expect(await exists(root, '.claude/skills/debugging/SKILL.md')).toBe(false);
    expect(await exists(root, '.claude/skills/ui/SKILL.md')).toBe(true);
    await silence(() => runCheck(root, 'frontend'));
    expect((await loadContext(root, 'all')).project.skills.map((s) => s.name)).toEqual(['debugging']);
    await expect(loadContext(root, 'missing')).rejects.toThrow('Unknown profile');
  });

  it('rejects malformed profiles and evaluates positive and negative trigger cases', async () => {
    const project = (await loadContext(root)).project;
    const cases = [{ task: 'Investigating a failure', expected: ['debugging'] }, { task: 'Write release announcement', expected: [], forbidden: ['debugging'] }];
    expect(evaluateTriggers(project, cases).every((r) => r.passed)).toBe(true);
    expect(evaluateTriggers(project, [{ task: 'Write release announcement', expected: ['debugging'] }])[0]?.passed).toBe(false);
    expect(() => evaluateTriggers(project, [])).toThrow();
    expect(() => evaluateTriggers(project, [{ task: '', expected: [] }])).toThrow();
    expect(() => evaluateTriggers(project, [{ task: 'x', expected: ['missing'] }])).toThrow('unknown skill');
    await write(root, 'cases.json', JSON.stringify(cases));
    await silence(() => runSkillEval(root, 'cases.json'));
    await write(root, 'cases.json', JSON.stringify([{ task: 'failure', expected: [], forbidden: ['debugging'] }]));
    await expect(silence(() => runSkillEval(root, 'cases.json'))).rejects.toThrow('evaluation failed');
    await expect(runSkillEval(root, 'absent.json')).rejects.toThrow('Cannot read');
    for (const config of ['profiles: []', 'profiles:\n  bad:\n    skills: invalid', 'profile: unknown', 'profiles: {}\nprofile: constructor']) {
      await write(root, '.wondev/wondev.yaml', config);
      await expect(loadConfig(root)).rejects.toThrow();
    }
  });

  it('describes actual compiler capabilities and fallback behavior', () => {
    expect(targetCapabilities({ engine: 'claude', memory: 'C.md', skills: 's', commands: 'c', rules: 'r', agents: 'a' }).resources).toBe('verbatim copies');
    expect(targetCapabilities({ engine: 'claude', memory: 'C.md', skills: 's', commands: 'c' }).scoping).toBe('documented paths');
    expect(targetCapabilities({ engine: 'rule-dir', path: 'r', ext: '.md', frontmatter: { globs: 'globs' } }).scoping).toBe('native globs');
    expect(targetCapabilities({ engine: 'rule-dir', path: 'r', ext: '.md' }).resources).toBe('source references');
    expect(targetCapabilities({ engine: 'single-file', path: 'A.md' }).agents).toBe('source references');
    expect(targetCapabilities({ engine: 'html', path: 'G.html' }).skills).toBe('human guide');
  });
});

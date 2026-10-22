import fs from 'node:fs/promises';
import path from 'node:path';
import { loadContext } from './context.js';
import { evaluateTriggers, validateSkill, type TriggerCase } from '../core/skill-quality.js';
import { createRootGuard } from '../util/paths.js';
import { WondevError } from '../util/errors.js';
import { info, success } from '../util/log.js';
import { BASE_SKILLS } from '../core/base-skills.js';
import { loadProject } from '../core/source.js';
import { loadConfig } from '../core/config.js';

export async function runSkillCatalog(json = false): Promise<void> {
  if (json) info(JSON.stringify(BASE_SKILLS, null, 2));
  else {
    info('Bundled on wondev init; upgrade tracked starters, or use skills install bundled:<name> after adopt.');
    for (const skill of BASE_SKILLS) info(`${skill.name} [${skill.kind}] — ${skill.requires}`);
    info('Use wondev skills info <name> for project paths and setup. External runtimes are not installed by npm install or init.');
  }
}

export async function runSkillInfo(root: string, name: string, json = false): Promise<void> {
  const config = await loadConfig(root);
  const { project } = await loadProject(root, config.name, config.sources, config.vault);
  const skill = project.skills.find((s) => s.name === name);
  if (!skill) throw new WondevError(`Unknown project skill: ${name}`, BASE_SKILLS.some((s) => s.name === name) ? `Install it with: wondev skills install bundled:${name}` : 'Run `wondev skills catalog` to see available bundled skills.');
  const ctx = await loadContext(root);
  const report = { name, path: skill.sourcePath, active: ctx.project.skills.some((s) => s.name === name),
    description: skill.description, metadata: skill.frontmatter ?? {},
    resources: skill.attachments.map((att) => `${path.posix.dirname(skill.sourcePath)}/${att.relPath}`),
    bundled: BASE_SKILLS.find((s) => s.name === name) ?? null };
  if (json) info(JSON.stringify(report, null, 2));
  else {
    info(`${name}: ${report.active ? 'enabled' : 'disabled or outside profile'}\n${skill.description}\nSource: ${skill.sourcePath}`);
    if (report.bundled) info(`Distribution: ${report.bundled.kind}\nRequires: ${report.bundled.requires}\nUpstream: ${report.bundled.source}`);
    const setup = report.resources.find((rel) => rel.endsWith('/references/setup.md'));
    if (setup) info(`Setup: ${setup}\n${await fs.readFile(path.join(root, setup), 'utf8')}`);
    else info(`Resources: ${report.resources.length}. Read the skill for usage and prerequisites.`);
  }
}

export async function runSkillValidate(root: string, profile?: string): Promise<void> {
  const ctx = await loadContext(root, profile);
  const issues = [...ctx.issues.filter((i) => i.level === 'error').map((i) => `${i.file}: ${i.message}`),
    ...ctx.project.skills.flatMap((skill) => validateSkill(skill).map((message) => `${skill.name}: ${message}`))];
  if (issues.length) throw new WondevError(issues.join('\n'));
  success(`${ctx.project.skills.length} skill(s) satisfy portable Agent Skills metadata requirements.`);
}

export async function runSkillEval(root: string, file: string, profile?: string): Promise<void> {
  await createRootGuard(root)(file);
  const ctx = await loadContext(root, profile);
  let cases: TriggerCase[];
  try { cases = JSON.parse(await fs.readFile(path.join(root, file), 'utf8')) as TriggerCase[]; }
  catch { throw new WondevError(`Cannot read trigger cases as JSON: ${file}`); }
  const results = evaluateTriggers(ctx.project, cases);
  info(JSON.stringify(results, null, 2));
  if (results.some((r) => !r.passed)) throw new WondevError('Skill trigger evaluation failed. Inspect missing and unexpected selections above.');
}

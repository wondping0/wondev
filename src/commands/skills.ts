import fs from 'node:fs/promises';
import path from 'node:path';
import { loadContext } from './context.js';
import { evaluateTriggers, validateSkill, type TriggerCase } from '../core/skill-quality.js';
import { createRootGuard } from '../util/paths.js';
import { WondevError } from '../util/errors.js';
import { info, success } from '../util/log.js';

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

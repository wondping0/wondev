import path from 'node:path';
import type { Project, Skill } from './model.js';
import { selectContext } from './retrieval.js';
import { WondevError } from '../util/errors.js';

export function validateSkill(skill: Skill): string[] {
  const issues: string[] = [];
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skill.name) || skill.name.length > 64) issues.push('name must use kebab-case and contain at most 64 characters');
  if (path.posix.basename(skill.sourcePath) === 'SKILL.md' && path.posix.basename(path.posix.dirname(skill.sourcePath)) !== skill.name) issues.push('name must match the containing directory');
  if (!skill.description.trim() || skill.description.length > 1024) issues.push('description must contain 1–1024 characters');
  const frontmatter = skill.frontmatter ?? {};
  for (const key of ['license', 'compatibility', 'allowed-tools']) {
    if (frontmatter[key] !== undefined && (typeof frontmatter[key] !== 'string' || !(frontmatter[key] as string).trim())) issues.push(`${key} must be a non-empty string`);
  }
  if (typeof frontmatter['compatibility'] === 'string' && frontmatter['compatibility'].length > 500) issues.push('compatibility must contain at most 500 characters');
  const metadata = frontmatter['metadata'];
  if (metadata !== undefined && (!metadata || typeof metadata !== 'object' || Array.isArray(metadata) || Object.values(metadata).some((v) => typeof v !== 'string'))) issues.push('metadata must map string keys to string values');
  if (!skill.body.trim()) issues.push('skill instructions are empty');
  return issues;
}

export interface TriggerCase { task: string; files?: string[]; expected: string[]; forbidden?: string[] }
export interface TriggerResult { task: string; selected: string[]; missing: string[]; unexpected: string[]; passed: boolean }

/** Exercises wondev's selector. Native hosts may make different activation decisions. */
export function evaluateTriggers(project: Project, cases: TriggerCase[]): TriggerResult[] {
  if (!Array.isArray(cases) || !cases.length) throw new WondevError('Trigger cases must be a non-empty JSON array.');
  const names = new Set(project.skills.map((s) => s.name));
  return cases.map((item) => {
    if (!item || typeof item.task !== 'string' || !item.task.trim() || !Array.isArray(item.expected) || item.expected.some((s) => typeof s !== 'string') || (item.forbidden !== undefined && (!Array.isArray(item.forbidden) || item.forbidden.some((s) => typeof s !== 'string'))) || (item.files !== undefined && (!Array.isArray(item.files) || item.files.some((f) => typeof f !== 'string')))) throw new WondevError('Each trigger case needs task, expected, and optional forbidden/files arrays.');
    for (const name of [...item.expected, ...(item.forbidden ?? [])]) if (!names.has(name)) throw new WondevError(`Trigger case refers to an unknown skill: ${name}`);
    const packet = selectContext({ ...project, memory: [] }, { task: item.task, ...(item.files ? { files: item.files } : {}), budget: Number.MAX_SAFE_INTEGER, depth: 0 });
    const selected = packet.selected.map((s) => s.id);
    const missing = item.expected.filter((s) => !selected.includes(s));
    const unexpected = (item.forbidden ?? []).filter((s) => selected.includes(s));
    return { task: item.task, selected, missing, unexpected, passed: !missing.length && !unexpected.length };
  });
}

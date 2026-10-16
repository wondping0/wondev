import type { Project } from './model.js';
import type { Freshness } from './freshness.js';
import { memoryId } from './freshness.js';
import { selectContext, type ContextSelection } from './retrieval.js';
import { WondevError } from '../util/errors.js';

export interface ContextExpectation { memory?: string[]; skills?: string[] }
export interface ContextCase {
  task: string;
  files?: string[];
  budget?: number;
  format?: 'markdown' | 'json';
  expected: ContextExpectation;
  forbidden?: ContextExpectation;
}
export interface ContextResult {
  task: string;
  selected: ContextSelection[];
  missing: string[];
  unexpected: string[];
  tokens: number;
  budget: number;
  passed: boolean;
  error?: string;
}

/** Evaluate the same bounded packet that an agent receives, including memory and skills. */
export function evaluateContext(project: Project, cases: ContextCase[], freshness: Freshness[] = []): ContextResult[] {
  if (!Array.isArray(cases) || !cases.length) throw new WondevError('Context cases must be a non-empty JSON array.');
  const known = new Set([
    ...project.memory.filter((m) => !m.status || m.status === 'active').map((m) => `memory:${memoryId(m)}`),
    ...project.skills.map((s) => `skill:${s.name}`),
  ]);
  const refs = (value: ContextExpectation): string[] => {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((k) => !['memory', 'skills'].includes(k))) throw new WondevError('Context expectations must contain memory and/or skills arrays.');
    const result: string[] = [];
    for (const key of ['memory', 'skills'] as const) {
      const names = value[key];
      if (names === undefined) continue;
      if (!Array.isArray(names) || names.some((name) => typeof name !== 'string' || !name.trim())) throw new WondevError('Context expectations must contain lists of non-empty IDs.');
      for (const name of names) {
        const ref = `${key === 'skills' ? 'skill' : key}:${name}`;
        if (!known.has(ref)) throw new WondevError(`Context case refers to an unknown or inactive item: ${ref}`);
        result.push(ref);
      }
    }
    return [...new Set(result)];
  };
  return cases.map((item) => {
    if (!item || typeof item.task !== 'string' || !item.task.trim() || (item.files !== undefined && (!Array.isArray(item.files) || item.files.some((f) => typeof f !== 'string' || !f.trim())))) throw new WondevError('Each context case needs a task and optional files array.');
    const budget = item.budget ?? 4000;
    if (!Number.isSafeInteger(budget) || budget <= 0 || (item.format !== undefined && !['markdown', 'json'].includes(item.format))) throw new WondevError('Context cases need a positive integer budget and markdown/json format.');
    const expected = refs(item.expected);
    const forbidden = refs(item.forbidden ?? {});
    if (expected.some((ref) => forbidden.includes(ref))) throw new WondevError('A context item cannot be both expected and forbidden.');
    try {
      const packet = selectContext(project, { task: item.task, files: item.files, budget, format: item.format }, freshness);
      const selected = packet.selected.map((s) => `${s.kind}:${s.id}`);
      const missing = expected.filter((ref) => !selected.includes(ref));
      const unexpected = forbidden.filter((ref) => selected.includes(ref));
      return { task: item.task, selected: packet.selected, missing, unexpected, tokens: packet.tokens, budget, passed: !missing.length && !unexpected.length };
    } catch (error) {
      if (!(error instanceof WondevError)) throw error;
      return { task: item.task, selected: [], missing: expected, unexpected: [], tokens: 0, budget, passed: false, error: error.message };
    }
  });
}

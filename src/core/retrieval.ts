import type { MemoryDoc, Project, Skill } from './model.js';
import type { Freshness } from './freshness.js';
import { memoryId } from './freshness.js';
import { relatedNotes } from './links.js';
import { matchesPatterns } from './matching.js';
import { estimateTokens } from '../util/tokens.js';
import { WondevError } from '../util/errors.js';

export interface ContextOptions {
  task?: string;
  files?: string[];
  budget?: number;
  explain?: boolean;
  format?: 'markdown' | 'json';
  depth?: number;
  graphLimit?: number;
}
export interface ContextSelection {
  kind: 'memory' | 'skill';
  id: string;
  path: string;
  reasons: string[];
  freshness?: Freshness['status'];
}
export interface ContextPacket {
  content: string;
  selected: ContextSelection[];
  omitted: number;
  tokens: number;
  budget: number;
}
interface Candidate extends ContextSelection { body: string; score: number; required: boolean }

function terms(text: string): string[] {
  const stop = new Set(['the', 'and', 'for', 'when', 'with', 'this', 'that', 'use', 'yang', 'dan', 'untuk', 'dengan', 'saat']);
  return [...new Set(text.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? [])].filter((word) => !stop.has(word));
}

function relevance(task: string[], files: string[], title: string, description: string, body: string, globs: string[]): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;
  const paths = files.filter((file) => globs.length && matchesPatterns(file, globs));
  if (paths.length) { score += 100; reasons.push(`Path match: ${paths.join(', ')}`); }
  const metadata = terms(`${title} ${description}`);
  const matches = (candidate: string, word: string): boolean => candidate === word ||
    word.length >= 4 && candidate.startsWith(word) || candidate.length >= 4 && word.startsWith(candidate);
  const matched = task.filter((word) => metadata.some((candidate) => matches(candidate, word)));
  if (matched.length) { score += matched.length * 10; reasons.push(`Task terms: ${matched.join(', ')}`); }
  const bodyTerms = new Set(terms(body));
  const bodyMatches = task.filter((word) => !matched.includes(word) && [...bodyTerms].some((candidate) => matches(candidate, word)));
  if (bodyMatches.length) { score += Math.min(5, bodyMatches.length); reasons.push(`Body terms: ${bodyMatches.join(', ')}`); }
  return { score, reasons };
}

export function formatContext(packet: ContextPacket, format: 'markdown' | 'json' = 'markdown'): string {
  return format === 'json' ? `${JSON.stringify(packet, null, 2)}\n` : packet.content;
}

/** Deterministic lexical/path retrieval with bounded graph expansion, independent of a model. */
export function selectContext(project: Project, options: ContextOptions = {}, freshness: Freshness[] = []): ContextPacket {
  const budget = options.budget ?? 4000;
  const depth = options.depth ?? 1;
  const limit = options.graphLimit ?? 8;
  if (!Number.isInteger(budget) || budget <= 0) throw new WondevError('Context budget must be a positive integer.');
  if (!Number.isInteger(depth) || depth < 0 || depth > 3 || !Number.isInteger(limit) || limit < 0 || limit > 100) throw new WondevError('Graph depth must be 0–3 and graphLimit must be 0–100.');
  if (!options.task?.trim() && !options.files?.length) throw new WondevError('Context selection needs --task or --files.');
  const task = terms(options.task ?? '');
  const files = options.files ?? [];
  const active = project.memory.filter((doc) => !doc.status || doc.status === 'active');
  const candidates = new Map<string, Candidate>();
  const memoryCandidate = (doc: MemoryDoc): Candidate => {
    const match = relevance(task, files, `${doc.title} ${doc.slug} ${doc.aliases?.join(' ') ?? ''}`, doc.description ?? '', doc.body, doc.globs ?? doc.evidence ?? []);
    const state = freshness.find((item) => item.id === memoryId(doc));
    return {
      kind: 'memory', id: memoryId(doc), path: doc.sourcePath, body: doc.body,
      score: match.score, required: doc.always,
      reasons: [...(doc.always ? ['Required project memory'] : []), ...match.reasons],
      freshness: state?.status ?? 'unverified',
    };
  };
  for (const doc of active) {
    const item = memoryCandidate(doc);
    if (item.required || item.score > 0) candidates.set(item.path, item);
  }
  let frontier = active.filter((doc) => candidates.has(doc.sourcePath));
  let expanded = 0;
  for (let hop = 1; hop <= depth && expanded < limit; hop++) {
    const next: MemoryDoc[] = [];
    for (const seed of frontier) {
      const neighbors = [...new Set([...relatedNotes(active, seed), ...active.filter((doc) => relatedNotes(active, doc).includes(seed))])]
        .sort((a, b) => a.sourcePath.localeCompare(b.sourcePath));
      for (const neighbor of neighbors) {
        if (candidates.has(neighbor.sourcePath) || expanded >= limit) continue;
        const item = memoryCandidate(neighbor);
        item.score = 8 / hop;
        item.reasons.push(`Related to ${memoryId(seed)} (hop ${hop})`);
        candidates.set(item.path, item);
        next.push(neighbor);
        expanded++;
      }
    }
    frontier = next;
  }
  for (const skill of project.skills) {
    const item = skillCandidate(skill, task, files);
    if (item.required || item.score > 0) candidates.set(item.path, item);
  }
  const ordered = [...candidates.values()].sort((a, b) => Number(b.required) - Number(a.required) || b.score - a.score || a.path.localeCompare(b.path));
  const makePacket = (items: Candidate[]): ContextPacket => {
    const selected: ContextSelection[] = items.map(({ kind, id, path, reasons, freshness: state }) => ({
      kind, id, path, reasons, ...(state ? { freshness: state } : {}),
    }));
    const omitted = ordered.length - items.length;
    const preamble = '# Task context\n\nUse the selected project guidance below. Check changed or unverified evidence against the code before relying on it. Load skill resources from their source directory only when needed.\n';
    const content = `${preamble}\n${items.map((item) => [
      `## ${item.kind}: ${item.id}`,
      `Source: \`${item.path}\`${item.freshness ? ` · Evidence: ${item.freshness}` : ''}`,
      ...(options.explain ? [`Selected because: ${item.reasons.join('; ')}`] : []),
      item.body.trim(),
    ].join('\n\n')).join('\n\n')}\n\nOmitted ${omitted} relevant item(s) within the estimated token budget.\n`;
    const packet: ContextPacket = { content, selected, omitted, tokens: 0, budget };
    // JSON includes its own estimate; iterate until the number's width is stable.
    for (let i = 0; i < 5; i++) {
      const cost = estimateTokens(formatContext(packet, options.format));
      if (packet.tokens === cost) break;
      packet.tokens = cost;
    }
    return packet;
  };
  const chosen = ordered.filter((item) => item.required);
  const required = makePacket(chosen);
  if (required.tokens > budget) throw new WondevError(`Required context and packet overhead need approximately ${required.tokens} tokens, exceeding budget ${budget}.`, 'Raise --budget or reduce always-on memory and inline skills.');
  for (const item of ordered.filter((candidate) => !candidate.required)) {
    if (makePacket([...chosen, item]).tokens <= budget) chosen.push(item);
  }
  return makePacket(chosen);
}

function skillCandidate(skill: Skill, task: string[], files: string[]): Candidate {
  const match = relevance(task, files, skill.name, skill.description, skill.body, skill.globs ?? []);
  return {
    kind: 'skill', id: skill.name, path: skill.sourcePath, body: skill.body,
    score: match.score, required: skill.inline,
    reasons: [...(skill.inline ? ['Required inline skill'] : []), ...match.reasons],
  };
}

import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { loadContext } from '../commands/context.js';
import { sourceDirectory } from './config.js';
import { parseFrontmatter, stringifyFrontmatter } from './frontmatter.js';
import { currentNoteHash, evidenceFiles, fingerprint, memoryId } from './freshness.js';
import { memoryLinkIssues, parseNoteLink, resolveNote } from './links.js';
import { hasErrors, parseMemoryDoc, type Issue } from './source.js';
import { createRootGuard } from '../util/paths.js';
import { normalizeEol, readFileIfExists, sha256, writeFileAtomic, writeFileAtomicExclusive } from '../util/fs.js';
import { withProjectLock } from '../util/lock.js';
import { WondevError } from '../util/errors.js';

export interface SessionInput {
  agent: string;
  task: string;
  outcome: string;
  decisions?: string[];
  evidence?: string[];
  failedAttempts?: string[];
  next?: string[];
}
export interface MemoryProposal {
  version: 1;
  id: string;
  session: string;
  memory: string;
  expectedHash: string;
  before: string;
  content: string;
  created: string;
  status: 'pending' | 'applying' | 'applied' | 'rejected';
  /** Additive: old proposals update a note; a learning proposal creates this source slug. */
  create?: { slug: string };
}

function identifier(): string { return `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`; }
function safeId(id: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9-]*$/.test(id)) throw new WondevError(`Invalid session or proposal ID: ${id}`);
}

export function validateSession(input: SessionInput): void {
  if (!input || typeof input !== 'object') throw new WondevError('Session must be an object.');
  for (const field of ['agent', 'task', 'outcome'] as const) {
    if (typeof input[field] !== 'string' || !input[field].trim()) throw new WondevError(`Session ${field} must be a non-empty string.`);
  }
  for (const field of ['decisions', 'evidence', 'failedAttempts', 'next'] as const) {
    const value = input[field];
    if (value !== undefined && (!Array.isArray(value) || value.some((v) => typeof v !== 'string' || !v.trim()))) throw new WondevError(`Session ${field} must be a list of non-empty strings.`);
  }
}

export async function recordSession(root: string, input: SessionInput): Promise<string> {
  validateSession(input);
  return withProjectLock(root, async () => {
    const ctx = await loadContext(root);
    const id = identifier();
    const rel = `${sourceDirectory('sessions', ctx.config.sources)}/${id}.md`;
    await createRootGuard(root)(rel);
    const sections: Array<[string, string[] | undefined]> = [
      ['Decisions', input.decisions], ['Evidence', input.evidence],
      ['Failed attempts and rejected alternatives', input.failedAttempts], ['Next actions', input.next],
    ];
    const body = [`# ${input.task}`, input.outcome, ...sections.map(([title, items]) => `## ${title}\n\n${items?.length ? items.map((item) => `- ${item}`).join('\n') : 'None recorded.'}`)].join('\n\n');
    await writeFileAtomic(path.join(root, rel), stringifyFrontmatter({ id, agent: input.agent, task: input.task, created: new Date().toISOString(), kind: 'session' }, body));
    return id;
  });
}

export function proposalReviewHash(proposal: MemoryProposal): string {
  // Status is intentionally excluded so a crashed, already-applied write can be resumed.
  const { status: _status, ...reviewed } = proposal;
  return sha256(JSON.stringify(reviewed));
}

export function renderProposal(proposal: MemoryProposal): string {
  // Longer fences keep code fences inside a proposed note from closing the review block.
  const longest = Math.max(3, ...[...`${proposal.before}\n${proposal.content}`.matchAll(/`+/g)].map((m) => m[0].length)) + 1;
  const fence = '`'.repeat(longest);
  return stringifyFrontmatter({ id: proposal.id, kind: 'memory-proposal', status: proposal.status, session: proposal.session, memory: proposal.memory }, [
    `# ${proposal.create ? 'Learn' : 'Update'} ${proposal.memory}`,
    `Review hash: \`${proposalReviewHash(proposal)}\``,
    `Expected source hash: \`${proposal.expectedHash}\``,
    'Review both versions and the session evidence. Apply with `wondev session apply <proposal-id> --review-hash <hash>`.',
    `## Before\n\n${fence}markdown\n${proposal.before.trimEnd()}\n${fence}`,
    `## Proposed\n\n${fence}markdown\n${proposal.content.trimEnd()}\n${fence}`,
  ].join('\n\n'));
}

async function proposalPath(root: string, id: string): Promise<string> {
  safeId(id);
  const ctx = await loadContext(root);
  const rel = `${sourceDirectory('sessions', ctx.config.sources)}/proposals/${id}`;
  await createRootGuard(root)(`${rel}.json`);
  await createRootGuard(root)(`${rel}.md`);
  return path.join(root, rel);
}

async function saveProposal(root: string, proposal: MemoryProposal): Promise<void> {
  const file = await proposalPath(root, proposal.id);
  await writeFileAtomic(`${file}.json`, `${JSON.stringify(proposal, null, 2)}\n`);
  await writeFileAtomic(`${file}.md`, renderProposal(proposal));
}

export async function readProposal(root: string, id: string): Promise<MemoryProposal> {
  const file = await proposalPath(root, id);
  let proposal: MemoryProposal;
  try { proposal = JSON.parse(await fs.readFile(`${file}.json`, 'utf8')) as MemoryProposal; }
  catch { throw new WondevError(`Cannot read proposal ${id}.`); }
  if (!proposal || proposal.version !== 1 || proposal.id !== id || !['pending', 'applying', 'applied', 'rejected'].includes(proposal.status) || ['session', 'memory', 'expectedHash', 'before', 'content', 'created'].some((key) => typeof (proposal as unknown as Record<string, unknown>)[key] !== 'string')) throw new WondevError(`Invalid proposal ${id}.`);
  if (proposal.create !== undefined && (!proposal.create || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(proposal.memory) || proposal.create.slug !== `lessons/${proposal.memory}` || proposal.before !== '')) throw new WondevError(`Invalid learning proposal ${id}.`);
  if (sha256(normalizeEol(proposal.before)) !== proposal.expectedHash) throw new WondevError(`Proposal ${id} has an invalid baseline hash.`);
  return proposal;
}

/** Turn an explicit session summary into a reviewable, scoped lesson; no model call or auto-activation. */
export async function proposeLearning(root: string, session: string, name: string, files: string[]): Promise<MemoryProposal> {
  safeId(session);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) || name.length > 64) throw new WondevError('Lesson name must be kebab-case with at most 64 characters.');
  if (!Array.isArray(files) || !files.length || files.some((f) => typeof f !== 'string' || !f.trim())) throw new WondevError('Learning requires --files with the repository evidence paths or globs.');
  return withProjectLock(root, async () => {
    const ctx = await loadContext(root);
    if (hasErrors(ctx.issues)) throw new WondevError('Fix source validation errors before proposing a lesson.');
    if (resolveNote(ctx.project.memory, parseNoteLink(name)).length) throw new WondevError(`Memory already exists: ${name}. Use session propose to update it.`);
    const rel = `${sourceDirectory('sessions', ctx.config.sources)}/${session}.md`;
    const target = `${sourceDirectory('memory', ctx.config.sources)}/lessons/${name}.md`;
    const guard = createRootGuard(root);
    await guard(rel);
    await guard(target);
    if (await readFileIfExists(path.join(root, target)) !== null) throw new WondevError(`Lesson destination already exists: ${target}`);
    const raw = await readFileIfExists(path.join(root, rel));
    if (!raw) throw new WondevError(`Unknown session: ${session}`);
    const record = parseFrontmatter(raw, rel);
    if (record.data['id'] !== session || typeof record.data['task'] !== 'string' || !record.data['task'].trim()) throw new WondevError(`Invalid session: ${session}`);
    const evidence = [...new Set(files)];
    await fingerprint(root, evidence, await evidenceFiles(root), true);
    const content = stringifyFrontmatter({ id: name, title: record.data['task'], kind: 'lesson', status: 'active', always: false,
      description: `Development experience: ${record.data['task']}. Check applicability before reusing.`, globs: evidence, evidence,
      learnedFrom: session, agent: record.data['agent'],
    }, `This is a reviewed session lesson, not a universal rule. Recheck the evidence and current task before applying it.\n\n${record.body.trim()}\n`);
    const issues: Issue[] = [];
    const note = parseMemoryDoc(content, `lessons/${name}`, target, issues, ctx.config.vault);
    issues.push(...memoryLinkIssues([...ctx.project.memory, note]));
    if (hasErrors(issues)) throw new WondevError(`Invalid learning content:\n${issues.map((i) => i.message).join('\n')}`);
    const proposal: MemoryProposal = { version: 1, id: identifier(), session, memory: name, before: '', expectedHash: sha256(''),
      content, created: new Date().toISOString(), status: 'pending', create: { slug: `lessons/${name}` } };
    await saveProposal(root, proposal);
    return proposal;
  });
}

async function applyLearning(root: string, proposal: MemoryProposal): Promise<void> {
  const ctx = await loadContext(root);
  if (hasErrors(ctx.issues)) throw new WondevError('Fix source validation errors before applying a lesson.');
  const slug = proposal.create!.slug;
  const rel = `${sourceDirectory('memory', ctx.config.sources)}/${slug}.md`;
  await createRootGuard(root)(rel);
  const current = await readFileIfExists(path.join(root, rel));
  const issues: Issue[] = [];
  const note = parseMemoryDoc(proposal.content, slug, rel, issues, ctx.config.vault);
  if (note.id !== proposal.memory || note.kind !== 'lesson' || note.status !== 'active' || note.always || !note.evidence?.length) throw new WondevError('A learning proposal must preserve its identity, active lesson kind, evidence, and on-demand scope.');
  const other = ctx.project.memory.filter((doc) => doc.sourcePath !== rel);
  if (resolveNote(other, parseNoteLink(proposal.memory)).length) throw new WondevError(`Memory identity already exists: ${proposal.memory}`);
  issues.push(...memoryLinkIssues([...other, note]));
  if (hasErrors(issues)) throw new WondevError('Invalid proposed lesson. Check its memory links and metadata.');
  if ((proposal.status === 'applying' || proposal.status === 'applied') && current !== null && normalizeEol(current) === proposal.content) {
    proposal.status = 'applied';
    await saveProposal(root, proposal);
    return;
  }
  if (current !== null || proposal.status === 'applied') throw new WondevError('Lesson destination changed or this proposal was already applied. Create and review a new proposal.');
  // Reject evidence that disappeared between learning and review; review still checks meaning.
  await fingerprint(root, note.evidence, await evidenceFiles(root), true);
  proposal.status = 'applying';
  await saveProposal(root, proposal);
  // Exclusive creation also protects a note created by an external editor after the check.
  await createRootGuard(root)(rel);
  await writeFileAtomicExclusive(path.join(root, rel), proposal.content);
  proposal.status = 'applied';
  await saveProposal(root, proposal);
}

async function validateUpdate(root: string, name: string, content: string) {
  const ctx = await loadContext(root);
  const found = resolveNote(ctx.project.memory, parseNoteLink(name));
  if (found.length !== 1) throw new WondevError(`Memory must resolve to one note: ${name}`);
  const note = found[0]!;
  const issues: Issue[] = [];
  const candidate = parseMemoryDoc(content, note.slug, note.sourcePath, issues, ctx.config.vault);
  if (memoryId(candidate) !== memoryId(note)) throw new WondevError('A proposal must preserve the memory identity.');
  issues.push(...memoryLinkIssues(ctx.project.memory.map((doc) => doc === note ? candidate : doc)));
  if (hasErrors(issues)) throw new WondevError(`Invalid proposed memory:\n${issues.map((i) => i.message).join('\n')}`);
  return note;
}

export async function proposeMemory(root: string, session: string, name: string, content: string): Promise<MemoryProposal> {
  safeId(session);
  return withProjectLock(root, async () => {
    const ctx = await loadContext(root);
    const sessionRel = `${sourceDirectory('sessions', ctx.config.sources)}/${session}.md`;
    await createRootGuard(root)(sessionRel);
    const rawSession = await fs.readFile(path.join(root, sessionRel), 'utf8').catch(() => null);
    if (!rawSession || parseFrontmatter(rawSession, sessionRel).data['id'] !== session) throw new WondevError(`Unknown session: ${session}`);
    const note = await validateUpdate(root, name, content);
    const before = normalizeEol(await fs.readFile(path.join(root, note.sourcePath), 'utf8'));
    const proposal: MemoryProposal = {
      version: 1, id: identifier(), session, memory: memoryId(note), expectedHash: sha256(before),
      before, content: normalizeEol(content), created: new Date().toISOString(), status: 'pending',
    };
    await saveProposal(root, proposal);
    return proposal;
  });
}

export async function applyMemoryProposal(root: string, id: string, reviewHash: string): Promise<void> {
  await withProjectLock(root, async () => {
    const proposal = await readProposal(root, id);
    if (proposalReviewHash(proposal) !== reviewHash) throw new WondevError('Review hash does not match this proposal. Review the current proposal before applying it.');
    if (proposal.status === 'rejected') throw new WondevError('This proposal was rejected.');
    if (proposal.create) { await applyLearning(root, proposal); return; }
    const note = await validateUpdate(root, proposal.memory, proposal.content);
    const current = await currentNoteHash(root, note.sourcePath);
    const proposed = sha256(proposal.content);
    if ((proposal.status === 'applying' || proposal.status === 'applied') && current === proposed) {
      proposal.status = 'applied';
      await saveProposal(root, proposal);
      return;
    }
    if (proposal.status === 'applied') throw new WondevError('This proposal was already applied; the memory has changed since then.');
    if (current !== proposal.expectedHash) throw new WondevError('Memory changed since this proposal was created. Create and review a new proposal against the latest version.');
    proposal.status = 'applying';
    await saveProposal(root, proposal);
    if (await currentNoteHash(root, note.sourcePath) !== proposal.expectedHash) throw new WondevError('Memory changed while applying the proposal.');
    await writeFileAtomic(path.join(root, note.sourcePath), proposal.content);
    proposal.status = 'applied';
    await saveProposal(root, proposal);
  });
}

export async function rejectMemoryProposal(root: string, id: string): Promise<void> {
  await withProjectLock(root, async () => {
    const proposal = await readProposal(root, id);
    if (proposal.status !== 'pending') throw new WondevError('Only a pending proposal can be rejected.');
    proposal.status = 'rejected';
    await saveProposal(root, proposal);
  });
}

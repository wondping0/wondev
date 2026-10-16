import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { recordSession, proposeLearning, applyMemoryProposal, proposalReviewHash, readProposal, rejectMemoryProposal } from '../src/core/sessions.js';
import { loadContext } from '../src/commands/context.js';
import { selectContext } from '../src/core/retrieval.js';
import { evaluateContext } from '../src/core/context-quality.js';
import { checkFreshness } from '../src/core/freshness.js';
import { runMemoryVerify } from '../src/commands/memory.js';
import { runBuild } from '../src/commands/build.js';
import { runCheck } from '../src/commands/check.js';
import { cleanup, exists, read, seedProject, silence, tmpRoot, write } from './helpers.js';

let root: string;
beforeEach(async () => { root = await tmpRoot(); await seedProject(root, ['agents']); await write(root, 'src/auth.ts', 'export const expiry = 60;'); });
afterEach(async () => { await cleanup(root); });

async function session(): Promise<string> {
  return recordSession(root, { agent: 'claude', task: 'Fix login expiry', outcome: 'Central expiry validation fixes refresh.',
    decisions: ['Validate expiry in the service.'], evidence: ['src/auth.ts', 'Auth test passed.'],
    failedAttempts: ['UI timeout alone did not fix token expiry.'], next: ['Check concurrent refresh.'],
  });
}

describe('learning from development sessions', () => {
  it('keeps experience pending until review, then retrieves it on a future task from any agent', async () => {
    const id = await session();
    const proposal = await proposeLearning(root, id, 'login-expiry', ['src/auth.ts']);
    expect(await exists(root, '.wondev/memory/lessons/login-expiry.md')).toBe(false);
    expect((await loadContext(root)).project.memory.some((m) => m.kind === 'lesson')).toBe(false);
    await expect(applyMemoryProposal(root, proposal.id, 'not-reviewed')).rejects.toThrow('Review hash');
    await applyMemoryProposal(root, proposal.id, proposalReviewHash(proposal));
    const ctx = await loadContext(root);
    const packet = selectContext(ctx.project, { task: 'Debug login expiry', files: ['src/auth.ts'] });
    expect(packet.selected.map((s) => s.id)).toContain('login-expiry');
    expect(packet.content).toContain('UI timeout alone did not fix token expiry.');
    expect(packet.content).toContain('Check concurrent refresh.');
    const lesson = ctx.project.memory.find((m) => m.id === 'login-expiry')!;
    expect(lesson.extra['learnedFrom']).toBe(id);
    expect(lesson.extra['agent']).toBe('claude');
    expect(lesson.always).toBe(false);
    expect(evaluateContext(ctx.project, [{ task: 'Debug login expiry', files: ['src/auth.ts'], expected: { memory: ['login-expiry'], skills: ['debugging'] }, budget: 3000 }])[0]?.passed).toBe(true);
    expect((await checkFreshness(root, [lesson], {}))[0]?.status).toBe('unverified');
    await silence(() => runMemoryVerify(root, 'login-expiry', 'Inspected service and reran expiry test'));
    await checkFreshness(root, (await loadContext(root)).project.memory.filter((m) => m.id === 'login-expiry'), { freshness: 'strict' });
  });

  it('supports idempotent apply and crash recovery but preserves later edits', async () => {
    const proposal = await proposeLearning(root, await session(), 'expiry', ['src/auth.ts']);
    const hash = proposalReviewHash(proposal);
    const proposalPath = `.wondev/sessions/proposals/${proposal.id}.json`;
    await write(root, proposalPath, JSON.stringify({ ...proposal, status: 'applying' }));
    await write(root, '.wondev/memory/lessons/expiry.md', proposal.content);
    await applyMemoryProposal(root, proposal.id, hash);
    await applyMemoryProposal(root, proposal.id, hash);
    expect((await readProposal(root, proposal.id)).status).toBe('applied');
    await write(root, '.wondev/memory/lessons/expiry.md', proposal.content + '\nNew human finding.');
    await expect(applyMemoryProposal(root, proposal.id, hash)).rejects.toThrow('destination changed');
  });

  it('resumes before the first write and rejects a competing lesson creation', async () => {
    const id = await session();
    const a = await proposeLearning(root, id, 'expiry', ['src/auth.ts']);
    const b = await proposeLearning(root, id, 'expiry', ['src/auth.ts']);
    await write(root, `.wondev/sessions/proposals/${a.id}.json`, JSON.stringify({ ...a, status: 'applying' }));
    await applyMemoryProposal(root, a.id, proposalReviewHash(a));
    await expect(applyMemoryProposal(root, b.id, proposalReviewHash(b))).rejects.toThrow('destination changed');
    await expect(proposeLearning(root, id, 'expiry', ['src/auth.ts'])).rejects.toThrow('already exists');
  });

  it('validates identity, evidence, session provenance and destination before proposing', async () => {
    const id = await session();
    await expect(proposeLearning(root, id, '../outside', ['src/auth.ts'])).rejects.toThrow('kebab-case');
    await expect(proposeLearning(root, id, 'expiry', [])).rejects.toThrow('--files');
    await expect(proposeLearning(root, id, 'expiry', ['missing/**'])).rejects.toThrow('match no files');
    await expect(proposeLearning(root, 'unknown', 'expiry', ['src/auth.ts'])).rejects.toThrow('Unknown session');
    await write(root, '.wondev/sessions/fake.md', '---\nid: fake\n---\ntext');
    await expect(proposeLearning(root, 'fake', 'expiry', ['src/auth.ts'])).rejects.toThrow('Invalid session');
    await write(root, '.wondev/memory/lessons/expiry.md', '---\nid: other\n---\nExisting memory.');
    await expect(proposeLearning(root, id, 'expiry', ['src/auth.ts'])).rejects.toThrow('already exists');
  });

  it('rejects broken links, tampered identities, and source conflicts', async () => {
    const broken = await recordSession(root, { agent: 'codex', task: 'Debug', outcome: 'See [[missing-note]].' });
    await expect(proposeLearning(root, broken, 'expiry', ['src/auth.ts'])).rejects.toThrow('Invalid learning content');
    const proposal = await proposeLearning(root, await session(), 'expiry', ['src/auth.ts']);
    const file = `.wondev/sessions/proposals/${proposal.id}.json`;
    await write(root, file, JSON.stringify({ ...proposal, create: { slug: '../escape' } }));
    await expect(readProposal(root, proposal.id)).rejects.toThrow('Invalid learning proposal');
    const changed = { ...proposal, content: proposal.content.replace('kind: lesson', 'kind: decision') };
    await write(root, file, JSON.stringify(changed));
    await expect(applyMemoryProposal(root, proposal.id, proposalReviewHash(changed))).rejects.toThrow('must preserve');
    await write(root, file, JSON.stringify(proposal));
    await write(root, '.wondev/memory/collision.md', '---\nid: expiry\n---\nExisting fact');
    await expect(applyMemoryProposal(root, proposal.id, proposalReviewHash(proposal))).rejects.toThrow('identity already exists');
  });

  it('rejects disappeared evidence and rejected proposals', async () => {
    const proposal = await proposeLearning(root, await session(), 'expiry', ['src/auth.ts']);
    await fs.unlink(path.join(root, 'src/auth.ts'));
    await expect(applyMemoryProposal(root, proposal.id, proposalReviewHash(proposal))).rejects.toThrow('match no files');
    await rejectMemoryProposal(root, proposal.id);
    await expect(applyMemoryProposal(root, proposal.id, proposalReviewHash(proposal))).rejects.toThrow('rejected');
  });
});

describe('optional memory freshness gates', () => {
  it('distinguishes stale and strict, and ignores inactive notes', async () => {
    const ctx = await loadContext(root);
    await checkFreshness(root, ctx.project.memory, { freshness: 'stale' });
    await expect(checkFreshness(root, ctx.project.memory, { freshness: 'strict' })).rejects.toThrow('unverified');
    await expect(checkFreshness(root, ctx.project.memory, { freshness: 'invalid' as 'strict' })).rejects.toThrow('policy');
    expect(await checkFreshness(root, ctx.project.memory.map((m) => ({ ...m, status: 'archived' })), { freshness: 'strict' })).toEqual([]);
  });

  it('checks affected paths and always-on memory, including deleted evidence', async () => {
    await write(root, '.wondev/memory/auth.md', '---\nid: auth\nevidence: [src/auth.ts]\n---\nCentral expiry.');
    await silence(() => runMemoryVerify(root, 'auth', 'Reviewed auth'));
    let ctx = await loadContext(root);
    await checkFreshness(root, ctx.project.memory, { freshness: 'stale', files: ['src/auth.ts'] });
    await fs.unlink(path.join(root, 'src/auth.ts'));
    ctx = await loadContext(root);
    await expect(checkFreshness(root, ctx.project.memory, { freshness: 'stale', files: ['src/auth.ts'] })).rejects.toThrow('Deleted');
    await expect(checkFreshness(root, ctx.project.memory, { freshness: 'stale', files: ['.wondev/memory/auth.md'] })).rejects.toThrow('auth');
    await checkFreshness(root, ctx.project.memory, { freshness: 'stale', files: ['src/unrelated.ts'] });
    await expect(checkFreshness(root, ctx.project.memory, { freshness: 'strict', files: ['src/unrelated.ts'] })).rejects.toThrow('architecture');
  });

  it('does not let rebuilding outputs hide stale memory from CI', async () => {
    await write(root, '.wondev/memory/auth.md', '---\nid: auth\nevidence: [src/auth.ts]\n---\nCentral expiry.');
    await silence(() => runMemoryVerify(root, 'auth', 'Reviewed auth'));
    await write(root, 'src/auth.ts', 'export const expiry = 120;');
    await silence(() => runBuild(root));
    await silence(() => runCheck(root));
    await expect(silence(() => runCheck(root, undefined, { freshness: 'stale' }))).rejects.toThrow('freshness check failed');
    expect(await read(root, 'AGENTS.md')).toContain('Architecture');
  });
});

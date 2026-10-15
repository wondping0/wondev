import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyMemoryProposal, proposeMemory, readProposal, recordSession, rejectMemoryProposal, proposalReviewHash, validateSession } from '../src/core/sessions.js';
import { cleanup, read, seedProject, tmpRoot, write } from './helpers.js';

let root: string;
const input = { agent: 'claude', task: 'Investigate architecture', outcome: 'Checked the deployment', decisions: ['Keep one process'], evidence: ['src/main.ts'], failedAttempts: ['Rejected splitting workers'], next: ['Add a regression test'] };
beforeEach(async () => { root = await tmpRoot(); await seedProject(root, ['agents']); });
afterEach(async () => { await cleanup(root); });

describe('session knowledge lifecycle', () => {
  it('writes unique session notes with useful evidence and reviewable proposals', async () => {
    const [a, b] = await Promise.all([recordSession(root, input), recordSession(root, { ...input, agent: 'codex' })]);
    expect(a).not.toBe(b);
    expect(await read(root, `.wondev/sessions/${a}.md`)).toContain('Rejected splitting workers');
    const before = await read(root, '.wondev/memory/architecture.md');
    const proposal = await proposeMemory(root, a, 'architecture', before.replace('single binary', 'single process'));
    expect(await read(root, '.wondev/memory/architecture.md')).toBe(before);
    expect(await read(root, `.wondev/sessions/proposals/${proposal.id}.md`)).toContain('## Before');
    await expect(applyMemoryProposal(root, proposal.id, 'wrong')).rejects.toThrow('Review hash');
    await applyMemoryProposal(root, proposal.id, proposalReviewHash(proposal));
    expect(await read(root, '.wondev/memory/architecture.md')).toContain('single process');
    expect((await readProposal(root, proposal.id)).status).toBe('applied');
    await applyMemoryProposal(root, proposal.id, proposalReviewHash(proposal));
    await expect(rejectMemoryProposal(root, proposal.id)).rejects.toThrow('pending');
  });

  it('prevents two agents from overwriting each other and preserves the losing proposal', async () => {
    const session = await recordSession(root, input);
    const before = await read(root, '.wondev/memory/architecture.md');
    const a = await proposeMemory(root, session, 'architecture', `${before}\nFirst agent's finding.\n`);
    const b = await proposeMemory(root, session, 'architecture', `${before}\nSecond agent's finding.\n`);
    const results = await Promise.allSettled([applyMemoryProposal(root, a.id, proposalReviewHash(a)), applyMemoryProposal(root, b.id, proposalReviewHash(b))]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    const statuses = await Promise.all([readProposal(root, a.id), readProposal(root, b.id)]);
    expect(statuses.map((p) => p.status).sort()).toEqual(['applied', 'pending']);
  });

  it('rejects invalid updates, unknown sessions, path escapes, and changed review artifacts', async () => {
    expect(() => validateSession({ ...input, agent: '' })).toThrow('agent');
    expect(() => validateSession({ ...input, decisions: [1] } as never)).toThrow('decisions');
    const session = await recordSession(root, input);
    await expect(proposeMemory(root, '../escape', 'architecture', 'text')).rejects.toThrow('Invalid');
    await expect(proposeMemory(root, 'missing', 'architecture', 'text')).rejects.toThrow('Unknown session');
    await expect(proposeMemory(root, session, 'missing', 'text')).rejects.toThrow('one note');
    await expect(proposeMemory(root, session, 'architecture', '---\nid: different\n---\nbody')).rejects.toThrow('preserve');
    await expect(proposeMemory(root, session, 'architecture', '[[missing]]')).rejects.toThrow('Invalid proposed');
    const proposal = await proposeMemory(root, session, 'architecture', 'New architecture.');
    await rejectMemoryProposal(root, proposal.id);
    await expect(applyMemoryProposal(root, proposal.id, proposalReviewHash(proposal))).rejects.toThrow('rejected');
    await expect(readProposal(root, 'missing')).rejects.toThrow('Cannot read');
    await write(root, `.wondev/sessions/proposals/${proposal.id}.json`, '{}');
    await expect(readProposal(root, proposal.id)).rejects.toThrow('Invalid proposal');
    await write(root, `.wondev/sessions/proposals/${proposal.id}.json`, JSON.stringify({ ...proposal, before: 'tampered' }));
    await expect(readProposal(root, proposal.id)).rejects.toThrow('baseline hash');
  });

  it('resumes an interrupted application without reverting later changes', async () => {
    const session = await recordSession(root, input);
    const proposal = await proposeMemory(root, session, 'architecture', 'Updated architecture.\n');
    await write(root, `.wondev/sessions/proposals/${proposal.id}.json`, JSON.stringify({ ...proposal, status: 'applying' }));
    await write(root, '.wondev/memory/architecture.md', proposal.content);
    await applyMemoryProposal(root, proposal.id, proposalReviewHash(proposal));
    await fs.appendFile(path.join(root, '.wondev/memory/architecture.md'), 'Later changes.');
    await expect(applyMemoryProposal(root, proposal.id, proposalReviewHash(proposal))).rejects.toThrow('already applied');
  });
});

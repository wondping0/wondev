import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runList } from '../src/commands/list.js';
import { catchWondevError, cleanup, seedProject, tmpRoot, write } from './helpers.js';

/**
 * `list` shipped in 0.8.0 and reached 1.0.0 with no test at all -- the same gap that let a
 * runaway rebuild loop live in `watch` through two releases. These capture what it prints,
 * since the output is the entire feature.
 */

let root: string;
beforeEach(async () => {
  root = await tmpRoot();
});
afterEach(async () => {
  await cleanup(root);
});

/** Run `list` and return everything it wrote to stdout. */
async function listOutput(): Promise<string> {
  const chunks: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString());
    return true;
  }) as typeof process.stdout.write;
  try {
    await runList(root);
  } finally {
    process.stdout.write = original;
  }
  // Strip ANSI so assertions do not depend on whether colour is enabled.
  return chunks.join('').replace(/\[[0-9;]*m/g, '');
}

describe('wondev list', () => {
  it('separates always-loaded memory from on-demand, and totals the always-on cost', async () => {
    await seedProject(root, ['claude']);
    await write(root, '.wondev/memory/glossary.md', '---\ntitle: Glossary\n---\n\nTerms.\n');

    const out = await listOutput();
    expect(out).toContain('Memory — always loaded');
    expect(out).toMatch(/≈\d+.*every turn/);
    expect(out).toContain('Memory — on demand');
    expect(out).toContain('architecture');
    expect(out).toContain('glossary');
  });

  it('says whether each skill is carried or referenced', async () => {
    await seedProject(root, ['claude']);
    await write(
      root,
      '.wondev/skills/carried/SKILL.md',
      '---\nname: carried\ndescription: d\ninline: true\n---\n\nx\n',
    );
    const out = await listOutput();
    expect(out).toContain('inlined');
    expect(out).toContain('referenced');
  });

  it('counts a skill\'s reference files', async () => {
    await seedProject(root, ['claude']);
    await write(root, '.wondev/skills/deep/SKILL.md', '---\nname: deep\ndescription: d\n---\n\nx\n');
    await write(root, '.wondev/skills/deep/references/a.md', '# a\n');
    await write(root, '.wondev/skills/deep/references/b.md', '# b\n');
    expect(await listOutput()).toContain('+2 ref');
  });

  it('shows freshness for both always-on and on-demand documents', async () => {
    await seedProject(root, ['claude']);
    await write(
      root,
      '.wondev/memory/architecture.md',
      '---\ntitle: Architecture\nalways: true\nverified: 2026-08-11\n---\n\nx\n',
    );
    // On-demand and unverified. "Is this still true?" is asked precisely when someone is
    // about to rely on a document, which is exactly when an on-demand one gets read.
    await write(root, '.wondev/memory/glossary.md', '---\ntitle: Glossary\n---\n\nTerms.\n');

    const out = await listOutput();
    expect(out).toContain('✓ 2026-08-11');
    expect(out).toContain('unverified');
  });

  it('lists subagents and commands', async () => {
    await seedProject(root, ['claude']);
    await write(root, '.wondev/agents/auditor.md', '---\nname: auditor\ndescription: Audits\n---\n\nx\n');
    const out = await listOutput();
    expect(out).toContain('Subagents');
    expect(out).toContain('auditor');
    expect(out).toContain('Commands');
    expect(out).toContain('/review');
  });

  it('names the enabled targets', async () => {
    await seedProject(root, ['claude', 'agents']);
    expect(await listOutput()).toContain('targets: claude, agents');
  });

  it('tells an empty project what to do next instead of printing nothing', async () => {
    await write(root, '.wondev/wondev.yaml', 'name: empty\ntargets:\n  - claude\nschema: 1\n');
    const out = await listOutput();
    expect(out).toContain('defines nothing yet');
    expect(out).toContain('wondev add');
  });

  it('fails like every other command when there is no project', async () => {
    const err = await catchWondevError(() => runList(root));
    expect(err.message).toMatch(/wondev\.yaml/);
    expect(err.hint).toMatch(/wondev init/);
  });
});

describe('sections that are absent rather than empty', () => {
  it('omits the always-loaded section when nothing is always-on', async () => {
    await write(root, '.wondev/wondev.yaml', 'name: demo\ntargets:\n  - claude\nschema: 1\n');
    await write(root, '.wondev/memory/glossary.md', '---\ntitle: Glossary\n---\n\nTerms.\n');

    const out = await listOutput();
    expect(out).not.toContain('always loaded');
    expect(out).toContain('Memory — on demand');
  });

  it('omits the on-demand section when everything is always-on', async () => {
    await write(root, '.wondev/wondev.yaml', 'name: demo\ntargets:\n  - claude\nschema: 1\n');
    await write(root, '.wondev/memory/a.md', '---\ntitle: A\nalways: true\n---\n\nx\n');

    const out = await listOutput();
    expect(out).toContain('always loaded');
    expect(out).not.toContain('on demand');
  });

  it('shows a memory document that carries no description', async () => {
    await write(root, '.wondev/wondev.yaml', 'name: demo\ntargets:\n  - claude\nschema: 1\n');
    await write(root, '.wondev/memory/bare.md', '---\ntitle: Bare\n---\n\nx\n');

    const out = await listOutput();
    expect(out).toContain('bare');
    // No description means the note is just the freshness, with no dangling separator.
    expect(out).not.toMatch(/unverified\s+·\s*$/m);
  });
});

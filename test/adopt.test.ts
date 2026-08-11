import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runAdopt, rewriteWikilinks, slugFromFilename } from '../src/commands/adopt.js';
import { loadProject } from '../src/core/source.js';
import { catchWondevError, cleanup, exists, read, silence, tmpRoot, write } from './helpers.js';

let root: string;
beforeEach(async () => {
  root = await tmpRoot();
});
afterEach(async () => {
  await cleanup(root);
});

const adopt = (opts = {}) => silence(() => runAdopt(root, opts));

describe('slugFromFilename', () => {
  it('turns a human title into a legal slug', () => {
    expect(slugFromFilename('Alur Live Map.md')).toBe('alur-live-map');
    expect(slugFromFilename('Spesifikasi Mesin 3 Site.md')).toBe('spesifikasi-mesin-3-site');
    expect(slugFromFilename('CI-CD.md')).toBe('ci-cd');
    expect(slugFromFilename('---.md')).toBe('untitled');
  });
});

describe('rewriteWikilinks', () => {
  const renames = new Map([['Runbook Deployment HA', 'runbook-deployment-ha']]);

  it('points a renamed link at its new slug', () => {
    expect(rewriteWikilinks('see [[Runbook Deployment HA]]', renames)).toBe(
      'see [[runbook-deployment-ha]]',
    );
  });

  it('leaves a link to something outside the vault exactly as written', () => {
    expect(rewriteWikilinks('see [[some-repo-name]]', renames)).toBe('see [[some-repo-name]]');
  });

  it('preserves an alias or anchor after the target', () => {
    expect(rewriteWikilinks('[[Runbook Deployment HA|the runbook]]', renames)).toBe(
      '[[runbook-deployment-ha|the runbook]]',
    );
  });
});

describe('wondev adopt', () => {
  it('refuses when .wondev/ already exists, unless forced', async () => {
    await write(root, 'CLAUDE.md', '# Project\n\nContext.\n');
    await write(root, '.wondev/wondev.yaml', 'name: x\n');
    const err = await catchWondevError(adopt);
    expect(err.message).toMatch(/already exists/);
    await expect(adopt({ force: true })).resolves.toBeUndefined();
  });

  it('fails clearly when there is nothing to adopt', async () => {
    const err = await catchWondevError(adopt);
    expect(err.message).toMatch(/no agent context/i);
    expect(err.hint).toMatch(/wondev init/);
  });

  it('writes nothing on a dry run', async () => {
    await write(root, 'CLAUDE.md', '# Project\n\nContext.\n');
    await adopt({ dryRun: true });
    expect(await exists(root, '.wondev/wondev.yaml')).toBe(false);
  });

  it('adopts a context file as always-on memory', async () => {
    await write(root, 'CLAUDE.md', '# My Project\n\nHandlers live in src/routes.\n');
    await adopt();
    const doc = await read(root, '.wondev/memory/claude-md.md');
    expect(doc).toContain('title: My Project');
    expect(doc).toContain('always: true');
    expect(doc).toContain('Handlers live in src/routes.');
  });

  it('takes only the hand-written part of a file wondev already generated', async () => {
    await write(
      root,
      'AGENTS.md',
      '# Mine\n\nKeep this.\n\n<!-- wondev:start -->\n\nGenerated noise.\n\n<!-- wondev:end -->\n',
    );
    await adopt();
    const doc = await read(root, '.wondev/memory/agents-md.md');
    expect(doc).toContain('Keep this.');
    expect(doc).not.toContain('Generated noise.');
  });

  it('skips a context file that is entirely generated', async () => {
    await write(root, 'AGENTS.md', '<!-- wondev:start -->\n\nAll generated.\n\n<!-- wondev:end -->\n');
    await write(root, 'CLAUDE.md', '# Real\n\nKeep.\n');
    await adopt();
    expect(await exists(root, '.wondev/memory/agents-md.md')).toBe(false);
    expect(await exists(root, '.wondev/memory/claude-md.md')).toBe(true);
  });

  it('adopts skills with their attachments, and every other .claude artifact', async () => {
    await write(root, '.claude/skills/graphify/SKILL.md', '---\nname: graphify\ndescription: d\n---\n\nBody.\n');
    await write(root, '.claude/skills/graphify/references/query.md', '# Query\n');
    await write(root, '.claude/skills/graphify/.version', '1.2.3\n');
    await write(root, '.claude/commands/review.md', '---\nname: review\ndescription: d\n---\n\nGo.\n');
    await write(root, '.claude/agents/auditor.md', '---\nname: auditor\ndescription: d\n---\n\nAudit.\n');

    await adopt();

    expect(await exists(root, '.wondev/skills/graphify/SKILL.md')).toBe(true);
    expect(await exists(root, '.wondev/skills/graphify/references/query.md')).toBe(true);
    expect(await exists(root, '.wondev/commands/review.md')).toBe(true);
    expect(await exists(root, '.wondev/agents/auditor.md')).toBe(true);
    // Not markdown, so it cannot be an attachment.
    expect(await exists(root, '.wondev/skills/graphify/.version')).toBe(false);
  });

  it('normalises vault filenames and keeps the links between them working', async () => {
    await write(root, 'CLAUDE.md', '# P\n\nx\n');
    await write(root, 'vault/Runbook Deployment HA.md', '# Runbook\n\nSteps.\n');
    await write(root, 'vault/Peta Layanan.md', '# Peta\n\nSee [[Runbook Deployment HA]].\n');

    await adopt({ vault: 'vault' });

    expect(await exists(root, '.wondev/memory/runbook-deployment-ha.md')).toBe(true);
    const peta = await read(root, '.wondev/memory/peta-layanan.md');
    expect(peta).toContain('[[runbook-deployment-ha]]');
    expect(peta).toContain("title: Peta");

    // The real test: the adopted project has no unresolved links.
    const { issues } = await loadProject(root, 'demo');
    expect(issues.filter((i) => i.level === 'error')).toEqual([]);
  });

  it('keeps frontmatter it does not understand', async () => {
    await write(root, 'CLAUDE.md', '# P\n\nx\n');
    await write(root, 'vault/a.md', '---\ndiperiksa: 2026-08-10\nowner: platform\n---\n\nBody.\n');
    await adopt({ vault: 'vault' });
    const doc = await read(root, '.wondev/memory/a.md');
    expect(doc).toContain('diperiksa: 2026-08-10');
    expect(doc).toContain('owner: platform');
  });

  it('records the targets it found evidence of', async () => {
    await write(root, 'CLAUDE.md', '# P\n\nx\n');
    await write(root, 'GEMINI.md', '# P\n\ny\n');
    await adopt();
    const config = await read(root, '.wondev/wondev.yaml');
    // Assert on the list, not the whole file: the header comment names every known target,
    // so a naive substring check passes for targets that were never detected.
    const list = /targets:\n((?:\s+-\s+\S+\n)+)/.exec(config)?.[1] ?? '';
    expect(list).toContain('claude');
    expect(list).toContain('gemini');
    expect(list).not.toContain('cursor');
  });
});

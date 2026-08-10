import path from 'node:path';
import fs from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runInit } from '../src/commands/init.js';
import { runUpgrade } from '../src/commands/upgrade.js';
import { loadTemplateManifest, saveTemplateManifest } from '../src/core/templates.js';
import { normalizeEol, sha256 } from '../src/util/fs.js';
import { catchWondevError, cleanup, exists, read, silence, tmpRoot, write } from './helpers.js';

let root: string;
beforeEach(async () => {
  root = await tmpRoot();
});
afterEach(async () => {
  await cleanup(root);
});

const init = () => silence(() => runInit(root, { targets: ['claude'], skipBuild: true }));
const upgrade = (opts = {}) => silence(() => runUpgrade(root, opts));

/**
 * Simulate an earlier release having shipped `previous` for this template.
 *
 * The recorded hash is what wondev compares against, so rewriting it is how a test says
 * "upstream has changed this file since your project was created".
 */
async function pretendPreviouslyShipped(rel: string, previous: string): Promise<void> {
  const manifest = await loadTemplateManifest(root);
  if (!manifest) throw new Error('no template manifest');
  manifest.files[rel] = { hash: sha256(normalizeEol(previous)), from: '0.0.1-old' };
  await saveTemplateManifest(root, manifest);
}

/** Upstream changed the file, and the user's copy is not the old shipped one either. */
async function pretendTemplateChanged(rel: string): Promise<void> {
  await pretendPreviouslyShipped(rel, 'content that was never on disk here\n');
}

describe('provenance', () => {
  it('records every shipped starter file at init', async () => {
    await init();
    const manifest = await loadTemplateManifest(root);
    expect(manifest).not.toBeNull();
    expect(Object.keys(manifest!.files)).toContain('skills/debugging/SKILL.md');
    expect(Object.keys(manifest!.files)).toContain('memory/architecture.md');
  });

  it('refuses to upgrade a project with no provenance', async () => {
    await init();
    await fs.rm(path.join(root, '.wondev', '.templates.json'));
    const err = await catchWondevError(() => runUpgrade(root));
    expect(err.message).toMatch(/no starter-pack provenance/i);
  });
});

describe('classification', () => {
  it('does nothing when the shipped templates are unchanged', async () => {
    await init();
    const before = await read(root, '.wondev/skills/debugging/SKILL.md');
    await upgrade();
    expect(await read(root, '.wondev/skills/debugging/SKILL.md')).toBe(before);
    expect(await exists(root, '.wondev/skills/debugging/SKILL.md.new')).toBe(false);
  });

  it('replaces a file the user never touched', async () => {
    await init();
    const file = '.wondev/skills/debugging/SKILL.md';
    const oldShipped = '---\nname: debugging\ndescription: old\n---\n\nThe old procedure.\n';

    // The user's copy IS the old shipped template, byte for byte: they never edited it.
    await write(root, file, oldShipped);
    await pretendPreviouslyShipped('skills/debugging/SKILL.md', oldShipped);

    await upgrade();

    const after = await read(root, file);
    expect(after).not.toBe(oldShipped);
    expect(after).toContain('Reproduce it.');
    expect(await exists(root, `${file}.new`)).toBe(false);
  });

  it('never modifies a file the user edited, writing .new instead', async () => {
    await init();
    const file = '.wondev/skills/debugging/SKILL.md';
    const mine = '---\nname: debugging\ndescription: My own version\n---\n\nMy careful rewrite.\n';
    await write(root, file, mine);
    await pretendTemplateChanged('skills/debugging/SKILL.md');

    await upgrade();

    expect(await read(root, file)).toBe(mine);
    expect(await exists(root, `${file}.new`)).toBe(true);
    expect(await read(root, `${file}.new`)).toContain('Reproduce it.');
  });

  it('keeps offering the update until the user actually merges', async () => {
    await init();
    const file = '.wondev/skills/debugging/SKILL.md';
    await write(root, file, 'mine\n');
    await pretendTemplateChanged('skills/debugging/SKILL.md');

    await upgrade();
    await fs.rm(path.join(root, `${file}.new`));
    await upgrade();

    // The recorded hash deliberately stays at the old value, so the offer survives.
    expect(await exists(root, `${file}.new`)).toBe(true);
  });

  it('respects a starter file the user deleted', async () => {
    await init();
    await fs.rm(path.join(root, '.wondev', 'skills', 'git-workflow', 'SKILL.md'));
    await upgrade();
    expect(await exists(root, '.wondev/skills/git-workflow/SKILL.md')).toBe(false);
  });

  it('re-adds a deleted file only when asked', async () => {
    await init();
    await fs.rm(path.join(root, '.wondev', 'skills', 'git-workflow', 'SKILL.md'));
    await upgrade({ restore: true });
    expect(await exists(root, '.wondev/skills/git-workflow/SKILL.md')).toBe(true);
  });

  it('adds a template that is new in this release', async () => {
    await init();
    const manifest = await loadTemplateManifest(root);
    delete manifest!.files['skills/code-review/SKILL.md'];
    await saveTemplateManifest(root, manifest!);
    await fs.rm(path.join(root, '.wondev', 'skills', 'code-review', 'SKILL.md'));

    await upgrade();
    expect(await exists(root, '.wondev/skills/code-review/SKILL.md')).toBe(true);
  });

  it('skips new templates with --no-new', async () => {
    await init();
    const manifest = await loadTemplateManifest(root);
    delete manifest!.files['skills/code-review/SKILL.md'];
    await saveTemplateManifest(root, manifest!);
    await fs.rm(path.join(root, '.wondev', 'skills', 'code-review', 'SKILL.md'));

    await upgrade({ noNew: true });
    expect(await exists(root, '.wondev/skills/code-review/SKILL.md')).toBe(false);
  });

  it('does not overwrite a user file that collides with a new template path', async () => {
    await init();
    const manifest = await loadTemplateManifest(root);
    delete manifest!.files['skills/code-review/SKILL.md'];
    await saveTemplateManifest(root, manifest!);
    await write(root, '.wondev/skills/code-review/SKILL.md', 'mine, same path\n');

    await upgrade();
    expect(await read(root, '.wondev/skills/code-review/SKILL.md')).toBe('mine, same path\n');
    expect(await exists(root, '.wondev/skills/code-review/SKILL.md.new')).toBe(true);
  });
});

describe('flags', () => {
  it('writes nothing on a dry run', async () => {
    await init();
    const file = '.wondev/skills/debugging/SKILL.md';
    await write(root, file, 'mine\n');
    await pretendTemplateChanged('skills/debugging/SKILL.md');

    await upgrade({ dryRun: true });
    expect(await exists(root, `${file}.new`)).toBe(false);
    expect(await read(root, file)).toBe('mine\n');
  });

  it('limits work to --only', async () => {
    await init();
    await write(root, '.wondev/skills/debugging/SKILL.md', 'mine\n');
    await write(root, '.wondev/skills/code-review/SKILL.md', 'mine too\n');
    await pretendTemplateChanged('skills/debugging/SKILL.md');
    await pretendTemplateChanged('skills/code-review/SKILL.md');

    await upgrade({ only: 'skills/debugging' });

    expect(await exists(root, '.wondev/skills/debugging/SKILL.md.new')).toBe(true);
    expect(await exists(root, '.wondev/skills/code-review/SKILL.md.new')).toBe(false);
  });

  it('rejects an --only that matches nothing', async () => {
    await init();
    await expect(runUpgrade(root, { only: 'nope/nothing' })).rejects.toThrow(/No starter template/);
  });

  it('advances the recorded version after a successful upgrade', async () => {
    await init();
    const manifest = await loadTemplateManifest(root);
    manifest!.version = '0.0.1-old';
    await saveTemplateManifest(root, manifest!);

    await upgrade();
    const after = await loadTemplateManifest(root);
    expect(after!.version).not.toBe('0.0.1-old');
  });
});

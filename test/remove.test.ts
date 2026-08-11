import path from 'node:path';
import fs from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runBuild } from '../src/commands/build.js';
import { runRemove } from '../src/commands/remove.js';
import { catchWondevError, cleanup, exists, seedProject, silence, tmpRoot, write } from './helpers.js';

let root: string;
beforeEach(async () => {
  root = await tmpRoot();
});
afterEach(async () => {
  await cleanup(root);
});

const remove = (kind: string, name: string, opts = {}) =>
  silence(() => runRemove(root, kind, name, opts));

describe('wondev remove', () => {
  it('deletes the source and sweeps the output it produced', async () => {
    await seedProject(root, ['claude']);
    await silence(() => runBuild(root, { quiet: true }));
    expect(await exists(root, '.claude/skills/debugging/SKILL.md')).toBe(true);

    await remove('skill', 'debugging');

    expect(await exists(root, '.wondev/skills/debugging')).toBe(false);
    // The rebuild is the point: without it the artifact looks deleted while every agent
    // still reads a generated copy.
    expect(await exists(root, '.claude/skills/debugging/SKILL.md')).toBe(false);
  });

  it('leaves the generated copy in place when the rebuild is skipped', async () => {
    await seedProject(root, ['claude']);
    await silence(() => runBuild(root, { quiet: true }));
    await remove('skill', 'debugging', { noBuild: true });
    expect(await exists(root, '.claude/skills/debugging/SKILL.md')).toBe(true);
  });

  it('writes nothing on a dry run', async () => {
    await seedProject(root, ['claude']);
    await remove('memory', 'architecture', { dryRun: true });
    expect(await exists(root, '.wondev/memory/architecture.md')).toBe(true);
  });

  it('names what to do next when the artifact does not exist', async () => {
    await seedProject(root, ['claude']);
    const err = await catchWondevError(() => remove('memory', 'nope'));
    expect(err.message).toMatch(/No memory named "nope"/);
    expect(err.hint).toMatch(/wondev list/);
  });

  it('removes every artifact kind', async () => {
    await seedProject(root, ['claude']);
    await write(root, '.wondev/agents/a.md', '---\nname: a\ndescription: d\n---\n\nx\n');
    await silence(() => runBuild(root, { quiet: true }));

    await remove('memory', 'architecture');
    await remove('command', 'review');
    await remove('agent', 'a');

    expect(await exists(root, '.wondev/memory/architecture.md')).toBe(false);
    expect(await exists(root, '.wondev/commands/review.md')).toBe(false);
    expect(await exists(root, '.wondev/agents/a.md')).toBe(false);
  });

  it('handles the flat skills/<name>.md form too', async () => {
    await seedProject(root, ['claude']);
    await write(root, '.wondev/skills/solo.md', '---\nname: solo\ndescription: d\n---\n\nx\n');
    await remove('skill', 'solo');
    expect(await exists(root, '.wondev/skills/solo.md')).toBe(false);
  });

  it('rejects an unknown artifact kind', async () => {
    await seedProject(root, ['claude']);
    const err = await catchWondevError(() => remove('widget', 'x'));
    expect(err.message).toMatch(/Unknown artifact type/);
  });
});

describe('remove refuses to delete outside .wondev/', () => {
  /**
   * Regression test for arbitrary file deletion.
   *
   * `remove` built a path from its argument and called fs.rm, bypassing the guards the rest
   * of wondev routes deletion through. `wondev remove memory ../../../notes` deleted a file
   * outside the project, and the skill form deleted a directory tree recursively -- both
   * reported as a success. Introduced in 0.8.0, live in 0.9.9.
   */
  it('rejects a name that climbs out of the directory', async () => {
    await seedProject(root, ['claude']);
    for (const name of ['../../../x', 'a/../../../x', '..']) {
      const err = await catchWondevError(() => remove('memory', name));
      expect(err.message).toMatch(/Invalid memory name/);
      expect(err.hint).toMatch(/cannot contain/);
    }
  });

  it('rejects an absolute path', async () => {
    await seedProject(root, ['claude']);
    const err = await catchWondevError(() => remove('memory', '/etc/passwd'));
    expect(err.message).toMatch(/Invalid memory name/);
  });

  it('leaves a file outside the project untouched', async () => {
    await seedProject(root, ['claude']);
    const outside = path.join(root, '..', `wondev-canary-${path.basename(root)}.md`);
    await fs.writeFile(outside, 'CANARY', 'utf8');
    try {
      await catchWondevError(() => remove('memory', '../../../' + path.basename(outside, '.md')));
      expect(await fs.readFile(outside, 'utf8')).toBe('CANARY');
    } finally {
      await fs.rm(outside, { force: true });
    }
  });

  it('still removes a legitimate nested memory slug', async () => {
    await seedProject(root, ['claude']);
    await write(root, '.wondev/memory/decisions/0001-x.md', '---\ntitle: X\n---\n\nx\n');
    await remove('memory', 'decisions/0001-x', { noBuild: true });
    expect(await exists(root, '.wondev/memory/decisions/0001-x.md')).toBe(false);
  });
});

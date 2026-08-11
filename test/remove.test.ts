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

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runBuild } from '../src/commands/build.js';
import { runCheck } from '../src/commands/check.js';
import { runClean } from '../src/commands/clean.js';
import { loadManifest } from '../src/core/writer.js';
import { catchWondevError, cleanup, exists, read, seedProject, silence, tmpRoot, write } from './helpers.js';

let root: string;
beforeEach(async () => {
  root = await tmpRoot();
});
afterEach(async () => {
  await cleanup(root);
});

const build = (opts = {}) => silence(() => runBuild(root, { quiet: true, ...opts }));
const check = () => silence(() => runCheck(root));

/** seedProject plus an `index:` block, and optionally a large always-on document. */
async function seedWithIndex(indexYaml: string, huge = false): Promise<void> {
  await seedProject(root, ['claude', 'agents']);
  await write(
    root,
    '.wondev/wondev.yaml',
    `name: demo\ntargets:\n  - claude\n  - agents\n${indexYaml}`,
  );
  if (huge) {
    await write(
      root,
      '.wondev/memory/big.md',
      `---\ntitle: Big\nalways: true\n---\n\n${'x'.repeat(8000)}\n`,
    );
  }
}

describe('memory index', () => {
  it('is not generated when no index is configured', async () => {
    await seedProject(root, ['claude']);
    await build();
    const manifest = await loadManifest(root);
    expect(Object.values(manifest.files).some((e) => e.target === 'index')).toBe(false);
  });

  it('writes the table and keeps the prose already in the file', async () => {
    await seedWithIndex('index:\n  file: docs/Index.md\n');
    await write(root, 'docs/Index.md', '# House rules\n\nRead this first.\n');

    await build();

    const after = await read(root, 'docs/Index.md');
    expect(after).toContain('# House rules');
    expect(after).toContain('Read this first.');
    expect(after).toContain('## Always loaded');
    expect(after).toContain('[[architecture]]');
  });

  it('creates the file when it does not exist yet', async () => {
    await seedWithIndex('index:\n  file: docs/Index.md\n');
    await build();
    expect(await exists(root, 'docs/Index.md')).toBe(true);
  });

  it('strips only its own region on clean', async () => {
    await seedWithIndex('index:\n  file: docs/Index.md\n');
    await write(root, 'docs/Index.md', '# House rules\n\nRead this first.\n');
    await build();

    await silence(() => runClean(root));

    const cleaned = await read(root, 'docs/Index.md');
    expect(cleaned).toContain('# House rules');
    expect(cleaned).not.toContain('## Always loaded');
  });

  it('reports drift when the region is edited by hand', async () => {
    await seedWithIndex('index:\n  file: docs/Index.md\n');
    await build();
    const current = await read(root, 'docs/Index.md');
    await write(root, 'docs/Index.md', current.replace('Always loaded', 'Tampered'));

    const err = await catchWondevError(check);
    expect(err.message).toMatch(/do not match|edited by hand/);
  });

  it('passes check with a large always-on context when no budget is set', async () => {
    await seedWithIndex('index:\n  file: docs/Index.md\n', true);
    await build();
    await expect(check()).resolves.toBeUndefined();
  });

  it('fails check once a budget below the total is set, naming the biggest', async () => {
    await seedWithIndex('index:\n  file: docs/Index.md\n  budget: 100\n', true);
    await build();

    const err = await catchWondevError(check);
    expect(err.message).toMatch(/Always-on context/);
    expect(err.message).toContain('big');
    expect(err.hint).toMatch(/always: false/);
  });

  it('refuses an index path that collides with a target', async () => {
    await seedWithIndex('index:\n  file: AGENTS.md\n');
    const err = await catchWondevError(build);
    expect(err.message).toMatch(/already written by target/);
  });
});

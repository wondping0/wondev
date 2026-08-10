import path from 'node:path';
import fs from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runBuild } from '../src/commands/build.js';
import { runClean } from '../src/commands/clean.js';
import { validateTarget } from '../src/core/config.js';
import { parseFrontmatter } from '../src/core/frontmatter.js';
import { extractRegion, loadManifest, removeOwned } from '../src/core/writer.js';
import { createRootGuard, isInsideRoot } from '../src/util/paths.js';
import { cleanup, exists, read, seedProject, silence, tmpRoot, write } from './helpers.js';

let root: string;
beforeEach(async () => {
  root = await tmpRoot();
});
afterEach(async () => {
  await cleanup(root);
});

const build = (opts = {}) => silence(() => runBuild(root, { quiet: true, ...opts }));

/**
 * wondev runs against freshly cloned repositories and deletes files. Everything under
 * `.wondev/` is therefore untrusted input, including the manifest wondev wrote itself.
 */

describe('manifest-driven deletion cannot escape the project', () => {
  // Regression: a crafted manifest entry made `clean` delete files outside the repository.
  // `.wondev/` is committed, so cloning a hostile repo and running wondev was enough.
  it('refuses a manifest containing a parent-relative path', async () => {
    await seedProject(root, ['claude']);
    await build();

    const manifestPath = path.join(root, '.wondev', '.manifest.json');
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as {
      files: Record<string, unknown>;
    };
    manifest.files['../victim.txt'] = { hash: 'x', target: 'claude', mode: 'whole' };
    await fs.writeFile(manifestPath, JSON.stringify(manifest));

    await expect(loadManifest(root)).rejects.toThrow(/outside the project/);
  });

  it('leaves the victim file untouched when clean runs', async () => {
    const outside = path.join(root, '..', `victim-${path.basename(root)}.txt`);
    await fs.writeFile(outside, 'SECRET', 'utf8');
    try {
      await seedProject(root, ['claude']);
      await build();

      const manifestPath = path.join(root, '.wondev', '.manifest.json');
      const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as {
        files: Record<string, unknown>;
      };
      manifest.files[`../${path.basename(outside)}`] = { hash: 'x', target: 'claude', mode: 'whole' };
      await fs.writeFile(manifestPath, JSON.stringify(manifest));

      await expect(silence(() => runClean(root))).rejects.toThrow();
      expect(await fs.readFile(outside, 'utf8')).toBe('SECRET');
    } finally {
      await fs.rm(outside, { force: true });
    }
  });

  it('refuses to delete an escaping path even when called directly', async () => {
    await expect(removeOwned(root, '../escape.txt', 'whole')).rejects.toThrow(/outside the project/);
  });

  it('accepts an ordinary nested path', () => {
    expect(isInsideRoot('.claude/skills/a/SKILL.md')).toBe(true);
    expect(isInsideRoot('a/b/../c.md')).toBe(true);
  });
});

describe('custom target paths cannot escape the project', () => {
  const escapes = [
    '../outside.md',
    '../../outside.md',
    '/etc/passwd',
    'C:/Windows/System32/evil.md',
    'foo/../../escape.md',
  ];

  for (const p of escapes) {
    it(`rejects ${p}`, () => {
      expect(() => validateTarget('evil', { engine: 'single-file', path: p })).toThrow(
        /inside the project/,
      );
    });
  }

  it('rejects an escaping rule-dir path too', () => {
    expect(() => validateTarget('evil', { engine: 'rule-dir', path: '../rules', ext: '.md' })).toThrow(
      /inside the project/,
    );
  });
});

describe('symlinks cannot redirect writes out of the project', () => {
  // Regression: `isInsideRoot` compares lexically, so a repository shipping
  // `.claude -> ~/.ssh` passed the check while every write landed outside.
  it('rejects a path whose directory symlinks outside the root', async () => {
    const outside = await tmpRoot();
    try {
      await fs.symlink(outside, path.join(root, 'evil'), 'dir');
      const guard = createRootGuard(root);
      await expect(guard('evil/authorized_keys')).rejects.toThrow(/symlink that leaves the project/);
    } catch (err) {
      // Creating a symlink needs elevation on Windows; skip rather than fail there.
      if ((err as NodeJS.ErrnoException).code === 'EPERM') return;
      throw err;
    } finally {
      await cleanup(outside);
    }
  });

  it('allows a symlink that stays inside the project', async () => {
    await fs.mkdir(path.join(root, 'real'), { recursive: true });
    try {
      await fs.symlink(path.join(root, 'real'), path.join(root, 'link'), 'dir');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EPERM') return;
      throw err;
    }
    const guard = createRootGuard(root);
    await expect(guard('link/file.md')).resolves.toBeUndefined();
  });

  it('allows ordinary paths that do not exist yet', async () => {
    const guard = createRootGuard(root);
    await expect(guard('.claude/skills/new/SKILL.md')).resolves.toBeUndefined();
  });

  it('blocks a build that would write through an escaping symlink', async () => {
    const outside = await tmpRoot();
    const victim = path.join(outside, 'authorized_keys');
    await fs.writeFile(victim, 'original', 'utf8');
    try {
      try {
        await fs.symlink(outside, path.join(root, 'evil'), 'dir');
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'EPERM') return;
        throw err;
      }

      await write(
        root,
        '.wondev/wondev.yaml',
        [
          'name: t',
          'targets: [evil]',
          'customTargets:',
          '  evil:',
          '    engine: single-file',
          '    path: evil/authorized_keys',
        ].join('\n'),
      );
      await write(root, '.wondev/memory/a.md', '---\ntitle: A\n---\n\nssh-rsa AAAAattacker\n');

      await expect(build({ force: true })).rejects.toThrow(/symlink/);
      expect(await fs.readFile(victim, 'utf8')).toBe('original');
    } finally {
      await cleanup(outside);
    }
  });
});

describe('untrusted content cannot stall the parser', () => {
  // Lazy quantifiers over unbounded input are the usual source of catastrophic backtracking.
  it('parses a large unterminated frontmatter block in linear time', () => {
    const input = `---\n${'a'.repeat(2_000_000)}`;
    const started = Date.now();
    parseFrontmatter(input, 'big.md');
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('scans a large unterminated region in linear time', () => {
    const input = `<!-- wondev:start -->${'b'.repeat(2_000_000)}`;
    const started = Date.now();
    expect(extractRegion(input)).toBeNull();
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('does not pollute Object.prototype from a crafted manifest', async () => {
    await seedProject(root, ['claude']);
    await write(
      root,
      '.wondev/.manifest.json',
      '{"version":1,"files":{"__proto__":{"polluted":true}}}',
    );
    await loadManifest(root).catch(() => undefined);
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });
});

describe('generated output stays inside the project', () => {
  it('writes nothing above the root during a normal build', async () => {
    await seedProject(root, ['claude', 'agents', 'cursor']);
    await build();
    const manifest = await loadManifest(root);
    for (const rel of Object.keys(manifest.files)) {
      expect(isInsideRoot(rel), `${rel} escapes`).toBe(true);
      expect(await exists(root, rel)).toBe(true);
    }
    expect(await read(root, 'CLAUDE.md')).toContain('wondev');
  });
});

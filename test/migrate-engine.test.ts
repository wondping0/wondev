import path from 'node:path';
import fs from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  MIGRATIONS,
  pendingMigrations,
  runMigrations,
  type Migration,
} from '../src/core/migrate/index.js';
import { assertSchemaCurrent } from '../src/core/schema.js';
import { loadConfig, stampConfig } from '../src/core/config.js';
import { catchWondevError, cleanup, read, seedProject, tmpRoot, write } from './helpers.js';

/**
 * The migration engine, exercised end to end against synthetic schema versions.
 *
 * `MIGRATIONS` is empty because schema 1 is the only shape that has ever existed, so every
 * path through this engine is currently unreachable in production. That is exactly the
 * problem: the first real schema bump would be the first time any of it ran, on the day it
 * matters, against someone's authored files.
 *
 * These tests supply their own migrations rather than waiting for a real one.
 */

let root: string;
beforeEach(async () => {
  root = await tmpRoot();
});
afterEach(async () => {
  await cleanup(root);
});

/** A migration that rewrites one frontmatter key, which is what a real one tends to be. */
function renameKey(from: number, to: number, oldKey: string, newKey: string): Migration {
  return {
    from,
    to,
    describe: `rename \`${oldKey}\` to \`${newKey}\``,
    async apply(projectRoot: string): Promise<string[]> {
      const dir = path.join(projectRoot, '.wondev', 'memory');
      const changed: string[] = [];
      for (const name of await fs.readdir(dir)) {
        if (!name.endsWith('.md')) continue;
        const file = path.join(dir, name);
        const before = await fs.readFile(file, 'utf8');
        const after = before.replace(new RegExp(`^${oldKey}:`, 'm'), `${newKey}:`);
        if (after === before) continue;
        await fs.writeFile(file, after, 'utf8');
        changed.push(`.wondev/memory/${name}`);
      }
      return changed;
    },
  };
}

describe('the shipped migration list', () => {
  it('is a well-formed chain with no gaps or repeats', () => {
    // Guards the day someone appends to it: a chain that skips a version leaves projects at
    // the missing one permanently unmigratable, and nothing else would notice.
    const seen = new Set<number>();
    for (const m of MIGRATIONS) {
      expect(m.to, `migration from ${m.from} must advance exactly one version`).toBe(m.from + 1);
      expect(seen.has(m.from), `two migrations start at schema ${m.from}`).toBe(false);
      seen.add(m.from);
      expect(m.describe.trim().length).toBeGreaterThan(0);
    }
  });
});

describe('pendingMigrations', () => {
  const chain = [renameKey(1, 2, 'checked', 'verified'), renameKey(2, 3, 'owner', 'maintainer')];

  it('returns nothing when the project is already current', () => {
    expect(pendingMigrations(3, 3, chain)).toEqual([]);
    expect(pendingMigrations(4, 3, chain)).toEqual([]);
  });

  it('walks every step between two distant versions, in order', () => {
    expect(pendingMigrations(1, 3, chain).map((m) => `${m.from}→${m.to}`)).toEqual(['1→2', '2→3']);
  });

  it('refuses a broken chain rather than skipping the gap', async () => {
    const gapped = [renameKey(1, 2, 'a', 'b'), renameKey(3, 4, 'c', 'd')];
    const err = await catchWondevError(async () => pendingMigrations(1, 4, gapped));
    expect(err.message).toMatch(/No migration path from schema 2 to 4/);
  });
});

describe('runMigrations', () => {
  it('applies each step in order and reports what it touched', async () => {
    await seedProject(root, ['claude']);
    await write(root, '.wondev/memory/a.md', '---\nchecked: 2026-08-10\nowner: platform\n---\n\nx\n');

    const chain = pendingMigrations(1, 3, [
      renameKey(1, 2, 'checked', 'verified'),
      renameKey(2, 3, 'owner', 'maintainer'),
    ]);
    const { applied, changed } = await runMigrations(root, chain);

    expect(applied.map((m) => m.to)).toEqual([2, 3]);
    expect(changed).toContain('.wondev/memory/a.md');

    const after = await read(root, '.wondev/memory/a.md');
    expect(after).toContain('verified: 2026-08-10');
    expect(after).toContain('maintainer: platform');
    expect(after).not.toContain('checked:');
  });

  it('stops at the first failure, leaving a state that can be diagnosed', async () => {
    await seedProject(root, ['claude']);
    await write(root, '.wondev/memory/a.md', '---\nchecked: 2026-08-10\n---\n\nx\n');

    const exploding: Migration = {
      from: 2,
      to: 3,
      describe: 'fails',
      apply: async () => {
        throw new Error('migration 2→3 blew up');
      },
    };

    await expect(
      runMigrations(root, [renameKey(1, 2, 'checked', 'verified'), exploding]),
    ).rejects.toThrow(/blew up/);

    // The first migration's work is kept on purpose: rolling it back would discard a
    // correct step and leave no evidence of how far the chain got.
    expect(await read(root, '.wondev/memory/a.md')).toContain('verified:');
  });
});

describe('the refusal that sends a user to migrate', () => {
  it('names the command when the project predates this build', async () => {
    const err = await catchWondevError(async () => assertSchemaCurrent(1, 2));
    expect(err.message).toMatch(/uses source schema 1; this wondev expects 2/);
    expect(err.hint).toMatch(/wondev migrate/);
  });

  it('accepts a project already at or beyond the current schema', () => {
    expect(() => assertSchemaCurrent(2, 2)).not.toThrow();
    expect(() => assertSchemaCurrent(3, 2)).not.toThrow();
  });
});

describe('stampConfig', () => {
  it('advances the schema without destroying the comments around it', async () => {
    await seedProject(root, ['claude']);
    await write(
      root,
      '.wondev/wondev.yaml',
      '# keep this comment\nname: demo\ntargets:\n  - claude\nschema: 1\n',
    );

    await stampConfig(root, 1, '9.9.9');

    const raw = await read(root, '.wondev/wondev.yaml');
    expect(raw).toContain('# keep this comment');
    expect(raw).toContain('wondevVersion: 9.9.9');

    const config = await loadConfig(root);
    expect(config.schema).toBe(1);
    expect(config.wondevVersion).toBe('9.9.9');
  });
});

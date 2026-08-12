import path from 'node:path';
import fs from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  MIGRATIONS,
  pendingMigrations,
  runMigrations,
  type Migration,
} from '../src/core/migrate/index.js';
import { assertSchemaCurrent, SOURCE_SCHEMA_VERSION } from '../src/core/schema.js';
import { loadConfig, stampConfig } from '../src/core/config.js';
import { runMigrate } from '../src/commands/migrate.js';
import { catchWondevError, cleanup, read, seedProject, silence, tmpRoot, write } from './helpers.js';

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
      // A migration that advances past SOURCE_SCHEMA_VERSION means someone added the
      // migration and forgot to bump the constant. `wondev migrate` would then stamp the
      // project to a schema this very build refuses to load -- migrating it into a state
      // only a future release can read.
      expect(
        m.to,
        `migration to schema ${m.to} exceeds SOURCE_SCHEMA_VERSION ${SOURCE_SCHEMA_VERSION}; bump the constant`,
      ).toBeLessThanOrEqual(SOURCE_SCHEMA_VERSION);
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

describe('the migrate command', () => {
  /** A migration that renames one frontmatter key, wrapped for the command tests. */
  const bump = (from: number, to: number): Migration => renameKey(from, to, 'checked', 'verified');

  it('says nothing to do, and stamps the version that last touched the project', async () => {
    await seedProject(root, ['claude']);
    await write(root, '.wondev/wondev.yaml', 'name: demo\ntargets:\n  - claude\nschema: 1\n');

    await silence(() => runMigrate(root));

    const config = await loadConfig(root);
    expect(config.schema).toBe(1);
    // The stamp is the point: without it the next upgrade cannot tell what wrote this.
    expect(config.wondevVersion).toBeDefined();
  });

  it('changes nothing on a dry run', async () => {
    await seedProject(root, ['claude']);
    await write(root, '.wondev/memory/a.md', '---\nchecked: 2026-08-10\n---\n\nx\n');

    await silence(() => runMigrate(root, { dryRun: true, migrations: [bump(1, 2)] }));

    expect(await read(root, '.wondev/memory/a.md')).toContain('checked:');
    expect((await loadConfig(root)).schema).toBe(1);
  });

  it('applies the chain and stamps the schema it reached', async () => {
    // This is the path that has never run in production, because MIGRATIONS is empty. It
    // would otherwise first execute on the day a real schema bump ships.
    await seedProject(root, ['claude']);
    await write(root, '.wondev/wondev.yaml', 'name: demo\ntargets:\n  - claude\nschema: 1\n');
    await write(root, '.wondev/memory/a.md', '---\nchecked: 2026-08-10\n---\n\nx\n');

    await silence(() => runMigrate(root, { migrations: [bump(1, 2), renameKey(2, 3, 'owner', 'maintainer')] }));

    const after = await read(root, '.wondev/memory/a.md');
    expect(after).toContain('verified: 2026-08-10');

    // Read the raw file: the injected chain simulates a future build's migrations, so the
    // stamped schema is deliberately beyond what this build will load.
    const raw = await read(root, '.wondev/wondev.yaml');
    expect(raw).toContain('schema: 3');
    expect(raw).toMatch(/wondevVersion:/);
  });

  it('refuses a chain with a gap instead of skipping it', async () => {
    await seedProject(root, ['claude']);
    await write(root, '.wondev/wondev.yaml', 'name: demo\ntargets:\n  - claude\nschema: 1\n');

    const err = await catchWondevError(() =>
      silence(() => runMigrate(root, { migrations: [bump(1, 2), renameKey(3, 4, 'a', 'b')] })),
    );
    expect(err.message).toMatch(/No migration path/);
    // Nothing was stamped, so the project is still honestly at schema 1.
    expect((await loadConfig(root)).schema).toBe(1);
  });
});

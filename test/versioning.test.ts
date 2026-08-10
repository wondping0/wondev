import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { runBuild } from '../src/commands/build.js';
import { runCheck } from '../src/commands/check.js';
import { runInit } from '../src/commands/init.js';
import { runMigrate } from '../src/commands/migrate.js';
import { loadConfig, stampConfig } from '../src/core/config.js';
import { pendingMigrations, runMigrations, type Migration } from '../src/core/migrate/index.js';
import {
  assertSchemaCurrent,
  MANIFEST_SCHEMA_VERSION,
  SOURCE_SCHEMA_VERSION,
} from '../src/core/schema.js';
import { loadManifest } from '../src/core/writer.js';
import { wondevVersion } from '../src/util/version.js';
import { catchWondevError, cleanup, read, seedProject, silence, tmpRoot, write } from './helpers.js';

let root: string;
beforeEach(async () => {
  root = await tmpRoot();
});
afterEach(async () => {
  await cleanup(root);
});

const build = (opts = {}) => silence(() => runBuild(root, { quiet: true, ...opts }));

describe('version stamping', () => {
  it('stamps schema and wondevVersion into a new project', async () => {
    await silence(() => runInit(root, { targets: ['claude'], skipBuild: true }));
    const raw = await read(root, '.wondev/wondev.yaml');
    const parsed = parseYaml(raw) as Record<string, unknown>;
    expect(parsed['schema']).toBe(SOURCE_SCHEMA_VERSION);
    expect(parsed['wondevVersion']).toBe(wondevVersion());
  });

  it('stamps the producing version into the manifest', async () => {
    await seedProject(root, ['claude']);
    await build();
    const manifest = await loadManifest(root);
    expect(manifest.wondevVersion).toBe(wondevVersion());
    expect(manifest.version).toBe(MANIFEST_SCHEMA_VERSION);
  });

  it('treats a config with no schema key as version 1', async () => {
    await write(root, '.wondev/wondev.yaml', 'name: demo\ntargets:\n  - claude\n');
    const config = await loadConfig(root);
    expect(config.schema).toBe(1);
  });
});

describe('forward compatibility', () => {
  it('refuses a source schema from the future rather than guessing', async () => {
    await seedProject(root, ['claude']);
    await write(
      root,
      '.wondev/wondev.yaml',
      `name: demo\ntargets:\n  - claude\nschema: ${SOURCE_SCHEMA_VERSION + 5}\n`,
    );
    const err = await catchWondevError(() => loadConfig(root));
    expect(err.message).toMatch(/supports up to/);
    expect(err.hint).toMatch(/Upgrade wondev/);
  });

  it('refuses a manifest format from the future rather than deleting unknown files', async () => {
    await seedProject(root, ['claude']);
    await build();
    const manifest = JSON.parse(await read(root, '.wondev/.manifest.json')) as Record<string, unknown>;
    manifest['version'] = MANIFEST_SCHEMA_VERSION + 5;
    await write(root, '.wondev/.manifest.json', JSON.stringify(manifest));
    await expect(loadManifest(root)).rejects.toThrow(/supports up to/);
  });

  it('rejects a non-integer schema', async () => {
    await write(root, '.wondev/wondev.yaml', 'name: demo\ntargets:\n  - claude\nschema: "one"\n');
    await expect(loadConfig(root)).rejects.toThrow(/positive integer/);
  });
});

describe('backward compatibility gate', () => {
  // Reading an older source shape with current rules would silently produce wrong output,
  // so build and check stop instead of guessing. Only one schema version exists today, so
  // the gate is exercised directly rather than through a project file.
  it('refuses a project older than this build and points at migrate', () => {
    const err = (() => {
      try {
        assertSchemaCurrent(1, 2);
        return null;
      } catch (e) {
        return e as { message: string; hint?: string };
      }
    })();
    expect(err?.message).toMatch(/source schema 1.*expects 2/);
    expect(err?.hint).toMatch(/wondev migrate/);
  });

  it('allows a project at the current schema', () => {
    expect(() => assertSchemaCurrent(2, 2)).not.toThrow();
  });

  it('allows a project ahead of the gate, which loadConfig rejects separately', () => {
    expect(() => assertSchemaCurrent(3, 2)).not.toThrow();
  });

  it('is wired into the commands, so a current project passes', async () => {
    await silence(() => runInit(root, { targets: ['claude'] }));
    await expect(silence(() => runCheck(root))).resolves.toBeUndefined();
  });
});

describe('output-version awareness', () => {
  it('names the version mismatch instead of reporting a bare drift', async () => {
    await seedProject(root, ['claude']);
    await build();

    // Pretend the output came from an older release, as it would after `npm update wondev`.
    const manifest = JSON.parse(await read(root, '.wondev/.manifest.json')) as Record<string, unknown>;
    manifest['wondevVersion'] = '0.0.1-old';
    await write(root, '.wondev/.manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);
    await write(
      root,
      '.wondev/memory/architecture.md',
      '---\ntitle: Architecture\nalways: true\n---\n\nChanged.\n',
    );

    const err = await catchWondevError(() => silence(() => runCheck(root)));
    expect(err.message).toContain('0.0.1-old');
    expect(err.message).toContain(wondevVersion());
    expect(err.hint).toMatch(/wondev build/);
  });

  it('still reports plain drift when the versions match', async () => {
    await seedProject(root, ['claude']);
    await build();
    await write(
      root,
      '.wondev/memory/architecture.md',
      '---\ntitle: Architecture\nalways: true\n---\n\nChanged.\n',
    );
    const err = await catchWondevError(() => silence(() => runCheck(root)));
    expect(err.message).toMatch(/do not match/);
  });

  it('prefers the conflict message over the version message when both apply', async () => {
    await seedProject(root, ['claude']);
    await build();
    const manifest = JSON.parse(await read(root, '.wondev/.manifest.json')) as Record<string, unknown>;
    manifest['wondevVersion'] = '0.0.1-old';
    await write(root, '.wondev/.manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);

    // A whole-mode file, because a region-mode file with no markers is adopted rather than
    // treated as a conflict -- that is the point of region mode.
    await write(root, '.claude/skills/debugging/SKILL.md', 'hand edited\n');

    const err = await catchWondevError(() => silence(() => runCheck(root)));
    expect(err.hint).toMatch(/--force|hand edits/);
  });
});

describe('migration engine', () => {
  const fake = (from: number, to: number): Migration => ({
    from,
    to,
    describe: `fake ${from}->${to}`,
    apply: async () => [`touched-${from}`],
  });

  it('returns nothing when already current', () => {
    expect(pendingMigrations(3, 3, [])).toEqual([]);
  });

  it('never runs backwards', () => {
    expect(pendingMigrations(5, 3, [])).toEqual([]);
  });

  it('builds an ordered chain across several steps', () => {
    const chain = pendingMigrations(1, 4, [fake(1, 2), fake(2, 3), fake(3, 4)]);
    expect(chain.map((m) => `${m.from}->${m.to}`)).toEqual(['1->2', '2->3', '3->4']);
  });

  it('fails loudly on a gap rather than skipping a step', () => {
    expect(() => pendingMigrations(1, 4, [fake(1, 2), fake(3, 4)])).toThrow(/No migration path/);
  });

  it('applies migrations in order and collects changed paths', async () => {
    const { applied, changed } = await runMigrations(root, [fake(1, 2), fake(2, 3)]);
    expect(applied).toHaveLength(2);
    expect(changed).toEqual(['touched-1', 'touched-2']);
  });

  it('stops at the first failure so the state stays diagnosable', async () => {
    const boom: Migration = {
      from: 2,
      to: 3,
      describe: 'explodes',
      apply: async () => {
        throw new Error('boom');
      },
    };
    await expect(runMigrations(root, [fake(1, 2), boom])).rejects.toThrow('boom');
  });
});

describe('wondev migrate', () => {
  it('reports nothing to do on a current project', async () => {
    await silence(() => runInit(root, { targets: ['claude'], skipBuild: true }));
    await expect(silence(() => runMigrate(root))).resolves.toBeUndefined();
  });

  it('refreshes a stale wondevVersion stamp', async () => {
    await silence(() => runInit(root, { targets: ['claude'], skipBuild: true }));
    await stampConfig(root, SOURCE_SCHEMA_VERSION, '0.0.1-old');
    expect((await loadConfig(root)).wondevVersion).toBe('0.0.1-old');

    await silence(() => runMigrate(root));
    expect((await loadConfig(root)).wondevVersion).toBe(wondevVersion());
  });

  it('changes nothing on a dry run', async () => {
    await silence(() => runInit(root, { targets: ['claude'], skipBuild: true }));
    await stampConfig(root, SOURCE_SCHEMA_VERSION, '0.0.1-old');
    await silence(() => runMigrate(root, { dryRun: true }));
    expect((await loadConfig(root)).wondevVersion).toBe('0.0.1-old');
  });
});

describe('stampConfig', () => {
  it('preserves the explanatory comments in wondev.yaml', async () => {
    await silence(() => runInit(root, { targets: ['claude'], skipBuild: true }));
    const before = await read(root, '.wondev/wondev.yaml');
    expect(before).toContain('# wondev configuration.');

    await stampConfig(root, SOURCE_SCHEMA_VERSION, '9.9.9');
    const after = await read(root, '.wondev/wondev.yaml');
    expect(after).toContain('# wondev configuration.');
    expect(after).toContain('customTargets:');
    expect((parseYaml(after) as Record<string, unknown>)['wondevVersion']).toBe('9.9.9');
  });

  it('leaves the target list intact', async () => {
    await silence(() => runInit(root, { targets: ['claude', 'cursor'], skipBuild: true }));
    await stampConfig(root, SOURCE_SCHEMA_VERSION, '9.9.9');
    const config = await loadConfig(root);
    expect(config.targets).toEqual(['claude', 'cursor']);
  });
});

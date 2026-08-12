import { loadConfig, stampConfig } from '../core/config.js';
import {
  MIGRATIONS,
  pendingMigrations,
  runMigrations,
  type Migration,
} from '../core/migrate/index.js';
import { SOURCE_SCHEMA_VERSION } from '../core/schema.js';
import { info, step, style, success } from '../util/log.js';
import { wondevVersion } from '../util/version.js';

export interface MigrateOptions {
  dryRun?: boolean;
  /**
   * The migration list to use. Defaults to the shipped `MIGRATIONS`.
   *
   * A seam, for the same reason `pendingMigrations` already takes one: `MIGRATIONS` is empty
   * because schema 1 is the only shape that has existed, so without this the code that
   * actually applies a migration cannot be executed until the day it first matters. Tests
   * supply their own list and run the real path.
   */
  migrations?: Migration[];
}

/**
 * Bring an older project's authored source up to the current schema.
 *
 * Kept as its own command, never folded into `build`, because migrations rewrite files the
 * user wrote. That needs an explicit decision and a clean git tree, not a side effect.
 */
export async function runMigrate(root: string, options: MigrateOptions = {}): Promise<void> {
  const config = await loadConfig(root);
  const available = options.migrations ?? MIGRATIONS;
  const target = available.reduce((n, m) => Math.max(n, m.to), SOURCE_SCHEMA_VERSION);
  const chain = pendingMigrations(config.schema, target, available);
  const running = wondevVersion();

  if (chain.length === 0) {
    info(`Source schema ${config.schema} is current — nothing to migrate.`);

    // Even with no schema change, recording the version that last touched the project makes
    // the next upgrade diagnosable.
    if (config.wondevVersion !== running && !options.dryRun) {
      await stampConfig(root, config.schema, running);
      step(`stamped wondevVersion ${config.wondevVersion ?? 'none'} -> ${running}`);
    }
    return;
  }

  info(
    `Migrating source schema ${style.bold(String(config.schema))} -> ${style.bold(String(target))}`,
  );
  for (const migration of chain) {
    step(`${migration.from} -> ${migration.to}: ${migration.describe}`);
  }

  if (options.dryRun) {
    info('');
    info(style.dim('Dry run: nothing was changed.'));
    return;
  }

  const { applied, changed } = await runMigrations(root, chain);
  for (const path of changed) step(`${style.dim('changed')}  ${path}`);

  await stampConfig(root, target, running);
  success(
    `applied ${applied.length} migration(s), ${changed.length} file(s) changed — now at schema ${target}`,
  );
  info(style.dim('Run `wondev build` to regenerate output from the migrated source.'));
}

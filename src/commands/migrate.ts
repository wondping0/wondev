import { loadConfig, stampConfig } from '../core/config.js';
import { MIGRATIONS, pendingMigrations, runMigrations } from '../core/migrate/index.js';
import { SOURCE_SCHEMA_VERSION } from '../core/schema.js';
import { info, step, style, success } from '../util/log.js';
import { wondevVersion } from '../util/version.js';

export interface MigrateOptions {
  dryRun?: boolean;
}

/**
 * Bring an older project's authored source up to the current schema.
 *
 * Kept as its own command, never folded into `build`, because migrations rewrite files the
 * user wrote. That needs an explicit decision and a clean git tree, not a side effect.
 */
export async function runMigrate(root: string, options: MigrateOptions = {}): Promise<void> {
  const config = await loadConfig(root);
  const chain = pendingMigrations(config.schema, SOURCE_SCHEMA_VERSION, MIGRATIONS);
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
    `Migrating source schema ${style.bold(String(config.schema))} -> ${style.bold(String(SOURCE_SCHEMA_VERSION))}`,
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

  await stampConfig(root, SOURCE_SCHEMA_VERSION, running);
  success(
    `applied ${applied.length} migration(s), ${changed.length} file(s) changed — now at schema ${SOURCE_SCHEMA_VERSION}`,
  );
  info(style.dim('Run `wondev build` to regenerate output from the migrated source.'));
}

import { SOURCE_SCHEMA_VERSION } from '../schema.js';
import { WondevError } from '../../util/errors.js';

/**
 * One step between adjacent source schema versions.
 *
 * Migrations rewrite the user's authored files, so they are never run implicitly by `build`
 * or `check` -- only by an explicit `wondev migrate`.
 */
export interface Migration {
  from: number;
  to: number;
  /** One line, shown before it runs. */
  describe: string;
  /** Returns the paths it changed, relative to the project root. */
  apply(root: string): Promise<string[]>;
}

/**
 * Registered migrations, in order.
 *
 * Empty today: schema 1 is the first and only shape. The machinery exists now because the
 * version stamp it reads cannot be added retroactively -- a project initialised without one
 * can never be identified later. Adding a migration is appending to this array.
 */
export const MIGRATIONS: Migration[] = [];

/** Migrations needed to bring `from` up to `to`, verified to form an unbroken chain. */
export function pendingMigrations(
  from: number,
  to: number = SOURCE_SCHEMA_VERSION,
  available: Migration[] = MIGRATIONS,
): Migration[] {
  if (from >= to) return [];

  const chain: Migration[] = [];
  let current = from;
  while (current < to) {
    const next = available.find((m) => m.from === current);
    if (!next) {
      throw new WondevError(
        `No migration path from schema ${current} to ${to}.`,
        'This project may have been created by an incompatible version of wondev.',
      );
    }
    chain.push(next);
    current = next.to;
  }
  return chain;
}

export interface MigrationRun {
  applied: Migration[];
  changed: string[];
}

/** Run a chain in order, stopping at the first failure so a partial state is diagnosable. */
export async function runMigrations(root: string, chain: Migration[]): Promise<MigrationRun> {
  const applied: Migration[] = [];
  const changed: string[] = [];
  for (const migration of chain) {
    const touched = await migration.apply(root);
    applied.push(migration);
    changed.push(...touched);
  }
  return { applied, changed };
}

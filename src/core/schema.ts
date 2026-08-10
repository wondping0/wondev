import { WondevError } from '../util/errors.js';

/**
 * Format versions.
 *
 * These are independent of the package version on purpose. The npm version changes often;
 * these change only when the on-disk shape does, which is what a migration keys off.
 *
 * A project written without a `schema` key is assumed to be at version 1, since that is the
 * first shape that ever existed.
 */

/** Shape of `.wondev/` and its frontmatter. Bump when authored files must change. */
export const SOURCE_SCHEMA_VERSION = 1;

/** Shape of `.wondev/.manifest.json`. Bump when the bookkeeping format changes. */
export const MANIFEST_SCHEMA_VERSION = 1;

/**
 * Refuse to operate on a project whose source predates this build.
 *
 * Kept as a pure function rather than inlined at the call site so it stays testable while
 * only one schema version exists -- otherwise the branch could not be exercised until the
 * day it first matters, which is exactly the wrong time to discover it is wrong.
 */
export function assertSchemaCurrent(
  schema: number,
  current: number = SOURCE_SCHEMA_VERSION,
): void {
  if (schema < current) {
    throw new WondevError(
      `This project uses source schema ${schema}; this wondev expects ${current}.`,
      'Run `wondev migrate` to bring it up to date.',
    );
  }
}

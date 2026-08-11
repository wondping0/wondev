/**
 * Programmatic API.
 *
 * The CLI is the primary interface, but exposing the pure pieces lets other tools reuse the
 * parser and renderers without shelling out.
 *
 * ## What is here, and what is not
 *
 * Two things: the **format** — types, loaders, and the pure render functions that turn a
 * `Project` into files — and the **commands**, which are what the CLI itself calls.
 *
 * Removed in 0.9.9, ahead of 1.0: the writer internals (`planWrites`, `applyPlan`,
 * `cleanAll`, `loadManifest`), the template bookkeeping, the semver helpers, and the
 * migration registry. They were exported because they existed, not because their shapes
 * were designed to be built on — `applyPlan` had already gained a parameter in 0.1.2, which
 * would have been a breaking change had anyone been relying on it.
 *
 * If you were calling one of those, call the corresponding `run*` command instead: it does
 * the bookkeeping correctly, including the parts that are easy to get wrong, such as which
 * files a partial build is allowed to retire.
 */
export type {
  Attachment,
  Command,
  ClaudeTarget,
  MemoryDoc,
  NamedTarget,
  Project,
  RenderedFile,
  RuleDirTarget,
  SingleFileTarget,
  Target,
  WriteMode,
} from './core/model.js';

export {
  loadConfig,
  resolveTargets,
  validateTarget,
  type IndexColumn,
  type IndexConfig,
  type WondevConfig,
} from './core/config.js';
export { loadProject, hasErrors, type Issue, type LoadResult } from './core/source.js';
export {
  renderAll,
  renderTarget,
  flattenProject,
  INDEX_OWNER,
  type RenderResult,
} from './core/render/index.js';
export { renderIndex, alwaysOnTokens, docTokens } from './core/render/index-doc.js';
export { onDemandMemoryIndex } from './core/render/shared.js';
export { estimateTokens, formatTokens } from './util/tokens.js';
export {
  BUILTIN_TARGETS,
  DEFAULT_TARGETS,
  TARGET_ALIASES,
  knownTargetNames,
  lookupBuiltin,
  resolveAlias,
} from './core/registry.js';
export { WondevError, isWondevError } from './util/errors.js';

export { runInit } from './commands/init.js';
export { runBuild } from './commands/build.js';
export { runCheck } from './commands/check.js';
export { runClean } from './commands/clean.js';
export { runAdd } from './commands/add.js';
export { runMigrate } from './commands/migrate.js';
export { runUpgrade } from './commands/upgrade.js';
export { runDoctor } from './commands/doctor.js';
export { runAdopt } from './commands/adopt.js';
export { runRemove } from './commands/remove.js';
export { runList } from './commands/list.js';
export { runWatch } from './commands/watch.js';


export { SOURCE_SCHEMA_VERSION, MANIFEST_SCHEMA_VERSION } from './core/schema.js';
export { wondevVersion } from './util/version.js';

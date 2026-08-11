/**
 * Programmatic API.
 *
 * The CLI is the primary interface, but exposing the pure pieces lets other tools reuse the
 * parser and renderers without shelling out.
 *
 * ## Stability
 *
 * Two tiers, and they are not equally safe to build on.
 *
 * **Stable** — the model types, `loadConfig`, `loadProject`, the render functions, the
 * registry, and `WondevError`. These describe the format and the pure transformation, which
 * is what wondev actually promises.
 *
 * **Provisional** — the writer internals (`planWrites`, `applyPlan`, `cleanAll`) and the
 * `run*` command entry points. They are exported because they were useful before there was
 * a considered API, not because their shapes were designed to be depended on. They will be
 * narrowed or removed in 1.0; `applyPlan` already gained a parameter in 0.1.2. Shell out to
 * the CLI rather than calling these if you want something that keeps working.
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
export {
  cleanAll,
  loadManifest,
  planWrites,
  applyPlan,
  type Manifest,
  type PlanItem,
} from './core/writer.js';
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
export { runWatch } from './commands/watch.js';

export {
  loadTemplateManifest,
  recordTemplates,
  templatesDir,
  type TemplateManifest,
} from './core/templates.js';
export { compareVersions, isNewerThan } from './util/semver.js';

export { SOURCE_SCHEMA_VERSION, MANIFEST_SCHEMA_VERSION } from './core/schema.js';
export {
  MIGRATIONS,
  pendingMigrations,
  runMigrations,
  type Migration,
} from './core/migrate/index.js';
export { wondevVersion } from './util/version.js';

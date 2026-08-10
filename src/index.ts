/**
 * Programmatic API.
 *
 * The CLI is the primary interface, but exposing the pure pieces lets other tools reuse the
 * parser and renderers without shelling out.
 */
export type {
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

export { loadConfig, resolveTargets, validateTarget, type WondevConfig } from './core/config.js';
export { loadProject, hasErrors, type Issue, type LoadResult } from './core/source.js';
export { renderAll, renderTarget, flattenProject, type RenderResult } from './core/render/index.js';
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

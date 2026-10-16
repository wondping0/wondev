import type { NamedTarget, Project, RenderedFile } from '../core/model.js';
import { loadConfig, resolveTargets, SOURCE_KINDS, sourceDirectory, type WondevConfig } from '../core/config.js';
import { loadProject, type Issue } from '../core/source.js';
import { assertSchemaCurrent } from '../core/schema.js';
import { WondevError } from '../util/errors.js';
import { matchesPatterns } from '../core/matching.js';

export interface ProjectContext {
  root: string;
  config: WondevConfig;
  project: Project;
  targets: NamedTarget[];
  issues: Issue[];
}

/** Everything the commands need, loaded once. */
export async function loadContext(root: string, profile?: string): Promise<ProjectContext> {
  const config = await loadConfig(root);

  // Migration rewrites authored files, so it is never implicit. Reading an older source
  // shape with current rules would quietly produce wrong output, so this is a hard stop.
  assertSchemaCurrent(config.schema);

  const { project, issues } = await loadProject(root, config.name, config.sources, config.vault);
  if (config.vault || project.memory.some((doc) => doc.kind === 'lesson' || doc.id?.startsWith('map-module-') || doc.id?.startsWith('map-package-'))) project.contextEnabled = true;
  const selected = profile ?? config.profile;
  if (selected) {
    const settings = config.profiles?.[selected];
    if (!settings || !Object.hasOwn(config.profiles ?? {}, selected)) throw new WondevError(`Unknown profile: ${selected}`);
    project.skills = project.skills.filter((skill) => matchesPatterns(skill.name, settings.skills));
  }
  const targets = resolveTargets(config);
  return { root, config, project, targets, issues };
}

/** Generated output may never become an authored source on the next build. */
export function assertOutputPaths(ctx: ProjectContext, files: RenderedFile[]): void {
  const sources = SOURCE_KINDS.map((kind) => sourceDirectory(kind, ctx.config.sources).toLowerCase());
  for (const file of files) {
    const rel = file.path.replace(/\\/g, '/').toLowerCase();
    if (rel === '.wondev/wondev.yaml' || sources.some((dir) => rel === dir || rel.startsWith(`${dir}/`))) {
      throw new WondevError(`Generated output overlaps authored sources: ${file.path}`);
    }
  }
}

/** Narrow a context to a single target, for `build --target=cursor`. */
export function selectTarget(ctx: ProjectContext, name: string): NamedTarget[] {
  const match = ctx.targets.filter((t) => t.name === name);
  if (match.length === 0) {
    throw new WondevError(
      `Target "${name}" is not enabled in this project.`,
      `Enabled targets: ${ctx.targets.map((t) => t.name).join(', ')}`,
    );
  }
  return match;
}

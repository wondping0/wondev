import type { NamedTarget, Project } from '../core/model.js';
import { loadConfig, resolveTargets, type WondevConfig } from '../core/config.js';
import { loadProject, type Issue } from '../core/source.js';
import { assertSchemaCurrent } from '../core/schema.js';
import { WondevError } from '../util/errors.js';

export interface ProjectContext {
  root: string;
  config: WondevConfig;
  project: Project;
  targets: NamedTarget[];
  issues: Issue[];
}

/** Everything the commands need, loaded once. */
export async function loadContext(root: string): Promise<ProjectContext> {
  const config = await loadConfig(root);

  // Migration rewrites authored files, so it is never implicit. Reading an older source
  // shape with current rules would quietly produce wrong output, so this is a hard stop.
  assertSchemaCurrent(config.schema);

  const { project, issues } = await loadProject(root, config.name);
  const targets = resolveTargets(config);
  return { root, config, project, targets, issues };
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

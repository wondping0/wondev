import type { NamedTarget } from '../core/model.js';
import { INDEX_OWNER, renderAll } from '../core/render/index.js';
import { deprecationNotice } from '../core/registry.js';
import { hasErrors } from '../core/source.js';
import {
  applyPlan,
  conflictsIn,
  describeConflicts,
  loadManifest,
  planWrites,
  type PlanItem,
} from '../core/writer.js';
import { WondevError } from '../util/errors.js';
import { info, step, style, success, warn } from '../util/log.js';
import { loadContext, selectTarget, type ProjectContext } from './context.js';

export interface BuildOptions {
  force?: boolean;
  dryRun?: boolean;
  target?: string | undefined;
  quiet?: boolean;
}

export async function runBuild(root: string, options: BuildOptions = {}): Promise<void> {
  const ctx = await loadContext(root);
  reportIssues(ctx);

  const targets = options.target ? selectTarget(ctx, options.target) : ctx.targets;
  if (!options.quiet) warnDeprecated(targets);
  const { files, owners } = renderAll(ctx.project, targets, ctx.config.index);
  const manifest = await loadManifest(root);
  const plan = await planWrites(root, files, owners, manifest);

  const conflicts = conflictsIn(plan);
  if (conflicts.length > 0 && !options.force) {
    throw describeConflicts(conflicts);
  }

  if (options.dryRun) {
    printPlan(plan, true);
    return;
  }

  // Only a full build may retire another target's files. See applyPlan. The index is
  // rendered whatever the narrowing, so it counts as built.
  const builtTargets = options.target
    ? new Set([...targets.map((t) => t.name), INDEX_OWNER])
    : undefined;
  const { written, removed } = await applyPlan(root, plan, manifest, builtTargets);

  if (!options.quiet) {
    printPlan(plan, false);
    for (const file of removed) {
      step(`${style.dim(file.outcome === 'deleted' ? 'deleted ' : 'stripped')}  ${file.path}`);
    }
    const summary = [
      `${written.length} file(s) written`,
      removed.length > 0 ? `${removed.length} removed` : null,
      `${targets.length} target(s)`,
    ]
      .filter(Boolean)
      .join(', ');
    success(summary);
  }
}

/**
 * Warn once per run when an enabled target has been deprecated, naming the replacement.
 * Agents do move their config paths, and silently writing to a location nothing reads any
 * more is the worst possible failure: everything looks like it worked.
 */
function warnDeprecated(targets: NamedTarget[]): void {
  for (const { name } of targets) {
    const notice = deprecationNotice(name);
    if (notice) warn(notice);
  }
}

function reportIssues(ctx: ProjectContext): void {
  for (const issue of ctx.issues) {
    if (issue.level === 'warning') warn(`${issue.file}: ${issue.message}`);
  }
  if (hasErrors(ctx.issues)) {
    const lines = ctx.issues
      .filter((i) => i.level === 'error')
      .map((i) => `  ${i.file}: ${i.message}`);
    throw new WondevError(
      `Cannot build, ${lines.length} problem(s) in .wondev/:\n${lines.join('\n')}`,
      'Run `wondev check` for the full report.',
    );
  }
}

function printPlan(plan: PlanItem[], dryRun: boolean): void {
  const verbs: Record<PlanItem['action'], string> = {
    create: 'create',
    update: 'update',
    adopt: 'adopt ',
    unchanged: 'same  ',
  };
  for (const item of plan) {
    if (item.action === 'unchanged' && !dryRun) continue;
    const conflict = item.conflict ? style.yellow(` (forced: ${item.conflict})`) : '';
    step(`${style.dim(verbs[item.action])}  ${item.path}${conflict}`);
  }
  if (dryRun) info(style.dim('\nDry run: nothing was written.'));
}

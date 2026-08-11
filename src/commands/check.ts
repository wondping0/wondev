import { renderAll } from '../core/render/index.js';
import { alwaysOnTokens, docTokens } from '../core/render/index-doc.js';
import { formatTokens } from '../util/tokens.js';
import { loadManifest, planWrites } from '../core/writer.js';
import { WondevError } from '../util/errors.js';
import { error, info, style, success, warn } from '../util/log.js';
import { wondevVersion } from '../util/version.js';
import { loadContext } from './context.js';

/**
 * The CI entry point. Reports every problem in one pass and exits non-zero if any of them
 * would make the generated files wrong or out of date.
 */
export async function runCheck(root: string): Promise<void> {
  const ctx = await loadContext(root);

  let errors = 0;
  let warnings = 0;

  for (const issue of ctx.issues) {
    if (issue.level === 'error') {
      errors += 1;
      error(`${issue.file}: ${issue.message}`);
    } else {
      warnings += 1;
      warn(`${issue.file}: ${issue.message}`);
    }
  }

  if (errors > 0) {
    throw new WondevError(`${errors} error(s) in .wondev/.`);
  }

  const { files, owners } = renderAll(ctx.project, ctx.targets, ctx.config.index);
  const manifest = await loadManifest(root);
  const plan = await planWrites(root, files, owners, manifest);

  const conflicts = plan.filter((p) => p.conflict !== undefined);
  for (const c of conflicts) {
    error(
      c.conflict === 'untracked'
        ? `${c.path}: exists but was not written by wondev`
        : `${c.path}: edited by hand since wondev wrote it`,
    );
  }

  const drifted = plan.filter((p) => p.conflict === undefined && p.action !== 'unchanged');
  for (const d of drifted) {
    error(`${d.path}: out of date (would ${d.action === 'create' ? 'be created' : 'change'})`);
  }

  const total = conflicts.length + drifted.length;
  if (total > 0) {
    const running = wondevVersion();
    const generatedBy = manifest.wondevVersion;

    // Distinguish "someone forgot to rebuild" from "wondev itself changed its output".
    // Without this, upgrading wondev turns every downstream CI red with a message that
    // reads like the user broke something.
    if (generatedBy && generatedBy !== running && conflicts.length === 0) {
      throw new WondevError(
        `${total} generated file(s) were produced by wondev ${generatedBy}, but you are running ${running}.`,
        'Run `wondev build` to regenerate them with this version, and commit the result.',
      );
    }

    throw new WondevError(
      `${total} generated file(s) do not match .wondev/.`,
      conflicts.length > 0
        ? 'Run `wondev build --force` to overwrite, or move the hand edits into .wondev/ first.'
        : 'Run `wondev build` to regenerate them.',
    );
  }

  // Only when a budget was asked for. Enforcing a default would turn this into a failure
  // every project inherits on upgrade, which is precisely what docs/versioning.md forbids.
  const budget = ctx.config.index?.budget;
  if (budget !== undefined) {
    const used = alwaysOnTokens(ctx.project);
    if (used > budget) {
      const largest = ctx.project.memory
        .filter((d) => d.always)
        .sort((a, b) => docTokens(b) - docTokens(a))
        .slice(0, 3)
        .map((d) => `  ${d.slug} — ≈${formatTokens(docTokens(d))}`);
      throw new WondevError(
        `Always-on context is ≈${formatTokens(used)}, over the ${formatTokens(budget)} budget.\nLargest contributors:\n${largest.join('\n')}`,
        'Set `always: false` on documents that do not belong in every prompt, or raise `index.budget`.',
      );
    }
  }

  const counts = `${ctx.project.memory.length} memory, ${ctx.project.skills.length} skills, ${ctx.project.commands.length} commands`;
  success(`up to date — ${counts} across ${ctx.targets.length} target(s)`);
  if (warnings > 0) info(style.dim(`${warnings} warning(s)`));
}

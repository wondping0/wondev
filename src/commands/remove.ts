import path from 'node:path';
import fs from 'node:fs/promises';
import { wondevDir } from '../core/config.js';
import { WondevError } from '../util/errors.js';
import { pathExists } from '../util/fs.js';
import { info, step, style, success } from '../util/log.js';
import { parseKind, type ArtifactKind } from './add.js';
import { runBuild } from './build.js';

/**
 * Delete an artifact and the output it produced.
 *
 * This existed as a capability before it existed as a command: deleting the source by hand
 * and rebuilding already swept the generated files, because `applyPlan` retires anything the
 * current render no longer produces. But nothing in `--help` said so, so the reasonable
 * conclusion was that artifacts could not be safely removed at all.
 *
 * The rebuild is the point. Removing the source without it leaves generated copies behind in
 * every target, which is worse than not removing it -- the artifact appears deleted while
 * every agent still reads it.
 */

export interface RemoveOptions {
  dryRun?: boolean;
  /** Skip the rebuild. The generated output is then stale until the next build. */
  noBuild?: boolean;
}

/**
 * Refuse a name that could point outside the directory it belongs to.
 *
 * `remove` builds a path from an argument and then deletes it, which makes it the one place
 * in wondev where an unvalidated name becomes `fs.rm`. Without this,
 * `wondev remove memory ../../../notes` deleted a file outside the project entirely, and the
 * skill form deleted a whole directory tree recursively -- reporting both as a success.
 *
 * Checked lexically first for a clear message, then again against the resolved path, because
 * the lexical test alone cannot account for how the platform normalises a separator.
 */
function assertInside(dir: string, name: string, kind: ArtifactKind): void {
  if (name.trim() === '' || /(^|[/\\])\.\.([/\\]|$)/.test(name) || path.isAbsolute(name)) {
    throw new WondevError(
      `Invalid ${kind} name "${name}".`,
      'A name identifies something inside .wondev/; it cannot contain `..` or be an absolute path.',
    );
  }
}

/** Second gate: the resolved path must still sit under the directory it came from. */
function assertResolvedInside(dir: string, target: string): void {
  const root = path.resolve(dir) + path.sep;
  if (!(path.resolve(target) + path.sep).startsWith(root)) {
    throw new WondevError(
      `Refusing to delete outside ${path.basename(dir)}/: ${target}`,
    );
  }
}

/** Where each kind lives, and whether it owns a directory. */
function locate(base: string, kind: ArtifactKind, name: string): { file: string; dir?: string } {
  switch (kind) {
    case 'skill':
      return { file: path.join(base, 'skills', name, 'SKILL.md'), dir: path.join(base, 'skills', name) };
    case 'memory':
      return { file: path.join(base, 'memory', `${name}.md`) };
    case 'command':
      return { file: path.join(base, 'commands', `${name}.md`) };
    case 'agent':
      return { file: path.join(base, 'agents', `${name}.md`) };
  }
}

export async function runRemove(
  root: string,
  rawKind: string,
  name: string,
  options: RemoveOptions = {},
): Promise<void> {
  const kind = parseKind(rawKind);
  const base = wondevDir(root);
  if (!(await pathExists(base))) {
    throw new WondevError(`No .wondev/ in ${root}.`, 'Run `wondev init` first.');
  }

  // Before anything is resolved, let alone deleted.
  assertInside(base, name, kind);

  const { file, dir } = locate(base, kind, name);

  // A skill may also exist in the flat `skills/<name>.md` form.
  const flat = kind === 'skill' ? path.join(base, 'skills', `${name}.md`) : null;
  const target = (await pathExists(file))
    ? file
    : flat && (await pathExists(flat))
      ? flat
      : null;

  if (target === null) {
    throw new WondevError(
      `No ${kind} named "${name}".`,
      'Run `wondev list` to see what this project defines.',
    );
  }

  const removeDir = dir !== undefined && target === file;
  const rel = path.relative(root, removeDir ? dir : target).replace(/\\/g, '/');

  if (options.dryRun) {
    step(`${style.dim('remove')}  ${rel}`);
    info(style.dim('\nDry run: nothing was deleted.'));
    return;
  }

  // Defence in depth, mirroring removeOwned in writer.ts: this is the only other place in
  // wondev that deletes, so it re-checks regardless of what the caller already validated.
  if (removeDir) {
    assertResolvedInside(path.join(base, 'skills'), dir);
    await fs.rm(dir, { recursive: true, force: true });
  } else {
    assertResolvedInside(base, target);
    await fs.rm(target, { force: true });
  }
  success(`removed ${style.cyan(rel)}`);

  if (options.noBuild) {
    info(style.dim('  Generated output still contains it. Run `wondev build` to sweep it.'));
    return;
  }

  info('');
  await runBuild(root, {});
}

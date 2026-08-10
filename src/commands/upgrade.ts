import path from 'node:path';
import fs from 'node:fs/promises';
import { wondevDir } from '../core/config.js';
import {
  hashProjectFile,
  hashTemplateFile,
  listTemplateFiles,
  loadTemplateManifest,
  saveTemplateManifest,
  templatesDir,
  type TemplateManifest,
} from '../core/templates.js';
import { WondevError } from '../util/errors.js';
import { normalizeEol, pathExists, writeFileAtomic } from '../util/fs.js';
import { info, step, style, success, warn } from '../util/log.js';
import { wondevVersion } from '../util/version.js';

export interface UpgradeOptions {
  dryRun?: boolean;
  /** Restrict to paths starting with this prefix, relative to `.wondev/`. */
  only?: string | undefined;
  /** Re-add starter files the user deliberately deleted. */
  restore?: boolean;
  /** Skip templates that are new in this release. */
  noNew?: boolean;
}

type Outcome =
  | 'updated'      // user never touched it; safe to replace
  | 'conflict'     // user edited it; a .new file was written instead
  | 'added'        // new in this release
  | 'restored'     // user had deleted it and asked for it back
  | 'skipped-deleted'
  | 'unchanged';

interface Decision {
  rel: string;
  outcome: Outcome;
}

/**
 * Bring starter-pack files up to the version shipped with this wondev.
 *
 * The rule that shapes everything here: a file the user edited is never modified. wondev
 * writes `<name>.new` alongside it and lets the human merge.
 *
 * A three-way merge would be the obvious alternative and is the wrong tool. Merging prose
 * produces plausible-looking corruption -- two reasonable sentences interleaved into one
 * that instructs an agent to do something neither author intended -- and conflict markers
 * left in a file an agent reads as instructions are worse still.
 */
export async function runUpgrade(root: string, options: UpgradeOptions = {}): Promise<void> {
  const manifest = await loadTemplateManifest(root);
  if (!manifest) {
    throw new WondevError(
      'This project has no starter-pack provenance to compare against.',
      'It was created before upgrade tracking existed, or .wondev/.templates.json was removed. Starter files must be updated by hand.',
    );
  }

  const templates = templatesDir();
  if (!(await pathExists(templates))) {
    throw new WondevError(`Starter templates are missing from the installation (${templates}).`);
  }

  const running = wondevVersion();
  const shipped = await listTemplateFiles(templates);
  const filtered = options.only
    ? shipped.filter((rel) => rel === options.only || rel.startsWith(`${options.only}/`))
    : shipped;

  if (options.only && filtered.length === 0) {
    throw new WondevError(`No starter template matches "${options.only}".`);
  }

  const next: TemplateManifest = { version: running, files: { ...manifest.files } };
  const decisions: Decision[] = [];

  for (const rel of filtered) {
    const decision = await decide(root, templates, rel, manifest, options);
    decisions.push({ rel, outcome: decision.outcome });

    if (options.dryRun) continue;

    if (decision.write) {
      await writeFileAtomic(decision.write.path, decision.write.content);
    }
    if (decision.record) {
      next.files[rel] = { hash: decision.record, from: running };
    }
  }

  await report(decisions, options);

  if (!options.dryRun) {
    await saveTemplateManifest(root, next);
  }
}

interface Resolution {
  outcome: Outcome;
  /** Absolute path plus content, when something should be written. */
  write?: { path: string; content: string };
  /** New hash to record, when the user's copy now matches the shipped template. */
  record?: string;
}

async function decide(
  root: string,
  templates: string,
  rel: string,
  manifest: TemplateManifest,
  options: UpgradeOptions,
): Promise<Resolution> {
  const shippedHash = await hashTemplateFile(templates, rel);
  const shippedContent = normalizeEol(await fs.readFile(path.join(templates, rel), 'utf8'));
  const target = path.join(wondevDir(root), rel);
  const record = manifest.files[rel];
  const userHash = await hashProjectFile(root, rel);

  // New template in this release.
  if (!record) {
    if (userHash !== null) {
      // The user created a file at the same path. Theirs wins.
      return { outcome: 'conflict', write: { path: `${target}.new`, content: shippedContent } };
    }
    if (options.noNew) return { outcome: 'unchanged' };
    return { outcome: 'added', write: { path: target, content: shippedContent }, record: shippedHash };
  }

  // The user deleted this starter file. That was a decision; respect it unless asked.
  if (userHash === null) {
    if (!options.restore) return { outcome: 'skipped-deleted' };
    return { outcome: 'restored', write: { path: target, content: shippedContent }, record: shippedHash };
  }

  // Upstream has not changed this file, so there is nothing to offer.
  if (record.hash === shippedHash) return { outcome: 'unchanged' };

  // Upstream changed it and the user never touched it: safe to replace outright.
  if (userHash === record.hash) {
    return { outcome: 'updated', write: { path: target, content: shippedContent }, record: shippedHash };
  }

  // Both changed. Write the new version alongside and leave the user's file alone. The
  // recorded hash deliberately stays at the old value so the same offer survives until the
  // user actually merges.
  return { outcome: 'conflict', write: { path: `${target}.new`, content: shippedContent } };
}

async function report(decisions: Decision[], options: UpgradeOptions): Promise<void> {
  const by = (outcome: Outcome): Decision[] => decisions.filter((d) => d.outcome === outcome);

  for (const d of by('updated')) step(`${style.dim('updated ')}  ${d.rel}`);
  for (const d of by('added')) step(`${style.dim('added   ')}  ${d.rel}`);
  for (const d of by('restored')) step(`${style.dim('restored')}  ${d.rel}`);
  for (const d of by('skipped-deleted')) {
    step(`${style.dim('skipped ')}  ${d.rel} ${style.dim('(you deleted it)')}`);
  }

  const conflicts = by('conflict');
  for (const d of conflicts) {
    warn(`${d.rel} — you edited this; new version written to ${d.rel}.new`);
  }

  const changed = by('updated').length + by('added').length + by('restored').length;

  if (changed === 0 && conflicts.length === 0) {
    success('starter pack is already up to date');
    return;
  }

  if (options.dryRun) {
    info('');
    info(style.dim('Dry run: nothing was written.'));
    return;
  }

  success(`${changed} file(s) updated, ${conflicts.length} left for you to merge`);
  if (conflicts.length > 0) {
    info(
      style.dim(
        'Compare each .new file with yours, keep what you want, then delete the .new file.',
      ),
    );
  }
  if (changed > 0) info(style.dim('Run `wondev build` to regenerate output.'));
}

import path from 'node:path';
import fs from 'node:fs/promises';
import { stringify as stringifyYaml } from 'yaml';
import { CONFIG_FILE, WONDEV_DIR, wondevDir } from '../core/config.js';
import { knownTargetNames } from '../core/registry.js';
import { SOURCE_SCHEMA_VERSION } from '../core/schema.js';
import { parseFrontmatter, stringifyFrontmatter } from '../core/frontmatter.js';
import { WondevError } from '../util/errors.js';
import { wondevVersion } from '../util/version.js';
import { listFilesRecursive, normalizeEol, pathExists, writeFileAtomic } from '../util/fs.js';
import { isInsideRoot, toPosix } from '../util/paths.js';
import { info, plural, step, style, success, warn } from '../util/log.js';

/**
 * Read an existing project's agent context back into `.wondev/`.
 *
 * The inverse of `build`, and necessarily a lossier one: the generated formats discard
 * things the source format carries. Where a value cannot be recovered it is left absent
 * rather than invented, because a wrong `description` is worse than a missing one -- it is
 * the trigger an agent matches on.
 *
 * Nothing outside `.wondev/` is read destructively and nothing is deleted. The files it
 * adopted from stay exactly where they are; running `build` afterwards is what makes wondev
 * take ownership of them.
 */

export interface AdoptOptions {
  dryRun?: boolean;
  force?: boolean;
  /** Extra directory of markdown to take in as memory, e.g. an Obsidian vault. */
  vault?: string | undefined;
  /**
   * Frontmatter keys to rename on the way in, as `from=to`.
   *
   * A project that kept its own vocabulary -- `diperiksa` where wondev expects `verified` --
   * would otherwise adopt cleanly and lose the meaning: the key survives in `extra`, but
   * nothing reads it, so no freshness tick ever appears. Renaming is the whole fix, and
   * guessing which key means what is not something adopt should do on its own.
   */
  map?: string[] | undefined;
}

/** `diperiksa=verified` → a rename applied to adopted frontmatter. */
export function parseKeyMap(pairs: readonly string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const pair of pairs) {
    const eq = pair.indexOf('=');
    const from = eq === -1 ? '' : pair.slice(0, eq).trim();
    const to = eq === -1 ? '' : pair.slice(eq + 1).trim();
    if (from === '' || to === '') {
      throw new WondevError(
        `Invalid --map value "${pair}".`,
        'Expected `from=to`, for example `--map diperiksa=verified`.',
      );
    }
    out.set(from, to);
  }
  return out;
}

/** Rename keys, keeping the original order so an adopted file stays recognisable. */
export function applyKeyMap(
  data: Record<string, unknown>,
  renames: Map<string, string>,
): Record<string, unknown> {
  if (renames.size === 0) return data;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    out[renames.get(key) ?? key] = value;
  }
  return out;
}

interface Planned {
  /** Path inside `.wondev/`, forward-slashed. */
  rel: string;
  content: string;
  from: string;
}

/** Filenames that are whole-project context in someone else's format. */
const MEMORY_FILES: Array<{ file: string; slug: string; target: string }> = [
  { file: 'CLAUDE.md', slug: 'claude-md', target: 'claude' },
  { file: 'AGENTS.md', slug: 'agents-md', target: 'agents' },
  { file: 'GEMINI.md', slug: 'gemini-md', target: 'gemini' },
  { file: '.github/copilot-instructions.md', slug: 'copilot-instructions', target: 'copilot' },
  { file: 'CONVENTIONS.md', slug: 'conventions-md', target: 'aider' },
];

const REGION_START = '<!-- wondev:start -->';
const REGION_END = '<!-- wondev:end -->';

/**
 * Take only what wondev did not write.
 *
 * Adopting a file wondev generated would round-trip its own output back into the source and
 * duplicate every document. The markers are the reliable signal, since they are exactly what
 * `build` leaves behind.
 */
function humanPart(content: string): string {
  const start = content.indexOf(REGION_START);
  if (start === -1) return content.trim();
  const end = content.indexOf(REGION_END, start);
  const before = content.slice(0, start);
  const after = end === -1 ? '' : content.slice(end + REGION_END.length);
  return `${before}\n${after}`.replace(/\n{3,}/g, '\n\n').trim();
}

/** A filesystem-safe, wondev-legal slug from a human-titled filename. */
export function slugFromFilename(name: string): string {
  return name
    .replace(/\.mdc?$/i, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'untitled';
}

function firstHeading(body: string): string | undefined {
  return /^#\s+(.+)$/m.exec(body)?.[1]?.trim();
}

async function readIfPresent(root: string, rel: string): Promise<string | null> {
  try {
    return normalizeEol(await fs.readFile(path.join(root, rel), 'utf8'));
  } catch {
    return null;
  }
}

export async function runAdopt(root: string, options: AdoptOptions = {}): Promise<void> {
  const base = wondevDir(root);
  if ((await pathExists(base)) && !options.force) {
    throw new WondevError(
      `${WONDEV_DIR}/ already exists in ${root}.`,
      'Adopt is for projects that have agent config but no wondev source. Use --force to overwrite it.',
    );
  }

  const planned: Planned[] = [];
  const detectedTargets = new Set<string>();
  const skipped: string[] = [];

  // 1. Whole-project context files.
  for (const entry of MEMORY_FILES) {
    const raw = await readIfPresent(root, entry.file);
    if (raw === null) continue;
    detectedTargets.add(entry.target);
    const body = humanPart(raw);
    if (body === '') {
      skipped.push(`${entry.file} (contained only generated content)`);
      continue;
    }
    const title = firstHeading(body) ?? entry.file;
    planned.push({
      rel: `memory/${entry.slug}.md`,
      from: entry.file,
      // always: true is the honest default here. These files were being loaded on every turn
      // in their original form, so anything else would silently change the project's
      // behaviour during a migration.
      content: stringifyFrontmatter({ title, always: true }, body),
    });
  }

  // 2. Claude Code's own layout, which maps one-to-one.
  planned.push(...(await adoptClaudeDir(root, detectedTargets, skipped)));

  // 3. An optional directory of markdown, taken in as on-demand memory.
  const keyMap = parseKeyMap(options.map ?? []);
  if (options.vault) {
    planned.push(...(await adoptVault(root, options.vault, skipped, keyMap)));
  }

  if (planned.length === 0) {
    throw new WondevError(
      'Found no agent context to adopt.',
      'Looked for CLAUDE.md, AGENTS.md, GEMINI.md, .github/copilot-instructions.md, CONVENTIONS.md, and .claude/. Run `wondev init` to start from a template instead.',
    );
  }

  // Two sources can legitimately produce the same slug -- CLAUDE.md and AGENTS.md often say
  // the same thing. Reporting the collision beats silently keeping whichever came last.
  const seen = new Map<string, string>();
  const unique: Planned[] = [];
  for (const p of planned) {
    const previous = seen.get(p.rel);
    if (previous) {
      skipped.push(`${p.from} (would overwrite ${p.rel}, already taken from ${previous})`);
      continue;
    }
    seen.set(p.rel, p.from);
    unique.push(p);
  }

  const targets = detectedTargets.size > 0 ? [...detectedTargets].sort() : ['claude', 'agents'];

  for (const p of unique) step(`${style.dim('adopt ')}  ${WONDEV_DIR}/${p.rel}  ${style.dim(`← ${p.from}`)}`);
  for (const s of skipped) warn(`skipped ${s}`);

  reportDanglingLinks(unique);

  if (options.dryRun) {
    info(style.dim(`\nDry run: nothing was written. Would adopt ${plural(unique.length, 'file')}.`));
    return;
  }

  for (const p of unique) {
    await writeFileAtomic(path.join(base, p.rel), p.content);
  }
  await writeFileAtomic(path.join(base, CONFIG_FILE), renderAdoptedConfig(path.basename(root), targets));

  success(`adopted ${plural(unique.length, 'file')} into ${style.cyan(`${WONDEV_DIR}/`)}`);
  info(style.dim(`  targets: ${targets.join(', ')}`));
  info('');
  info(`Next: review ${style.cyan(`${WONDEV_DIR}/`)}, then run ${style.cyan('wondev build --force')}.`);
  info(
    style.dim(
      '  --force is expected the first time: the files you adopted from still exist, and wondev',
    ),
  );
  info(style.dim('  refuses to overwrite output it did not write until you say so.'));
}

async function adoptClaudeDir(
  root: string,
  targets: Set<string>,
  skipped: string[],
): Promise<Planned[]> {
  const out: Planned[] = [];
  const claudeDir = path.join(root, '.claude');
  if (!(await pathExists(claudeDir))) return out;
  targets.add('claude');

  // Skills, including the attachments 0.2.0 taught wondev to carry.
  const skillsDir = path.join(claudeDir, 'skills');
  if (await pathExists(skillsDir)) {
    for (const rel of await listFilesRecursive(skillsDir)) {
      const posix = toPosix(rel);
      const parts = posix.split('/');
      const name = parts[0];
      if (!name || parts.length < 2) continue;
      const raw = normalizeEol(await fs.readFile(path.join(skillsDir, rel), 'utf8'));
      if (parts[1] === 'SKILL.md' && parts.length === 2) {
        out.push({ rel: `skills/${name}/SKILL.md`, from: `.claude/skills/${posix}`, content: raw });
      } else if (posix.endsWith('.md')) {
        out.push({
          rel: `skills/${name}/${parts.slice(1).join('/')}`,
          from: `.claude/skills/${posix}`,
          content: raw,
        });
      } else {
        skipped.push(`.claude/skills/${posix} (attachments must be .md)`);
      }
    }
  }

  for (const [dir, kind] of [
    ['commands', 'commands'],
    ['agents', 'agents'],
  ] as const) {
    const abs = path.join(claudeDir, dir);
    if (!(await pathExists(abs))) continue;
    for (const rel of await listFilesRecursive(abs)) {
      if (!rel.endsWith('.md')) continue;
      const raw = normalizeEol(await fs.readFile(path.join(abs, rel), 'utf8'));
      out.push({ rel: `${kind}/${toPosix(rel)}`, from: `.claude/${dir}/${toPosix(rel)}`, content: raw });
    }
  }

  return out;
}

/**
 * Take a directory of markdown in as memory.
 *
 * Written for a vault whose filenames are human titles -- `Alur Live Map.md` -- which are
 * legal as slugs but produce awkward generated filenames, so they are normalised here. The
 * original title is preserved in frontmatter, and `[[wikilinks]]` are left untouched:
 * wondev resolves them against slugs *and* basenames, so they keep working.
 */
async function adoptVault(
  root: string,
  vaultRel: string,
  skipped: string[],
  keyMap: Map<string, string>,
): Promise<Planned[]> {
  // Same boundary the writer enforces, applied to a read. Adopt copies what it finds into
  // `.wondev/`, which is committed, so pointing this outside the project turns a mistyped
  // path into content landing in git. A vault that genuinely lives elsewhere can be copied
  // in first, deliberately.
  if (!isInsideRoot(vaultRel)) {
    throw new WondevError(
      `--vault must be a relative path inside the project (got "${vaultRel}").`,
      'Adopt copies what it reads into .wondev/, which you commit.',
    );
  }

  const abs = path.join(root, vaultRel);
  if (!(await pathExists(abs))) {
    throw new WondevError(`No such directory: ${vaultRel}`);
  }

  const files = (await listFilesRecursive(abs)).map(toPosix);

  // Renaming happens first, in full, because the bodies have to be rewritten against the
  // complete map. `[[Runbook Deployment HA]]` stops resolving the moment that note becomes
  // `runbook-deployment-ha`, and wondev treats an unresolved link as an error -- so a vault
  // that was internally consistent would fail to build immediately after being adopted.
  const renames = new Map<string, string>();
  for (const posix of files) {
    if (!posix.endsWith('.md')) continue;
    const base = path.posix.basename(posix, '.md');
    renames.set(base, slugFromFilename(base));
  }

  const out: Planned[] = [];
  for (const posix of files) {
    if (!posix.endsWith('.md')) {
      skipped.push(`${vaultRel}/${posix} (not markdown)`);
      continue;
    }
    const raw = normalizeEol(await fs.readFile(path.join(abs, posix), 'utf8'));
    const { data, body } = parseFrontmatter(raw, `${vaultRel}/${posix}`);
    const base = path.posix.basename(posix, '.md');
    const title =
      (typeof data['title'] === 'string' ? data['title'] : undefined) ?? firstHeading(body) ?? base;

    // Everything already in the file is kept: a vault's own vocabulary survives in `extra`,
    // and adopt has no business deciding which of someone's keys matter.
    const front: Record<string, unknown> = { ...applyKeyMap(data, keyMap), title, always: false };
    out.push({
      rel: `memory/${slugFromFilename(base)}.md`,
      from: `${vaultRel}/${posix}`,
      content: stringifyFrontmatter(front, rewriteWikilinks(body, renames)),
    });
  }
  return out;
}

/**
 * Say up front which `[[links]]` will not resolve.
 *
 * wondev treats an unresolved memory link as an error, so a vault carrying links to things
 * that were never notes -- repository names, external systems -- adopts cleanly and then
 * fails to build. Reporting it here turns a wall of errors after the fact into a decision
 * made before it: create the notes, or drop the brackets.
 */
function reportDanglingLinks(planned: Planned[]): void {
  const memory = planned.filter((p) => p.rel.startsWith('memory/'));
  const slugs = new Set(memory.map((p) => p.rel.slice('memory/'.length).replace(/\.md$/, '')));

  const dangling = new Map<string, number>();
  for (const p of memory) {
    for (const m of p.content.matchAll(/\[\[([^\]|#]+)[^\]]*\]\]/g)) {
      const target = (m[1] ?? '').trim();
      if (target === '' || slugs.has(target)) continue;
      dangling.set(target, (dangling.get(target) ?? 0) + 1);
    }
  }
  if (dangling.size === 0) return;

  const total = [...dangling.values()].reduce((a, b) => a + b, 0);
  warn(
    `${plural(dangling.size, 'link target')} do not match any adopted document ` +
      `(${total} occurrences). \`wondev check\` will report these as errors:`,
  );
  for (const [target, count] of [...dangling.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
    info(style.dim(`    [[${target}]] × ${count}`));
  }
  info(
    style.dim(
      '  Add a memory document with that slug, or remove the brackets if it was never a note.',
    ),
  );
}

/**
 * Point `[[Old Title]]` at the slug that title became.
 *
 * Only the link target is touched, and only when it names a note that was actually renamed.
 * A link to something outside the vault is left exactly as written rather than guessed at --
 * wondev will report it as unresolved, which is the correct outcome for a link that was
 * already dangling before the migration.
 */
export function rewriteWikilinks(body: string, renames: Map<string, string>): string {
  return body.replace(/\[\[([^\]|#]+)([^\]]*)\]\]/g, (whole, target: string, rest: string) => {
    const renamed = renames.get(target.trim());
    return renamed === undefined ? whole : `[[${renamed}${rest}]]`;
  });
}

function renderAdoptedConfig(name: string, targets: string[]): string {
  const header = [
    '# wondev configuration, written by `wondev adopt`.',
    '#',
    '# The targets below are the ones adopt found evidence of in this repository.',
    `# Known targets: ${knownTargetNames().join(', ')}`,
    '#',
    '# Review .wondev/ before the first build. Adopt recovers what the generated formats',
    '# kept, and they do not keep everything -- a skill trigger that was never written down',
    '# cannot be read back out.',
    '',
  ].join('\n');

  const body = stringifyYaml({ name, targets }, { lineWidth: 0 });
  const stamp = stringifyYaml(
    { schema: SOURCE_SCHEMA_VERSION, wondevVersion: wondevVersion() },
    { lineWidth: 0 },
  );
  return `${header}${body}\n# Written by wondev. Used to detect when \`wondev migrate\` is needed.\n${stamp}`;
}

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import { stringify as stringifyYaml } from 'yaml';
import { CONFIG_FILE, WONDEV_DIR, wondevDir } from '../core/config.js';
import { BUILTIN_TARGETS, DEFAULT_TARGETS, knownTargetNames, resolveAlias } from '../core/registry.js';
import { SOURCE_SCHEMA_VERSION } from '../core/schema.js';
import { WondevError } from '../util/errors.js';
import { wondevVersion } from '../util/version.js';
import { copyDir, pathExists, writeFileAtomic } from '../util/fs.js';
import { info, style, success } from '../util/log.js';
import { runBuild } from './build.js';

export interface InitOptions {
  targets?: string[] | undefined;
  all?: boolean;
  force?: boolean;
  skipBuild?: boolean;
}

/**
 * Templates live beside `dist/` in the published tarball and beside `src/` in the repo.
 * Both resolve to `<package root>/templates` from two levels up, so the same code path
 * works when running from source under vitest and from the installed package.
 */
function templatesDir(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'templates');
}

export async function runInit(root: string, options: InitOptions = {}): Promise<void> {
  const base = wondevDir(root);

  if ((await pathExists(base)) && !options.force) {
    throw new WondevError(
      `${WONDEV_DIR}/ already exists in ${root}.`,
      'Delete it or re-run with --force to overwrite the source templates.',
    );
  }

  const targets = chooseTargets(options);
  const templates = templatesDir();
  if (!(await pathExists(templates))) {
    throw new WondevError(`Starter templates are missing from the installation (${templates}).`);
  }

  await copyDir(templates, base);
  await writeFileAtomic(path.join(base, CONFIG_FILE), renderConfig(path.basename(root), targets));

  success(`created ${style.cyan(`${WONDEV_DIR}/`)} with the starter pack`);

  const counts = await countStarterPack(base);
  info(style.dim(`  ${counts.skills} skills, ${counts.memory} memory docs, ${counts.commands} commands`));
  info(style.dim(`  targets: ${targets.join(', ')}`));

  if (!options.skipBuild) {
    info('');
    await runBuild(root, {});
  }

  info('');
  info(`Next: edit ${style.cyan(`${WONDEV_DIR}/memory/architecture.md`)}, then run ${style.cyan('wondev build')}.`);
}

function chooseTargets(options: InitOptions): string[] {
  if (options.all) return knownTargetNames();
  if (!options.targets || options.targets.length === 0) return [...DEFAULT_TARGETS];

  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of options.targets) {
    const name = raw.trim();
    if (name === '') continue;
    const canonical = resolveAlias(name);
    if (!BUILTIN_TARGETS[canonical]) {
      throw new WondevError(
        `Unknown target "${name}".`,
        `Known targets: ${knownTargetNames().join(', ')}.`,
      );
    }
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    out.push(canonical);
  }
  if (out.length === 0) throw new WondevError('No valid targets given.');
  return out;
}

function renderConfig(name: string, targets: string[]): string {
  const header = [
    '# wondev configuration.',
    '#',
    '# Everything in this directory is the single source of truth for AI agent knowledge.',
    '# Run `wondev build` to compile it into each agent\'s native config format.',
    '#',
    `# Known targets: ${knownTargetNames().join(', ')}`,
    '#',
    '# To support an agent that is not listed, add it under customTargets:',
    '#',
    '#   customTargets:',
    '#     my-agent:',
    '#       engine: single-file      # or rule-dir',
    '#       path: .myagent/context.md',
    '',
  ].join('\n');

  const body = stringifyYaml({ name, targets }, { lineWidth: 0 });

  // Stamped at the bottom so the interesting keys stay at the top. These two make the
  // project identifiable later; a project written without them can never be migrated.
  const stamp = stringifyYaml(
    { schema: SOURCE_SCHEMA_VERSION, wondevVersion: wondevVersion() },
    { lineWidth: 0 },
  );

  return `${header}${body}\n# Written by wondev. Used to detect when \`wondev migrate\` is needed.\n${stamp}`;
}

async function countStarterPack(base: string): Promise<{ skills: number; memory: number; commands: number }> {
  const count = async (dir: string, deep = false): Promise<number> => {
    try {
      const entries = await fs.readdir(path.join(base, dir), { withFileTypes: true, recursive: deep });
      return entries.filter((e) => (deep ? e.isFile() && e.name.endsWith('.md') : e.isDirectory() || e.name.endsWith('.md'))).length;
    } catch {
      return 0;
    }
  };
  return {
    skills: await count('skills'),
    memory: await count('memory', true),
    commands: await count('commands'),
  };
}

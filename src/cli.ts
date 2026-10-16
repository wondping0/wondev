#!/usr/bin/env node
import path from 'node:path';
import { realpathSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { BUILTIN_TARGETS, TARGET_ALIASES, targetCapabilities, targetsAddedSince } from './core/registry.js';
import { isWondevError, WondevError } from './util/errors.js';
import { readFileIfExists } from './util/fs.js';
import { error, info, setColor, style, warn } from './util/log.js';

const HELP = `
${style.bold('wondev')} — write your AI agent knowledge once, compile it for every agent.

${style.bold('Usage')}
  wondev <command> [options]

${style.bold('Commands')}
  init                     Scaffold .wondev/ with the starter pack, then build
  adopt                    Read existing agent config back into .wondev/
  vault [dir]              Move sources into an active Obsidian vault (default: knowledge)
  build                    Compile configured sources into every enabled target
  watch                    Rebuild when configured sources or config change
  add <type> <name>        Add a skill, memory, command, or agent
  remove <type> <name>     Delete one, and sweep the output it produced
                           (type: skill|memory|command|agent)
  list                     Show what this project defines, and what each piece costs
  check                    Validate sources and detect drift  (exit 1 on failure)
  clean                    Remove generated files listed in the manifest
  migrate                  Bring an older .wondev/ up to the current source schema
  upgrade                  Update starter-pack files, preserving your edits
  doctor                   Diagnose this project and report problems
  targets                  List known targets and what reads them
  context                  Select memory and skills for a task within a token budget
  context eval <cases>     Test memory + skill retrieval under real token budgets
  map                      Refresh observed JS/TS application structure in memory
  memory verify <note>     Record evidence after checking a note against the code
  memory stale             Report changed, missing, or unverified evidence
  skills validate          Validate portable skill metadata
  skills eval <cases.json> Test positive and negative skill trigger cases
  skills install <source> Install a versioned local: or npm: skill pack
  skills update <name>    Preview or apply upstream changes while preserving edits
  skills sync              Restore pack files from locked versions and checksums
  session <action>         Record work; propose, review, apply, or reject memory updates
  session learn <id> <name> Propose a reusable lesson from a recorded session

${style.bold('Options')}
  --cwd <dir>              Run against a different project directory
  --targets <a,b,c>        init: which targets to enable
  --all                    init: enable every known target
  --force                  init, adopt: overwrite .wondev/ · build: overwrite conflicting files
  --target <name>          build: build only one target
  --dry-run                build, migrate, upgrade, adopt, remove, vault, skills, map: preview
  --no-build               remove, skills, map, session apply: skip generated output rebuild
  --only <path>            upgrade: limit to one starter file or directory
  --restore                upgrade: re-add starter files you deleted
  --no-new                 upgrade: skip templates that are new in this release
  --new                    targets: only those added since you initialised
  --verbose                targets: show compiler capabilities and path verification dates
  --vault <dir>            init: create active vault; adopt: import existing markdown
  --map <from=to>          adopt: rename a frontmatter key (repeatable)
  --online                 doctor: also ask npm whether a newer wondev exists
  --no-color               Disable coloured output
  --task <text>            context: task to select guidance for
  --files <a,b>            context/check: changed paths; session learn: evidence paths/globs
  --budget <tokens>        context: ceiling for the complete output (default: 4000)
  --explain                context: include selection reasons
  --json                   context, memory stale: emit machine-readable output
  --against <evidence>     memory verify: describe the check actually performed
  --profile <name>         build, watch, check, context, list, skills: select a skill profile
  --input <file>           session record/propose: JSON summary or revised memory Markdown
  --review-hash <hash>     session apply: hash printed by session review
  --source <source>        skills update: select a new local: or npm: source/version
  --exclude <glob>         map: exclude repository paths (repeatable)
  --freshness <policy>     check: fail on stale notes, or strict (also unverified)
  -h, --help               Show this help
  -v, --version            Show version

${style.bold('Examples')}
  npx wondev init --targets claude,cursor,agents
  wondev build --dry-run
  wondev add skill reviewing-migrations
  wondev check
`.trim();

/**
 * Commands are imported on demand.
 *
 * Loading every command eagerly pulled in the YAML parser and the whole core for `--help`,
 * `--version`, and `targets`, none of which touch a project. Each command now pays only for
 * what it uses, which measurably shortens the most common no-op invocations.
 */
async function readVersion(): Promise<string> {
  const pkgPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
  const raw = await readFileIfExists(pkgPath);
  if (!raw) return '0.0.0';
  try {
    return (JSON.parse(raw) as { version?: string }).version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

async function listTargets(root: string, onlyNew: boolean, verbose = false): Promise<void> {
  let since: string | undefined;
  if (onlyNew) {
    // Needs the stamp written at init; without it there is no baseline to compare against.
    const { loadConfig } = await import('./core/config.js');
    const config = await loadConfig(root);
    since = config.wondevVersion;
    if (!since) {
      throw new WondevError(
        'This project does not record which wondev version initialised it.',
        'Run `wondev migrate` to stamp the current version, then compare against later releases.',
      );
    }
  }

  const names = since ? targetsAddedSince(since) : Object.keys(BUILTIN_TARGETS).sort();

  if (names.length === 0) {
    info(`No targets have been added since wondev ${since}.`);
    return;
  }

  info(style.bold(since ? `Targets added since wondev ${since}` : 'Built-in targets'));
  const width = Math.max(...names.map((n) => n.length));
  for (const name of names) {
    const entry = BUILTIN_TARGETS[name];
    if (!entry) continue;
    const output =
      entry.target.engine === 'claude'
        ? entry.target.memory
        : entry.target.path;
    const flag = entry.deprecated ? ` ${style.yellow('(deprecated)')}` : '';
    info(`  ${style.cyan(name.padEnd(width))}  ${style.dim(output)}${flag}`);
    if (entry.readBy.length > 1) {
      info(`  ${' '.repeat(width)}  ${style.dim(`read by ${entry.readBy.join(', ')}`)}`);
    }
    if (verbose) {
      const capabilities = targetCapabilities(entry.target);
      info(style.dim(`  skills: ${capabilities.skills}; resources: ${capabilities.resources}; scoping: ${capabilities.scoping}; agents: ${capabilities.agents}`));
      const when = entry.pathVerified
        ? `path verified ${entry.pathVerified}`
        : 'path never verified against vendor docs';
      info(`  ${' '.repeat(width)}  ${style.dim(`added ${entry.addedIn} · ${when}`)}`);
    }
  }

  if (verbose && !since) {
    const unverified = names.filter((n) => !BUILTIN_TARGETS[n]?.pathVerified).length;
    if (unverified > 0) {
      info('');
      warn(
        `${unverified} of ${names.length} target paths have never been re-checked against the ` +
          'vendor documentation.',
      );
      info(
        style.dim(
          [
            '  An agent that moves its config location is the one failure with no symptom:',
            '  wondev keeps writing the old path and every command still reports success.',
            '  See CONTRIBUTING.md for how these are reviewed.',
          ].join('\n'),
        ),
      );
    }
  }

  if (since) return;

  const aliases = Object.entries(TARGET_ALIASES).sort(([a], [b]) => a.localeCompare(b));
  if (aliases.length > 0) {
    info('');
    info(style.bold('Aliases'));
    info(`  ${style.dim(aliases.map(([from, to]) => `${from} → ${to}`).join(', '))}`);
  }
  info('');
  info(style.dim('Anything else: add it under `customTargets` in .wondev/wondev.yaml.'));
}

/**
 * Parse arguments and dispatch. Exported so it can be tested in-process.
 *
 * Returns an exit code rather than calling `process.exit`, so a caller — including a test —
 * observes the outcome instead of losing the process.
 */
export async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
      cwd: { type: 'string' },
      targets: { type: 'string' },
      target: { type: 'string' },
      all: { type: 'boolean' },
      force: { type: 'boolean' },
      'dry-run': { type: 'boolean' },
      'no-color': { type: 'boolean' },
      'skip-build': { type: 'boolean' },
      only: { type: 'string' },
      restore: { type: 'boolean' },
      'no-new': { type: 'boolean' },
      new: { type: 'boolean' },
      online: { type: 'boolean' },
      vault: { type: 'string' },
      map: { type: 'string', multiple: true },
      verbose: { type: 'boolean' },
      'no-build': { type: 'boolean' },
      task: { type: 'string' },
      files: { type: 'string' },
      budget: { type: 'string' },
      explain: { type: 'boolean' },
      json: { type: 'boolean' },
      against: { type: 'string' },
      profile: { type: 'string' },
      input: { type: 'string' },
      'review-hash': { type: 'string' },
      source: { type: 'string' },
      exclude: { type: 'string', multiple: true },
      freshness: { type: 'string' },
    },
  });

  if (values['no-color']) setColor(false);

  if (values.version) {
    info(await readVersion());
    return 0;
  }

  const command = positionals[0];
  if (!command || values.help) {
    info(HELP);
    return command ? 0 : (values.help ? 0 : 1);
  }

  const root = path.resolve(values.cwd ?? process.cwd());

  switch (command) {
    case 'session': {
      const { runSession } = await import('./commands/session.js');
      await runSession(root, positionals.slice(1), { input: values.input, reviewHash: values['review-hash'], noBuild: values['no-build'] === true, files: values.files?.split(',').map((f) => f.trim()).filter(Boolean) });
      return 0;
    }
    case 'map': {
      const { runMap } = await import('./commands/map.js');
      await runMap(root, { dryRun: values['dry-run'] === true, noBuild: values['no-build'] === true, exclude: values.exclude });
      return 0;
    }
    case 'context': {
      if (positionals[1]) {
        if (positionals[1] !== 'eval' || !positionals[2]) throw new WondevError('Usage: wondev context eval <cases.json>');
        const { runContextEval } = await import('./commands/context-eval.js');
        await runContextEval(root, positionals[2], values.profile);
        return 0;
      }
      const { runContext } = await import('./commands/select-context.js');
      await runContext(root, {
        profile: values.profile,
        ...(values.task ? { task: values.task } : {}),
        ...(values.files ? { files: values.files.split(',').map((f) => f.trim()).filter(Boolean) } : {}),
        ...(values.budget ? { budget: Number(values.budget) } : {}),
        explain: values.explain === true, format: values.json ? 'json' : 'markdown',
      });
      return 0;
    }
    case 'skills': {
      if (['install', 'update', 'sync'].includes(positionals[1] ?? '')) {
        const { runPacks } = await import('./commands/packs.js');
        await runPacks(root, positionals[1]!, positionals[2], { dryRun: values['dry-run'] === true, source: values.source, noBuild: values['no-build'] === true });
        return 0;
      }
      const { runSkillValidate, runSkillEval } = await import('./commands/skills.js');
      if (positionals[1] === 'validate') await runSkillValidate(root, values.profile);
      else if (positionals[1] === 'eval' && positionals[2]) await runSkillEval(root, positionals[2], values.profile);
      else throw new WondevError('Usage: wondev skills validate | skills eval <cases.json>');
      return 0;
    }
    case 'memory': {
      const { runMemoryVerify, runMemoryStale } = await import('./commands/memory.js');
      if (positionals[1] === 'stale') await runMemoryStale(root, values.json === true);
      else if (positionals[1] === 'verify' && positionals[2]) await runMemoryVerify(root, positionals[2], values.against ?? '');
      else throw new WondevError('Usage: wondev memory stale [--json] | memory verify <note> --against <check>');
      return 0;
    }
    case 'init': {
      const { runInit } = await import('./commands/init.js');
      await runInit(root, {
        targets: values.targets ? values.targets.split(',') : undefined,
        all: values.all === true,
        force: values.force === true,
        skipBuild: values['skip-build'] === true,
        vault: values.vault,
      });
      return 0;
    }

    case 'vault': {
      const { runVault } = await import('./commands/vault.js');
      await runVault(root, positionals[1], values['dry-run'] === true);
      return 0;
    }

    case 'build': {
      const { runBuild } = await import('./commands/build.js');
      await runBuild(root, {
        force: values.force === true,
        dryRun: values['dry-run'] === true,
        target: values.target,
        profile: values.profile,
      });
      return 0;
    }

    case 'watch': {
      const { runWatch } = await import('./commands/watch.js');
      await runWatch(root, { force: values.force === true, target: values.target, profile: values.profile });
      return 0;
    }

    case 'add': {
      const kind = positionals[1];
      const name = positionals[2];
      if (!kind || !name) {
        throw new WondevError(
          'Usage: wondev add <skill|memory|command|agent> <name>',
        );
      }
      const { runAdd, parseKind } = await import('./commands/add.js');
      await runAdd(root, parseKind(kind), name);
      return 0;
    }

    case 'check': {
      const { runCheck } = await import('./commands/check.js');
      if (values.freshness !== undefined && !['stale', 'strict'].includes(values.freshness)) throw new WondevError('--freshness must be stale or strict.');
      await runCheck(root, values.profile, { freshness: values.freshness as 'stale' | 'strict' | undefined, files: values.files?.split(',').map((f) => f.trim()).filter(Boolean) });
      return 0;
    }

    case 'clean': {
      const { runClean } = await import('./commands/clean.js');
      await runClean(root);
      return 0;
    }

    case 'migrate': {
      const { runMigrate } = await import('./commands/migrate.js');
      await runMigrate(root, { dryRun: values['dry-run'] === true });
      return 0;
    }

    case 'upgrade': {
      const { runUpgrade } = await import('./commands/upgrade.js');
      await runUpgrade(root, {
        dryRun: values['dry-run'] === true,
        only: values.only,
        restore: values.restore === true,
        noNew: values['no-new'] === true,
      });
      return 0;
    }

    case 'adopt': {
      const { runAdopt } = await import('./commands/adopt.js');
      await runAdopt(root, {
        dryRun: values['dry-run'] === true,
        force: values.force === true,
        vault: typeof values.vault === 'string' ? values.vault : undefined,
        map: values.map,
      });
      return 0;
    }

    case 'doctor': {
      const { runDoctor } = await import('./commands/doctor.js');
      await runDoctor(root, { online: values.online === true });
      return 0;
    }

    case 'remove':
    case 'rm': {
      const kind = positionals[1];
      const name = positionals[2];
      if (!kind || !name) {
        throw new WondevError('Usage: wondev remove <skill|memory|command|agent> <name>');
      }
      const { runRemove } = await import('./commands/remove.js');
      await runRemove(root, kind, name, {
        dryRun: values['dry-run'] === true,
        noBuild: values['no-build'] === true,
      });
      return 0;
    }

    case 'list': {
      const { runList } = await import('./commands/list.js');
      await runList(root, values.profile);
      return 0;
    }

    case 'targets':
      await listTargets(root, values.new === true, values.verbose === true);
      return 0;

    case 'help':
      info(HELP);
      return 0;

    default:
      throw new WondevError(
        `Unknown command "${command}".`,
        'Run `wondev --help` to see available commands.',
      );
  }
}

/**
 * Report a failure the way the CLI should, and return the exit code.
 *
 * Separate from the auto-run below so a test can assert on how each kind of error is
 * presented: a WondevError shows its hint, an unknown option points at `--help`, and
 * anything else shows a stack because it is a bug rather than a user mistake.
 */
export function reportFailure(err: unknown): number {
  if (isWondevError(err)) {
    error(err.message);
    if (err.hint) info(style.dim(err.hint));
  } else if (err instanceof Error && err.name === 'ERR_PARSE_ARGS_UNKNOWN_OPTION') {
    error(err.message);
    info(style.dim('Run `wondev --help` to see available options.'));
  } else {
    error((err as Error)?.stack ?? String(err));
  }
  return 1;
}

// Only when this file is what node was asked to run. Without the guard, importing the module
// -- which is the only way to test any of the above -- would execute the CLI against the
// test runner's own argv.
const invokedDirectly = (() => {
  if (process.argv[1] === undefined) return false;
  try {
    // npm's Unix bin links and macOS temporary directories can contain symlinks. Node
    // resolves import.meta.url, but argv keeps the requested spelling of the entry path.
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    // An importer can provide a synthetic argv (for example node reading from stdin).
    return false;
  }
})();

if (invokedDirectly) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err: unknown) => {
      process.exitCode = reportFailure(err);
    });
}

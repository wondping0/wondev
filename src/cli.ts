#!/usr/bin/env node
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { runAdd, parseKind } from './commands/add.js';
import { runBuild } from './commands/build.js';
import { runCheck } from './commands/check.js';
import { runClean } from './commands/clean.js';
import { runInit } from './commands/init.js';
import { runWatch } from './commands/watch.js';
import { BUILTIN_TARGETS, TARGET_ALIASES } from './core/registry.js';
import { isWondevError, WondevError } from './util/errors.js';
import { readFileIfExists } from './util/fs.js';
import { error, info, setColor, style } from './util/log.js';

const HELP = `
${style.bold('wondev')} — write your AI agent knowledge once, compile it for every agent.

${style.bold('Usage')}
  wondev <command> [options]

${style.bold('Commands')}
  init                     Scaffold .wondev/ with the starter pack, then build
  build                    Compile .wondev/ into every enabled target
  watch                    Rebuild whenever .wondev/ changes
  add <type> <name>        Add a skill, memory, or command  (type: skill|memory|command)
  check                    Validate sources and detect drift  (exit 1 on failure)
  clean                    Remove generated files listed in the manifest
  targets                  List known targets and what reads them

${style.bold('Options')}
  --cwd <dir>              Run against a different project directory
  --targets <a,b,c>        init: which targets to enable
  --all                    init: enable every known target
  --force                  init: overwrite .wondev/ · build: overwrite conflicting files
  --target <name>          build: build only one target
  --dry-run                build: show what would change, write nothing
  --no-color               Disable coloured output
  -h, --help               Show this help
  -v, --version            Show version

${style.bold('Examples')}
  npx wondev init --targets claude,cursor,agents
  wondev build --dry-run
  wondev add skill reviewing-migrations
  wondev check
`.trim();

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

function listTargets(): void {
  info(style.bold('Built-in targets'));
  const names = Object.keys(BUILTIN_TARGETS).sort();
  const width = Math.max(...names.map((n) => n.length));
  for (const name of names) {
    const entry = BUILTIN_TARGETS[name];
    if (!entry) continue;
    const output =
      entry.target.engine === 'claude'
        ? entry.target.memory
        : entry.target.path;
    info(`  ${style.cyan(name.padEnd(width))}  ${style.dim(output)}`);
    if (entry.readBy.length > 1) {
      info(`  ${' '.repeat(width)}  ${style.dim(`read by ${entry.readBy.join(', ')}`)}`);
    }
  }

  const aliases = Object.entries(TARGET_ALIASES).sort(([a], [b]) => a.localeCompare(b));
  if (aliases.length > 0) {
    info('');
    info(style.bold('Aliases'));
    info(`  ${style.dim(aliases.map(([from, to]) => `${from} → ${to}`).join(', '))}`);
  }
  info('');
  info(style.dim('Anything else: add it under `customTargets` in .wondev/wondev.yaml.'));
}

async function main(argv: string[]): Promise<number> {
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
    case 'init':
      await runInit(root, {
        targets: values.targets ? values.targets.split(',') : undefined,
        all: values.all === true,
        force: values.force === true,
        skipBuild: values['skip-build'] === true,
      });
      return 0;

    case 'build':
      await runBuild(root, {
        force: values.force === true,
        dryRun: values['dry-run'] === true,
        target: values.target,
      });
      return 0;

    case 'watch':
      await runWatch(root, { force: values.force === true, target: values.target });
      return 0;

    case 'add': {
      const kind = positionals[1];
      const name = positionals[2];
      if (!kind || !name) {
        throw new WondevError(
          'Usage: wondev add <skill|memory|command> <name>',
        );
      }
      await runAdd(root, parseKind(kind), name);
      return 0;
    }

    case 'check':
      await runCheck(root);
      return 0;

    case 'clean':
      await runClean(root);
      return 0;

    case 'targets':
      listTargets();
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

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    if (isWondevError(err)) {
      error(err.message);
      if (err.hint) info(style.dim(err.hint));
    } else if (err instanceof Error && err.name === 'ERR_PARSE_ARGS_UNKNOWN_OPTION') {
      error(err.message);
      info(style.dim('Run `wondev --help` to see available options.'));
    } else {
      error((err as Error)?.stack ?? String(err));
    }
    process.exitCode = 1;
  });

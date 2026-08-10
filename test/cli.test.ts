import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runAdd } from '../src/commands/add.js';
import { runBuild } from '../src/commands/build.js';
import { runCheck } from '../src/commands/check.js';
import { runInit } from '../src/commands/init.js';
import { catchWondevError, cleanup, exists, read, silence, tmpRoot } from './helpers.js';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cliPath = path.join(repoRoot, 'dist', 'cli.js');

let root: string;
beforeEach(async () => {
  root = await tmpRoot();
});
afterEach(async () => {
  await cleanup(root);
});

describe('init', () => {
  it('scaffolds the starter pack and builds it', async () => {
    await silence(() => runInit(root, {}));

    expect(await exists(root, '.wondev/wondev.yaml')).toBe(true);
    expect(await exists(root, '.wondev/skills/debugging/SKILL.md')).toBe(true);
    expect(await exists(root, '.wondev/memory/architecture.md')).toBe(true);
    expect(await exists(root, 'CLAUDE.md')).toBe(true);
    expect(await exists(root, 'AGENTS.md')).toBe(true);
  });

  it('produces a starter pack that passes its own check', async () => {
    await silence(() => runInit(root, {}));
    await expect(silence(() => runCheck(root))).resolves.toBeUndefined();
  });

  it('refuses to overwrite an existing .wondev without --force', async () => {
    await silence(() => runInit(root, { skipBuild: true }));
    await expect(runInit(root, { skipBuild: true })).rejects.toThrow(/already exists/);
  });

  it('honours an explicit target list', async () => {
    await silence(() => runInit(root, { targets: ['cursor'] }));
    expect(await exists(root, '.cursor/rules')).toBe(true);
    expect(await exists(root, 'CLAUDE.md')).toBe(false);
  });

  it('accepts an alias as a target name', async () => {
    await silence(() => runInit(root, { targets: ['codex'] }));
    expect(await exists(root, 'AGENTS.md')).toBe(true);
  });

  it('rejects an unknown target instead of silently skipping it', async () => {
    await expect(runInit(root, { targets: ['nosuchagent'] })).rejects.toThrow(/Unknown target/);
  });

  it('can enable every known target at once', async () => {
    await silence(() => runInit(root, { all: true }));
    expect(await exists(root, 'GEMINI.md')).toBe(true);
    expect(await exists(root, '.clinerules')).toBe(true);
    expect(await exists(root, '.kiro/steering')).toBe(true);
  });
});

describe('add', () => {
  it('creates a skill that builds and checks cleanly', async () => {
    await silence(() => runInit(root, { targets: ['claude'] }));
    await silence(() => runAdd(root, 'skill', 'my-new-skill'));
    expect(await exists(root, '.wondev/skills/my-new-skill/SKILL.md')).toBe(true);

    await silence(() => runBuild(root, { quiet: true }));
    expect(await exists(root, '.claude/skills/my-new-skill/SKILL.md')).toBe(true);
    await expect(silence(() => runCheck(root))).resolves.toBeUndefined();
  });

  it('creates memory and command artifacts', async () => {
    await silence(() => runInit(root, { targets: ['claude'], skipBuild: true }));
    await silence(() => runAdd(root, 'memory', 'deployment'));
    await silence(() => runAdd(root, 'command', 'ship'));
    expect(await exists(root, '.wondev/memory/deployment.md')).toBe(true);
    expect(await exists(root, '.wondev/commands/ship.md')).toBe(true);
  });

  it('rejects a name that is not kebab-case', async () => {
    await silence(() => runInit(root, { targets: ['claude'], skipBuild: true }));
    const err = await catchWondevError(() => runAdd(root, 'skill', 'Bad Name'));
    expect(err.message).toMatch(/not a valid name/);
    expect(err.hint).toMatch(/kebab-case/);
  });

  it('refuses to overwrite an existing artifact', async () => {
    await silence(() => runInit(root, { targets: ['claude'], skipBuild: true }));
    await expect(runAdd(root, 'skill', 'debugging')).rejects.toThrow(/already exists/);
  });

  it('requires an initialised project', async () => {
    const err = await catchWondevError(() => runAdd(root, 'skill', 'x'));
    expect(err.hint).toMatch(/wondev init/);
  });
});

describe('full lifecycle', () => {
  it('survives init, edit, rebuild, and check', async () => {
    await silence(() => runInit(root, { targets: ['claude', 'agents', 'cursor'] }));
    await silence(() => runAdd(root, 'memory', 'deployment'));
    await silence(() => runBuild(root, { quiet: true }));
    await expect(silence(() => runCheck(root))).resolves.toBeUndefined();

    const claudeMd = await read(root, 'CLAUDE.md');
    expect(claudeMd).toContain('Architecture');
    expect(claudeMd).toContain('**debugging**');
  });
});

/**
 * One test drives the real published entry point rather than the exported functions, so a
 * broken shebang, bad arg parsing, or a missing `templates/` in the package would be caught.
 */
describe('the actual bin', () => {
  const run = (args: string[], cwd = root) =>
    execFileAsync(process.execPath, [cliPath, ...args, '--no-color'], { cwd });

  it('reports its version', async () => {
    const { stdout } = await run(['--version']);
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('prints help', async () => {
    const { stdout } = await run(['--help']);
    expect(stdout).toContain('wondev <command>');
  });

  it('lists targets', async () => {
    const { stdout } = await run(['targets']);
    expect(stdout).toContain('claude');
    expect(stdout).toContain('AGENTS.md');
  });

  it('runs init and check from the command line', async () => {
    await run(['init', '--targets', 'claude,agents']);
    expect(await exists(root, 'CLAUDE.md')).toBe(true);
    const { stdout } = await run(['check']);
    expect(stdout).toContain('up to date');
  });

  it('exits non-zero on an unknown command', async () => {
    await expect(run(['frobnicate'])).rejects.toMatchObject({ code: 1 });
  });

  it('exits non-zero when check finds drift', async () => {
    await run(['init', '--targets', 'claude']);
    const fs = await import('node:fs/promises');
    await fs.rm(path.join(root, 'CLAUDE.md'));
    await expect(run(['check'])).rejects.toMatchObject({ code: 1 });
  });
});

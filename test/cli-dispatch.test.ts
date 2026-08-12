import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { main, reportFailure } from '../src/cli.js';
import { WondevError } from '../src/util/errors.js';
import { cleanup, exists, silence, tmpRoot, write } from './helpers.js';

/**
 * Argument parsing and dispatch, in-process.
 *
 * `cli.ts` was at zero coverage: it ran `main()` on import, so no test could load it, and
 * the only thing exercising it was a child process the coverage tool cannot see. It is the
 * layer every user touches first, and a wiring mistake here reaches everyone.
 */

let root: string;
beforeEach(async () => {
  root = await tmpRoot();
});
afterEach(async () => {
  await cleanup(root);
});

/** Run the CLI and capture what it printed alongside its exit code. */
async function run(...argv: string[]): Promise<{ code: number; out: string }> {
  const chunks: string[] = [];
  const outWrite = process.stdout.write.bind(process.stdout);
  const errWrite = process.stderr.write.bind(process.stderr);
  const capture = ((chunk: string | Uint8Array) => {
    chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString());
    return true;
  }) as typeof process.stdout.write;
  process.stdout.write = capture;
  process.stderr.write = capture;
  try {
    const code = await main(argv);
    return { code, out: chunks.join('').replace(/\[[0-9;]*m/g, '') };
  } finally {
    process.stdout.write = outWrite;
    process.stderr.write = errWrite;
  }
}

describe('argument handling', () => {
  it('prints help and succeeds when asked', async () => {
    const { code, out } = await run('--help');
    expect(code).toBe(0);
    expect(out).toContain('wondev <command>');
    expect(out).toContain('adopt');
    expect(out).toContain('remove');
  });

  it('exits 1 when given nothing, since that is a usage error', async () => {
    const { code, out } = await run();
    expect(code).toBe(1);
    expect(out).toContain('Commands');
  });

  it('prints the version', async () => {
    const { code, out } = await run('--version');
    expect(code).toBe(0);
    expect(out.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('names an unknown command and points at help', async () => {
    await expect(run('frobnicate')).rejects.toThrow(/Unknown command "frobnicate"/);
  });

  it('requires both arguments for add', async () => {
    await expect(run('add', 'skill', '--cwd', root)).rejects.toThrow(/Usage: wondev add/);
  });

  it('requires both arguments for remove', async () => {
    await expect(run('remove', 'skill', '--cwd', root)).rejects.toThrow(/Usage: wondev remove/);
  });
});

describe('dispatch reaches the right command', () => {
  it('runs init, then list, then check against --cwd', async () => {
    expect((await run('init', '--targets', 'claude', '--cwd', root)).code).toBe(0);
    expect(await exists(root, '.wondev/wondev.yaml')).toBe(true);

    const list = await run('list', '--cwd', root);
    expect(list.code).toBe(0);
    expect(list.out).toContain('Skills');

    expect((await run('check', '--cwd', root)).code).toBe(0);
  });

  it('runs add and remove end to end', async () => {
    await run('init', '--targets', 'claude', '--cwd', root);
    await run('add', 'memory', 'runbook', '--cwd', root);
    expect(await exists(root, '.wondev/memory/runbook.md')).toBe(true);

    await run('remove', 'memory', 'runbook', '--cwd', root);
    expect(await exists(root, '.wondev/memory/runbook.md')).toBe(false);
  });

  it('runs adopt against a project with existing config', async () => {
    await write(root, 'CLAUDE.md', '# Mine\n\nx\n');
    const { code } = await run('adopt', '--cwd', root);
    expect(code).toBe(0);
    expect(await exists(root, '.wondev/memory/claude-md.md')).toBe(true);
  });

  it('runs targets, including the verbose form', async () => {
    expect((await run('targets')).out).toContain('Built-in targets');
    expect((await run('targets', '--verbose')).out).toMatch(/path verified|never verified/);
  });

  it('runs doctor, migrate, clean, and build --dry-run', async () => {
    await run('init', '--targets', 'claude', '--cwd', root);
    expect((await run('doctor', '--cwd', root)).code).toBe(0);
    expect((await run('migrate', '--cwd', root)).code).toBe(0);
    expect((await run('build', '--dry-run', '--cwd', root)).code).toBe(0);
    expect((await run('upgrade', '--dry-run', '--cwd', root)).code).toBe(0);
    expect((await run('clean', '--cwd', root)).code).toBe(0);
  });
});

describe('how failures are reported', () => {
  /** These print by design; silenced so the suite's own output stays readable. */
  const report = (err: unknown): Promise<number> => silence(async () => reportFailure(err));

  it('shows a WondevError with its hint', async () => {
    expect(await report(new WondevError('broke', 'try this'))).toBe(1);
    expect(await report(new WondevError('broke'))).toBe(1);
  });

  it('points an unknown option at --help', async () => {
    const err = new Error('Unknown option --nope');
    err.name = 'ERR_PARSE_ARGS_UNKNOWN_OPTION';
    expect(await report(err)).toBe(1);
  });

  it('shows a stack for anything unexpected, because that is a bug not a mistake', async () => {
    expect(await report(new Error('kaboom'))).toBe(1);
    expect(await report('a bare string')).toBe(1);
  });
});

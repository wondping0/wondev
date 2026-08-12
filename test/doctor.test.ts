import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runDoctor } from '../src/commands/doctor.js';
import { runBuild } from '../src/commands/build.js';
import { cleanup, seedProject, silence, tmpRoot, write } from './helpers.js';

/**
 * `doctor` is the command a user runs when something is wrong, so what it reports has to be
 * true. It also sets `process.exitCode`, which is easy to get wrong in a way no other test
 * would notice: a diagnostic that always exits 0 is useless in a script.
 */

let root: string;
// `process.exitCode` is typed loosely enough to be a string or null; capture it as-is so
// the restore in afterEach cannot itself change the value it is meant to preserve.
let originalExitCode: typeof process.exitCode;

beforeEach(async () => {
  root = await tmpRoot();
  originalExitCode = process.exitCode;
});
afterEach(async () => {
  process.exitCode = originalExitCode;
  await cleanup(root);
});

async function doctorOutput(options = {}): Promise<string> {
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
    await runDoctor(root, options);
  } finally {
    process.stdout.write = outWrite;
    process.stderr.write = errWrite;
  }
  return chunks.join('').replace(/\[[0-9;]*m/g, '');
}

describe('wondev doctor', () => {
  it('reports a healthy project and leaves the exit code alone', async () => {
    await seedProject(root, ['claude']);
    await silence(() => runBuild(root, { quiet: true }));
    process.exitCode = undefined;

    const out = await doctorOutput();
    expect(out).toMatch(/no problems/);
    expect(out).toContain('source schema');
    expect(out).toContain('generated file(s) tracked');
    expect(process.exitCode).toBeUndefined();
  });

  it('exits non-zero when it finds a real problem, so a script can act on it', async () => {
    // No .wondev/ at all: the most basic failure doctor exists to name.
    process.exitCode = undefined;
    const out = await doctorOutput();
    expect(out).toMatch(/problem\(s\)/);
    expect(process.exitCode).toBe(1);
  });

  it('names the source problems rather than only counting them', async () => {
    await seedProject(root, ['claude']);
    // A skill with no description cannot be triggered, so loading reports it as an error.
    await write(root, '.wondev/skills/broken/SKILL.md', '---\nname: broken\n---\n\nbody\n');
    process.exitCode = undefined;

    const out = await doctorOutput();
    expect(out).toContain('description');
    expect(process.exitCode).toBe(1);
  });

  it('notices when nothing has been built yet', async () => {
    await seedProject(root, ['claude']);
    const out = await doctorOutput();
    expect(out).toMatch(/build|generated/i);
  });

  it('makes no network request unless --online is passed', async () => {
    await seedProject(root, ['claude']);
    await silence(() => runBuild(root, { quiet: true }));

    const original = globalThis.fetch;
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      throw new Error('doctor must not reach the network without --online');
    }) as typeof fetch;
    try {
      await doctorOutput();
      expect(called).toBe(false);
    } finally {
      globalThis.fetch = original;
    }
  });

  it('survives the update check failing, since being offline is not a project problem', async () => {
    await seedProject(root, ['claude']);
    await silence(() => runBuild(root, { quiet: true }));
    process.exitCode = undefined;

    const original = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error('network down');
    }) as typeof fetch;
    try {
      const out = await doctorOutput({ online: true });
      // A failed version check must not be reported as a broken project.
      expect(process.exitCode).not.toBe(1);
      expect(out.length).toBeGreaterThan(0);
    } finally {
      globalThis.fetch = original;
    }
  });
});

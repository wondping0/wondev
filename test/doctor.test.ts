import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  deprecationFinding,
  nodeFinding,
  runDoctor,
  schemaFinding,
} from '../src/commands/doctor.js';
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

describe('the findings doctor cannot reach through a running process', () => {
  it('judges a Node version too old for wondev', () => {
    // Unreachable from runDoctor: the process executing this test is, by definition, on a
    // supported Node. Extracted for the same reason assertSchemaCurrent was.
    expect(nodeFinding('18.20.0')).toEqual({
      level: 'error',
      message: 'Node 18.20.0 is too old; wondev needs 20 or newer.',
    });
    expect(nodeFinding('not-a-version').level).toBe('error');
  });

  it('accepts a supported Node version', () => {
    expect(nodeFinding('22.12.0')).toEqual({ level: 'ok', message: 'Node 22.12.0' });
  });

  it('judges a schema older than this build', () => {
    // Unreachable while SOURCE_SCHEMA_VERSION is 1: loadConfig refuses anything below it.
    const finding = schemaFinding(1, 2);
    expect(finding.level).toBe('error');
    expect(finding.message).toContain('wondev migrate');
  });

  it('accepts a current schema', () => {
    expect(schemaFinding(1, 1)).toEqual({ level: 'ok', message: 'source schema 1' });
  });

  it('names a replacement only when the deprecation has one', () => {
    expect(deprecationFinding('windsurf', { since: '1.0.0', replacedBy: 'devin' }).message).toContain(
      'Use "devin"',
    );
    // No built-in is currently deprecated without a replacement, so this branch has no
    // other way to run.
    expect(deprecationFinding('old', { since: '1.0.0' }).message).not.toContain('Use "');
  });
});

describe('doctor findings that need a particular project state', () => {
  it('reports a config that will not load', async () => {
    await write(root, '.wondev/wondev.yaml', 'name: [unclosed\n');
    const out = await doctorOutput();
    expect(out).toContain('Config:');
    expect(process.exitCode).toBe(1);
  });

  it('warns about a deprecated target the project enables', async () => {
    await seedProject(root, ['windsurf']);
    const out = await doctorOutput();
    expect(out).toContain('deprecated');
    expect(out).toContain('windsurf');
  });

  it('caps how many source problems it names, then points at check', async () => {
    await seedProject(root, ['claude']);
    for (const n of ['a', 'b', 'c', 'd']) {
      await write(root, `.wondev/skills/${n}/SKILL.md`, `---\nname: ${n}\n---\n\nbody\n`);
    }
    const out = await doctorOutput();
    expect(out).toContain('and 1 more');
    expect(out).toContain('wondev check');
  });

  it('reports tracked output whose producing version is unknown', async () => {
    await seedProject(root, ['claude']);
    // A manifest written before 0.2 carries no wondevVersion.
    await write(root, '.wondev/.manifest.json',
      JSON.stringify({ version: 1, files: { 'CLAUDE.md': { hash: 'x', target: 'claude', mode: 'region' } } }));
    const out = await doctorOutput();
    expect(out).toContain('1 generated file(s) tracked');
    expect(out).not.toContain('built by wondev undefined');
  });

  it('warns when the output was built by a different version', async () => {
    await seedProject(root, ['claude']);
    await write(root, '.wondev/.manifest.json',
      JSON.stringify({
        version: 1,
        wondevVersion: '0.0.1',
        files: { 'CLAUDE.md': { hash: 'x', target: 'claude', mode: 'region' } },
      }));
    const out = await doctorOutput();
    expect(out).toContain('built by wondev 0.0.1');
    expect(out).toMatch(/you are running/);
  });

  it('warns when the starter pack predates this release', async () => {
    await seedProject(root, ['claude']);
    await write(root, '.wondev/.templates.json', JSON.stringify({ version: '0.0.1', files: {} }));
    const out = await doctorOutput();
    expect(out).toContain('starter pack is from wondev 0.0.1');
    expect(out).toContain('wondev upgrade');
  });

  it('reports a current starter pack', async () => {
    await seedProject(root, ['claude']);
    const { wondevVersion } = await import('../src/util/version.js');
    await write(root, '.wondev/.templates.json',
      JSON.stringify({ version: wondevVersion(), files: {} }));
    const out = await doctorOutput();
    expect(out).toContain(`starter pack from wondev ${wondevVersion()}`);
  });
});

describe('the online version check', () => {
  const stubFetch = (impl: () => Promise<unknown>): (() => void) => {
    const original = globalThis.fetch;
    globalThis.fetch = impl as typeof fetch;
    return () => {
      globalThis.fetch = original;
    };
  };

  it('reports a newer release when one exists', async () => {
    await seedProject(root, ['claude']);
    const restore = stubFetch(async () => ({ ok: true, json: async () => ({ version: '999.0.0' }) }));
    try {
      expect(await doctorOutput({ online: true })).toContain('wondev 999.0.0 is available');
    } finally {
      restore();
    }
  });

  it('says the installed version is current when it is', async () => {
    await seedProject(root, ['claude']);
    const { wondevVersion } = await import('../src/util/version.js');
    const restore = stubFetch(async () => ({ ok: true, json: async () => ({ version: wondevVersion() }) }));
    try {
      expect(await doctorOutput({ online: true })).toContain('is current');
    } finally {
      restore();
    }
  });

  it('reports an HTTP failure as a warning, not a project problem', async () => {
    await seedProject(root, ['claude']);
    const restore = stubFetch(async () => ({ ok: false, status: 503 }));
    try {
      const out = await doctorOutput({ online: true });
      expect(out).toContain('could not reach npm (HTTP 503)');
      expect(process.exitCode).not.toBe(1);
    } finally {
      restore();
    }
  });

  it('handles a response carrying no version', async () => {
    await seedProject(root, ['claude']);
    const restore = stubFetch(async () => ({ ok: true, json: async () => ({}) }));
    try {
      expect(await doctorOutput({ online: true })).toContain('npm returned no version');
    } finally {
      restore();
    }
  });
});

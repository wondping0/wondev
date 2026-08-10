import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runDoctor } from '../src/commands/doctor.js';
import { runInit } from '../src/commands/init.js';
import {
  BUILTIN_TARGETS,
  deprecationNotice,
  targetsAddedSince,
  type RegistryEntry,
} from '../src/core/registry.js';
import { compareVersions, isNewerThan } from '../src/util/semver.js';
import { cleanup, silence, tmpRoot } from './helpers.js';

let root: string;
beforeEach(async () => {
  root = await tmpRoot();
});
afterEach(async () => {
  await cleanup(root);
  process.exitCode = 0;
});

const entry = (over: Partial<RegistryEntry> = {}): RegistryEntry => ({
  label: 'Test',
  addedIn: '0.1.0',
  readBy: ['Test'],
  target: { engine: 'single-file', path: 'TEST.md' },
  ...over,
});

describe('semver comparison', () => {
  it('orders by each component', () => {
    expect(compareVersions('1.0.0', '2.0.0')).toBeLessThan(0);
    expect(compareVersions('1.2.0', '1.10.0')).toBeLessThan(0);
    expect(compareVersions('1.0.9', '1.0.10')).toBeLessThan(0);
    expect(compareVersions('2.0.0', '2.0.0')).toBe(0);
  });

  it('places a prerelease before its release', () => {
    expect(compareVersions('1.0.0-rc.1', '1.0.0')).toBeLessThan(0);
    expect(compareVersions('1.0.0', '1.0.0-rc.1')).toBeGreaterThan(0);
  });

  it('tolerates a leading v', () => {
    expect(compareVersions('v1.2.3', '1.2.3')).toBe(0);
  });

  it('sorts an unparseable version lowest rather than throwing', () => {
    expect(compareVersions('not-a-version', '0.0.1')).toBeLessThan(0);
    expect(isNewerThan('0.0.1', 'garbage')).toBe(true);
  });
});

describe('deprecation', () => {
  // No built-in target is deprecated yet, so the notice is exercised with a synthetic
  // registry. A branch first run on the day it matters is a branch nobody has checked.
  it('returns null for a healthy target', () => {
    expect(deprecationNotice('claude')).toBeNull();
  });

  it('names the replacement when there is one', () => {
    const notice = deprecationNotice('old', {
      old: entry({ deprecated: { since: '0.4.0', replacedBy: 'new' } }),
    });
    expect(notice).toContain('deprecated since 0.4.0');
    expect(notice).toContain('Use "new" instead');
  });

  it('includes a note when given', () => {
    const notice = deprecationNotice('old', {
      old: entry({ deprecated: { since: '0.4.0', note: 'The tool moved its config.' } }),
    });
    expect(notice).toContain('The tool moved its config.');
  });

  it('works without a replacement', () => {
    const notice = deprecationNotice('old', { old: entry({ deprecated: { since: '0.4.0' } }) });
    expect(notice).toContain('deprecated since 0.4.0');
    expect(notice).not.toContain('Use "');
  });

  it('no built-in target is deprecated in this release', () => {
    const deprecated = Object.keys(BUILTIN_TARGETS).filter((n) => deprecationNotice(n) !== null);
    expect(deprecated).toEqual([]);
  });
});

describe('target discovery', () => {
  it('lists nothing new when the project is current', () => {
    expect(targetsAddedSince('9.9.9')).toEqual([]);
  });

  it('lists targets added after the given version', () => {
    const registry = {
      old: entry({ addedIn: '0.1.0' }),
      fresh: entry({ addedIn: '0.3.0' }),
      fresher: entry({ addedIn: '1.0.0' }),
    };
    expect(targetsAddedSince('0.2.0', registry)).toEqual(['fresh', 'fresher']);
  });

  it('excludes a target added in exactly that version', () => {
    const registry = { same: entry({ addedIn: '0.2.0' }) };
    expect(targetsAddedSince('0.2.0', registry)).toEqual([]);
  });

  it('every built-in target records when it was added', () => {
    for (const [name, e] of Object.entries(BUILTIN_TARGETS)) {
      expect(e.addedIn, `${name} is missing addedIn`).toMatch(/^\d+\.\d+\.\d+/);
    }
  });
});

describe('doctor', () => {
  it('reports a missing project as an error', async () => {
    await silence(() => runDoctor(root));
    expect(process.exitCode).toBe(1);
  });

  it('passes on a freshly initialised, built project', async () => {
    await silence(() => runInit(root, { targets: ['claude'] }));
    await silence(() => runDoctor(root));
    expect(process.exitCode).not.toBe(1);
  });

  it('flags a project that has never been built', async () => {
    await silence(() => runInit(root, { targets: ['claude'], skipBuild: true }));
    await silence(() => runDoctor(root));
    // A missing build is a warning, not an error: it is a normal state right after init.
    expect(process.exitCode).not.toBe(1);
  });

  it('makes no network request unless asked', async () => {
    const original = globalThis.fetch;
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      throw new Error('should not be called');
    }) as typeof fetch;
    try {
      await silence(() => runInit(root, { targets: ['claude'] }));
      await silence(() => runDoctor(root));
      expect(called).toBe(false);
    } finally {
      globalThis.fetch = original;
    }
  });
});

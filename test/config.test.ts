import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig, resolveTargets, validateTarget } from '../src/core/config.js';
import { WondevError } from '../src/util/errors.js';
import { cleanup, tmpRoot, write } from './helpers.js';

let root: string;
beforeEach(async () => {
  root = await tmpRoot();
});
afterEach(async () => {
  await cleanup(root);
});

describe('loadConfig', () => {
  it('points at init when there is no config', async () => {
    await expect(loadConfig(root)).rejects.toThrow(/wondev\.yaml/);
    const err = await loadConfig(root).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WondevError);
    expect((err as WondevError).hint).toMatch(/wondev init/);
  });

  it('defaults targets when the key is absent', async () => {
    await write(root, '.wondev/wondev.yaml', 'name: demo\n');
    const config = await loadConfig(root);
    expect(config.targets.length).toBeGreaterThan(0);
    expect(config.targets).toContain('claude');
  });

  it('rejects an unknown target by name', async () => {
    await write(root, '.wondev/wondev.yaml', 'name: demo\ntargets:\n  - notarealagent\n');
    await expect(loadConfig(root)).rejects.toThrow(/notarealagent/);
  });

  it('accepts an unknown name when it is declared as a custom target', async () => {
    await write(
      root,
      '.wondev/wondev.yaml',
      [
        'name: demo',
        'targets:',
        '  - my-agent',
        'customTargets:',
        '  my-agent:',
        '    engine: single-file',
        '    path: .myagent/context.md',
      ].join('\n'),
    );
    const config = await loadConfig(root);
    expect(resolveTargets(config)).toEqual([
      { name: 'my-agent', target: { engine: 'single-file', path: '.myagent/context.md', mode: 'region' } },
    ]);
  });

  it('rejects an empty target list rather than silently building nothing', async () => {
    await write(root, '.wondev/wondev.yaml', 'name: demo\ntargets: []\n');
    await expect(loadConfig(root)).rejects.toThrow(/empty/);
  });
});

describe('validateTarget', () => {
  it('defaults single-file mode to region so existing files survive', () => {
    const t = validateTarget('x', { engine: 'single-file', path: 'A.md' });
    expect(t).toEqual({ engine: 'single-file', path: 'A.md', mode: 'region' });
  });

  it('refuses a path that escapes the project root', () => {
    expect(() => validateTarget('x', { engine: 'single-file', path: '../outside.md' })).toThrow(
      WondevError,
    );
  });

  it('refuses an absolute path', () => {
    expect(() => validateTarget('x', { engine: 'single-file', path: '/etc/passwd' })).toThrow(
      WondevError,
    );
  });

  it('refuses a Windows absolute path', () => {
    expect(() => validateTarget('x', { engine: 'single-file', path: 'C:/Windows/x.md' })).toThrow(
      WondevError,
    );
  });

  it('refuses an unknown engine', () => {
    expect(() => validateTarget('x', { engine: 'telepathy', path: 'a.md' })).toThrow(/engine/);
  });

  it('requires rule-dir extensions to start with a dot', () => {
    expect(() => validateTarget('x', { engine: 'rule-dir', path: '.r', ext: 'md' })).toThrow(/dot/);
  });
});

describe('resolveTargets', () => {
  it('collapses an alias and its canonical name into one target', () => {
    const targets = resolveTargets({
      name: 'demo',
      targets: ['codex', 'agents', 'zed'],
      customTargets: {},
      schema: 1,
    });
    expect(targets).toHaveLength(1);
    expect(targets[0]?.name).toBe('agents');
  });

  it('lets a custom target shadow a built-in name', () => {
    const targets = resolveTargets({
      name: 'demo',
      targets: ['agents'],
      customTargets: { agents: { engine: 'single-file', path: 'CUSTOM.md', mode: 'whole' } },
      schema: 1,
    });
    expect(targets[0]?.target).toEqual({ engine: 'single-file', path: 'CUSTOM.md', mode: 'whole' });
  });
});

describe('index configuration', () => {
  const base = 'name: demo\ntargets:\n  - claude\n';
  const load = async (yaml: string) => {
    await write(root, '.wondev/wondev.yaml', base + yaml);
    return loadConfig(root);
  };

  it('is absent when the block is omitted', async () => {
    const config = await load('');
    expect(config.index).toBeUndefined();
  });

  it('reads file, budget, and columns', async () => {
    const config = await load(
      'index:\n  file: docs/Index.md\n  budget: 8000\n  columns:\n    - key: owner\n      label: Owner\n',
    );
    expect(config.index).toEqual({
      file: 'docs/Index.md',
      budget: 8000,
      columns: [{ key: 'owner', label: 'Owner' }],
    });
  });

  it('defaults columns to an empty list so consumers need no null check', async () => {
    const config = await load('index:\n  file: docs/Index.md\n');
    expect(config.index?.columns).toEqual([]);
    expect(config.index?.budget).toBeUndefined();
  });

  it('requires a file', async () => {
    await expect(load('index:\n  budget: 10\n')).rejects.toThrow(/"index\.file" is required/);
  });

  it('refuses a path outside the project', async () => {
    await expect(load('index:\n  file: ../escape.md\n')).rejects.toThrow(/inside the project/);
  });

  it('refuses a budget that is not a positive integer', async () => {
    await expect(load('index:\n  file: a.md\n  budget: -1\n')).rejects.toThrow(/positive integer/);
    await expect(load('index:\n  file: a.md\n  budget: 1.5\n')).rejects.toThrow(/positive integer/);
  });

  it('refuses a column missing key or label', async () => {
    await expect(load('index:\n  file: a.md\n  columns:\n    - key: owner\n')).rejects.toThrow(
      /needs a "key" and a "label"/,
    );
  });
});

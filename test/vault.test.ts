import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { runVault } from '../src/commands/vault.js';
import { runInit } from '../src/commands/init.js';
import { runBuild } from '../src/commands/build.js';
import { runCheck } from '../src/commands/check.js';
import { runAdd } from '../src/commands/add.js';
import { runRemove } from '../src/commands/remove.js';
import { runUpgrade } from '../src/commands/upgrade.js';
import { loadContext } from '../src/commands/context.js';
import { loadConfig, readSources } from '../src/core/config.js';
import { runAdopt } from '../src/commands/adopt.js';
import { cleanup, exists, read, seedProject, silence, tmpRoot, write } from './helpers.js';

let root: string;
beforeEach(async () => { root = await tmpRoot(); });
afterEach(async () => { await cleanup(root); });

describe('active Obsidian vault', () => {
  it('moves authored sources, compiles edits, and keeps lifecycle commands on the configured paths', async () => {
    await silence(() => runInit(root, { targets: ['agents'], vault: 'knowledge' }));
    expect(await exists(root, '.wondev/memory')).toBe(false);
    const config = await loadConfig(root);
    expect(config.sources?.memory).toBe('knowledge/memory');
    await silence(() => runAdd(root, 'memory', 'billing'));
    await write(root, 'knowledge/memory/billing.md', '---\ntitle: Billing\nalways: true\n---\nChanged through Obsidian.\n');
    await silence(() => runBuild(root));
    expect(await read(root, 'AGENTS.md')).toContain('Changed through Obsidian.');
    expect(await read(root, 'knowledge/index.md')).toContain('[[memory/billing]]');
    await silence(() => runCheck(root));
    await silence(() => runRemove(root, 'memory', 'billing'));
    expect(await read(root, 'AGENTS.md')).not.toContain('Changed through Obsidian.');
    await silence(() => runUpgrade(root));
    expect(await exists(root, '.wondev/memory')).toBe(false);
    const dashboard = parse(await read(root, 'knowledge/dashboards/project.base'));
    expect(dashboard.views).toHaveLength(4);
    expect(await read(root, 'knowledge/templates/module.md')).toContain('Decisions and rejected alternatives');
  });

  it('preflights moves, supports dry run, and refuses an existing vault', async () => {
    await seedProject(root);
    await silence(() => runVault(root, 'knowledge', true));
    expect(await exists(root, 'knowledge')).toBe(false);
    await write(root, 'knowledge/note.md', 'mine');
    await expect(runVault(root)).rejects.toThrow('already exists');
    await expect(runVault(root, '.wondev/memory/vault')).rejects.toThrow('overlaps');
    await expect(runVault(root, '../outside')).rejects.toThrow('inside');
  });

  it('rejects unsafe and overlapping sources before loading them', async () => {
    for (const source of [{ memory: '../outside' }, { memory: '.' }, { memory: 'vault', skills: 'vault/skills' }, { other: 'vault' }, []]) {
      expect(() => readSources(source)).toThrow();
    }
    await seedProject(root);
    await fs.mkdir(path.join(root, 'actual'), { recursive: true });
    const outside = await tmpRoot();
    try {
      await fs.symlink(outside, path.join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
      await write(root, '.wondev/wondev.yaml', 'sources:\n  memory: linked\n');
      await expect(loadContext(root)).rejects.toThrow('symlink');
    } finally { await fs.rm(path.join(root, 'linked'), { force: true }); await cleanup(outside); }
  });

  it('refuses outputs inside a source and keeps drafts out of agent context', async () => {
    await seedProject(root, ['agents']);
    await write(root, '.wondev/memory/draft.md', '---\nstatus: draft\nalways: true\n---\nUNVERIFIED DRAFT\n');
    await silence(() => runBuild(root));
    expect(await read(root, 'AGENTS.md')).not.toContain('UNVERIFIED DRAFT');
    await write(root, '.wondev/wondev.yaml', 'targets: [bad]\ncustomTargets:\n  bad:\n    engine: single-file\n    path: .wondev/memory/output.md\n');
    await expect(runBuild(root)).rejects.toThrow('overlaps authored');
  });

  it('preserves folders with repeated basenames during vault import', async () => {
    await write(root, 'vault/API/Overview.md', '# API\n\nSee [[UI/Overview]].\n');
    await write(root, 'vault/UI/Overview.md', '# UI\n');
    await silence(() => runAdopt(root, { vault: 'vault' }));
    expect(await read(root, '.wondev/memory/api/overview.md')).toContain('[[ui/overview]]');
    expect(await exists(root, '.wondev/memory/ui/overview.md')).toBe(true);
    expect((await loadContext(root)).issues).toEqual([]);
  });

  it('rewrites Markdown, frontmatter, and anchored links without changing code examples', async () => {
    await write(root, 'vault/API/Login Flow.md', '---\nrelated: ["[[UI/Auth Note#Token|tokens]]"]\n---\n# Login\n\n[Tokens](../UI/Auth%20Note.md#token)\n`[[UI/Auth Note]]`\n```md\n[[UI/Auth Note]]\n```\n');
    await write(root, 'vault/UI/Auth Note.md', '# Auth\n\n## Token\n\nContract.');
    await silence(() => runAdopt(root, { vault: 'vault' }));
    const content = await read(root, '.wondev/memory/api/login-flow.md');
    expect(content).toContain('../ui/auth-note.md#token');
    expect(content).toContain('[[ui/auth-note#Token|tokens]]');
    expect(content).toContain('`[[UI/Auth Note]]`');
    expect((await loadContext(root)).issues).toEqual([]);
  });

  it('moves the generated index into the vault while preserving previous index prose and settings', async () => {
    await seedProject(root, ['agents']);
    await write(root, '.wondev/wondev.yaml', 'targets: [agents]\nindex:\n  file: docs/old-index.md\n  budget: 9000\n  columns: [{ key: kind, label: Kind }]\n');
    await write(root, 'docs/old-index.md', 'Human introduction.\n');
    await silence(() => runBuild(root));
    await silence(() => runVault(root));
    await write(root, 'knowledge/memory/draft.md', '---\nstatus: draft\nalways: true\n---\nPending claim.');
    await silence(() => runBuild(root));
    expect((await loadConfig(root)).index?.budget).toBe(9000);
    expect(await read(root, 'docs/old-index.md')).toBe('Human introduction.\n');
    expect(await read(root, 'knowledge/index.md')).toContain('## Draft and archived');
    expect(await read(root, 'knowledge/index.md')).toContain('[[memory/architecture]]');
    expect(await read(root, 'AGENTS.md')).not.toContain('Pending claim.');
  });
});

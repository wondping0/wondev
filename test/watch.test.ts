import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isAtomicWriteTemp } from '../src/util/fs.js';
import { cleanup, seedProject, tmpRoot } from './helpers.js';
import { runInit } from '../src/commands/init.js';
import { silence } from './helpers.js';

const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'cli.js');

let root: string;
beforeEach(async () => {
  root = await tmpRoot();
});
afterEach(async () => {
  await cleanup(root);
});

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('isAtomicWriteTemp', () => {
  // The watcher relies on this to recognise wondev's own writes. If the temp naming in
  // writeFileAtomic changes without this following, `watch` silently rebuilds forever.
  it('matches the sibling temp files writeFileAtomic creates', () => {
    expect(isAtomicWriteTemp('.manifest.json.wondev-1234-a1b2c3d4.tmp')).toBe(true);
    expect(isAtomicWriteTemp('CLAUDE.md.wondev-9-ffffffff.tmp')).toBe(true);
  });

  it('does not match ordinary files', () => {
    expect(isAtomicWriteTemp('.manifest.json')).toBe(false);
    expect(isAtomicWriteTemp('architecture.md')).toBe(false);
    expect(isAtomicWriteTemp('notes.tmp')).toBe(false);
  });
});

describe('wondev watch', () => {
  it('rebuilds from an active vault outside .wondev and follows a changed source configuration', async () => {
    await silence(() => runInit(root, { targets: ['claude'], vault: 'knowledge' }));
    const log: string[] = [];
    const child = spawn(process.execPath, [cli, 'watch', '--cwd', root], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    child.stdout.on('data', (data: Buffer) => log.push(data.toString()));
    child.stderr.on('data', (data: Buffer) => log.push(data.toString()));
    const until = async (predicate: () => Promise<boolean>): Promise<void> => {
      const deadline = Date.now() + 8000;
      while (Date.now() < deadline) { if (await predicate()) return; await sleep(100); }
      throw new Error(`Watcher did not converge: ${log.join('')}`);
    };
    try {
      await until(async () => log.join('').includes('Watching'));
      const note = '---\ntitle: Architecture\nalways: true\n---\nVault edit reached Claude.\n';
      await fs.writeFile(path.join(root, 'knowledge/memory/architecture.md'), note);
      await until(async () => (await fs.readFile(path.join(root, 'CLAUDE.md'), 'utf8')).includes('Vault edit reached Claude.'));
      await fs.rename(path.join(root, 'knowledge/memory'), path.join(root, 'knowledge/notes'));
      const configFile = path.join(root, '.wondev/wondev.yaml');
      const config = await fs.readFile(configFile, 'utf8');
      await fs.writeFile(configFile, config.replace('memory: knowledge/memory', 'memory: knowledge/notes'));
      await fs.writeFile(path.join(root, 'knowledge/notes/architecture.md'), note.replace('Vault edit reached Claude.', 'Moved source reached Claude.'));
      await until(async () => (await fs.readFile(path.join(root, 'CLAUDE.md'), 'utf8')).includes('Moved source reached Claude.'));
      const count = log.join('').match(/target\(s\)/g)?.length ?? 0;
      await sleep(500);
      expect((log.join('').match(/target\(s\)/g)?.length ?? 0) - count).toBeLessThanOrEqual(1);
    } finally {
      const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
      child.kill();
      await exited;
    }
  }, 20000);

  /**
   * Regression test for a self-sustaining rebuild loop.
   *
   * Every build rewrites `.wondev/.manifest.json`, which lives inside the watched directory,
   * so the build's own output re-triggered the watcher. One edit produced roughly six
   * rebuilds per second indefinitely. This spawns the real CLI because the bug only exists
   * in the interaction between the writer and the watcher, not in any single function.
   */
  it('rebuilds once per edit instead of looping on its own manifest writes', async () => {
    await seedProject(root, ['claude']);

    const log: string[] = [];
    const child = spawn(process.execPath, [cli, 'watch', '--cwd', root], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (d: Buffer) => log.push(d.toString()));

    try {
      await sleep(1500);
      const before = log.join('').match(/target\(s\)/g)?.length ?? 0;
      expect(before).toBeGreaterThanOrEqual(1); // the initial build

      await fs.writeFile(
        path.join(root, '.wondev', 'memory', 'architecture.md'),
        '---\ntitle: Architecture\nalways: true\n---\n\nEdited once.\n',
        'utf8',
      );

      await sleep(2500);
      const after = log.join('').match(/target\(s\)/g)?.length ?? 0;

      // One edit may legitimately produce a couple of filesystem events. A loop produces
      // tens: before the fix this reached 30+ in the same window.
      expect(after).toBeGreaterThan(before);
      expect(after - before).toBeLessThanOrEqual(4);

      const claude = await fs.readFile(path.join(root, 'CLAUDE.md'), 'utf8');
      expect(claude).toContain('Edited once.');
    } finally {
      child.kill();
    }
  }, 20_000);
});

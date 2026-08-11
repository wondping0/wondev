import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isAtomicWriteTemp } from '../src/util/fs.js';
import { cleanup, seedProject, tmpRoot } from './helpers.js';

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

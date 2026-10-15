import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { loadConfig, sourceDirectory, wondevDir, type WondevConfig } from '../core/config.js';
import { isWondevError } from '../util/errors.js';
import { isAtomicWriteTemp } from '../util/fs.js';
import { error, info, style } from '../util/log.js';
import { runBuild, type BuildOptions } from './build.js';

const DEBOUNCE_MS = 150;

/** Basename of the manifest wondev rewrites on every build, inside the watched directory. */
const MANIFEST_BASENAME = '.manifest.json';

/**
 * Rebuild on change.
 *
 * Recursive `fs.watch` is used where the platform supports it and falls back to watching
 * `.wondev/` plus its immediate subdirectories, which covers the layout wondev creates.
 * Editors often fire several events per save, so rebuilds are debounced.
 */
export async function runWatch(root: string, options: BuildOptions = {}): Promise<void> {
  const base = wondevDir(root);

  let watchers: fsSync.FSWatcher[] = [];
  let timer: NodeJS.Timeout | undefined;
  let building = false;
  let queued = false;
  let stopped = false;

  /**
   * Ignore wondev's own bookkeeping.
   *
   * `.wondev/.manifest.json` is written by every build and lives inside the directory being
   * watched, so without this a single edit rebuilds forever: build writes the manifest, the
   * watcher sees it, that rebuild writes it again. The `queued` path below guarantees the
   * cycle never settles, because an event arriving mid-build always schedules another one.
   *
   * Measured before the fix: one edit produced roughly six rebuilds per second indefinitely.
   */
  const isSelfInflicted = (filename: string | Buffer | null): boolean => {
    if (filename === null) return false;
    const base = path.basename(typeof filename === 'string' ? filename : filename.toString());
    // The temp file matters as much as the manifest: writes are atomic, so each manifest
    // save also creates and renames `.manifest.json.wondev-<pid>-<hex>.tmp` beside it.
    return base === MANIFEST_BASENAME || base.startsWith('.lock') || isAtomicWriteTemp(base);
  };

  // Both parameters are optional so the queued-rebuild path below can call this directly,
  // where there is no originating filesystem event to inspect.
  const trigger = (_event?: string, filename: string | Buffer | null = null): void => {
    if (stopped) return;
    if (isSelfInflicted(filename)) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      void rebuild();
    }, DEBOUNCE_MS);
  };

  const rebuild = async (): Promise<void> => {
    if (building) {
      queued = true;
      return;
    }
    building = true;
    try {
      await safeBuild(root, options);
      await configureWatchers();
    } finally {
      building = false;
      if (queued) {
        queued = false;
        trigger();
      }
    }
  };

  const configureWatchers = async (): Promise<void> => {
    let config: WondevConfig | undefined;
    try { config = await loadConfig(root); } catch {
      // Keep working watchers while YAML is edited. On startup still observe the config
      // location, otherwise the user cannot recover from an initially malformed file.
      if (watchers.length) return;
    }
    const sources = ['memory', 'skills', 'commands', 'agents'].map((kind) =>
      sourceDirectory(kind as 'memory' | 'skills' | 'commands' | 'agents', config?.sources));
    const fresh: fsSync.FSWatcher[] = [];
    const watched = new Set<string>();
    const relevant = (rel: string): boolean => rel === '.wondev/wondev.yaml' || sources.some((source) =>
      rel === source || rel.startsWith(`${source}/`) || source.startsWith(`${rel}/`));
    const watch = async (dir: string): Promise<void> => {
      if (watched.has(dir)) return;
      watched.add(dir);
      const listener = (event: string, name: string | Buffer | null): void => {
        const rel = path.relative(root, path.join(dir, name?.toString() ?? '')).replace(/\\/g, '/');
        if (!name || relevant(rel)) trigger(event, name);
      };
      try { fresh.push(fsSync.watch(dir, { recursive: true }, listener)); }
      catch {
        try {
          fresh.push(fsSync.watch(dir, listener));
          for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
            if (entry.isDirectory()) await watch(path.join(dir, entry.name));
          }
        } catch { /* A parent watcher detects newly created sources. */ }
      }
    };
    await watch(base);
    for (const source of sources) {
      let dir = path.join(root, source);
      while (!fsSync.existsSync(dir) && dir !== root) dir = path.dirname(dir);
      await watch(dir);
    }
    if (stopped) { for (const w of fresh) w.close(); return; }
    for (const w of watchers) w.close();
    watchers = fresh;
  };
  await configureWatchers();
  // Readiness means watchers are installed. Building after subscribing closes the gap
  // where an edit between the initial build and subscription could otherwise be lost.
  await rebuild();
  info(style.dim('Watching configured sources and .wondev/wondev.yaml. Ctrl+C to stop.'));

  await new Promise<void>((resolve) => {
    const stop = (): void => {
      stopped = true;
      if (timer) clearTimeout(timer);
      for (const w of watchers) w.close();
      process.removeListener('SIGINT', stop);
      process.removeListener('SIGTERM', stop);
      resolve();
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
}

/** A failed rebuild must not kill the watcher; the user is mid-edit and will fix it. */
async function safeBuild(root: string, options: BuildOptions): Promise<void> {
  try {
    await runBuild(root, options);
  } catch (err) {
    if (isWondevError(err)) {
      error(err.message);
      if (err.hint) info(style.dim(err.hint));
    } else {
      error((err as Error).message);
    }
  }
}

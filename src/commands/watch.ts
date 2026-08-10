import fsSync from 'node:fs';
import path from 'node:path';
import { wondevDir } from '../core/config.js';
import { isWondevError } from '../util/errors.js';
import { error, info, style } from '../util/log.js';
import { runBuild, type BuildOptions } from './build.js';

const DEBOUNCE_MS = 150;

/**
 * Rebuild on change.
 *
 * Recursive `fs.watch` is used where the platform supports it and falls back to watching
 * `.wondev/` plus its immediate subdirectories, which covers the layout wondev creates.
 * Editors often fire several events per save, so rebuilds are debounced.
 */
export async function runWatch(root: string, options: BuildOptions = {}): Promise<void> {
  const base = wondevDir(root);

  await safeBuild(root, options);
  info(style.dim(`Watching ${path.relative(root, base) || base} for changes. Ctrl+C to stop.`));

  const watchers: fsSync.FSWatcher[] = [];
  let timer: NodeJS.Timeout | undefined;
  let building = false;
  let queued = false;

  const trigger = (): void => {
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
    } finally {
      building = false;
      if (queued) {
        queued = false;
        trigger();
      }
    }
  };

  try {
    watchers.push(fsSync.watch(base, { recursive: true }, trigger));
  } catch {
    watchers.push(fsSync.watch(base, trigger));
    for (const sub of ['memory', 'skills', 'commands']) {
      const dir = path.join(base, sub);
      try {
        watchers.push(fsSync.watch(dir, { recursive: true }, trigger));
      } catch {
        try {
          watchers.push(fsSync.watch(dir, trigger));
        } catch {
          // Subdirectory may not exist yet; the parent watcher will catch its creation.
        }
      }
    }
  }

  await new Promise<void>((resolve) => {
    const stop = (): void => {
      if (timer) clearTimeout(timer);
      for (const w of watchers) w.close();
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

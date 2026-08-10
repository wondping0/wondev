import path from 'node:path';
import fs from 'node:fs/promises';
import { WondevError } from './errors.js';

/**
 * Paths are stored and compared in POSIX form everywhere inside wondev, so a build on
 * Windows and a build on Linux produce byte-identical manifests and output.
 * Convert to native form only at the moment of touching the filesystem.
 */

export function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}

export function toNative(p: string): string {
  return p.split('/').join(path.sep);
}

/** Project-root-relative POSIX path for an absolute path. */
export function relPosix(root: string, abs: string): string {
  return toPosix(path.relative(root, abs));
}

/** Absolute native path for a project-root-relative POSIX path. */
export function absFrom(root: string, rel: string): string {
  return path.resolve(root, toNative(rel));
}

/**
 * True when `rel` stays inside the project root. Target paths come from user config, so
 * `../../etc/passwd` has to be rejected before it reaches the writer.
 */
export function isInsideRoot(rel: string): boolean {
  if (path.isAbsolute(rel) || /^[a-zA-Z]:/.test(rel)) return false;
  const normalized = toPosix(path.normalize(toNative(rel)));
  return !normalized.startsWith('../') && normalized !== '..';
}

/**
 * A path checker that also resolves symlinks.
 *
 * `isInsideRoot` compares paths lexically, which a symlinked directory defeats: a repository
 * containing `.claude -> ~/.ssh` passes the lexical test while every write lands outside the
 * project. Since a repository can carry symlinks and wondev runs on freshly cloned ones,
 * this checks where a path really leads before anything touches it.
 *
 * Verified directories are cached, so a build resolves each output directory once rather
 * than once per file.
 */
export function createRootGuard(root: string): (rel: string) => Promise<void> {
  let realRoot: string | undefined;
  const verified = new Set<string>();

  const resolveRoot = async (): Promise<string> => {
    realRoot ??= await fs.realpath(root).catch(() => path.resolve(root));
    return realRoot;
  };

  /** Resolve the closest ancestor that exists; the leaf usually does not yet. */
  const realAncestor = async (start: string): Promise<string | null> => {
    let current = start;
    for (;;) {
      try {
        return await fs.realpath(current);
      } catch {
        const parent = path.dirname(current);
        if (parent === current) return null;
        current = parent;
      }
    }
  };

  return async function ensureInside(rel: string): Promise<void> {
    if (!isInsideRoot(rel)) {
      throw new WondevError(`Path escapes the project: ${rel}`);
    }

    const dir = path.dirname(absFrom(root, rel));
    if (verified.has(dir)) return;

    const base = await resolveRoot();
    const real = await realAncestor(dir);
    const relative = real === null ? '..' : path.relative(base, real);

    if (relative !== '' && (relative.startsWith('..') || path.isAbsolute(relative))) {
      throw new WondevError(
        `Refusing to follow a symlink that leaves the project: ${rel}`,
        'A directory on this path is a symlink pointing outside the repository.',
      );
    }
    verified.add(dir);
  };
}

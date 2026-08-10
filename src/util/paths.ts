import path from 'node:path';

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

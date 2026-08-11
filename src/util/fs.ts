import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { toPosix } from './paths.js';

export async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

export async function readFileIfExists(p: string): Promise<string | null> {
  try {
    return await fs.readFile(p, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

export async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

/**
 * Write via a sibling temp file plus rename, so an interrupted or crashed build can never
 * leave a half-written config file behind. The temp file is a sibling rather than in the
 * OS temp dir because `rename` is only atomic within a single filesystem.
 */
/**
 * Recognise the sibling temp files `writeFileAtomic` creates.
 *
 * Exported so a filesystem watcher can ignore wondev's own writes. Keeping the pattern next
 * to the code that produces it is the point: when the naming changes, both sides move
 * together instead of a watcher quietly starting to rebuild forever.
 */
export function isAtomicWriteTemp(name: string): boolean {
  return /\.wondev-\d+-[0-9a-f]+\.tmp$/.test(name);
}

export async function writeFileAtomic(target: string, content: string): Promise<void> {
  await ensureDir(path.dirname(target));
  const tmp = `${target}.wondev-${process.pid}-${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    await fs.writeFile(tmp, content, 'utf8');
    await fs.rename(tmp, target);
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}

export async function removeFile(p: string): Promise<void> {
  await fs.rm(p, { force: true });
}

/** Remove `dir` and every parent up to (not including) `stopAt`, while they stay empty. */
export async function pruneEmptyDirs(dir: string, stopAt: string): Promise<void> {
  let current = path.resolve(dir);
  const stop = path.resolve(stopAt);
  while (current.startsWith(stop) && current !== stop) {
    try {
      const entries = await fs.readdir(current);
      if (entries.length > 0) return;
      await fs.rmdir(current);
    } catch {
      return;
    }
    current = path.dirname(current);
  }
}

/** All files under `dir`, as POSIX paths relative to `dir`, sorted for deterministic output. */
export async function listFilesRecursive(dir: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(current: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw err;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile()) {
        out.push(toPosix(path.relative(dir, full)));
      }
    }
  }
  await walk(dir);
  return out.sort();
}

export function sha256(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

/**
 * Normalize line endings before hashing and writing. Without this, a repo checked out with
 * `core.autocrlf=true` on Windows would report permanent drift against a Linux build.
 */
export function normalizeEol(content: string): string {
  return content.replace(/\r\n/g, '\n');
}

/** Copy a directory tree recursively, creating missing parents. */
export async function copyDir(src: string, dest: string): Promise<void> {
  await fs.cp(src, dest, { recursive: true });
}

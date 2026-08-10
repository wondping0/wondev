import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { isWondevError, type WondevError } from '../src/util/errors.js';

/** A throwaway project directory. Vitest cleans them up via the returned disposer. */
export async function tmpRoot(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'wondev-test-'));
}

export async function cleanup(root: string): Promise<void> {
  await fs.rm(root, { recursive: true, force: true });
}

export async function write(root: string, rel: string, content: string): Promise<void> {
  const abs = path.join(root, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, 'utf8');
}

export async function read(root: string, rel: string): Promise<string> {
  return fs.readFile(path.join(root, rel), 'utf8');
}

export async function exists(root: string, rel: string): Promise<boolean> {
  try {
    await fs.stat(path.join(root, rel));
    return true;
  } catch {
    return false;
  }
}

/**
 * A minimal but complete `.wondev/` source tree: one always-on memory doc, one skill, one
 * command. Small enough that expected output can be asserted literally.
 */
export async function seedProject(
  root: string,
  targets: string[] = ['claude', 'agents', 'cursor'],
): Promise<void> {
  await write(
    root,
    '.wondev/wondev.yaml',
    `name: demo\ntargets:\n${targets.map((t) => `  - ${t}`).join('\n')}\n`,
  );
  await write(
    root,
    '.wondev/memory/architecture.md',
    '---\ntitle: Architecture\nalways: true\n---\n\nThe system is a single binary.\n',
  );
  await write(
    root,
    '.wondev/skills/debugging/SKILL.md',
    '---\nname: debugging\ndescription: Use when investigating a failure\n---\n\nReproduce first.\n',
  );
  await write(
    root,
    '.wondev/commands/review.md',
    '---\nname: review\ndescription: Review the diff\n---\n\nRead the diff.\n',
  );
}

/**
 * Capture a rejected `WondevError`. Guidance lives in `hint`, not `message`, so assertions
 * about what the user is told to do next have to look there.
 */
export async function catchWondevError(fn: () => Promise<unknown>): Promise<WondevError> {
  try {
    await fn();
  } catch (err) {
    if (isWondevError(err)) return err;
    throw new Error(`Expected a WondevError, got: ${String(err)}`);
  }
  throw new Error('Expected a WondevError, but nothing was thrown.');
}

/** Silence CLI output for the duration of `fn`, so test logs stay readable. */
export async function silence<T>(fn: () => Promise<T>): Promise<T> {
  const out = process.stdout.write.bind(process.stdout);
  const err = process.stderr.write.bind(process.stderr);
  process.stdout.write = (() => true) as typeof process.stdout.write;
  process.stderr.write = (() => true) as typeof process.stderr.write;
  try {
    return await fn();
  } finally {
    process.stdout.write = out;
    process.stderr.write = err;
  }
}

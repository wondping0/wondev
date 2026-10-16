import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRootGuard } from './paths.js';
import { WondevError } from './errors.js';

/** Serialize cooperating CLI processes; a timeout never removes another writer's lock. */
export async function withProjectLock<T>(root: string, operation: () => Promise<T>, timeoutMs = 5000): Promise<T> {
  const rel = '.wondev/.lock';
  await createRootGuard(root)(rel);
  await fs.mkdir(path.join(root, '.wondev'), { recursive: true });
  const file = path.join(root, rel);
  const token = JSON.stringify({ pid: process.pid, token: randomUUID() });
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const handle = await fs.open(file, 'wx');
      try { await handle.writeFile(token); } finally { await handle.close(); }
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      if (Date.now() >= deadline) {
        throw new WondevError('Another wondev writer holds .wondev/.lock.', 'Retry after it finishes. If a process crashed, confirm it has stopped before removing the lock.');
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  try { return await operation(); }
  finally {
    if (await fs.readFile(file, 'utf8').catch(() => '') === token) await fs.rm(file, { force: true });
  }
}

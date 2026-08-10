/**
 * Bounded-concurrency map.
 *
 * wondev's hot paths read and write hundreds of small files. Doing that sequentially wastes
 * most of the wall clock waiting on syscalls, but an unbounded `Promise.all` over a large
 * project opens every file at once and risks EMFILE on systems with a low descriptor limit.
 *
 * Results are returned in input order, so callers keep deterministic output.
 */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  if (items.length === 0) return results;

  let next = 0;
  const workerCount = Math.max(1, Math.min(limit, items.length));

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await fn(items[index] as T, index);
    }
  };

  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
}

/**
 * How many files wondev touches at once.
 *
 * Chosen to stay well under the default descriptor limit on every supported platform while
 * still saturating a normal disk. Raising it further stopped helping in measurement.
 */
export const IO_CONCURRENCY = 32;

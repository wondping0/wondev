import { loadContext } from './context.js';
import { inspectFreshness } from '../core/freshness.js';
import { formatContext, selectContext, type ContextOptions } from '../core/retrieval.js';
import { hasErrors } from '../core/source.js';
import { WondevError } from '../util/errors.js';

export async function runContext(root: string, options: ContextOptions & { profile?: string | undefined }): Promise<void> {
  const ctx = await loadContext(root, options.profile);
  if (hasErrors(ctx.issues)) throw new WondevError('Fix source validation errors before selecting context.');
  const freshness = await inspectFreshness(root, ctx.project.memory);
  const packet = selectContext(ctx.project, options, freshness);
  process.stdout.write(formatContext(packet, options.format));
}

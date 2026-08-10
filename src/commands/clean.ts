import { cleanAll, loadManifest } from '../core/writer.js';
import { info, step, style, success } from '../util/log.js';

/**
 * Remove exactly what the manifest records and nothing else. Files wondev only partly owns
 * keep the user's content and lose just the managed region.
 */
export async function runClean(root: string): Promise<void> {
  const manifest = await loadManifest(root);
  const tracked = Object.keys(manifest.files);

  if (tracked.length === 0) {
    info('Nothing to clean — no generated files are tracked.');
    return;
  }

  const removed = await cleanAll(root, manifest);
  for (const file of removed) {
    const verb = file.outcome === 'deleted' ? 'deleted ' : 'stripped';
    step(`${style.dim(verb)}  ${file.path}`);
  }

  const deleted = removed.filter((f) => f.outcome === 'deleted').length;
  const stripped = removed.length - deleted;
  const parts = [`${deleted} deleted`];
  if (stripped > 0) parts.push(`${stripped} left in place with the wondev block removed`);
  success(`cleaned: ${parts.join(', ')}`);
}

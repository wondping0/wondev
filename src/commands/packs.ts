import { installPack, syncPacks, updatePack, type PackResult } from '../core/packs.js';
import { info, success, warn } from '../util/log.js';
import { runBuild } from './build.js';
import { WondevError } from '../util/errors.js';

export async function runPacks(root: string, action: string, sourceOrName?: string, options: { dryRun?: boolean; source?: string | undefined; noBuild?: boolean } = {}): Promise<void> {
  let results: PackResult[];
  if (action === 'install' && sourceOrName) results = [await installPack(root, sourceOrName, { dryRun: options.dryRun === true })];
  else if (action === 'update' && sourceOrName) results = [await updatePack(root, sourceOrName, { dryRun: options.dryRun === true, ...(options.source ? { source: options.source } : {}) })];
  else if (action === 'sync') results = await syncPacks(root, options.dryRun === true);
  else throw new WondevError('Usage: wondev skills install <local:path|npm:package@version> | update <name> [--source <source>] | sync');
  for (const result of results) {
    info(`${result.name}@${result.version} · ${result.integrity}`);
    for (const change of result.changes.filter((c) => c.action !== 'unchanged')) {
      info(`${change.action.padEnd(10)} ${change.path}`);
      if (options.dryRun && change.diff) info(change.diff);
    }
    if (result.changes.some((c) => c.action === 'conflict')) warn('Local edits/deletions were preserved. Incoming files are in .wondev/skill-updates/ for manual review; they are not active skills.');
  }
  if (options.dryRun) success('Dry run: no project files changed.');
  else if (!options.noBuild) await runBuild(root);
}

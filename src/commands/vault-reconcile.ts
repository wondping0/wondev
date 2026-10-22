import fs from 'node:fs/promises';
import path from 'node:path';
import { planVaultReconciliation, applyVaultReconciliation, type VaultResolutions } from '../core/vault-reconcile.js';
import { createRootGuard } from '../util/paths.js';
import { withProjectLock } from '../util/lock.js';
import { WondevError } from '../util/errors.js';
import { info } from '../util/log.js';

export async function runVaultReconcile(root: string, directory: string, options: { apply?: boolean; dryRun?: boolean; json?: boolean; resolutions?: string; reviewHash?: string } = {}): Promise<void> {
  const execute = async (): Promise<void> => {
    let resolutions: VaultResolutions = {};
    if (options.resolutions) {
      await createRootGuard(root)(options.resolutions);
      try {
        resolutions = JSON.parse(await fs.readFile(path.join(root, options.resolutions), 'utf8')) as VaultResolutions;
        if (!resolutions || typeof resolutions !== 'object' || Array.isArray(resolutions)) throw new Error();
      } catch { throw new WondevError('Vault resolutions must be a JSON object mapping destination paths to source or vault.'); }
    }
    const plan = await planVaultReconciliation(root, directory, resolutions);
    const { changes, snapshot: _snapshot, ...report } = plan;
    if (options.json) info(JSON.stringify({ ...report, changes: changes.map((c) => ({ path: c.path, action: c.after === null ? 'remove' : c.before === null ? 'create' : 'update' })) }, null, 2));
    else {
      for (const note of plan.notes) info(`${note.status}: ${note.destination}\n  source: ${note.source ?? '-'} (${note.sourceTitle ?? '-'})\n  vault: ${note.vault ?? '-'} (${note.vaultTitle ?? '-'})`);
      for (const issue of plan.issues) info(`${issue.level}: ${issue.file}: ${issue.message}`);
      for (const warning of plan.warnings) info(warning);
      info(`Review hash: ${plan.reviewHash}\nPreview only unless --apply --review-hash <hash> is supplied. Resolve conflicts with --resolutions <file.json>, then preview again.`);
    }
    if (!options.apply || options.dryRun) return;
    if (options.reviewHash !== plan.reviewHash) throw new WondevError('Vault review hash is missing or stale. Preview the current plan before applying.');
    await applyVaultReconciliation(root, plan);
    if (!options.json) info(`Active memory is now ${plan.vault}/memory. Run wondev build and wondev check. Backup: .wondev/vault-backups/${plan.reviewHash}`);
  };
  if (options.apply && !options.dryRun) await withProjectLock(root, execute); else await execute();
}

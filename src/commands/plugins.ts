import { PLUGIN_CATALOG, catalogPlugin, changePlugin, exportPlugins, loadPluginLock, pluginRelease } from '../core/plugin-catalog.js';
import { info } from '../util/log.js';
import { WondevError } from '../util/errors.js';
import { runBundledInstall } from './bundled-skills.js';
import { runSelection } from './agent.js';

export async function runPlugins(root: string, action: string, id?: string, options: { json?: boolean; online?: boolean; agent?: string; version?: string; dryRun?: boolean; noBuild?: boolean } = {}): Promise<void> {
  if (action === 'catalog' || action === 'info') {
    if (action === 'info' && !id) throw new WondevError('Usage: wondev plugins info <id>');
    const entries = action === 'info' ? [catalogPlugin(id!)] : PLUGIN_CATALOG;
    if (options.json) info(JSON.stringify(entries, null, 2));
    else for (const entry of entries) {
      info(`${entry.id} [${entry.kind}] — ${entry.purpose}\n  ${entry.source}\n  Metadata checked ${entry.checkedAt}; ${entry.requires}`);
      if (action === 'info') {
        info(`  ${entry.assessment}\n  Access: ${entry.access.join('; ')}\n  Documentation: ${entry.documentation}`);
        info(entry.kind === 'bundled-skill' ? `  Install: wondev skills install bundled:${entry.id}` : `  Snapshot: ${entry.package}@${entry.version}\n  Pin: wondev plugins pin ${entry.id}\n  Pinning records selection; it does not install or activate the server.`);
      }
    }
    return;
  }
  if (action === 'export') {
    if (!options.agent) throw new WondevError('Usage: wondev plugins export --agent codex|claude|generic');
    process.stdout.write(exportPlugins(await loadPluginLock(root), options.agent));
    return;
  }
  if (action === 'check' || action === 'status') {
    const lock = await loadPluginLock(root);
    const reports = [];
    let failed = false;
    for (const [name, pin] of Object.entries(lock.plugins)) {
      let latest: Awaited<ReturnType<typeof pluginRelease>> | undefined;
      let error: string | undefined;
      if (options.online) {
        try {
          const locked = await pluginRelease(catalogPlugin(name), pin.version);
          if (locked.integrity !== pin.integrity) throw new WondevError('Pinned registry integrity changed; review before activation.');
          latest = await pluginRelease(catalogPlugin(name));
        } catch (err) { failed = true; error = (err as Error).message; }
      }
      reports.push({ id: name, ...pin, hostActivation: 'unverified', latest: latest?.version ?? null, updateAvailable: latest ? latest.version !== pin.version : null, ...(error ? { error } : {}) });
    }
    if (options.json) info(JSON.stringify({ online: !!options.online, plugins: reports, limits: 'Metadata and selection only; no vulnerability scan, downloads, or host activation check.' }, null, 2));
    else {
      for (const report of reports) info(`${report.id}@${report.version}: ${report.enabled ? 'included in export' : 'disabled in export'}; latest ${report.latest ?? 'not checked'}; host activation unverified${report.error ? `; ${report.error}` : ''}`);
      info(`${reports.length} pinned plugin(s). Use plugins check --online to check registry releases; use plugins export --agent <host> to review configuration.`);
    }
    if (failed) process.exitCode = 1;
    return;
  }
  if (!id) throw new WondevError('Usage: wondev plugins catalog|info|pin|enable|disable|remove|status|check|export');
  const entry = catalogPlugin(id);
  if (entry.kind === 'bundled-skill' && action === 'install') { await runBundledInstall(root, id, options); return; }
  if (entry.kind === 'bundled-skill' && (action === 'enable' || action === 'disable')) { await runSelection(root, action, id, options); return; }
  if (!['pin', 'enable', 'disable', 'remove'].includes(action)) throw new WondevError('Use plugins pin <id> [--plugin-version <exact>] for MCP selections, or plugins install <id> for bundled skills.');
  const lock = await changePlugin(root, id, action as 'pin' | 'enable' | 'disable' | 'remove', options);
  if (options.json) info(JSON.stringify(lock, null, 2));
  else info(`${options.dryRun ? 'Would change' : 'Changed'} project plugin selection: ${action} ${id}. Host installation and activation are unchanged; export and apply the reviewed configuration in your host. New pins start disabled.`);
}

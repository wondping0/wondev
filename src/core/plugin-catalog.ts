import path from 'node:path';
import { BASE_SKILLS } from './base-skills.js';
import { loadConfig } from './config.js';
import { createRootGuard } from '../util/paths.js';
import { readFileIfExists, writeFileAtomic } from '../util/fs.js';
import { withProjectLock } from '../util/lock.js';
import { WondevError } from '../util/errors.js';

export interface CatalogPlugin {
  id: string;
  kind: 'bundled-skill' | 'mcp-server';
  purpose: string;
  source: string;
  documentation: string;
  checkedAt: string;
  assessment: string;
  access: string[];
  requires: string;
  package?: string;
  version?: string;
  integrity?: string;
  license?: string;
  args?: string[];
  environment?: string[];
}
const assessment = 'Source identity and integration metadata checked; not a security audit, vulnerability scan, or guarantee of safety.';
export const PLUGIN_CATALOG: CatalogPlugin[] = [
  ...BASE_SKILLS.map((skill): CatalogPlugin => ({ id: skill.name, kind: 'bundled-skill', purpose: `${skill.name}: ${skill.kind}`, source: skill.source, documentation: 'https://github.com/wondping0/wondev/blob/main/docs/base-skills.md', checkedAt: '2026-10-22', assessment,
    access: ['Agent project permissions; read the procedure and resources before executing them'], requires: skill.requires })),
  { id: 'playwright', kind: 'mcp-server', purpose: 'Browser interaction and UI verification', source: 'https://github.com/microsoft/playwright-mcp', documentation: 'https://github.com/microsoft/playwright-mcp#readme', checkedAt: '2026-10-22', assessment,
    access: ['Runs local code and a browser', 'Visits websites and can submit forms or upload data when instructed', 'Browser output may contain untrusted content; isolated profile is not a security sandbox'], requires: 'Node 18+ and an installed supported browser', package: '@playwright/mcp', version: '0.0.83', license: 'Apache-2.0',
    integrity: 'sha512-oNcl+Ae2/IAjhfPeP46BfIkSakfmprY+aOtkv5MjrQ4lPav4/yNtPhL0iq8SlIM90oApWgBDUxaNKvktazUKOg==', args: ['--isolated'] },
  { id: 'context7', kind: 'mcp-server', purpose: 'Retrieve current library documentation', source: 'https://github.com/upstash/context7', documentation: 'https://context7.com/docs/resources/all-clients', checkedAt: '2026-10-22', assessment,
    access: ['Runs local code', 'Sends documentation queries to Context7; avoid secrets and private source in queries', 'Retrieved documentation is external content'], requires: 'Node 20.18.1+; CONTEXT7_API_KEY for authenticated access', package: '@upstash/context7-mcp', version: '4.4.4', license: 'MIT',
    integrity: 'sha512-T2DkjhweDnC2mRAclDiTrPG3KI1zYKhhjgY2SMKD9PVrbEaGD8x35VsIOqpwwDc2qiKBvfYCF/jqr+jQMu5PUA==', environment: ['CONTEXT7_API_KEY'] },
];
export const PLUGIN_LOCK = '.wondev/plugins.lock.json';
export interface PluginPin { package: string; version: string; integrity: string; source: string; enabled: boolean; metadataCheckedAt: string }
export interface PluginLock { version: 1; plugins: Record<string, PluginPin> }
export const EXACT_PLUGIN_VERSION = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[a-zA-Z\d]+(?:[.-][a-zA-Z\d]+)*)?$/;
const INTEGRITY = /^sha512-[a-zA-Z\d+/]{86}==$/;

export function catalogPlugin(id: string): CatalogPlugin {
  const entry = PLUGIN_CATALOG.find((plugin) => plugin.id === id);
  if (!entry) throw new WondevError(`Unknown catalog plugin: ${id}`, 'Run wondev plugins catalog.');
  return entry;
}

export async function loadPluginLock(root: string): Promise<PluginLock> {
  await createRootGuard(root)(PLUGIN_LOCK);
  const raw = await readFileIfExists(path.join(root, PLUGIN_LOCK));
  if (raw === null) return { version: 1, plugins: {} };
  try {
    const lock = JSON.parse(raw) as PluginLock;
    if (!lock || lock.version !== 1 || !lock.plugins || typeof lock.plugins !== 'object' || Array.isArray(lock.plugins)) throw new Error();
    for (const [id, pin] of Object.entries(lock.plugins)) {
      const entry = catalogPlugin(id);
      if (!pin || entry.kind !== 'mcp-server' || pin.package !== entry.package || pin.source !== entry.source || !EXACT_PLUGIN_VERSION.test(pin.version) || !INTEGRITY.test(pin.integrity) || typeof pin.enabled !== 'boolean' || !/^\d{4}-\d{2}-\d{2}$/.test(pin.metadataCheckedAt)) throw new Error();
    }
    return lock;
  } catch { throw new WondevError(`${PLUGIN_LOCK} is invalid. Restore the lock before exporting or changing plugins.`); }
}

/** Only explicit online commands query fixed official registry endpoints. Never executes code. */
export async function pluginRelease(entry: CatalogPlugin, version = 'latest', fetcher: typeof fetch = fetch): Promise<{ version: string; integrity: string; source: string }> {
  if (!entry.package || (version !== 'latest' && !EXACT_PLUGIN_VERSION.test(version))) throw new WondevError('A catalog MCP package and exact version are required.');
  const response = await fetcher(`https://registry.npmjs.org/${encodeURIComponent(entry.package)}/${version}`, { redirect: 'error', signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new WondevError(`Cannot check ${entry.id}: registry HTTP ${response.status}.`);
  if (Number(response.headers.get('content-length')) > 2_000_000) throw new WondevError('Plugin registry metadata exceeds 2 MB.');
  let raw = '';
  const reader = response.body?.getReader();
  if (!reader) throw new WondevError('Plugin registry returned no metadata.');
  let size = 0;
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 2_000_000) throw new WondevError('Plugin registry metadata exceeds 2 MB.');
      raw += decoder.decode(value, { stream: true });
    }
  } finally { await reader.cancel(); }
  raw += decoder.decode();
  let data: { name?: string; version?: string; repository?: { url?: string }; dist?: { integrity?: string }; deprecated?: unknown };
  try { data = JSON.parse(raw) as typeof data; } catch { throw new WondevError('Plugin registry returned invalid JSON.'); }
  const source = data?.repository?.url?.replace(/^git\+/, '').replace(/\.git$/, '');
  if (!data || data.name !== entry.package || !data.version || !EXACT_PLUGIN_VERSION.test(data.version) || (version !== 'latest' && data.version !== version) || !data.dist?.integrity || !INTEGRITY.test(data.dist.integrity) || source?.toLowerCase() !== entry.source.toLowerCase() || data.deprecated) throw new WondevError(`Unverified or deprecated registry metadata for ${entry.id}; identity, version, repository and SHA-512 integrity must match.`);
  return { version: data.version, integrity: data.dist.integrity, source: entry.source };
}

export async function changePlugin(root: string, id: string, action: 'pin' | 'enable' | 'disable' | 'remove', options: { version?: string; dryRun?: boolean } = {}): Promise<PluginLock> {
  const entry = catalogPlugin(id);
  if (entry.kind !== 'mcp-server') throw new WondevError(`Use wondev skills install bundled:${id}, then skills enable|disable ${id}.`);
  if (options.version !== undefined && !EXACT_PLUGIN_VERSION.test(options.version)) throw new WondevError('Plugin pins require an exact version, never latest or a range.');
  await loadConfig(root);
  // Fetch before taking the project lock, then read current state under the lock.
  const release = action === 'pin' && options.version ? await pluginRelease(entry, options.version) : undefined;
  const execute = async (): Promise<PluginLock> => {
    const lock = await loadPluginLock(root);
    if (action === 'pin') {
      // Repeating a snapshot pin must not silently downgrade an explicitly selected version.
      if (release || !Object.hasOwn(lock.plugins, id)) lock.plugins[id] = { package: entry.package!, version: release?.version ?? entry.version!, integrity: release?.integrity ?? entry.integrity!, source: entry.source, enabled: lock.plugins[id]?.enabled ?? false, metadataCheckedAt: release ? new Date().toISOString().slice(0, 10) : entry.checkedAt };
    }
    else {
      if (!Object.hasOwn(lock.plugins, id)) throw new WondevError(`Plugin is not pinned: ${id}`, `Run wondev plugins pin ${id}.`);
      if (action === 'remove') delete lock.plugins[id];
      else lock.plugins[id]!.enabled = action === 'enable';
    }
    if (!options.dryRun) await writeFileAtomic(path.join(root, PLUGIN_LOCK), `${JSON.stringify(lock, null, 2)}\n`);
    return lock;
  };
  return options.dryRun ? execute() : withProjectLock(root, execute);
}

/** Export a reviewable snippet; host configuration and running sessions are never mutated. */
export function exportPlugins(lock: PluginLock, agent: string, platform: NodeJS.Platform = process.platform): string {
  if (!['codex', 'agents', 'claude', 'generic'].includes(agent)) throw new WondevError('Plugin export supports codex, claude, or generic MCP JSON.');
  const entries = Object.entries(lock.plugins).filter(([, pin]) => pin.enabled).sort(([a], [b]) => a.localeCompare(b)).map(([id, pin]) => {
    const plugin = catalogPlugin(id);
    const args = ['--yes', '--ignore-scripts', `${pin.package}@${pin.version}`, ...(plugin.args ?? [])];
    return { id, command: platform === 'win32' ? 'cmd' : 'npx', args: platform === 'win32' ? ['/d', '/c', 'npx', ...args] : args, environment: plugin.environment ?? [] };
  });
  if (agent === 'codex' || agent === 'agents') return entries.map((entry) => [`[mcp_servers.${entry.id}]`, `command = ${JSON.stringify(entry.command)}`, `args = ${JSON.stringify(entry.args)}`, ...(entry.environment.length ? [`env_vars = ${JSON.stringify(entry.environment)}`] : [])].join('\n')).join('\n\n') + '\n';
  return `${JSON.stringify({ mcpServers: Object.fromEntries(entries.map((entry) => [entry.id, { command: entry.command, args: entry.args }])) }, null, 2)}\n`;
}

import path from 'node:path';
import fs from 'node:fs/promises';
import { parseDocument } from 'yaml';
import { BASE_SKILLS } from '../core/base-skills.js';
import { canonicalAgent, detectAgent, pythonRuntime, understandRuntime } from '../core/agent-environment.js';
import { configPath, loadConfig, resolveTargets } from '../core/config.js';
import { BUILTIN_TARGETS, targetCapabilities } from '../core/registry.js';
import { loadProject } from '../core/source.js';
import { matchesPatterns } from '../core/matching.js';
import { conflictsIn, describeConflicts, loadManifest, planWrites, applyPlan, extractRegion } from '../core/writer.js';
import { withProjectLock } from '../util/lock.js';
import { normalizeEol, sha256, writeFileAtomic } from '../util/fs.js';
import { createRootGuard } from '../util/paths.js';
import { WondevError } from '../util/errors.js';
import { info } from '../util/log.js';
import { loadContext } from './context.js';
import { projectOutput } from './output.js';

export async function inspectAgent(root: string, options: { agent?: string; profile?: string; env?: NodeJS.ProcessEnv; python?: () => Promise<string | null> } = {}) {
  const ctx = await loadContext(root, options.profile);
  const detected = detectAgent(options.env, options.agent);
  const canonical = detected.agent ? canonicalAgent(detected.agent, ctx.config.customTargets) : undefined;
  if (canonical && !Object.hasOwn(ctx.config.customTargets, canonical) && !Object.hasOwn(BUILTIN_TARGETS, canonical)) {
    throw new WondevError(`Unknown agent target: ${detected.agent}`, 'Run `wondev targets`, or define a documented customTargets entry.');
  }
  const loaded = await loadProject(root, ctx.config.name, ctx.config.sources, ctx.config.vault);
  const active = new Set(ctx.project.skills.map((s) => s.name));
  const python = active.has('ui-ux-pro-max') || active.has('webapp-testing') ? await (options.python ?? pythonRuntime)() : null;
  const upstream = active.has('understand-anything') ? await understandRuntime(root, options.env) : undefined;
  const { files, owners } = await projectOutput(ctx, ctx.targets);
  const manifest = await loadManifest(root);
  const plan = await planWrites(root, files, owners, manifest);
  const expected = new Set(files.map((f) => f.path));
  const retired = Object.keys(manifest.files).filter((p) => !expected.has(p));
  const plugins: { path: string; status: string }[] = [];
  for (const rel of ['.claude-plugin/plugin.json', '.codex-plugin/plugin.json', 'plugin.json']) {
    await createRootGuard(root)(rel);
    try {
      const raw = await fs.readFile(path.join(root, rel), 'utf8');
      try {
        const value = JSON.parse(raw) as { name?: unknown } | null;
        plugins.push({ path: rel, status: typeof value?.name === 'string' ? 'manifest-present; activation-unverified' : 'invalid-manifest' });
      } catch { plugins.push({ path: rel, status: 'invalid-json' }); }
    } catch (err) { if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err; }
  }
  const configured = canonical ? ctx.targets.some((t) => t.name === canonical) : false;
  const pluginDelivery = !configured && (canonical === 'claude' || canonical === 'agents') && ctx.targets.some((t) => t.target.engine === 'skill-plugin');
  return {
    currentAgent: { ...detected, canonical, enabled: configured ? true : !canonical || pluginDelivery ? null : false,
      delivery: pluginDelivery ? 'plugin-package; activation-unverified' : configured ? 'configured-target' : canonical ? 'not-configured' : 'unknown' },
    profile: options.profile ?? ctx.config.profile ?? null,
    targets: ctx.targets.map((t) => ({ name: t.name, ...targetCapabilities(t.target) })),
    rules: ctx.project.memory.filter((m) => !m.status || m.status === 'active').map((m) => ({ path: m.sourcePath, always: m.always, globs: m.globs ?? [] })),
    skills: loaded.project.skills.map((s) => ({ name: s.name, path: s.sourcePath,
      status: active.has(s.name) ? 'enabled' : ctx.config.disabledSkills?.includes(s.name) ? 'disabled' : 'outside-profile',
      requires: BASE_SKILLS.find((base) => base.name === s.name)?.requires ?? s.frontmatter?.['compatibility'] ?? 'See skill instructions',
    })),
    prerequisites: { python, understandAnything: upstream, browser: active.has('webapp-testing') ? 'not-probed; verify project runner, Playwright and browser before testing' : undefined },
    output: { changes: plan.filter((p) => p.action !== 'unchanged' || p.conflict).map((p) => ({ path: p.path, action: p.action, conflict: p.conflict })), retired },
    plugins, issues: ctx.issues,
    limits: 'Environment hints do not prove host identity. Manifests do not prove plugin activation. Global plugins, entitlements and semantic rule conflicts are not inspected.',
  };
}

export async function runAgentCheck(root: string, options: { agent?: string; profile?: string; json?: boolean } = {}): Promise<void> {
  const report = await inspectAgent(root, options);
  if (options.json) info(JSON.stringify(report, null, 2));
  else {
    const current = report.currentAgent;
    info(`Current agent: ${current.agent ?? 'unknown or ambiguous; use --agent <target>'} (${current.evidence.join(', ') || 'no environment hints'})`);
    if (current.agent && current.enabled === false) info(`Target is not enabled. Use: wondev agent use ${current.agent}`);
    if (current.delivery.startsWith('plugin-package')) info('A compatible plugin package is configured. Activate it in the host; activation is not verified by this check.');
    info(`Profile: ${report.profile ?? 'all'}; targets: ${report.targets.map((t) => `${t.name} [${t.skills}]`).join(', ')}`);
    info(`Rules: ${report.rules.length}; output changes: ${report.output.changes.length}; retired files: ${report.output.retired.length}`);
    for (const rule of report.rules) info(`  rule ${rule.path}: ${rule.always ? 'always' : 'on demand'}${rule.globs.length ? `; paths ${rule.globs.join(', ')}` : ''}`);
    for (const skill of report.skills) info(`  ${skill.status.padEnd(15)} ${skill.name}: ${skill.requires}`);
    if (report.skills.some((s) => s.status === 'enabled' && ['ui-ux-pro-max', 'webapp-testing'].includes(s.name))) info(`Python: ${report.prerequisites.python ?? 'missing; install Python 3 for the bundled scripts'}`);
    if (report.prerequisites.understandAnything) info(`Understand Anything: ${report.prerequisites.understandAnything.status}; wondev skills info understand-anything shows setup instructions.`);
    if (report.prerequisites.browser) info(`Browser: ${report.prerequisites.browser}`);
    for (const plugin of report.plugins) info(`Plugin ${plugin.path}: ${plugin.status}`);
    for (const change of report.output.changes) info(`  ${change.conflict ?? change.action} ${change.path}`);
    for (const issue of report.issues) info(`${issue.level}: ${issue.file}: ${issue.message}`);
    info('Change selection: wondev skills enable|disable <name>; wondev skills use <profile>; wondev agent use <target>.');
    info(report.limits);
  }
  if (report.issues.some((i) => i.level === 'error') || report.output.changes.length || report.output.retired.length || report.currentAgent.enabled === false || report.plugins.some((p) => p.status.startsWith('invalid'))) {
    process.exitCode = 1;
  }
}

/** Change selections and output under the same project lock. Preflight conflicts first. */
export async function runSelection(root: string, action: 'agent' | 'enable' | 'disable' | 'profile', name: string, options: { dryRun?: boolean; noBuild?: boolean } = {}): Promise<void> {
  await loadConfig(root);
  const change = async (): Promise<void> => {
    const ctx = await loadContext(root);
    const raw = await fs.readFile(configPath(root), 'utf8');
    const doc = parseDocument(raw);
    const { project, issues } = await loadProject(root, ctx.config.name, ctx.config.sources, ctx.config.vault);
    if (issues.some((i) => i.level === 'error')) throw new WondevError('Fix source errors before changing agent or skill selection.');
    if (action === 'agent') {
      const canonical = canonicalAgent(name, ctx.config.customTargets);
      if (!Object.hasOwn(ctx.config.customTargets, canonical) && !Object.hasOwn(BUILTIN_TARGETS, canonical)) throw new WondevError(`Unknown agent target: ${name}`);
      ctx.config.targets = [canonical]; doc.set('targets', [canonical]);
    } else if (action === 'profile') {
      if (name === '*') { delete ctx.config.profile; doc.delete('profile'); }
      else {
        if (!Object.hasOwn(ctx.config.profiles ?? {}, name)) throw new WondevError(`Unknown profile: ${name}`);
        ctx.config.profile = name; doc.set('profile', name);
      }
    } else {
      if (!project.skills.some((s) => s.name === name)) throw new WondevError(`Unknown project skill: ${name}`);
      const disabled = new Set(ctx.config.disabledSkills ?? []);
      if (action === 'disable') disabled.add(name); else disabled.delete(name);
      ctx.config.disabledSkills = [...disabled].sort(); doc.set('disabledSkills', ctx.config.disabledSkills);
    }
    const profile = ctx.config.profile ? ctx.config.profiles![ctx.config.profile] : undefined;
    project.skills = project.skills.filter((s) => !ctx.config.disabledSkills?.includes(s.name) && (!profile || matchesPatterns(s.name, profile.skills)));
    project.contextEnabled = ctx.project.contextEnabled;
    ctx.project = project; ctx.targets = resolveTargets(ctx.config);
    const { files, owners } = await projectOutput(ctx, ctx.targets);
    const manifest = await loadManifest(root);
    const plan = await planWrites(root, files, owners, manifest);
    const conflicts = conflictsIn(plan);
    if (conflicts.length && !options.noBuild) throw describeConflicts(conflicts);
    // Switching must not delete hand edits in a generated file that becomes inactive.
    const wanted = new Set(files.map((file) => file.path));
    if (!options.noBuild) for (const [rel, entry] of Object.entries(manifest.files)) {
      if (wanted.has(rel)) continue;
      await createRootGuard(root)(rel);
      const bytes = await fs.readFile(path.join(root, rel)).catch((err: NodeJS.ErrnoException) => {
        if (err.code === 'ENOENT') return null;
        throw err;
      });
      if (!bytes) continue;
      const normalized = normalizeEol(bytes.toString('utf8'));
      const owned = entry.mode === 'region' ? extractRegion(normalized) : normalized;
      if (owned !== null && sha256(owned) !== entry.hash && (entry.mode !== 'whole' || sha256(bytes) !== entry.hash)) {
        throw new WondevError(`Refusing to retire edited output: ${rel}`, 'Move the edits into the configured sources and rebuild before changing selection.');
      }
    }
    info(`${options.dryRun ? 'Would select' : 'Selected'} ${action}: ${name === '*' ? 'all profiles cleared' : name}; ${project.skills.length} active skill(s); targets: ${ctx.config.targets.join(', ')}`);
    if (action === 'enable' && !project.skills.some((s) => s.name === name)) info(`Skill remains outside profile ${ctx.config.profile}; use another profile or wondev skills use --all.`);
    if (options.dryRun) return;
    if (await fs.readFile(configPath(root), 'utf8') !== raw) throw new WondevError('Config changed during selection; retry.');
    if (!options.noBuild) await applyPlan(root, plan, manifest);
    await writeFileAtomic(configPath(root), doc.toString({ lineWidth: 0 }));
    if (options.noBuild) info('Generated output is unchanged. Run `wondev build` to apply this selection.');
  };
  if (options.dryRun) await change(); else await withProjectLock(root, change);
}

import fs from 'node:fs/promises';
import path from 'node:path';
import { BASE_SKILLS } from '../core/base-skills.js';
import { loadConfig, sourceDirectory, sourceFile } from '../core/config.js';
import { hashTemplateFile, listTemplateFiles, loadTemplateManifest, saveTemplateManifest, templatesDir, templateSourceFile, TEMPLATES_REL, type TemplateManifest } from '../core/templates.js';
import { createRootGuard } from '../util/paths.js';
import { normalizeEol, pathExists, writeFileAtomicExclusive } from '../util/fs.js';
import { withProjectLock } from '../util/lock.js';
import { wondevVersion } from '../util/version.js';
import { WondevError } from '../util/errors.js';
import { info } from '../util/log.js';
import { runBuild } from './build.js';

/** Add only explicitly selected bundled skills, including in projects created by adopt. */
export async function runBundledInstall(root: string, name: string, options: { dryRun?: boolean; noBuild?: boolean } = {}): Promise<void> {
  const names = name === 'all' ? BASE_SKILLS.map((skill) => skill.name) : [name];
  if (names.some((n) => !BASE_SKILLS.some((skill) => skill.name === n))) throw new WondevError(`Unknown bundled skill: ${name}`, 'Run wondev skills catalog.');
  const execute = async (): Promise<void> => {
    const config = await loadConfig(root);
    const guard = createRootGuard(root);
    await guard(TEMPLATES_REL);
    const previous = await loadTemplateManifest(root);
    if (!previous && await pathExists(path.join(root, TEMPLATES_REL))) throw new WondevError('Starter provenance is invalid. Restore .wondev/.templates.json before installing bundled skills.');
    const manifest: TemplateManifest = previous ?? { version: wondevVersion(), files: {}, scope: [] };
    const directory = templatesDir();
    const selected = (await listTemplateFiles(directory)).filter((rel) => names.some((n) => rel.startsWith(`skills/${n}/`)));
    const plan: Array<{ rel: string; target: string; bytes: Buffer; exists: boolean }> = [];
    for (const n of names) {
      const flat = `${sourceDirectory('skills', config.sources)}/${n}.md`;
      await guard(flat);
      if (await pathExists(path.join(root, flat))) throw new WondevError(`A project skill already uses this name: ${n}`, 'Rename the existing skill or select another bundled skill.');
    }
    for (const rel of selected) {
      const target = sourceFile(rel, config.sources);
      await guard(target);
      const bytes = await fs.readFile(templateSourceFile(directory, rel));
      const existing = await fs.readFile(path.join(root, target)).catch((err: NodeJS.ErrnoException) => { if (err.code === 'ENOENT') return null; throw err; });
      if (existing && !existing.equals(bytes) && !(rel.endsWith('.md') && normalizeEol(existing.toString('utf8')) === normalizeEol(bytes.toString('utf8')))) {
        throw new WondevError(`Bundled skill would overwrite an existing file: ${target}`, 'Keep your skill; use wondev upgrade --only skills/<name> if its starter provenance is already tracked.');
      }
      plan.push({ rel, target, bytes, exists: existing !== null });
    }
    info(`${options.dryRun ? 'Would install' : 'Installing'} bundled skills: ${names.join(', ')}; ${plan.filter((p) => !p.exists).length} new file(s).`);
    if (options.dryRun) return;
    for (const item of plan) {
      if (!item.exists) {
        await writeFileAtomicExclusive(path.join(root, item.target), item.bytes);
        if (process.platform !== 'win32' && ((await fs.stat(templateSourceFile(directory, item.rel))).mode & 0o111)) await fs.chmod(path.join(root, item.target), 0o755);
      }
      manifest.files[item.rel] = { hash: await hashTemplateFile(directory, item.rel), from: wondevVersion() };
    }
    if (manifest.scope) manifest.scope = [...new Set([...manifest.scope, ...names.map((n) => `skills/${n}`)])].sort();
    manifest.version = wondevVersion();
    await saveTemplateManifest(root, manifest);
  };
  if (options.dryRun) await execute(); else await withProjectLock(root, execute);
  if (!options.dryRun && !options.noBuild) await runBuild(root);
}

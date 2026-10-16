import fs from 'node:fs/promises';
import path from 'node:path';
import { parseDocument, stringify } from 'yaml';
import { configPath, loadConfig, projectDirectory, readSources, sourceDirectory, SOURCE_KINDS } from '../core/config.js';
import { stringifyFrontmatter } from '../core/frontmatter.js';
import { createRootGuard } from '../util/paths.js';
import { pathExists, writeFileAtomic } from '../util/fs.js';
import { WondevError } from '../util/errors.js';
import { success } from '../util/log.js';
import { withProjectLock } from '../util/lock.js';

/** Move canonical source directories once; subsequent edits happen directly in the vault. */
export async function runVault(root: string, directory = 'knowledge', dryRun = false): Promise<void> {
  await loadConfig(root);
  if (dryRun) return vaultLocked(root, directory, true);
  return withProjectLock(root, () => vaultLocked(root, directory, false));
}

async function vaultLocked(root: string, directory: string, dryRun: boolean): Promise<void> {
  const vault = projectDirectory(directory, 'vault');
  const config = await loadConfig(root);
  if (config.vault) throw new WondevError(`A vault is already configured at ${config.vault}.`);
  const guard = createRootGuard(root);
  await guard(`${vault}/index.md`);
  if (await pathExists(path.join(root, vault))) {
    throw new WondevError(`${vault} already exists.`, 'To use an existing vault, configure sources and vault in wondev.yaml.');
  }
  const sources = readSources(Object.fromEntries(SOURCE_KINDS.map((kind) => [kind, `${vault}/${kind}`])));
  const moves = SOURCE_KINDS.map((kind) => ({ from: sourceDirectory(kind, config.sources), to: sources[kind]! }));
  for (const move of moves) {
    await guard(`${move.from}/.source-check`);
    if (vault === move.from || vault.startsWith(`${move.from}/`) || move.from.startsWith(`${vault}/`)) {
      throw new WondevError(`Vault destination overlaps a source directory: ${move.from}`);
    }
  }
  if (dryRun) { success(`Would move sources to ${vault} and create Obsidian templates and dashboards.`); return; }

  await fs.mkdir(path.join(root, vault), { recursive: true });
  const completed: typeof moves = [];
  try {
    for (const move of moves) {
      if (await pathExists(path.join(root, move.from))) {
        await fs.rename(path.join(root, move.from), path.join(root, move.to));
        completed.push(move);
      } else await fs.mkdir(path.join(root, move.to), { recursive: true });
    }
    for (const [rel, content] of Object.entries(vaultScaffold())) {
      await writeFileAtomic(path.join(root, vault, rel), content);
    }
    const doc = parseDocument(await fs.readFile(configPath(root), 'utf8'));
    doc.set('vault', vault);
    doc.set('sources', sources);
    doc.set('index', { ...config.index, file: `${vault}/index.md`, columns: config.index?.columns ?? [{ key: 'owner', label: 'Owner' }] });
    await writeFileAtomic(configPath(root), doc.toString({ lineWidth: 0 }));
  } catch (err) {
    // Restore moved authored directories if setup fails before the config is committed.
    for (const move of completed.reverse()) await fs.rename(path.join(root, move.to), path.join(root, move.from));
    throw err;
  }
  success(`Vault ready at ${vault}. Open this folder in Obsidian; run wondev build to refresh agent output.`);
}

export function vaultScaffold(): Record<string, string> {
  const files: Record<string, string> = {
    '.gitignore': '.obsidian/workspace*.json\n.obsidian/cache/\n',
    'index.md': '# Project knowledge\n\nEdit memory and skills here. The index below is maintained by wondev.\n\nOpen [[dashboards/project.base]] to browse modules and decisions, and [[review]] for evidence changes detected by the last build.\nUse `wondev memory stale` for a live check.\n',
    '.obsidian/templates.json': `${JSON.stringify({ folder: 'templates' }, null, 2)}\n`,
    'dashboards/project.base': stringify({
      filters: { and: ['file.inFolder("memory")', 'file.ext == "md"'] },
      views: [
        { type: 'table', name: 'Project memory', order: ['file.name', 'kind', 'status', 'verified', 'owner'] },
        { type: 'table', name: 'Modules', filters: 'kind == "module"', order: ['file.name', 'related', 'evidence'] },
        { type: 'table', name: 'Decisions', filters: 'kind == "decision"', order: ['file.name', 'status', 'verified'] },
        { type: 'table', name: 'Needs verification', filters: '!verified && status != "archived"', order: ['file.name', 'kind', 'evidence'] },
      ],
    }),
  };
  const sections: Record<string, string[]> = {
    module: ['Responsibility', 'Entry points and important files', 'Dependencies and consumers', 'Invariants', 'Decisions and rejected alternatives', 'Verification'],
    flow: ['Trigger and outcome', 'Steps across modules', 'Contracts and failure handling', 'Related decisions', 'Verification'],
    decision: ['Context', 'Decision', 'Alternatives tried and rejected', 'Consequences', 'Evidence and verification'],
    runbook: ['When to use', 'Prerequisites', 'Procedure', 'Expected result', 'Recovery and verification'],
  };
  for (const [kind, headings] of Object.entries(sections)) {
    files[`templates/${kind}.md`] = stringifyFrontmatter({
      title: '{{title}}', kind, status: 'draft', description: 'Read when ...',
      always: false, related: [], evidence: [],
    }, `# {{title}}\n\nAssign a unique stable id before activating this note. Paths in evidence are relative to the application repository.\n\n${headings.map((h) => `## ${h}\n\n`).join('')}`);
  }
  return files;
}

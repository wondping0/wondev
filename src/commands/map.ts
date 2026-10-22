import fs from 'node:fs/promises';
import path from 'node:path';
import { loadContext } from './context.js';
import { runBuild } from './build.js';
import { applicationMapNotes, scanApplication, MAP_START, MAP_END } from '../core/application-map.js';
import { sourceDirectory } from '../core/config.js';
import { parseMemoryDoc, hasErrors, type Issue } from '../core/source.js';
import { memoryLinkIssues } from '../core/links.js';
import { createRootGuard } from '../util/paths.js';
import { normalizeEol, readFileIfExists, sha256, writeFileAtomic, writeFileAtomicExclusive } from '../util/fs.js';
import { withProjectLock } from '../util/lock.js';
import { WondevError } from '../util/errors.js';
import { info } from '../util/log.js';

const STATE = '.wondev/.map.json';
interface MapState { version: 1; notes: Record<string, { hash: string; observed: string }> }
export interface MapOptions { dryRun?: boolean; noBuild?: boolean; exclude?: string[]; json?: boolean }

function region(raw: string): { start: number; end: number; text: string } {
  const start = raw.indexOf(MAP_START);
  const end = raw.indexOf(MAP_END) + MAP_END.length;
  if (start < 0 || end < start || raw.indexOf(MAP_START, start + 1) >= 0 || raw.indexOf(MAP_END, end) >= 0) throw new WondevError('Application map markers are missing or duplicated. Restore the generated region from version control.');
  return { start, end, text: raw.slice(start, end) };
}

export async function runMap(root: string, options: MapOptions = {}): Promise<void> {
  const execute = async (): Promise<void> => {
    const ctx = await loadContext(root);
    if (hasErrors(ctx.issues)) throw new WondevError('Fix source validation errors before mapping the application.');
    const guard = createRootGuard(root);
    await guard(STATE);
    await guard('.wondev/map-coverage.json');
    const rawState = await readFileIfExists(path.join(root, STATE));
    let state: MapState = { version: 1, notes: {} };
    if (rawState !== null) {
      try {
        state = JSON.parse(rawState) as MapState;
        if (!state || state.version !== 1 || !state.notes || typeof state.notes !== 'object' || Array.isArray(state.notes) || Object.entries(state.notes).some(([id, entry]) => !/^map-(?:module|package)-[a-f0-9]{12}$/.test(id) || !entry || typeof entry.observed !== 'string' || entry.hash !== sha256(entry.observed))) throw new Error();
      } catch { throw new WondevError(`${STATE} is invalid. Restore it from version control.`); }
    }
    const map = await scanApplication(root, ctx.config, options.exclude);
    const notes = applicationMapNotes(map, ctx.config, Object.fromEntries(ctx.project.memory.filter((doc) => doc.id).map((doc) => [doc.id!, doc.sourcePath])));
    for (const [id, previous] of Object.entries(state.notes)) {
      if (!notes.some((note) => note.id === id)) notes.push({ id, slug: `map/${id}`, content: '', observed: `${MAP_START}\nThis module or package is no longer in the application scan. Check exclusions or removal, then review and archive this note if appropriate.\n${MAP_END}` });
      // Validate all baselines even if the corresponding note has disappeared.
      region(previous.observed);
    }
    const plan: Array<{ path: string; before: string | null; content: string }> = [];
    const prospective = [...ctx.project.memory];
    const issues: Issue[] = [];
    for (const note of notes) {
      const existing = ctx.project.memory.find((doc) => doc.id === note.id);
      const rel = existing?.sourcePath ?? `${sourceDirectory('memory', ctx.config.sources)}/${note.slug}.md`;
      await guard(rel);
      const before = await readFileIfExists(path.join(root, rel));
      const previous = Object.hasOwn(state.notes, note.id) ? state.notes[note.id] : undefined;
      let content = note.content;
      if (before !== null) {
        const current = region(before);
        if ((!previous && normalizeEol(before) !== note.content) || (previous && sha256(normalizeEol(current.text)) !== previous.hash && normalizeEol(current.text) !== note.observed)) throw new WondevError(`Generated application map was edited: ${rel}`, 'Move your changes into Curated understanding and restore the generated region before refreshing.');
        content = before.slice(0, current.start) + note.observed + before.slice(current.end);
      } else if (!content) continue;
      const parsed = parseMemoryDoc(content, existing?.slug ?? note.slug, rel, issues, ctx.config.vault);
      if (parsed.id !== note.id) throw new WondevError(`Application map identity changed: ${rel}`);
      const index = prospective.findIndex((doc) => doc.sourcePath === rel);
      if (index < 0) prospective.push(parsed); else prospective[index] = parsed;
      plan.push({ path: rel, before, content });
      state.notes[note.id] = { hash: sha256(note.observed), observed: note.observed };
    }
    issues.push(...memoryLinkIssues(prospective));
    if (hasErrors(issues)) throw new WondevError(`Invalid application map:\n${issues.map((i) => i.message).join('\n')}`);
    const changed = plan.filter((item) => item.before !== item.content);
    if (options.json) info(JSON.stringify({ dryRun: !!options.dryRun, notes: changed.map((p) => p.path), coverage: map.coverage, warnings: map.warnings }, null, 2));
    else {
      for (const warning of map.warnings) info(`Parse warning: ${warning}`);
      info(`${options.dryRun ? 'Would refresh' : 'Refreshing'} ${changed.length} map note(s); ${map.files.length} JS/TS files, ${map.packages.length} package(s).`);
      for (const service of map.coverage!.services) info(`  ${service.name} (${service.root}): ${service.parsed} parsed, ${service.parseErrors} parse errors, ${service.unsupported} unsupported source file(s).`);
      info(`Coverage: ${map.coverage!.unresolvedImports} external/unresolved imports; details in .wondev/map-coverage.json after refresh.`);
      for (const limit of map.coverage!.limits) info(limit);
    }
    if (options.dryRun) return;
    // Check the complete plan before touching any notes; individual writes also recheck.
    for (const item of plan) if (await readFileIfExists(path.join(root, item.path)) !== item.before) throw new WondevError(`Application map source changed during scan: ${item.path}`);
    for (const item of changed) {
      await guard(item.path);
      if (await readFileIfExists(path.join(root, item.path)) !== item.before) throw new WondevError(`Application map source changed during refresh: ${item.path}`);
      if (item.before === null) await writeFileAtomicExclusive(path.join(root, item.path), item.content);
      else await writeFileAtomic(path.join(root, item.path), item.content);
    }
    await writeFileAtomic(path.join(root, STATE), `${JSON.stringify(state, null, 2)}\n`);
    await writeFileAtomic(path.join(root, '.wondev/map-coverage.json'), `${JSON.stringify(map.coverage, null, 2)}\n`);
  };
  if (options.dryRun) await execute(); else await withProjectLock(root, execute);
  if (!options.dryRun && !options.noBuild) await runBuild(root, { quiet: options.json });
}

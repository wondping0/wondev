import fs from 'node:fs/promises';
import path from 'node:path';
import { parseDocument } from 'yaml';
import { loadContext } from './context.js';
import { evidenceFiles, fingerprint, inspectFreshness, loadMemoryState, memoryHash, memoryId, saveMemoryState, currentNoteHash } from '../core/freshness.js';
import { parseNoteLink, resolveNote } from '../core/links.js';
import { loadProject, hasErrors } from '../core/source.js';
import { withProjectLock } from '../util/lock.js';
import { writeFileAtomic } from '../util/fs.js';
import { WondevError } from '../util/errors.js';
import { info, success } from '../util/log.js';

export async function runMemoryVerify(root: string, name: string, against: string): Promise<void> {
  if (!against.trim()) throw new WondevError('Verification requires --against describing the check you performed.');
  await withProjectLock(root, async () => {
    const ctx = await loadContext(root);
    if (hasErrors(ctx.issues)) throw new WondevError('Fix source validation errors before verifying memory.');
    const found = resolveNote(ctx.project.memory, parseNoteLink(name));
    if (found.length !== 1) throw new WondevError(`Memory must resolve to one note: ${name}`);
    const note = found[0]!;
    const state = await loadMemoryState(root);
    const expected = await currentNoteHash(root, note.sourcePath);
    const files = await fingerprint(root, note.evidence ?? [], await evidenceFiles(root), true);
    if (note.sourcePath in files) throw new WondevError('A memory note cannot be its own evidence. Narrow its evidence patterns to the code being checked.');
    const raw = await fs.readFile(path.join(root, note.sourcePath), 'utf8');
    const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(raw);
    const doc = parseDocument(frontmatter?.[1] ?? '');
    const date = new Date().toISOString().slice(0, 10);
    doc.set('verified', date);
    doc.set('verifiedAgainst', against);
    const next = `---\n${doc.toString({ lineWidth: 0 })}---\n${frontmatter ? raw.slice(frontmatter[0].length) : raw}`;
    if (await currentNoteHash(root, note.sourcePath) !== expected) throw new WondevError('The memory changed during verification; retry against the new version.');
    await writeFileAtomic(path.join(root, note.sourcePath), next);
    const loaded = await loadProject(root, ctx.config.name, ctx.config.sources, ctx.config.vault);
    const updated = loaded.project.memory.find((m) => m.sourcePath === note.sourcePath)!;
    state.notes = { ...state.notes, [memoryId(updated)]: { noteHash: memoryHash(updated), files, verified: date, against } };
    await saveMemoryState(root, state);
    success(`Recorded verification for ${memoryId(updated)} against ${Object.keys(files).length} evidence file(s).`);
  });
}

export async function runMemoryStale(root: string, json = false): Promise<void> {
  const ctx = await loadContext(root);
  const report = await inspectFreshness(root, ctx.project.memory);
  if (json) { info(JSON.stringify(report, null, 2)); return; }
  for (const item of report) info(`${item.status.padEnd(10)} ${item.id}${item.reasons.length ? ` — ${item.reasons.join('; ')}` : ''}`);
}

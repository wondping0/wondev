import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { planVaultReconciliation, applyVaultReconciliation } from '../src/core/vault-reconcile.js';
import { runVaultReconcile } from '../src/commands/vault-reconcile.js';
import { loadContext } from '../src/commands/context.js';
import { loadConfig } from '../src/core/config.js';
import { runBuild } from '../src/commands/build.js';
import { main } from '../src/cli.js';
import { cleanup, exists, read, seedProject, silence, tmpRoot, write } from './helpers.js';

let root: string;
beforeEach(async () => { root = await tmpRoot(); await seedProject(root, ['agents']); });
afterEach(async () => { await cleanup(root); });

it('previews both titles, requires an explicit choice and rejects stale review hashes', async () => {
  await write(root, 'knowledge/Architecture.md', '---\ntitle: New architecture\n---\n# Architecture\nDifferent facts.\n');
  const before = await read(root, '.wondev/wondev.yaml');
  const plan = await planVaultReconciliation(root, 'knowledge');
  expect(plan.notes[0]).toMatchObject({ status: 'conflict', sourceTitle: 'Architecture', vaultTitle: 'New architecture' });
  await expect(applyVaultReconciliation(root, plan)).rejects.toThrow('unresolved conflicts');
  await silence(() => runVaultReconcile(root, 'knowledge', { json: true }));
  await expect(silence(() => runVaultReconcile(root, 'knowledge', { apply: true, reviewHash: 'old' }))).rejects.toThrow('stale');
  expect(await read(root, '.wondev/wondev.yaml')).toBe(before);
  await write(root, 'choices.json', JSON.stringify({ 'knowledge/memory/Architecture.md': 'vault' }));
  const resolved = await planVaultReconciliation(root, 'knowledge', { 'knowledge/memory/Architecture.md': 'vault' });
  await silence(() => main(['vault', 'reconcile', 'knowledge', '--cwd', root, '--resolutions', 'choices.json', '--apply', '--review-hash', resolved.reviewHash]));
  expect((await loadConfig(root)).sources?.memory).toBe('knowledge/memory');
  expect(await read(root, 'knowledge/memory/Architecture.md')).toContain('Different facts');
  expect(await exists(root, '.wondev/memory/architecture.md')).toBe(false);
  expect(await read(root, `.wondev/vault-backups/${resolved.reviewHash}/files/.wondev/wondev.yaml`)).toBe(before);
  await silence(() => runBuild(root));
});

it('deduplicates identical copies, rewrites real links, preserves titles and code examples, and copies assets byte-exactly', async () => {
  const architecture = await read(root, '.wondev/memory/architecture.md');
  await write(root, 'knowledge/memory/Architecture.md', architecture);
  await write(root, '.wondev/memory/login.md', '---\ntitle: Login flow\nrelated: [architecture]\n---\n# Login\nSee [[architecture]] and [arch](architecture.md).\n`[[architecture]]`\n');
  await write(root, 'knowledge/memory/Vault Note.md', '# Vault note\nSee [[Architecture]].\n');
  await write(root, '.wondev/memory/assets/picture.bin', '\0binary\r\n');
  const plan = await planVaultReconciliation(root, 'knowledge');
  expect(plan.notes.map((n) => n.status).sort()).toEqual(['duplicate', 'source-only', 'vault-only']);
  expect(plan.issues.filter((i) => i.level === 'error')).toEqual([]);
  await applyVaultReconciliation(root, plan);
  const login = await read(root, 'knowledge/memory/login.md');
  expect(login).toContain('[[memory/Architecture]]');
  expect(login).toContain('[arch](Architecture.md)');
  expect(login).toContain('`[[architecture]]`');
  expect(await read(root, 'knowledge/memory/assets/picture.bin')).toBe('\0binary\r\n');
  expect((await loadContext(root)).issues.filter((i) => i.level === 'error')).toEqual([]);
});

it('detects unresolved wikilinks and refuses to switch configuration', async () => {
  await write(root, 'knowledge/orphan.md', '# Orphan\nSee [[missing#Heading]].');
  const plan = await planVaultReconciliation(root, 'knowledge');
  expect(plan.issues.some((i) => i.message.includes('unresolved memory'))).toBe(true);
  await expect(applyVaultReconciliation(root, plan)).rejects.toThrow('invalid links');
  expect((await loadConfig(root)).vault).toBeUndefined();
});

it('detects edits made between planning and apply', async () => {
  await write(root, 'knowledge/new.md', '# New note');
  const plan = await planVaultReconciliation(root, 'knowledge');
  await write(root, 'knowledge/new.md', '# Changed note');
  await expect(applyVaultReconciliation(root, plan)).rejects.toThrow('changed after preview');
  expect(await exists(root, 'knowledge/memory')).toBe(false);
});

it('refuses duplicate identities, invalid choices, missing roots and overlapping paths', async () => {
  await expect(planVaultReconciliation(root, '../outside')).rejects.toThrow('inside');
  await expect(planVaultReconciliation(root, '.wondev/memory/inside')).rejects.toThrow('overlaps');
  await expect(planVaultReconciliation(root, 'missing')).rejects.toThrow('No existing');
  await write(root, 'knowledge/note.md', '---\nid: shared\n---\nOne');
  await write(root, 'knowledge/other.md', '---\nid: shared\n---\nTwo');
  await expect(planVaultReconciliation(root, 'knowledge')).rejects.toThrow('Ambiguous');
  await fs.rm(path.join(root, 'knowledge/other.md'));
  await expect(planVaultReconciliation(root, 'knowledge', { 'wrong.md': 'source' })).rejects.toThrow('Invalid vault resolution');
  await expect(planVaultReconciliation(root, 'knowledge', { 'knowledge/memory/note.md': 'source' })).rejects.toThrow('missing source');
  await write(root, 'choices.json', '[]');
  await expect(runVaultReconcile(root, 'knowledge', { resolutions: 'choices.json' })).rejects.toThrow('JSON object');
});

it('reports conflicting assets and guards external vault symlinks', async () => {
  await write(root, 'knowledge/memory/picture.bin', 'vault');
  await write(root, '.wondev/memory/picture.bin', 'source');
  const plan = await planVaultReconciliation(root, 'knowledge');
  expect(plan.issues.some((i) => i.message.includes('conflicting binary'))).toBe(true);
  const outside = await tmpRoot();
  try {
    await fs.symlink(outside, path.join(root, 'external'), process.platform === 'win32' ? 'junction' : 'dir');
    await expect(planVaultReconciliation(root, 'external')).rejects.toThrow('symlink');
  } finally { await fs.rm(path.join(root, 'external'), { force: true }); await cleanup(outside); }
});

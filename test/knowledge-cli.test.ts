import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { main } from '../src/cli.js';
import { parseFrontmatter } from '../src/core/frontmatter.js';
import { readProposal, proposalReviewHash } from '../src/core/sessions.js';
import { cleanup, exists, read, tmpRoot, write } from './helpers.js';

let root: string;
beforeEach(async () => { root = await tmpRoot(); });
afterEach(async () => { await cleanup(root); });

async function run(...args: string[]): Promise<string> {
  const chunks: string[] = [];
  const stdout = process.stdout.write.bind(process.stdout);
  const stderr = process.stderr.write.bind(process.stderr);
  const capture = ((chunk: string | Uint8Array) => { chunks.push(String(chunk)); return true; }) as typeof process.stdout.write;
  process.stdout.write = capture;
  process.stderr.write = capture;
  try { expect(await main([...args, '--cwd', root, '--no-color'])).toBe(0); return chunks.join(''); }
  finally { process.stdout.write = stdout; process.stderr.write = stderr; }
}

describe('knowledge CLI workflow', () => {
  it('runs vault initialization, task context, verification, skill validation and evaluation', async () => {
    await run('init', '--vault', 'knowledge', '--targets', 'agents');
    const packet = JSON.parse(await run('context', '--task', 'debug failing tests', '--files', 'src/a.ts', '--budget', '8000', '--explain', '--json'));
    expect(packet.tokens).toBeLessThanOrEqual(8000);
    expect(packet.content).toContain('Source:');
    expect(await run('context', '--task', 'debug')).toContain('# Task context');
    await write(root, 'src/auth.ts', 'export const auth = true;');
    await write(root, 'knowledge/memory/auth.md', '---\nid: auth\ntitle: Auth\nevidence: [src/auth.ts]\n---\nAuthentication is enabled.');
    await run('memory', 'verify', 'auth', '--against', 'Inspected authentication implementation');
    expect(JSON.parse(await run('memory', 'stale', '--json')).find((item: { id: string }) => item.id === 'auth').status).toBe('fresh');
    expect(await run('memory', 'stale')).toContain('auth');
    await run('skills', 'validate');
    await write(root, 'cases.json', JSON.stringify([{ task: 'debug failing tests', expected: ['debugging'] }]));
    expect(JSON.parse(await run('skills', 'eval', 'cases.json'))[0].passed).toBe(true);
    await write(root, 'knowledge/memory/broken.md', '[[missing]]');
    await expect(run('context', '--task', 'debug')).rejects.toThrow('source validation');
    await expect(run('memory', 'verify', 'auth', '--against', 'checked')).rejects.toThrow('source validation');
  });

  it('records, reviews, applies and rejects session proposals through the CLI', async () => {
    await run('init', '--targets', 'agents');
    await write(root, 'session.json', JSON.stringify({ agent: 'codex', task: 'Check architecture', outcome: 'One process remains appropriate.' }));
    const session = (await run('session', 'record', '--input', 'session.json')).trim();
    await write(root, 'update.md', (await read(root, '.wondev/memory/architecture.md')) + '\nOne deployment unit.\n');
    const output = await run('session', 'propose', session, 'architecture', '--input', 'update.md');
    const id = String(parseFrontmatter(output, 'proposal').data['id']);
    expect(await run('session', 'review', id)).toContain('One deployment unit.');
    const proposal = await readProposal(root, id);
    await run('session', 'apply', id, '--review-hash', proposalReviewHash(proposal));
    expect(await read(root, 'AGENTS.md')).toContain('One deployment unit.');
    const second = await run('session', 'propose', session, 'architecture', '--input', 'update.md');
    const secondId = String(parseFrontmatter(second, 'proposal').data['id']);
    await run('session', 'reject', secondId);
    expect((await readProposal(root, secondId)).status).toBe('rejected');
    await expect(run('session', 'record')).rejects.toThrow('--input');
    await write(root, 'invalid.json', '{');
    await expect(run('session', 'record', '--input', 'invalid.json')).rejects.toThrow('valid JSON');
    await expect(run('session', 'propose', '--input', 'update.md')).rejects.toThrow('Usage');
    await expect(run('session', 'unknown', 'id')).rejects.toThrow('Unknown session action');
    await expect(run('session')).rejects.toThrow('Usage');
  });

  it('installs and updates packs with dry-run and lockfile sync through CLI dispatch', async () => {
    await run('init', '--targets', 'agents');
    await write(root, 'pack/package.json', '{"name":"test-pack","version":"1.0.0"}');
    await write(root, 'pack/skills/special/SKILL.md', '---\nname: special\ndescription: Inspect special tasks\n---\nInspect evidence.');
    expect(await run('skills', 'install', 'local:pack', '--dry-run')).toContain('no project files changed');
    await run('skills', 'install', 'local:pack');
    expect(await exists(root, '.wondev/skills/special/SKILL.md')).toBe(true);
    await write(root, '.wondev/skills/special/SKILL.md', '---\nname: special\ndescription: Local special tasks\n---\nLocal edits.');
    await write(root, 'pack/skills/special/SKILL.md', '---\nname: special\ndescription: Inspect special tasks\n---\nImproved upstream procedure.');
    expect(await run('skills', 'update', 'test-pack', '--source', 'local:pack', '--no-build')).toContain('Local edits/deletions were preserved');
    await expect(run('skills', 'sync')).rejects.toThrow('Locally modified');
    await write(root, '.wondev/skills/special/SKILL.md', await read(root, 'pack/skills/special/SKILL.md'));
    await run('skills', 'sync');
    await expect(run('skills', 'install')).rejects.toThrow('Usage');
    await expect(run('skills', 'something')).rejects.toThrow('Usage');
    await expect(run('memory')).rejects.toThrow('Usage');
  });

  it('dispatches vault conversion and profile overrides consistently', async () => {
    await run('init', '--targets', 'agents');
    await run('vault', 'docs/knowledge', '--dry-run');
    expect(await exists(root, 'docs/knowledge')).toBe(false);
    await run('vault', 'docs/knowledge');
    const config = await read(root, '.wondev/wondev.yaml');
    await write(root, '.wondev/wondev.yaml', config + '\nprofiles:\n  minimal:\n    skills: [debugging]\n');
    await run('build', '--profile', 'minimal');
    await run('check', '--profile', 'minimal');
    const list = await run('list', '--profile', 'minimal');
    expect(list).toContain('debugging');
    expect(list).not.toContain('writing-tests');
    const context = JSON.parse(await run('context', '--task', 'debug', '--profile', 'minimal', '--json', '--budget', '8000'));
    expect(context.selected.filter((s: { kind: string }) => s.kind === 'skill').map((s: { id: string }) => s.id)).toEqual(['debugging']);
  });
});

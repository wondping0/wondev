import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runInit } from '../src/commands/init.js';
import { catchWondevError, cleanup, exists, tmpRoot, write } from './helpers.js';

let root: string;
beforeEach(async () => {
  root = await tmpRoot();
});
afterEach(async () => {
  await cleanup(root);
});

async function initOutput(options = {}): Promise<string> {
  const chunks: string[] = [];
  const outWrite = process.stdout.write.bind(process.stdout);
  const errWrite = process.stderr.write.bind(process.stderr);
  const capture = ((chunk: string | Uint8Array) => {
    chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString());
    return true;
  }) as typeof process.stdout.write;
  process.stdout.write = capture;
  process.stderr.write = capture;
  try {
    await runInit(root, { skipBuild: true, targets: ['claude'], ...options });
  } finally {
    process.stdout.write = outWrite;
    process.stderr.write = errWrite;
  }
  return chunks.join('').replace(/\[[0-9;]*m/g, '');
}

describe('wondev init', () => {
  it('scaffolds the starter pack and counts it correctly', async () => {
    const out = await initOutput();
    expect(out).toContain('created');
    // "1 agents" was a real defect; the pluraliser exists because of it.
    expect(out).toContain('1 agent');
    expect(out).not.toContain('1 agents');
    expect(await exists(root, '.wondev/wondev.yaml')).toBe(true);
    expect(await exists(root, '.wondev/agents/code-reviewer.md')).toBe(true);
  });

  it('refuses to overwrite an existing .wondev/ without --force', async () => {
    await initOutput();
    const err = await catchWondevError(() => initOutput());
    expect(err.message).toMatch(/already exists/);
    expect(err.hint).toMatch(/--force/);
  });

  it('points at adopt when the project already has agent config', async () => {
    // Scaffolding beside existing config is not destructive, but it leaves that config
    // outside .wondev/ where wondev never compiles it — two sets of agent knowledge, one
    // of them maintained. The user should choose that, not discover it.
    await write(root, 'CLAUDE.md', '# Mine\n\nx\n');
    await write(root, '.claude/skills/mine/SKILL.md', '---\nname: mine\ndescription: d\n---\n\nx\n');

    const out = await initOutput();
    expect(out).toContain('already has agent config');
    expect(out).toContain('CLAUDE.md');
    expect(out).toContain('wondev adopt');
    // A warning, not a refusal: starting fresh is a legitimate choice.
    expect(await exists(root, '.wondev/wondev.yaml')).toBe(true);
  });

  it('says nothing about adopt on a clean project', async () => {
    const out = await initOutput();
    expect(out).not.toContain('already has agent config');
  });

  it('rejects an unknown target by name', async () => {
    const err = await catchWondevError(() => initOutput({ targets: ['nonesuch'] }));
    expect(err.message).toMatch(/Unknown target "nonesuch"/);
  });
});

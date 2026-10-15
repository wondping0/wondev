import { describe, expect, it } from 'vitest';
import { formatContext, selectContext } from '../src/core/retrieval.js';
import { estimateTokens } from '../src/util/tokens.js';
import type { MemoryDoc, Project } from '../src/core/model.js';

const memory = (slug: string, props: Partial<MemoryDoc> = {}): MemoryDoc => ({ slug, title: slug, always: false, extra: {}, body: 'Project fact.', sourcePath: `.wondev/memory/${slug}.md`, ...props });
const project = (): Project => ({
  name: 'demo', commands: [], agents: [],
  memory: [
    memory('rules', { always: true }),
    memory('auth', { description: 'Login tokens', globs: ['src/auth/**'], related: ['[[session-decision]]'] }),
    memory('session-decision', { body: 'Use signed cookies.' }),
    memory('billing', { description: 'Invoices', body: 'Billing facts.' }),
    memory('draft', { status: 'draft', description: 'Login', always: true }),
  ],
  skills: [{ name: 'debug-login', description: 'Debug login tokens', body: 'Reproduce the login error.', sourcePath: '.wondev/skills/debug-login/SKILL.md', inline: false, attachments: [] }],
});

describe('context selection', () => {
  it('selects relevant memory, connected decisions, and skills with explanations', () => {
    const packet = selectContext(project(), { task: 'Fix login', files: ['src/auth/session.ts'], explain: true }, [
      { id: 'auth', path: '.wondev/memory/auth.md', status: 'stale', reasons: ['Code changed'] },
    ]);
    expect(packet.selected.map((item) => item.id)).toEqual(['rules', 'auth', 'debug-login', 'session-decision']);
    expect(packet.content).toContain('Path match: src/auth/session.ts');
    expect(packet.content).toContain('Related to auth');
    expect(packet.content).toContain('Evidence: stale');
    expect(packet.content).not.toContain('Billing facts');
  });

  it('counts the complete Markdown and JSON output and never drops required context silently', () => {
    for (const format of ['markdown', 'json'] as const) {
      const packet = selectContext(project(), { task: 'login', format, budget: 500 });
      expect(packet.tokens).toBe(estimateTokens(formatContext(packet, format)));
      expect(packet.tokens).toBeLessThanOrEqual(500);
      expect(packet.selected.some((item) => item.id === 'rules')).toBe(true);
    }
    const p = project();
    p.skills[0]!.inline = true;
    p.skills[0]!.body = 'REQUIRED '.repeat(1000);
    expect(() => selectContext(p, { task: 'login', budget: 100 })).toThrow('Required context');
  });

  it('bounds graph expansion and skips optional documents which do not fit', () => {
    const p = project();
    p.memory[1]!.body = 'large '.repeat(2000);
    const packet = selectContext(p, { files: ['src/auth/a.ts'], budget: 300, graphLimit: 0 });
    expect(packet.omitted).toBe(1);
    expect(packet.selected.map((s) => s.id)).toEqual(['rules']);
    expect(selectContext(project(), { task: 'login', depth: 0 }).selected.map((s) => s.id)).not.toContain('session-decision');
  });

  it('uses backlinks, body terms, skill globs, and ignores archived notes', () => {
    const p = project();
    p.memory.push(memory('consumer', { related: ['auth'], body: 'Client contract.' }));
    p.memory.push(memory('old', { status: 'archived', always: true }));
    p.skills[0]!.globs = ['src/auth/**'];
    const packet = selectContext(p, { task: 'signed', files: ['src/auth/a.ts'], graphLimit: 1, depth: 3 });
    expect(packet.selected.map((s) => s.id)).toContain('consumer');
    expect(packet.selected.map((s) => s.id)).not.toContain('old');
    expect(packet.selected.find((s) => s.id === 'session-decision')?.reasons.join()).toContain('Body terms');
  });

  it('validates options and produces deterministic results', () => {
    expect(() => selectContext(project())).toThrow('--task or --files');
    expect(() => selectContext(project(), { task: 'x', budget: -1 })).toThrow('positive integer');
    expect(() => selectContext(project(), { task: 'x', depth: 4 })).toThrow('Graph depth');
    expect(selectContext(project(), { task: 'login' })).toEqual(selectContext(project(), { task: 'login' }));
  });
});

import { describe, expect, it } from 'vitest';
import { evaluateContext, type ContextCase } from '../src/core/context-quality.js';
import type { Project } from '../src/core/model.js';

const project = (): Project => ({ name: 'demo', agents: [], commands: [], memory: [
  { id: 'auth', slug: 'auth', title: 'Login', always: false, extra: {}, body: 'Central expiry validation.', sourcePath: 'memory/auth.md', globs: ['src/auth/**'] },
  { id: 'billing', slug: 'billing', title: 'Invoices', always: false, extra: {}, body: 'Invoice totals.', sourcePath: 'memory/billing.md' },
], skills: [{ name: 'debugging', description: 'Debug failures', body: 'Reproduce then test.', inline: false, attachments: [], sourcePath: 'skills/debugging/SKILL.md' }] });

describe('bounded context evaluation', () => {
  it('tests required and forbidden memory and skills together with JSON budget overhead', () => {
    const [result] = evaluateContext(project(), [{ task: 'Debug login', files: ['src/auth/session.ts'], format: 'json', budget: 1000, expected: { memory: ['auth'], skills: ['debugging'] }, forbidden: { memory: ['billing'] } }]);
    expect(result?.passed).toBe(true);
    expect(result?.tokens).toBeGreaterThan(0);
    expect(result?.tokens).toBeLessThanOrEqual(1000);
    expect(result?.selected.map((s) => `${s.kind}:${s.id}`)).toEqual(['memory:auth', 'skill:debugging']);
  });

  it('reports missing items, forbidden activation and required-context budget overflow', () => {
    const p = project();
    const [result] = evaluateContext(p, [{ task: 'Debug login', expected: { memory: ['billing'] }, forbidden: { skills: ['debugging'] } }]);
    expect(result?.missing).toEqual(['memory:billing']);
    expect(result?.unexpected).toEqual(['skill:debugging']);
    expect(result?.passed).toBe(false);
    p.memory[0]!.always = true;
    const [overflow] = evaluateContext(p, [{ task: 'Debug', budget: 1, expected: { memory: ['auth'] } }]);
    expect(overflow?.passed).toBe(false);
    expect(overflow?.error).toContain('Required context');
  });

  it('measures optional context lost under a real small budget', () => {
    const p = project();
    p.memory[0]!.body = 'long facts '.repeat(2000);
    const [result] = evaluateContext(p, [{ task: 'login', budget: 300, expected: { memory: ['auth'] } }]);
    expect(result?.missing).toEqual(['memory:auth']);
    expect(result?.error).toBeUndefined();
    expect(result?.tokens).toBeLessThanOrEqual(300);
  });

  it.each([
    null, [], [{ task: '', expected: {} }], [{ task: 'login', expected: [] }],
    [{ task: 'login', expected: { unknown: [] } }], [{ task: 'login', expected: { memory: 'auth' } }],
    [{ task: 'login', expected: { memory: ['missing'] } }], [{ task: 'login', expected: {}, files: [1] }],
    [{ task: 'login', expected: {}, budget: -1 }], [{ task: 'login', expected: {}, format: 'html' }],
    [{ task: 'login', expected: { memory: ['auth'] }, forbidden: { memory: ['auth'] } }],
  ])('rejects malformed or contradictory evaluation input %#', (cases) => {
    expect(() => evaluateContext(project(), cases as ContextCase[])).toThrow();
  });
});

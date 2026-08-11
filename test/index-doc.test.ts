import { describe, expect, it } from 'vitest';
import type { MemoryDoc, Project } from '../src/core/model.js';
import type { IndexConfig } from '../src/core/config.js';
import { alwaysOnTokens, renderIndex } from '../src/core/render/index-doc.js';

function doc(over: Partial<MemoryDoc> & { slug: string }): MemoryDoc {
  return {
    title: over.slug,
    always: false,
    extra: {},
    body: 'x'.repeat(400),
    sourcePath: `.wondev/memory/${over.slug}.md`,
    ...over,
  };
}

function project(memory: MemoryDoc[]): Project {
  return { name: 'demo', memory, skills: [], commands: [] };
}

const plain: IndexConfig = { file: 'Index.md', columns: [] };

describe('renderIndex', () => {
  it('writes a region-mode file at the configured path', () => {
    const file = renderIndex(project([doc({ slug: 'a' })]), plain);
    expect(file.path).toBe('Index.md');
    expect(file.mode).toBe('region');
  });

  it('separates always-loaded documents from on-demand ones', () => {
    const file = renderIndex(
      project([doc({ slug: 'arch', always: true }), doc({ slug: 'glossary' })]),
      plain,
    );
    expect(file.content).toContain('## Always loaded');
    expect(file.content).toContain('## On demand');
    const always = file.content.indexOf('## Always loaded');
    const demand = file.content.indexOf('## On demand');
    expect(always).toBeLessThan(demand);
  });

  it('totals only the always-on documents', () => {
    // 400 chars => 100 tokens each; only the always-on one counts.
    const p = project([doc({ slug: 'arch', always: true }), doc({ slug: 'other' })]);
    expect(alwaysOnTokens(p)).toBe(100);
    expect(renderIndex(p, plain).content).toContain('**Always-on total: ≈100**');
  });

  it('shows the budget beside the total only when one is configured', () => {
    const p = project([doc({ slug: 'arch', always: true })]);
    expect(renderIndex(p, plain).content).not.toContain('budget');
    expect(renderIndex(p, { ...plain, budget: 8000 }).content).toContain('(budget 8.0k)');
  });

  it('omits the Checked column entirely when nothing is verified', () => {
    const file = renderIndex(project([doc({ slug: 'a' })]), plain);
    expect(file.content).not.toContain('Checked');
  });

  it('shows a tick for verified documents and an empty cell for the rest', () => {
    const file = renderIndex(
      project([doc({ slug: 'a', verified: '2026-08-10' }), doc({ slug: 'b' })]),
      plain,
    );
    expect(file.content).toContain('Checked');
    expect(file.content).toContain('✓ 2026-08-10');
  });

  it('links notes with the wikilink syntax wondev already validates', () => {
    const file = renderIndex(project([doc({ slug: 'decisions/0001-x' })]), plain);
    expect(file.content).toContain('[[decisions/0001-x]]');
  });

  it('renders a configured extra column, empty where the key is absent', () => {
    const file = renderIndex(
      project([doc({ slug: 'a', extra: { owner: 'platform' } }), doc({ slug: 'b' })]),
      { ...plain, columns: [{ key: 'owner', label: 'Owner' }] },
    );
    expect(file.content).toContain('| Owner |');
    expect(file.content).toContain('platform');
  });

  it('escapes a pipe in a cell so the table cannot be broken', () => {
    const file = renderIndex(project([doc({ slug: 'a', extra: { owner: 'x|y' } })]), {
      ...plain,
      columns: [{ key: 'owner', label: 'Owner' }],
    });
    expect(file.content).toContain('x\\|y');
  });

  it('flattens a newline in a description so it stays on one row', () => {
    const file = renderIndex(project([doc({ slug: 'a', description: 'one\ntwo' })]), plain);
    expect(file.content).toContain('one two');
  });

  it('says so plainly when there are no memory documents', () => {
    const file = renderIndex(project([]), plain);
    expect(file.content).toContain('No memory documents yet.');
  });
});

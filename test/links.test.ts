import { describe, expect, it } from 'vitest';
import type { MemoryDoc } from '../src/core/model.js';
import { memoryLinkIssues, noteLinks, parseNoteLink, relatedNotes, resolveNote } from '../src/core/links.js';

function doc(slug: string, body = '', extra: Partial<MemoryDoc> = {}): MemoryDoc {
  return { slug, title: slug, always: false, body, extra: {}, sourcePath: `knowledge/memory/${slug}.md`, vaultPath: `memory/${slug}`, ...extra };
}

describe('Obsidian links', () => {
  it('resolves labels, headings, blocks, aliases, stable IDs, vault paths, and relative markdown', () => {
    const a = doc('modules/auth', '# Auth\n\n## Login flow\n\nResult ^result\n', { id: 'auth-module', aliases: ['Authentication'] });
    const b = doc('flows/login', '[[memory/modules/auth#Login flow|Login]]\n![[Authentication#^result]]\n[Auth](../modules/auth.md#login-flow)', { related: ['auth-module'] });
    expect(memoryLinkIssues([a, b])).toEqual([]);
    expect(relatedNotes([a, b], b)).toEqual([a]);
    expect(resolveNote([a, b], parseNoteLink('auth-module'))).toEqual([a]);
  });

  it('reports missing and ambiguous notes and anchors, and duplicate identities', () => {
    const a = doc('api/auth', '# Auth', { id: 'same' });
    const b = doc('ui/auth', '# UI', { id: 'same' });
    const c = doc('index', '[[auth]] [[missing]] [[api/auth#Lost]] [[api/auth#^missing]]');
    const issues = memoryLinkIssues([a, b, c]);
    expect(issues.map((i) => i.message).join('\n')).toMatch(/duplicate memory id/);
    expect(issues.filter((i) => i.message.startsWith('ambiguous'))).toHaveLength(1);
    expect(issues.filter((i) => i.message.includes('heading or block'))).toHaveLength(2);
  });

  it('ignores examples, comments, external URLs, and non-note attachments', () => {
    const body = '```md\n[[missing]]\n```\n`[[missing]]`\n<!-- [[missing]] -->\n![[image.png]]\n[x](https://example.com)\n[x](file:///tmp/a.md)';
    expect(noteLinks(body)).toEqual([]);
    const local = doc('a', '# Present\n[[#Present]]\n');
    expect(memoryLinkIssues([local])).toEqual([]);
  });
});

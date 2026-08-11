import { describe, expect, it } from 'vitest';
import type { Project } from '../src/core/model.js';
import { renderTarget } from '../src/core/render/index.js';
import { markdownToHtml, escapeHtml } from '../src/core/render/markdown.js';
import { BUILTIN_TARGETS } from '../src/core/registry.js';

describe('markdownToHtml', () => {
  it('escapes HTML before producing any markup', () => {
    const out = markdownToHtml('<script>alert(1)</script>');
    expect(out).not.toContain('<script>');
    expect(out).toContain('&lt;script&gt;');
  });

  it('renders headings, lists, and inline code', () => {
    const out = markdownToHtml('## Title\n\n- one\n- two\n\nUse `npm ci` here.');
    expect(out).toContain('<h2>Title</h2>');
    expect(out).toContain('<ul><li>one</li><li>two</li></ul>');
    expect(out).toContain('<code>npm ci</code>');
  });

  it('renders numbered lists separately from bullets', () => {
    expect(markdownToHtml('1. first\n2. second')).toContain('<ol><li>first</li><li>second</li></ol>');
  });

  it('keeps a fenced block as code and labels its language', () => {
    const out = markdownToHtml('```mermaid\ngraph TD;\n```');
    expect(out).toContain('class="lang-mermaid"');
    expect(out).toContain('graph TD;');
  });

  it('does not let a code span be reinterpreted as emphasis', () => {
    expect(markdownToHtml('`a *b* c`')).toContain('<code>a *b* c</code>');
  });

  it('cannot have its code placeholder forged by the document', () => {
    // The sentinel is only safe because escaping runs first: a literal `<` never survives
    // into the text this operates on.
    const out = markdownToHtml('<<CODE0>> and `real`');
    expect(out).toContain('&lt;&lt;CODE0&gt;&gt;');
    expect(out).toContain('<code>real</code>');
  });

  it('renders a table with its header row', () => {
    const out = markdownToHtml('| A | B |\n| --- | --- |\n| 1 | 2 |');
    expect(out).toContain('<th>A</th>');
    expect(out).toContain('<td>2</td>');
  });

  it('renders blockquotes and horizontal rules', () => {
    expect(markdownToHtml('> quoted')).toContain('<blockquote>quoted</blockquote>');
    expect(markdownToHtml('---')).toContain('<hr>');
  });

  it('marks wikilinks so they are visible rather than silently dropped', () => {
    expect(markdownToHtml('see [[other-doc]]')).toContain('<span class="wikilink">other-doc</span>');
  });

  it('escapes quotes so an attribute cannot be broken out of', () => {
    expect(escapeHtml('" onload="x')).toBe('&quot; onload=&quot;x');
  });
});

describe('html engine', () => {
  const project: Project = {
    name: 'Demo <Project>',
    memory: [
      {
        slug: 'architecture', title: 'Architecture', always: true, extra: {},
        verified: '2026-08-11',
        body: '# Architecture\n\nOne binary.',
        sourcePath: '.wondev/memory/architecture.md',
      },
      {
        slug: 'glossary', title: 'Glossary', always: false, extra: {},
        description: 'Looking up a domain term.',
        body: 'Terms.',
        sourcePath: '.wondev/memory/glossary.md',
      },
    ],
    skills: [
      {
        name: 'debugging', description: 'Use when investigating a failure',
        attachments: [{ relPath: 'references/deep.md', content: '# deep' }],
        body: 'Reproduce first.', sourcePath: '.wondev/skills/debugging/SKILL.md',
      },
    ],
    commands: [
      { name: 'review', description: 'Review the diff', body: 'Read it.', sourcePath: '.wondev/commands/review.md' },
    ],
    agents: [
      {
        name: 'blast-radius', description: 'Delegate for wide changes', model: 'sonnet',
        body: 'Map the reach.', sourcePath: '.wondev/agents/blast-radius.md',
      },
    ],
  };

  const file = renderTarget(project, { name: 'guide', target: BUILTIN_TARGETS['guide']!.target })[0]!;

  it('writes one complete document it owns entirely', () => {
    expect(file.path).toBe('GUIDE.html');
    expect(file.mode).toBe('whole');
    expect(file.content.startsWith('<!doctype html>')).toBe(true);
    expect(file.content.trimEnd().endsWith('</html>')).toBe(true);
  });

  it('makes no external requests, so it works from file:// and cannot phone home', () => {
    expect(file.content).not.toMatch(/<script\b/i);
    expect(file.content).not.toMatch(/https?:\/\//);
    expect(file.content).not.toMatch(/<link\b/i);
  });

  it('covers every artifact type', () => {
    expect(file.content).toContain('Architecture');
    expect(file.content).toContain('Glossary');
    expect(file.content).toContain('debugging');
    expect(file.content).toContain('blast-radius');
    expect(file.content).toContain('/review');
  });

  it('separates always-loaded memory from on-demand', () => {
    expect(file.content).toContain('Always loaded');
    expect(file.content).toContain('On demand');
  });

  it('shows cost and freshness per item', () => {
    expect(file.content).toMatch(/≈\d/);
    expect(file.content).toContain('checked 2026-08-11');
    expect(file.content).toContain('never verified');
  });

  it('nests document headings under the section title rather than above it', () => {
    const deep: Project = {
      ...project,
      memory: [{
        slug: 'a', title: 'Architecture', always: true, extra: {},
        body: ['# Architecture', '', 'One.', '', '## Sub', '', 'Two.'].join('\n'),
        sourcePath: '.wondev/memory/a.md',
      }],
      skills: [], commands: [], agents: [],
    };
    const html = renderTarget(deep, { name: 'guide', target: BUILTIN_TARGETS['guide']!.target })[0]!.content;
    // The section title is h3, so the body must start at h4. Without re-levelling, a
    // document opening with `# Architecture` renders above the heading introducing it.
    expect(html).toContain('<h3>Architecture</h3>');
    expect(html).toContain('<h4>Sub</h4>');
    expect(html).not.toContain('<h1>Architecture</h1>');
  });

  it('escapes the project name rather than injecting it as markup', () => {
    expect(file.content).toContain('Demo &lt;Project&gt;');
    expect(file.content).not.toContain('<Project>');
  });

  it('defines colours for both schemes on :root, not only inside a media query', () => {
    const rootBlock = file.content.slice(file.content.indexOf(':root{'), file.content.indexOf('}') + 1);
    expect(rootBlock).toContain('--bg:');
    expect(file.content).toContain('prefers-color-scheme:dark');
  });
});

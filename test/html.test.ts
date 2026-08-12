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

  it('refuses a link scheme that executes, and leaves it visible as text', () => {
    // Escaping stops a URL breaking out of the attribute; it does nothing about what the
    // URL does when followed. This produced a working javascript: link until 0.9.11.
    for (const scheme of ['javascript:alert(1)', 'data:text/html,<b>x', 'vbscript:msgbox']) {
      const out = markdownToHtml('[click](' + scheme + ')');
      expect(out).not.toContain('<a href=');
      expect(out).toContain('click');
    }
  });

  it('keeps the schemes a document legitimately uses', () => {
    expect(markdownToHtml('[a](https://example.com)')).toContain('<a href="https://example.com">');
    expect(markdownToHtml('[a](./docs/x.md)')).toContain('<a href="./docs/x.md">');
    expect(markdownToHtml('[a](#anchor)')).toContain('<a href="#anchor">');
    expect(markdownToHtml('[a](mailto:x@y.z)')).toContain('<a href="mailto:x@y.z">');
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
        name: 'debugging', description: 'Use when investigating a failure', inline: false,
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

  it('loads no external resources, so it works from file:// and cannot phone home', () => {
    // Checks the constructs that actually cause a request, not the mere presence of a URL:
    // a document may legitimately contain a link, and an href fetches nothing until someone
    // clicks it. Asserting "no URL anywhere" passed only because the fixture had none.
    expect(file.content).not.toMatch(/<link\b/i);
    expect(file.content).not.toMatch(/\bsrc\s*=/i);
    expect(file.content).not.toMatch(/@import/i);
    expect(file.content).not.toMatch(/url\(/i);
  });

  it('carries a filter the page still works without', () => {
    expect(file.content).toContain('id="q"');
    // Inline only — a script with a src would break the guarantee above.
    const scripts = file.content.match(/<script[^>]*>/gi) ?? [];
    expect(scripts).toHaveLength(1);
    expect(scripts[0]).toBe('<script>');
    // Sections are plain markup, so a blocked script costs the filter and nothing else.
    expect(file.content).toContain('<section id="memory-architecture">');
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

describe('markdown structures that used to be flattened or leaked', () => {
  it('nests a list inside the item it hangs from', () => {
    // Flattening this loses the distinction between a step and its sub-steps, which is the
    // structure a reader navigates by.
    expect(markdownToHtml('- one\n  - a\n  - b\n- two')).toBe(
      '<ul><li>one<ul><li>a</li><li>b</li></ul></li><li>two</li></ul>',
    );
  });

  it('nests an unordered list inside an ordered one', () => {
    expect(markdownToHtml('1. step\n   - detail\n2. next')).toBe(
      '<ol><li>step<ul><li>detail</li></ul></li><li>next</li></ol>',
    );
  });

  it('starts a new list when the marker changes at the same depth', () => {
    const out = markdownToHtml('- bullet\n1. number');
    expect(out).toContain('<ul><li>bullet</li></ul>');
    expect(out).toContain('<ol><li>number</li></ol>');
  });

  it('renders task list markers instead of literal brackets', () => {
    expect(markdownToHtml('- [ ] todo\n- [x] done')).toBe('<ul><li>☐ todo</li><li>☑ done</li></ul>');
  });

  it('turns an underlined line into a heading rather than showing the underline', () => {
    expect(markdownToHtml('Title\n=====')).toBe('<h1>Title</h1>');
    expect(markdownToHtml('Sub\n---')).toBe('<h2>Sub</h2>');
  });

  it('still treats --- as a rule when no paragraph precedes it', () => {
    // `---` is both a thematic break and a setext underline; which one depends on context.
    expect(markdownToHtml('para\n\n---\n\nafter')).toContain('<hr>');
  });

  it('resolves reference links and does not print their definitions', () => {
    const out = markdownToHtml('[text][ref] and [ref]\n\n[ref]: https://example.com');
    expect(out).toContain('<a href="https://example.com">text</a>');
    expect(out).toContain('<a href="https://example.com">ref</a>');
    expect(out).not.toContain('[ref]:');
  });

  it('leaves a reference with no definition as visible text', () => {
    expect(markdownToHtml('[text][missing]')).toContain('[text][missing]');
  });

  it('renders an image as a link, never as an <img> that would fetch', () => {
    // The page's one hard guarantee is that it makes no external request. An image source
    // is a request the moment the page opens, before anyone chooses to follow anything.
    const out = markdownToHtml('![alt](https://example.com/a.png)');
    expect(out).toContain('<a href="https://example.com/a.png">alt</a>');
    expect(out).not.toContain('<img');
    expect(out).not.toContain('!<a');
  });

  it('applies the scheme allowlist to images too', () => {
    expect(markdownToHtml('![x](javascript:alert(1))')).not.toContain('<a href=');
  });

  it('renders strikethrough', () => {
    expect(markdownToHtml('~~gone~~')).toContain('<del>gone</del>');
  });
});

describe('list items that span more than one line', () => {
  it('keeps a wrapped line with the item it belongs to', () => {
    // Indenting continuation text is the ordinary way to write a list item longer than one
    // line. Without support the list ended at the wrapped line, leaving a stray paragraph
    // and a second list that should have been nested inside the first.
    const md = ['- parent whose text', '  wraps:', '  - nested', '- second'].join('\n');
    expect(markdownToHtml(md)).toBe(
      '<ul><li>parent whose text wraps:<ul><li>nested</li></ul></li><li>second</li></ul>',
    );
  });

  it('does not swallow a fenced block as continuation text', () => {
    // Treating a fence as prose would destroy the code block, which is worse than ending
    // the list at it.
    const out = markdownToHtml(['- item', '', '```js', 'x', '```'].join('\n'));
    expect(out).toContain('<ul><li>item</li></ul>');
    expect(out).toContain('<pre class="lang-js"><code>x</code></pre>');
  });

  it('ends the list at an unindented line', () => {
    const out = markdownToHtml('- item\nnot part of the list');
    expect(out).toContain('<ul><li>item</li></ul>');
    expect(out).toContain('<p>not part of the list</p>');
  });
});

import type { HtmlTarget, Project, RenderedFile } from '../model.js';
import { estimateTokens, formatTokens } from '../../util/tokens.js';
import { escapeHtml, markdownToHtml } from './markdown.js';
import { sectionBody } from './shared.js';

/**
 * A self-contained HTML guide, for the one audience every other engine ignores: people.
 *
 * The same `.wondev/` that compiles to agent config also describes the project to whoever
 * has to maintain it, and until now that description was only readable as generated agent
 * files. This renders it as a page.
 *
 * Everything is inlined -- no scripts fetched, no fonts, no stylesheet -- so the file opens
 * from `file://`, survives being emailed, and can be served from a container with a single
 * read-only mount. It carries no external requests at all, which also means it cannot phone
 * anywhere when opened.
 */

interface Section {
  id: string;
  title: string;
  meta: string;
  body: string;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'section';
}

function cost(body: string): string {
  return `≈${formatTokens(estimateTokens(body))}`;
}

function sections(project: Project): { group: string; items: Section[] }[] {
  const groups: { group: string; items: Section[] }[] = [];

  const always = project.memory.filter((d) => d.always);
  const onDemand = project.memory.filter((d) => !d.always);

  const memoryItem = (doc: (typeof project.memory)[number]): Section => ({
    id: `memory-${slugify(doc.slug)}`,
    title: doc.title,
    meta: [
      cost(doc.body),
      doc.verified ? `checked ${doc.verified}` : 'never verified',
      doc.description ?? '',
    ]
      .filter(Boolean)
      .join(' · '),
    body: markdownToHtml(sectionBody(doc.body, doc.title, 4)),
  });

  if (always.length > 0) groups.push({ group: 'Always loaded', items: always.map(memoryItem) });
  if (onDemand.length > 0) groups.push({ group: 'On demand', items: onDemand.map(memoryItem) });

  if (project.skills.length > 0) {
    groups.push({
      group: 'Skills',
      items: project.skills.map((s) => ({
        id: `skill-${slugify(s.name)}`,
        title: s.name,
        meta: `${cost(s.body)} · ${s.description}`,
        body:
          markdownToHtml(sectionBody(s.body, s.name, 4)) +
          (s.attachments.length > 0
            ? `<p class="attachments">Reference material: ${s.attachments
                .map((a) => `<code>${escapeHtml(a.relPath)}</code>`)
                .join(', ')}</p>`
            : ''),
      })),
    });
  }

  if (project.agents.length > 0) {
    groups.push({
      group: 'Subagents',
      items: project.agents.map((a) => ({
        id: `agent-${slugify(a.name)}`,
        title: a.name,
        meta: [cost(a.body), a.model ? `model ${a.model}` : '', a.description]
          .filter(Boolean)
          .join(' · '),
        body: markdownToHtml(sectionBody(a.body, a.name, 4)),
      })),
    });
  }

  if (project.commands.length > 0) {
    groups.push({
      group: 'Commands',
      items: project.commands.map((c) => ({
        id: `command-${slugify(c.name)}`,
        title: `/${c.name}`,
        meta: `${cost(c.body)} · ${c.description}`,
        body: markdownToHtml(sectionBody(c.body, c.name, 4)),
      })),
    });
  }

  return groups;
}

/**
 * Light and dark are both defined on `:root`, with dark applied only inside a
 * `prefers-color-scheme` block. A page that defines a colour only inside a media query
 * borrows whatever the host paints behind it when that query does not match.
 */
const STYLE = `
:root{--bg:#fbfaf8;--fg:#1c1b19;--muted:#6b6862;--line:#e2ded7;--accent:#8a5a2b;--code:#f2efe9}
@media (prefers-color-scheme:dark){:root{--bg:#16151a;--fg:#e8e6e1;--muted:#9b968d;--line:#2c2a31;--accent:#d9a05b;--code:#201f26}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.65 ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif}
.wrap{display:grid;grid-template-columns:minmax(200px,260px) minmax(0,1fr);gap:2.5rem;max-width:1180px;margin:0 auto;padding:2rem 1.25rem}
nav{position:sticky;top:2rem;align-self:start;max-height:calc(100vh - 4rem);overflow:auto}
nav h2{font-size:.72rem;letter-spacing:.09em;text-transform:uppercase;color:var(--muted);margin:1.4rem 0 .4rem}
nav a{display:block;padding:.2rem 0;color:var(--fg);text-decoration:none;font-size:.9rem;border-left:2px solid transparent;padding-left:.6rem}
nav a:hover{color:var(--accent);border-left-color:var(--accent)}
header.top{border-bottom:1px solid var(--line);padding-bottom:1rem;margin-bottom:1.5rem}
header.top h1{margin:0;font-size:1.7rem;letter-spacing:-.01em}
header.top p{margin:.35rem 0 0;color:var(--muted);font-size:.9rem}
section{border-top:1px solid var(--line);padding-top:1.6rem;margin-top:2rem}
section:first-of-type{border-top:0;margin-top:0}
section>h3{margin:0;font-size:1.22rem}
.meta{color:var(--muted);font-size:.82rem;margin:.3rem 0 1rem}
.group{font-size:.72rem;letter-spacing:.09em;text-transform:uppercase;color:var(--accent);margin-top:2.5rem}
code{background:var(--code);padding:.12em .35em;border-radius:3px;font-size:.88em;font-family:ui-monospace,SFMono-Regular,Consolas,monospace}
pre{background:var(--code);padding:.9rem 1rem;border-radius:6px;overflow-x:auto}
pre code{background:none;padding:0}
table{border-collapse:collapse;width:100%;display:block;overflow-x:auto;font-size:.9rem}
th,td{border:1px solid var(--line);padding:.4rem .6rem;text-align:left;vertical-align:top}
blockquote{margin:1rem 0;padding:.1rem 1rem;border-left:3px solid var(--line);color:var(--muted)}
.wikilink{color:var(--accent)}
.attachments{color:var(--muted);font-size:.88rem}
footer{border-top:1px solid var(--line);margin-top:3rem;padding-top:1rem;color:var(--muted);font-size:.82rem}
#q{width:100%;padding:.45rem .6rem;margin-bottom:.5rem;border:1px solid var(--line);border-radius:5px;background:var(--bg);color:var(--fg);font:inherit;font-size:.88rem}
#q:focus{outline:2px solid var(--accent);outline-offset:-1px}
.is-hidden{display:none}
@media (max-width:760px){.wrap{grid-template-columns:1fr}nav{position:static;max-height:none}}
`.trim();

/**
 * Filtering, inline.
 *
 * A script is a real cost -- a strict Content-Security-Policy may refuse it -- so this is
 * written to be optional: with the script blocked or JavaScript off, the input is an inert
 * box and every section is still present and linked. Nothing is fetched, so the page keeps
 * its one hard guarantee of making no external requests.
 */
const SEARCH_SCRIPT = `<script>
(function () {
  var q = document.getElementById('q');
  if (!q) return;
  var links = Array.prototype.slice.call(document.querySelectorAll('nav a'));
  var groups = Array.prototype.slice.call(document.querySelectorAll('nav h2'));
  q.addEventListener('input', function () {
    var term = q.value.trim().toLowerCase();
    links.forEach(function (a) {
      var hit = !term || a.textContent.toLowerCase().indexOf(term) !== -1;
      a.classList.toggle('is-hidden', !hit);
    });
    groups.forEach(function (h) {
      var any = false, n = h.nextElementSibling;
      while (n && n.tagName === 'A') {
        if (!n.classList.contains('is-hidden')) any = true;
        n = n.nextElementSibling;
      }
      h.classList.toggle('is-hidden', !any);
    });
  });
})();
</script>`;

export function renderHtml(project: Project, target: HtmlTarget): RenderedFile[] {
  const groups = sections(project);
  const name = escapeHtml(project.name);

  const nav = groups
    .map(
      (g) =>
        `<h2>${escapeHtml(g.group)}</h2>` +
        g.items.map((s) => `<a href="#${s.id}">${escapeHtml(s.title)}</a>`).join(''),
    )
    .join('');

  const main = groups
    .map(
      (g) =>
        `<p class="group">${escapeHtml(g.group)}</p>` +
        g.items
          .map(
            (s) =>
              `<section id="${s.id}"><h3>${escapeHtml(s.title)}</h3>` +
              `<p class="meta">${escapeHtml(s.meta)}</p>${s.body}</section>`,
          )
          .join(''),
    )
    .join('');

  const total = formatTokens(
    project.memory.filter((d) => d.always).reduce((n, d) => n + estimateTokens(d.body), 0),
  );

  const content =
    `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">\n` +
    `<title>${name} — project guide</title>\n<style>\n${STYLE}\n</style>\n</head>\n<body>\n` +
    `<div class="wrap">\n<nav>` +
    '<input id="q" type="search" placeholder="Filter…" aria-label="Filter sections">' +
    `${nav}</nav>\n<main>\n` +
    `<header class="top"><h1>${name}</h1>` +
    `<p>Generated from <code>.wondev/</code>. Always-on context: ≈${total} tokens.</p></header>\n` +
    `${main}\n` +
    `<footer>Generated by wondev. Edit <code>.wondev/</code> and run <code>wondev build</code>.</footer>\n` +
    `</main>\n</div>\n${SEARCH_SCRIPT}\n</body>\n</html>\n`;

  // `whole`, not `region`: this is a complete document, and half a generated HTML file
  // wrapped in someone else's markup would not be a valid page.
  return [{ path: target.path, content, mode: 'whole' }];
}

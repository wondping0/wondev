/**
 * A deliberately small Markdown-to-HTML converter.
 *
 * wondev ships one runtime dependency and this is not worth being the second. The subset is
 * chosen to cover what actually appears in agent knowledge — headings, paragraphs, nested
 * lists, fenced code, tables, blockquotes, and inline emphasis, code, and links.
 *
 * Everything is escaped before any markup is produced, so a document containing HTML is
 * displayed rather than executed. That matters more here than completeness: `.wondev/` is
 * untrusted input by the project's own threat model, and this output is opened in a browser.
 *
 * Unsupported constructs degrade to visible text rather than disappearing. A fenced diagram
 * stays a code block, which is honest about what the page can and cannot draw.
 */

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Whether a link target is safe to put in an `href`.
 *
 * Escaping stops a URL breaking *out* of the attribute; it does nothing about what the URL
 * does when followed. `[click](javascript:alert(1))` escaped perfectly well and still
 * produced a working `javascript:` link in a page built from repository content, which the
 * threat model treats as untrusted.
 *
 * An allowlist rather than a blocklist: `javascript:` is the obvious one, `data:` and `vbs:`
 * are the ones a blocklist forgets. Anything unrecognised renders as plain text, so the link
 * is visible but inert.
 */
export function isSafeHref(href: string): boolean {
  const trimmed = href.trim();
  // Relative paths and same-page anchors carry no scheme and are always fine.
  if (/^[#./]/.test(trimmed) || !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) return true;
  return /^(https?|mailto|ftp):/i.test(trimmed);
}

/** `[ref]: https://…` collected before rendering, so `[text][ref]` can resolve. */
type LinkRefs = Map<string, string>;

const REF_DEFINITION = /^\s{0,3}\[([^\]]+)\]:\s*(\S+)\s*$/;

/**
 * Inline spans, applied to already-escaped text.
 *
 * Code spans are lifted out before anything else runs and restored last. Replacing them in
 * place is not enough: the later passes still walk the text between the `<code>` tags, so
 * `` `a *b* c` `` came back as `a <em>b</em> c`.
 *
 * The `<<CODE0>>` placeholder is unforgeable for a reason worth stating: this runs on text
 * that has already been escaped, so a literal `<` cannot appear in it. A document cannot
 * write a placeholder of its own and have a code span substituted into it.
 */
function inline(text: string, refs: LinkRefs = new Map()): string {
  const codeSpans: string[] = [];
  const withPlaceholders = text.replace(/`([^`]+)`/g, (_m, code: string) => {
    codeSpans.push(code);
    return `<<CODE${codeSpans.length - 1}>>`;
  });

  const link = (label: string, href: string, whole: string): string =>
    isSafeHref(href) ? `<a href="${href}">${label}</a>` : whole;

  const marked = withPlaceholders
    .replace(/\[\[([^\]]+)\]\]/g, (_m, t: string) => `<span class="wikilink">${t}</span>`)
    // Images become links, never `<img src>`. The generated page's one hard guarantee is
    // that it makes no external request, and an image source is a request the moment the
    // page opens -- before anyone chooses to follow anything.
    .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (whole, alt: string, href: string) =>
      link(alt || href, href, whole))
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (whole, label: string, href: string) =>
      link(label, href, whole))
    // Reference style: `[text][ref]`, and `[ref][]` or bare `[ref]` where a definition exists.
    .replace(/\[([^\]]+)\]\[([^\]]*)\]/g, (whole, label: string, key: string) => {
      const href = refs.get((key || label).toLowerCase());
      return href === undefined ? whole : link(label, href, whole);
    })
    .replace(/\[([^\]]+)\]/g, (whole, label: string) => {
      const href = refs.get(label.toLowerCase());
      return href === undefined ? whole : link(label, href, whole);
    })
    .replace(/~~([^~]+)~~/g, '<del>$1</del>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');

  return marked.replace(/<<CODE(\d+)>>/g, (_m, i: string) => `<code>${codeSpans[Number(i)]}</code>`);
}

function tableRow(line: string): string[] {
  return line
    .replace(/^\s*\|/, '')
    .replace(/\|\s*$/, '')
    .split('|')
    .map((c) => c.trim());
}

const isDivider = (line: string): boolean =>
  /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(line) && line.includes('-');

const FENCE = /^\s*(```|~~~)(.*)$/;
const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const SETEXT = /^\s{0,3}(=+|-+)\s*$/;

interface ListLine {
  indent: number;
  ordered: boolean;
  text: string;
}

/** `- [ ] thing` and `- [x] thing`, rendered as something a reader recognises. */
function taskMarker(text: string): string {
  return text.replace(/^\[( |x|X)\]\s+/, (_m, state: string) =>
    state === ' ' ? '☐ ' : '☑ ');
}

/**
 * Build one list, descending into deeper indentation as a child of the item above it.
 *
 * Without this the renderer emitted every item as a sibling, so a two-level procedure came
 * out flat -- the structure a reader uses to tell a step from its sub-steps, silently gone.
 */
function renderList(items: ListLine[], start: number, refs: LinkRefs): [string, number] {
  const base = (items[start] as ListLine).indent;
  const ordered = (items[start] as ListLine).ordered;
  const parts: string[] = [];
  let i = start;

  while (i < items.length) {
    const item = items[i] as ListLine;
    if (item.indent < base) break;

    if (item.indent > base) {
      const [nested, next] = renderList(items, i, refs);
      // Nested lists belong inside the item they hang from, not after it.
      const previous = parts.pop() ?? '<li></li>';
      parts.push(previous.replace(/<\/li>$/, `${nested}</li>`));
      i = next;
      continue;
    }

    // A change of marker at the same depth starts a new list rather than continuing this one.
    if (item.ordered !== ordered) break;

    parts.push(`<li>${inline(taskMarker(item.text), refs)}</li>`);
    i += 1;
  }

  const tag = ordered ? 'ol' : 'ul';
  return [`<${tag}>${parts.join('')}</${tag}>`, i];
}

export function markdownToHtml(source: string): string {
  const escaped = escapeHtml(source);

  // Reference definitions are collected first and removed, so they never render as text.
  const refs: LinkRefs = new Map();
  const lines: string[] = [];
  for (const line of escaped.split('\n')) {
    const match = REF_DEFINITION.exec(line);
    if (match?.[1] && match[2]) {
      refs.set(match[1].toLowerCase(), match[2]);
      continue;
    }
    lines.push(line);
  }

  const out: string[] = [];
  let i = 0;
  let paragraph: string[] = [];

  const flushParagraph = (): void => {
    if (paragraph.length === 0) return;
    out.push(`<p>${inline(paragraph.join(' '), refs)}</p>`);
    paragraph = [];
  };

  while (i < lines.length) {
    const line = lines[i] as string;

    // Fenced code. The fence language is kept as a class so a diagram block is at least
    // labelled as one, even though nothing here draws it.
    const fence = FENCE.exec(line);
    if (fence) {
      flushParagraph();
      const marker = fence[1] as string;
      const lang = (fence[2] ?? '').trim();
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !(lines[i] as string).trimStart().startsWith(marker)) {
        body.push(lines[i] as string);
        i += 1;
      }
      i += 1; // closing fence
      const cls = lang ? ` class="lang-${lang.replace(/[^a-zA-Z0-9-]/g, '')}"` : '';
      out.push(`<pre${cls}><code>${body.join('\n')}</code></pre>`);
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph();
      const level = (heading[1] as string).length;
      out.push(`<h${level}>${inline((heading[2] as string).trim(), refs)}</h${level}>`);
      i += 1;
      continue;
    }

    // Setext: an underline turns the paragraph above it into a heading. Checked before the
    // horizontal rule, because `---` is both, and which one it is depends on what precedes.
    const setext = SETEXT.exec(line);
    if (setext && paragraph.length > 0) {
      const level = (setext[1] as string).startsWith('=') ? 1 : 2;
      out.push(`<h${level}>${inline(paragraph.join(' '), refs)}</h${level}>`);
      paragraph = [];
      i += 1;
      continue;
    }

    if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) {
      flushParagraph();
      out.push('<hr>');
      i += 1;
      continue;
    }

    // Table: a pipe row followed by a divider row.
    if (line.includes('|') && i + 1 < lines.length && isDivider(lines[i + 1] as string)) {
      flushParagraph();
      const head = tableRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && (lines[i] as string).includes('|')) {
        rows.push(tableRow(lines[i] as string));
        i += 1;
      }
      out.push(
        `<table><thead><tr>${head.map((c) => `<th>${inline(c, refs)}</th>`).join('')}</tr></thead>` +
          `<tbody>${rows
            .map((r) => `<tr>${r.map((c) => `<td>${inline(c, refs)}</td>`).join('')}</tr>`)
            .join('')}</tbody></table>`,
      );
      continue;
    }

    if (LIST_ITEM.test(line)) {
      flushParagraph();
      const items: ListLine[] = [];
      while (i < lines.length) {
        const raw = lines[i] as string;
        const m = LIST_ITEM.exec(raw);

        if (m) {
          items.push({
            indent: (m[1] ?? '').length,
            ordered: /\d/.test(m[2] ?? ''),
            text: (m[3] ?? '').trim(),
          });
          i += 1;
          continue;
        }

        // A wrapped line belonging to the item above it. Without this the list ends at the
        // first wrapped line, so a document that indents continuation text -- the ordinary
        // way to write a list item longer than one line -- came out as a list, a stray
        // paragraph, and then a second list that should have been nested inside the first.
        //
        // A fence is not treated as continuation: swallowing it as prose would destroy the
        // code block, which is worse than ending the list here.
        const last = items[items.length - 1];
        const indent = raw.length - raw.trimStart().length;
        if (last && raw.trim() !== '' && indent > last.indent && !FENCE.test(raw)) {
          last.text = `${last.text} ${raw.trim()}`;
          i += 1;
          continue;
        }

        break;
      }
      let cursor = 0;
      while (cursor < items.length) {
        const [html, next] = renderList(items, cursor, refs);
        out.push(html);
        cursor = next;
      }
      continue;
    }

    const quote = /^\s*&gt;\s?(.*)$/.exec(line);
    if (quote) {
      flushParagraph();
      const body: string[] = [];
      while (i < lines.length) {
        const m = /^\s*&gt;\s?(.*)$/.exec(lines[i] as string);
        if (!m) break;
        body.push(m[1] as string);
        i += 1;
      }
      out.push(`<blockquote>${inline(body.join(' '), refs)}</blockquote>`);
      continue;
    }

    if (line.trim() === '') {
      flushParagraph();
      i += 1;
      continue;
    }

    paragraph.push(line.trim());
    i += 1;
  }

  flushParagraph();
  return out.join('\n');
}

/**
 * A deliberately small Markdown-to-HTML converter.
 *
 * wondev ships one runtime dependency and this is not worth being the second. The subset is
 * chosen to cover what actually appears in agent knowledge — headings, paragraphs, lists,
 * fenced code, tables, blockquotes, and inline emphasis, code, and links — and nothing else.
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
function inline(text: string): string {
  const codeSpans: string[] = [];
  const withPlaceholders = text.replace(/`([^`]+)`/g, (_m, code: string) => {
    codeSpans.push(code);
    return `<<CODE${codeSpans.length - 1}>>`;
  });

  const marked = withPlaceholders
    .replace(/\[\[([^\]]+)\]\]/g, (_m, t: string) => `<span class="wikilink">${t}</span>`)
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (whole, label: string, href: string) =>
      isSafeHref(href) ? `<a href="${href}">${label}</a>` : whole)
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

const isDivider = (line: string): boolean => /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(line) && line.includes('-');

export function markdownToHtml(source: string): string {
  const lines = escapeHtml(source).split('\n');
  const out: string[] = [];

  let i = 0;
  let paragraph: string[] = [];

  const flushParagraph = (): void => {
    if (paragraph.length === 0) return;
    out.push(`<p>${inline(paragraph.join(' '))}</p>`);
    paragraph = [];
  };

  while (i < lines.length) {
    const line = lines[i] as string;

    // Fenced code. The fence language is kept as a class so a diagram block is at least
    // labelled as one, even though nothing here draws it.
    const fence = /^\s*(```|~~~)(.*)$/.exec(line);
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
      out.push(`<h${level}>${inline((heading[2] as string).trim())}</h${level}>`);
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
        `<table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead>` +
          `<tbody>${rows
            .map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`)
            .join('')}</tbody></table>`,
      );
      continue;
    }

    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      flushParagraph();
      const ordered = numbered !== null;
      const items: string[] = [];
      while (i < lines.length) {
        const m = ordered
          ? /^\s*\d+[.)]\s+(.*)$/.exec(lines[i] as string)
          : /^\s*[-*+]\s+(.*)$/.exec(lines[i] as string);
        if (!m) break;
        items.push(`<li>${inline((m[1] as string).trim())}</li>`);
        i += 1;
      }
      out.push(ordered ? `<ol>${items.join('')}</ol>` : `<ul>${items.join('')}</ul>`);
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
      out.push(`<blockquote>${inline(body.join(' '))}</blockquote>`);
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

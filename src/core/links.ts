import path from 'node:path';
import type { MemoryDoc } from './model.js';
import type { Issue } from './source.js';

export interface NoteLink {
  target: string;
  anchor: string;
  raw: string;
  relative: boolean;
}

/** Examples are not graph edges. Keep line breaks so headings still parse correctly. */
export function proseOnly(body: string, stripInline = true): string {
  let fence = '';
  return body.replace(/<!--[\s\S]*?-->/g, '').split('\n').map((line) => {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker && (!fence || marker[0] === fence[0] && marker.length >= fence.length)) {
      fence = fence ? '' : marker;
      return '';
    }
    return fence ? '' : stripInline ? line.replace(/(`+)[\s\S]*?\1/g, '') : line;
  }).join('\n');
}

export function parseNoteLink(raw: string, relative = false): NoteLink {
  const unwrapped = raw.replace(/^!?\[\[/, '').replace(/\]\]$/, '').split('|')[0]!.trim();
  let decoded = unwrapped;
  try { decoded = decodeURIComponent(unwrapped); } catch { /* Keep malformed URLs diagnosable. */ }
  const hash = decoded.indexOf('#');
  return {
    target: (hash < 0 ? decoded : decoded.slice(0, hash)).replace(/\.md$/i, ''),
    anchor: hash < 0 ? '' : decoded.slice(hash + 1),
    raw,
    relative,
  };
}

export function noteLinks(body: string): NoteLink[] {
  const prose = proseOnly(body);
  const out: NoteLink[] = [];
  for (const match of prose.matchAll(/!?\[\[([^\]]+)\]\]/g)) out.push(parseNoteLink(match[0]));
  for (const match of prose.matchAll(/!?\[[^\]\n]*\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+"[^"]*")?\s*\)/g)) {
    const target = match[1] ?? match[2]!;
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(target)) continue;
    out.push(parseNoteLink(target, true));
  }
  return out.filter((link) => /\.md(?:#|\||\]\]|$)/i.test(link.raw) || !/\.(?:png|jpe?g|gif|svg|webp|pdf|mp[34]|wav|csv|json|ya?ml|[cm]?[jt]sx?|py|sh|zip|base|canvas)$/i.test(link.target));
}

function key(value: string): string { return value.normalize('NFKC').toLowerCase(); }

/** Exact paths win; basename and alias lookup must be unambiguous. */
export function resolveNote(memory: MemoryDoc[], link: NoteLink, from?: MemoryDoc): MemoryDoc[] {
  if (!link.target) return from ? [from] : [];
  const target = key(link.target);
  const matches = (candidate: string | undefined): boolean => candidate !== undefined && key(candidate) === target;
  const local = from && (link.relative || link.target.startsWith('.'))
    ? path.posix.normalize(path.posix.join(path.posix.dirname(from.sourcePath), `${link.target}.md`))
    : undefined;
  if (local) {
    const found = memory.filter((doc) => key(doc.sourcePath) === key(local));
    if (found.length) return found;
    if (link.relative || link.target.startsWith('.')) return [];
  }
  const exact = memory.filter((doc) => matches(doc.id) || matches(doc.slug) || matches(doc.vaultPath) || matches(doc.sourcePath.replace(/\.md$/, '')));
  if (exact.length) return exact;
  return memory.filter((doc) => matches(path.posix.basename(doc.slug)) || doc.aliases?.some(matches));
}

function hasAnchor(doc: MemoryDoc, anchor: string): boolean {
  const body = proseOnly(doc.body, false);
  if (anchor.startsWith('^')) {
    return body.split('\n').some((line) => line.trimEnd().endsWith(anchor));
  }
  const headings = [...body.matchAll(/^#{1,6}\s+(.+?)\s*#*\s*$/gm)].map((m) => key(m[1]!.replace(/[`*_~]/g, '')));
  return anchor.split('#').every((part) => headings.some((heading) =>
    heading === key(part) || heading.replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s+/g, '-') === key(part),
  ));
}

/** Rewrite note destinations while leaving code, comments, labels, and anchors intact. */
export function rewriteNoteTargets(body: string, rename: (target: string, relative: boolean) => string | undefined): string {
  let fence = '';
  let comment = false;
  const transform = (text: string): string => text.split(/(`+[^`]*`+)/g).map((part) => {
    if (part.startsWith('`')) return part;
    const destination = (raw: string, relative: boolean): string => {
      if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(raw)) return raw;
      const end = raw.search(/[#|]/);
      const target = end < 0 ? raw : raw.slice(0, end);
      let decoded = target;
      try { decoded = decodeURIComponent(target); } catch { return raw; }
      const next = rename(decoded.replace(/\.md$/i, ''), relative);
      return next === undefined ? raw : `${next}${relative || /\.md$/i.test(target) ? '.md' : ''}${end < 0 ? '' : raw.slice(end)}`;
    };
    return part.replace(/\[\[([^\]]+)\]\]|(!?\[[^\]\n]*\]\(\s*)(<[^>]+>|[^\s)]+)(\s*(?:"[^"]*"\s*)?\))/g,
      (whole, wiki: string | undefined, prefix: string, target: string, suffix: string) => {
        if (wiki !== undefined) return `[[${destination(wiki, false)}]]`;
        const angle = target.startsWith('<');
        return `${prefix}${angle ? '<' : ''}${destination(angle ? target.slice(1, -1) : target, true)}${angle ? '>' : ''}${suffix}`;
      });
  }).join('');
  return body.split('\n').map((line) => {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (!comment && marker && (!fence || marker[0] === fence[0] && marker.length >= fence.length)) { fence = fence ? '' : marker; return line; }
    if (fence) return line;
    let rest = line;
    let output = '';
    while (rest) {
      const position = rest.indexOf(comment ? '-->' : '<!--');
      if (position < 0) { output += comment ? rest : transform(rest); break; }
      const length = comment ? 3 : 4;
      output += comment ? rest.slice(0, position + length) : transform(rest.slice(0, position)) + '<!--';
      rest = rest.slice(position + length);
      comment = !comment;
    }
    return output;
  }).join('\n');
}

export function memoryLinkIssues(memory: MemoryDoc[]): Issue[] {
  const issues: Issue[] = [];
  const identities = new Map<string, string>();
  for (const doc of memory) {
    const identity = doc.id ?? doc.slug;
    const previous = identities.get(key(identity));
    if (previous) issues.push({ level: 'error', file: doc.sourcePath, message: `duplicate memory id "${identity}" (also ${previous})` });
    identities.set(key(identity), doc.sourcePath);
    const links = [...noteLinks(doc.body), ...(doc.related ?? []).map((r) => parseNoteLink(r))];
    for (const link of links) {
      const found = resolveNote(memory, link, doc);
      const reason = found.length === 0 ? 'unresolved memory link'
        : found.length > 1 ? 'ambiguous memory link'
        : link.anchor && !hasAnchor(found[0]!, link.anchor) ? 'unresolved memory heading or block' : undefined;
      if (reason) issues.push({ level: 'error', file: doc.sourcePath, message: `${reason} ${link.raw}` });
    }
  }
  return issues;
}

export function relatedNotes(memory: MemoryDoc[], doc: MemoryDoc): MemoryDoc[] {
  const links = [...noteLinks(doc.body), ...(doc.related ?? []).map((r) => parseNoteLink(r))];
  return [...new Set(links.flatMap((link) => {
    const found = resolveNote(memory, link, doc);
    return found.length === 1 ? found : [];
  }))].filter((other) => other !== doc);
}

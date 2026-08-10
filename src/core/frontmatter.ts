import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { WondevError } from '../util/errors.js';

export interface ParsedDocument {
  data: Record<string, unknown>;
  body: string;
}

/** U+FEFF, written as an escape so no invisible character sits in this source file. */
const BOM = String.fromCharCode(0xfeff);

/**
 * A leading BOM is tolerated because Windows editors add one; without this the opening
 * delimiter fails to match and the entire frontmatter block silently becomes body text.
 */
const FRONTMATTER = new RegExp(
  `^${BOM}?---[ \\t]*\\r?\\n([\\s\\S]*?)\\r?\\n---[ \\t]*(?:\\r?\\n|$)`,
);

export function parseFrontmatter(raw: string, sourcePath: string): ParsedDocument {
  const match = FRONTMATTER.exec(raw);
  if (!match) {
    const body = raw.startsWith(BOM) ? raw.slice(BOM.length) : raw;
    return { data: {}, body: body.trim() };
  }
  let data: unknown;
  try {
    data = parseYaml(match[1] ?? '');
  } catch (err) {
    throw new WondevError(
      `${sourcePath}: invalid YAML frontmatter - ${(err as Error).message}`,
      'Frontmatter must be valid YAML between two `---` lines.',
    );
  }
  if (data === null || data === undefined) data = {};
  if (typeof data !== 'object' || Array.isArray(data)) {
    throw new WondevError(`${sourcePath}: frontmatter must be a YAML mapping.`);
  }
  return {
    data: data as Record<string, unknown>,
    body: raw.slice(match[0].length).trim(),
  };
}

/** Render a frontmatter block plus body. Emits no block when `data` has no usable keys. */
export function stringifyFrontmatter(data: Record<string, unknown>, body: string): string {
  const entries = Object.entries(data).filter(([, v]) => v !== undefined && v !== null);
  if (entries.length === 0) return `${body.trim()}\n`;
  const yaml = stringifyYaml(Object.fromEntries(entries), { lineWidth: 0 }).trimEnd();
  return `---\n${yaml}\n---\n\n${body.trim()}\n`;
}

export function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

export function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

/** Accepts `globs: "src/**"` and `globs: ["src/**", "test/**"]` alike. */
export function asStringArray(value: unknown): string[] | undefined {
  if (typeof value === 'string' && value.trim() !== '') return [value.trim()];
  if (Array.isArray(value)) {
    const out = value
      .filter((v): v is string => typeof v === 'string' && v.trim() !== '')
      .map((v) => v.trim());
    return out.length > 0 ? out : undefined;
  }
  return undefined;
}

import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { WONDEV_DIR, sourceFile, type SourceConfig } from './config.js';
import { listFilesRecursive, normalizeEol, readFileIfExists, sha256, writeFileAtomic } from '../util/fs.js';
import { absFrom } from '../util/paths.js';

export const TEMPLATES_REL = `${WONDEV_DIR}/.templates.json`;

/**
 * The starter pack shipped inside the installed package.
 *
 * Resolves two levels up, which is the package root both from `dist/core/` and `src/core/`,
 * so the same code path works under vitest and from an npm install.
 */
export function templatesDir(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'templates');
}

export interface TemplateRecord {
  /** Hash of the shipped template at the time it was written into this project. */
  hash: string;
  /** The wondev version that supplied it. */
  from: string;
}

export interface TemplateManifest {
  version: string;
  files: Record<string, TemplateRecord>;
  /** Selective installs in adopted projects must not add unrelated starter templates. */
  scope?: string[];
}

/**
 * Provenance for starter-pack files.
 *
 * Without a record of what the shipped template *was*, an upgrade cannot tell a file the
 * user carefully rewrote from one they never touched, and would have to either clobber
 * edits or never update anything.
 */
export async function loadTemplateManifest(root: string): Promise<TemplateManifest | null> {
  const raw = await readFileIfExists(absFrom(root, TEMPLATES_REL));
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as TemplateManifest;
    if (typeof parsed !== 'object' || parsed === null || typeof parsed.files !== 'object') {
      return null;
    }
    if (parsed.scope !== undefined && (!Array.isArray(parsed.scope) || parsed.scope.some((s) => typeof s !== 'string' || !/^skills\/[a-z0-9][a-z0-9-]*$/.test(s)))) return null;
    return { version: parsed.version ?? '0.0.0', files: parsed.files ?? {}, ...(parsed.scope ? { scope: parsed.scope } : {}) };
  } catch {
    return null;
  }
}

export async function saveTemplateManifest(
  root: string,
  manifest: TemplateManifest,
): Promise<void> {
  const sorted: TemplateManifest = {
    version: manifest.version,
    ...(manifest.scope ? { scope: manifest.scope } : {}),
    files: Object.fromEntries(
      Object.entries(manifest.files).sort(([a], [b]) => a.localeCompare(b)),
    ),
  };
  await writeFileAtomic(absFrom(root, TEMPLATES_REL), `${JSON.stringify(sorted, null, 2)}\n`);
}

/** Every shipped template file, as POSIX paths relative to the templates root. */
export async function listTemplateFiles(templatesDir: string): Promise<string[]> {
  return (await listFilesRecursive(templatesDir)).map((rel) => rel === 'gitignore' ? '.gitignore' : rel).sort();
}

/** npm omits or renames .gitignore; keep its packaged name distinct from its authored path. */
export function templateSourceFile(templatesDir: string, rel: string): string {
  return path.join(templatesDir, rel === '.gitignore' ? 'gitignore' : rel);
}

export async function hashTemplateFile(templatesDir: string, rel: string): Promise<string> {
  const raw = await fs.readFile(templateSourceFile(templatesDir, rel), 'utf8');
  return sha256(normalizeEol(raw));
}

/** Hash of the user's copy, or null when they deleted it. */
export async function hashProjectFile(root: string, rel: string, sources?: SourceConfig): Promise<string | null> {
  const raw = await readFileIfExists(path.join(root, sourceFile(rel, sources)));
  return raw === null ? null : sha256(normalizeEol(raw));
}

/** Record the shipped state of every template file copied into a fresh project. */
export async function recordTemplates(
  root: string,
  templatesDir: string,
  version: string,
): Promise<void> {
  const files: Record<string, TemplateRecord> = {};
  for (const rel of await listTemplateFiles(templatesDir)) {
    files[rel] = { hash: await hashTemplateFile(templatesDir, rel), from: version };
  }
  await saveTemplateManifest(root, { version, files });
}

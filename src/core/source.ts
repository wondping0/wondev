import path from 'node:path';
import fs from 'node:fs/promises';
import type { Command, MemoryDoc, Project, Skill } from './model.js';
import { asBoolean, asString, asStringArray, parseFrontmatter } from './frontmatter.js';
import { listFilesRecursive, normalizeEol, readFileIfExists } from '../util/fs.js';
import { toPosix } from '../util/paths.js';
import { WONDEV_DIR, wondevDir } from './config.js';

export interface Issue {
  level: 'error' | 'warning';
  file: string;
  message: string;
}

export interface LoadResult {
  project: Project;
  issues: Issue[];
}

/** Names become filenames in every target, so they are restricted to a safe shape. */
const NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

const MEMORY_SUBDIR = 'memory';
const SKILLS_SUBDIR = 'skills';
const COMMANDS_SUBDIR = 'commands';

/**
 * Read `.wondev/` into a `Project`.
 *
 * Problems are collected as issues rather than thrown, so `wondev check` can report every
 * fault in one pass instead of making the user fix them one at a time. `build` refuses to
 * proceed when any issue has level `error`.
 */
export async function loadProject(root: string, projectName: string): Promise<LoadResult> {
  const base = wondevDir(root);
  const issues: Issue[] = [];

  const memory = await loadMemory(path.join(base, MEMORY_SUBDIR), issues);
  const skills = await loadSkills(path.join(base, SKILLS_SUBDIR), issues);
  const commands = await loadCommands(path.join(base, COMMANDS_SUBDIR), issues);

  checkMemoryLinks(memory, issues);

  const project: Project = { name: projectName, memory, skills, commands };
  return { project, issues };
}

export function hasErrors(issues: Issue[]): boolean {
  return issues.some((i) => i.level === 'error');
}

async function loadMemory(dir: string, issues: Issue[]): Promise<MemoryDoc[]> {
  const files = (await listFilesRecursive(dir)).filter((f) => f.endsWith('.md'));
  const docs: MemoryDoc[] = [];
  const seen = new Map<string, string>();

  for (const rel of files) {
    const sourcePath = toPosix(path.join(WONDEV_DIR, MEMORY_SUBDIR, rel));
    const raw = normalizeEol((await fs.readFile(path.join(dir, rel), 'utf8')));
    const { data, body } = parseFrontmatter(raw, sourcePath);
    const slug = rel.replace(/\.md$/, '');

    const previous = seen.get(slug);
    if (previous) {
      issues.push({ level: 'error', file: sourcePath, message: `duplicate memory slug "${slug}" (also ${previous})` });
      continue;
    }
    seen.set(slug, sourcePath);

    const title = asString(data['title']) ?? firstHeading(body) ?? humanize(path.basename(slug));
    if (body.trim() === '') {
      issues.push({ level: 'warning', file: sourcePath, message: 'memory document is empty' });
    }

    const doc: MemoryDoc = {
      slug,
      title,
      always: asBoolean(data['always']) ?? false,
      body,
      sourcePath,
    };
    const description = asString(data['description']);
    if (description) doc.description = description;
    const globs = asStringArray(data['globs']);
    if (globs) doc.globs = globs;
    docs.push(doc);
  }

  // Always-on docs first so flattened targets lead with the most important context.
  return docs.sort((a, b) => {
    if (a.always !== b.always) return a.always ? -1 : 1;
    return a.slug.localeCompare(b.slug);
  });
}

async function loadSkills(dir: string, issues: Issue[]): Promise<Skill[]> {
  const candidates = await findSkillFiles(dir);
  const skills: Skill[] = [];
  const seen = new Map<string, string>();

  for (const { file, fallbackName } of candidates) {
    const rel = toPosix(path.relative(dir, file));
    const sourcePath = toPosix(path.join(WONDEV_DIR, SKILLS_SUBDIR, rel));
    const raw = normalizeEol(await fs.readFile(file, 'utf8'));
    const { data, body } = parseFrontmatter(raw, sourcePath);

    const name = asString(data['name']) ?? fallbackName;
    if (!NAME_PATTERN.test(name)) {
      issues.push({
        level: 'error',
        file: sourcePath,
        message: `skill name "${name}" must be kebab-case (lowercase letters, digits, hyphens)`,
      });
      continue;
    }
    const previous = seen.get(name);
    if (previous) {
      issues.push({ level: 'error', file: sourcePath, message: `duplicate skill name "${name}" (also ${previous})` });
      continue;
    }
    seen.set(name, sourcePath);

    const description = asString(data['description']);
    if (!description) {
      issues.push({
        level: 'error',
        file: sourcePath,
        message: 'skill is missing a `description` in frontmatter',
      });
      continue;
    }

    const skill: Skill = { name, description, body, sourcePath };
    const globs = asStringArray(data['globs']);
    if (globs) skill.globs = globs;
    skills.push(skill);
  }

  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

/** Accepts both `skills/<name>/SKILL.md` and the flatter `skills/<name>.md`. */
async function findSkillFiles(dir: string): Promise<Array<{ file: string; fallbackName: string }>> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }

  const out: Array<{ file: string; fallbackName: string }> = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isDirectory()) {
      const skillFile = path.join(dir, entry.name, 'SKILL.md');
      if (await readFileIfExists(skillFile) !== null) {
        out.push({ file: skillFile, fallbackName: entry.name });
      }
    } else if (entry.isFile() && entry.name.endsWith('.md') && entry.name !== 'README.md') {
      out.push({ file: path.join(dir, entry.name), fallbackName: entry.name.replace(/\.md$/, '') });
    }
  }
  return out;
}

async function loadCommands(dir: string, issues: Issue[]): Promise<Command[]> {
  const files = (await listFilesRecursive(dir)).filter(
    (f) => f.endsWith('.md') && path.basename(f) !== 'README.md',
  );
  const commands: Command[] = [];
  const seen = new Map<string, string>();

  for (const rel of files) {
    const sourcePath = toPosix(path.join(WONDEV_DIR, COMMANDS_SUBDIR, rel));
    const raw = normalizeEol(await fs.readFile(path.join(dir, rel), 'utf8'));
    const { data, body } = parseFrontmatter(raw, sourcePath);

    const name = asString(data['name']) ?? path.basename(rel).replace(/\.md$/, '');
    if (!NAME_PATTERN.test(name)) {
      issues.push({
        level: 'error',
        file: sourcePath,
        message: `command name "${name}" must be kebab-case (lowercase letters, digits, hyphens)`,
      });
      continue;
    }
    const previous = seen.get(name);
    if (previous) {
      issues.push({ level: 'error', file: sourcePath, message: `duplicate command name "${name}" (also ${previous})` });
      continue;
    }
    seen.set(name, sourcePath);

    const description = asString(data['description']);
    if (!description) {
      issues.push({
        level: 'error',
        file: sourcePath,
        message: 'command is missing a `description` in frontmatter',
      });
      continue;
    }

    commands.push({ name, description, body, sourcePath });
  }

  return commands.sort((a, b) => a.name.localeCompare(b.name));
}

const WIKILINK = /\[\[([^\]]+)\]\]/g;

/** `[[slug]]` cross-references only help if they resolve, so unresolved ones are errors. */
function checkMemoryLinks(memory: MemoryDoc[], issues: Issue[]): void {
  const slugs = new Set(memory.map((m) => m.slug));
  const basenames = new Set(memory.map((m) => path.basename(m.slug)));
  for (const doc of memory) {
    for (const match of doc.body.matchAll(WIKILINK)) {
      const link = (match[1] ?? '').trim();
      if (link === '') continue;
      if (!slugs.has(link) && !basenames.has(link)) {
        issues.push({
          level: 'error',
          file: doc.sourcePath,
          message: `unresolved memory link [[${link}]]`,
        });
      }
    }
  }
}

function firstHeading(body: string): string | undefined {
  const m = /^#\s+(.+)$/m.exec(body);
  return m?.[1]?.trim();
}

function humanize(slug: string): string {
  return slug
    .split('-')
    .filter(Boolean)
    .map((w) => (w[0] ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

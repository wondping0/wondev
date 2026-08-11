import path from 'node:path';
import fs from 'node:fs/promises';
import type { Agent, Attachment, Command, MemoryDoc, Project, Skill } from './model.js';
import { asBoolean, asString, asStringArray, parseFrontmatter } from './frontmatter.js';
import { listFilesRecursive, normalizeEol, pathExists } from '../util/fs.js';
import { IO_CONCURRENCY, mapLimit } from '../util/async.js';
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
const AGENTS_SUBDIR = 'agents';

/** Keys wondev acts on. Everything else is carried through untouched in `extra`. */
const INTERPRETED_MEMORY_KEYS = new Set([
  'title',
  'description',
  'always',
  'globs',
  'verified',
  'verifiedAgainst',
]);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Only markdown: every other byte sequence would be corrupted by the generated header. */
const ATTACHMENT_EXT = '.md';

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

  // The three directories are independent, so they load together. Each collects into its
  // own issue list first, which keeps reported order stable regardless of completion order.
  const memoryIssues: Issue[] = [];
  const skillIssues: Issue[] = [];
  const commandIssues: Issue[] = [];
  const agentIssues: Issue[] = [];

  const [memory, skills, commands, agents] = await Promise.all([
    loadMemory(path.join(base, MEMORY_SUBDIR), memoryIssues),
    loadSkills(path.join(base, SKILLS_SUBDIR), skillIssues),
    loadCommands(path.join(base, COMMANDS_SUBDIR), commandIssues),
    loadAgents(path.join(base, AGENTS_SUBDIR), agentIssues),
  ]);
  issues.push(...memoryIssues, ...skillIssues, ...commandIssues, ...agentIssues);

  checkMemoryLinks(memory, issues);

  const project: Project = { name: projectName, memory, skills, commands, agents };
  return { project, issues };
}

export function hasErrors(issues: Issue[]): boolean {
  return issues.some((i) => i.level === 'error');
}

async function loadMemory(dir: string, issues: Issue[]): Promise<MemoryDoc[]> {
  const files = (await listFilesRecursive(dir)).filter((f) => f.endsWith('.md'));
  const contents = await mapLimit(files, IO_CONCURRENCY, async (rel) =>
    normalizeEol(await fs.readFile(path.join(dir, rel), 'utf8')),
  );

  const docs: MemoryDoc[] = [];
  const seen = new Map<string, string>();

  for (const [index, rel] of files.entries()) {
    const sourcePath = toPosix(path.join(WONDEV_DIR, MEMORY_SUBDIR, rel));
    const raw = contents[index] as string;
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
      extra: Object.fromEntries(
        Object.entries(data).filter(([k]) => !INTERPRETED_MEMORY_KEYS.has(k)),
      ),
      body,
      sourcePath,
    };
    const description = asString(data['description']);
    if (description) doc.description = description;
    const globs = asStringArray(data['globs']);
    if (globs) doc.globs = globs;

    const verified = asString(data['verified']);
    if (verified !== undefined) {
      // A malformed date must not become a tick in the index. Saying "checked" when nobody
      // checked is worse than saying nothing.
      if (ISO_DATE.test(verified)) {
        doc.verified = verified;
      } else {
        issues.push({
          level: 'warning',
          file: sourcePath,
          message: `verified must be YYYY-MM-DD (got "${verified}"); ignoring it`,
        });
      }
    }
    const against = asString(data['verifiedAgainst']);
    if (against) doc.verifiedAgainst = against;

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
  const contents = await mapLimit(candidates, IO_CONCURRENCY, async ({ file }) =>
    normalizeEol(await fs.readFile(file, 'utf8')),
  );
  const extras = await mapLimit(candidates, IO_CONCURRENCY, ({ dir: skillDir }) =>
    loadAttachments(skillDir),
  );

  const skills: Skill[] = [];
  const seen = new Map<string, string>();

  for (const [index, { file, fallbackName }] of candidates.entries()) {
    const rel = toPosix(path.relative(dir, file));
    const sourcePath = toPosix(path.join(WONDEV_DIR, SKILLS_SUBDIR, rel));
    const raw = contents[index] as string;
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

    const { attachments, skipped } = extras[index] as Awaited<ReturnType<typeof loadAttachments>>;
    for (const s of skipped) {
      issues.push({
        level: 'warning',
        file: sourcePath,
        message: `ignoring "${s}": skill attachments must be ${ATTACHMENT_EXT} files`,
      });
    }

    const skill: Skill = { name, description, attachments, body, sourcePath };
    const globs = asStringArray(data['globs']);
    if (globs) skill.globs = globs;
    skills.push(skill);
  }

  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

/** A skill's `SKILL.md`, plus the directory holding it when there is one. */
interface SkillCandidate {
  file: string;
  fallbackName: string;
  /** Null for the flat `skills/<name>.md` form, which can carry no attachments. */
  dir: string | null;
}

/** Accepts both `skills/<name>/SKILL.md` and the flatter `skills/<name>.md`. */
async function findSkillFiles(dir: string): Promise<SkillCandidate[]> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }

  const sorted = entries.sort((a, b) => a.name.localeCompare(b.name));

  // Probing each directory for a SKILL.md is one stat per skill; done together it is one
  // round trip instead of N.
  const found = await mapLimit(sorted, IO_CONCURRENCY, async (entry) => {
    if (entry.isDirectory()) {
      const skillDir = path.join(dir, entry.name);
      const skillFile = path.join(skillDir, 'SKILL.md');
      return (await pathExists(skillFile))
        ? { file: skillFile, fallbackName: entry.name, dir: skillDir }
        : null;
    }
    if (entry.isFile() && entry.name.endsWith('.md') && entry.name !== 'README.md') {
      return {
        file: path.join(dir, entry.name),
        fallbackName: entry.name.replace(/\.md$/, ''),
        dir: null,
      };
    }
    return null;
  });

  return found.filter((v): v is SkillCandidate => v !== null);
}

/**
 * Everything in a skill directory except `SKILL.md`, which the skill body already covers.
 *
 * Warnings are returned rather than pushed so the caller can emit them in candidate order;
 * concurrent loading would otherwise make the report order depend on disk timing.
 */
async function loadAttachments(
  dir: string | null,
): Promise<{ attachments: Attachment[]; skipped: string[] }> {
  if (dir === null) return { attachments: [], skipped: [] };

  const rel = (await listFilesRecursive(dir))
    .map(toPosix)
    .filter((f) => f !== 'SKILL.md')
    .sort();

  const skipped = rel.filter((f) => !f.endsWith(ATTACHMENT_EXT));
  const keep = rel.filter((f) => f.endsWith(ATTACHMENT_EXT));

  const contents = await mapLimit(keep, IO_CONCURRENCY, async (r) =>
    normalizeEol(await fs.readFile(path.join(dir, r), 'utf8')),
  );

  return {
    attachments: keep.map((relPath, i) => ({ relPath, content: contents[i] as string })),
    skipped,
  };
}

async function loadCommands(dir: string, issues: Issue[]): Promise<Command[]> {
  const files = (await listFilesRecursive(dir)).filter(
    (f) => f.endsWith('.md') && path.basename(f) !== 'README.md',
  );
  const contents = await mapLimit(files, IO_CONCURRENCY, async (rel) =>
    normalizeEol(await fs.readFile(path.join(dir, rel), 'utf8')),
  );

  const commands: Command[] = [];
  const seen = new Map<string, string>();

  for (const [index, rel] of files.entries()) {
    const sourcePath = toPosix(path.join(WONDEV_DIR, COMMANDS_SUBDIR, rel));
    const raw = contents[index] as string;
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

/**
 * Read `.wondev/agents/`.
 *
 * Deliberately the same shape as commands rather than skills: a subagent is one file with a
 * dispatch rule, and giving it a directory would invite reference material that the hosts
 * which support subagents do not load anyway.
 */
async function loadAgents(dir: string, issues: Issue[]): Promise<Agent[]> {
  const files = (await listFilesRecursive(dir)).filter(
    (f) => f.endsWith('.md') && path.basename(f) !== 'README.md',
  );
  const contents = await mapLimit(files, IO_CONCURRENCY, async (rel) =>
    normalizeEol(await fs.readFile(path.join(dir, rel), 'utf8')),
  );

  const agents: Agent[] = [];
  const seen = new Map<string, string>();

  for (const [index, rel] of files.entries()) {
    const sourcePath = toPosix(path.join(WONDEV_DIR, AGENTS_SUBDIR, rel));
    const raw = contents[index] as string;
    const { data, body } = parseFrontmatter(raw, sourcePath);

    const name = asString(data['name']) ?? path.basename(rel).replace(/\.md$/, '');
    if (!NAME_PATTERN.test(name)) {
      issues.push({
        level: 'error',
        file: sourcePath,
        message: `agent name "${name}" must be kebab-case (lowercase letters, digits, hyphens)`,
      });
      continue;
    }
    const previous = seen.get(name);
    if (previous) {
      issues.push({ level: 'error', file: sourcePath, message: `duplicate agent name "${name}" (also ${previous})` });
      continue;
    }
    seen.set(name, sourcePath);

    const description = asString(data['description']);
    if (!description) {
      issues.push({
        level: 'error',
        file: sourcePath,
        message: 'agent is missing a `description` in frontmatter',
      });
      continue;
    }

    const agent: Agent = { name, description, body, sourcePath };
    const tools = asStringArray(data['tools']);
    if (tools) agent.tools = tools;
    const model = asString(data['model']);
    if (model) agent.model = model;
    agents.push(agent);
  }

  return agents.sort((a, b) => a.name.localeCompare(b.name));
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

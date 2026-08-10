import type { Command, MemoryDoc, Project, Skill } from '../model.js';

/**
 * Helpers shared by the render engines. Everything here is pure: given the same `Project`
 * it returns the same string, which is what makes golden-file testing meaningful.
 */

/** Compare heading text loosely, so `# Example Skill` matches the name `example-skill`. */
function headingKey(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Drop a leading heading only when it repeats the title this renderer already emits.
 *
 * Matching on the text rather than just position matters: a decision record whose body
 * opens with `## Context` would otherwise lose its first section entirely.
 */
function stripDuplicateTitle(body: string, title: string): string {
  const match = /^(#{1,6})\s+(\S[^\n]*)\n+/.exec(body);
  if (!match?.[0] || !match[2]) return body;
  if (headingKey(match[2]) !== headingKey(title)) return body;
  return body.slice(match[0].length);
}

const FENCE = /^\s*(?:```|~~~)/;
const HEADING = /^(#{1,6})(\s+\S.*)$/;

/**
 * Re-level a document's headings so its shallowest sits just below the section heading.
 *
 * Every renderer wraps a body under a `## Something` heading. A decision record whose body
 * starts at `## Context` would then render as a sibling of its own title rather than a
 * child, silently flattening the structure an agent uses to navigate the document.
 *
 * Headings inside fenced code blocks are left alone; a `# comment` in a shell example is
 * not a heading.
 */
function normalizeHeadings(body: string, shallowest = 3): string {
  const lines = body.split('\n');

  let inFence = false;
  let min = 7;
  for (const line of lines) {
    if (FENCE.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const match = HEADING.exec(line);
    if (match?.[1]) min = Math.min(min, match[1].length);
  }
  if (min === 7) return body;

  const shift = shallowest - min;
  if (shift === 0) return body;

  inFence = false;
  return lines
    .map((line) => {
      if (FENCE.test(line)) {
        inFence = !inFence;
        return line;
      }
      if (inFence) return line;
      const match = HEADING.exec(line);
      if (!match?.[1] || !match[2]) return line;
      const level = Math.min(6, Math.max(1, match[1].length + shift));
      return `${'#'.repeat(level)}${match[2]}`;
    })
    .join('\n');
}

/** Strip a redundant title, then re-level what remains. */
function sectionBody(body: string, title: string): string {
  return normalizeHeadings(stripDuplicateTitle(body, title));
}

export function memorySection(doc: MemoryDoc): string {
  const parts = [`## ${doc.title}`];
  if (doc.description) parts.push(`_${doc.description}_`);
  if (doc.globs?.length) parts.push(`Applies to: ${doc.globs.map((g) => `\`${g}\``).join(', ')}`);
  parts.push(sectionBody(doc.body, doc.title));
  return parts.filter(Boolean).join('\n\n').trim();
}

export function skillSection(skill: Skill): string {
  const parts = [`## Skill: ${skill.name}`, `**When to use:** ${skill.description}`];
  if (skill.globs?.length) {
    parts.push(`**Applies to:** ${skill.globs.map((g) => `\`${g}\``).join(', ')}`);
  }
  parts.push(sectionBody(skill.body, skill.name));
  return parts.filter(Boolean).join('\n\n').trim();
}

export function commandSection(command: Command): string {
  return [
    `## Command: ${command.name}`,
    `**Purpose:** ${command.description}`,
    sectionBody(command.body, command.name),
  ]
    .filter(Boolean)
    .join('\n\n')
    .trim();
}

/**
 * The whole project as one markdown document, used by every `single-file` target.
 *
 * Ordering is memory, then skills, then commands: durable facts before procedures before
 * on-demand prompts, so an agent reading top-down gets context before instructions.
 */
export function flattenProject(project: Project): string {
  const out: string[] = [`# ${project.name}`];

  out.push(
    'Guidance for AI coding agents working in this repository.',
  );

  if (project.memory.length > 0) {
    out.push('# Project memory');
    for (const doc of project.memory) out.push(memorySection(doc));
  }

  if (project.skills.length > 0) {
    out.push('# Skills');
    out.push(
      'Each skill below is a procedure. Follow it when its "when to use" condition matches the task at hand.',
    );
    for (const skill of project.skills) out.push(skillSection(skill));
  }

  if (project.commands.length > 0) {
    out.push('# Commands');
    out.push('Repeatable prompts a user may invoke by name.');
    for (const command of project.commands) out.push(commandSection(command));
  }

  return `${out.join('\n\n').trim()}\n`;
}

/** Turn a possibly-nested memory slug into a flat, filesystem-safe basename. */
export function flatSlug(slug: string): string {
  return slug.replace(/[/\\]/g, '-');
}

import type { Command, MemoryDoc, Project, Skill } from '../model.js';

/**
 * Helpers shared by the render engines. Everything here is pure: given the same `Project`
 * it returns the same string, which is what makes golden-file testing meaningful.
 */

/**
 * Authors naturally start a memory document with `# Title`, which would collide with the
 * heading this renderer emits. Dropping the leading H1 keeps one heading per section.
 */
function stripLeadingHeading(body: string): string {
  return body.replace(/^#{1,2}\s+\S[^\n]*\n+/, '');
}

export function memorySection(doc: MemoryDoc): string {
  const parts = [`## ${doc.title}`];
  if (doc.description) parts.push(`_${doc.description}_`);
  if (doc.globs?.length) parts.push(`Applies to: ${doc.globs.map((g) => `\`${g}\``).join(', ')}`);
  parts.push(stripLeadingHeading(doc.body));
  return parts.filter(Boolean).join('\n\n').trim();
}

export function skillSection(skill: Skill): string {
  const parts = [`## Skill: ${skill.name}`, `**When to use:** ${skill.description}`];
  if (skill.globs?.length) {
    parts.push(`**Applies to:** ${skill.globs.map((g) => `\`${g}\``).join(', ')}`);
  }
  parts.push(skill.body);
  return parts.filter(Boolean).join('\n\n').trim();
}

export function commandSection(command: Command): string {
  return [`## Command: ${command.name}`, `**Purpose:** ${command.description}`, command.body]
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

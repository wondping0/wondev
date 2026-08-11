import type { Command, MemoryDoc, Project, Skill } from '../model.js';
import { estimateTokens, formatTokens } from '../../util/tokens.js';

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

/**
 * Strip a redundant title, then re-level what remains.
 *
 * `shallowest` is the heading level the body's own top level becomes. Markdown engines wrap
 * a body under `## Title` and pass 3; the HTML guide wraps it under `<h3>` and passes 4.
 * Getting it wrong inverts the hierarchy -- a document opening with `# Architecture` renders
 * above the heading that introduces it.
 */
export function sectionBody(body: string, title: string, shallowest = 3): string {
  return normalizeHeadings(stripDuplicateTitle(body, title), shallowest);
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

  // Pointers, never contents. Flat targets already carry every skill body, and reference
  // material exists precisely so it stays out of the file whose cost is paid every turn.
  // The paths are real, so an agent that wants the material can read it.
  if (skill.attachments.length > 0) {
    const list = skill.attachments
      .map((a) => `- \`.wondev/skills/${skill.name}/${a.relPath}\``)
      .join('\n');
    parts.push(`**Reference material** — read on demand, not included here:\n${list}`);
  }

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
 * One line per on-demand document: where it is, what it costs, and when to read it.
 *
 * This is the whole point of `always: false`. A flattened target is read on every turn, so
 * copying a document nobody asked for into it charges its full cost on every request forever.
 * A reference costs one line and the agent can open the file when the trigger matches.
 */
export function onDemandMemoryIndex(docs: MemoryDoc[]): string {
  return docs
    .map((doc) => {
      const cost = formatTokens(estimateTokens(doc.body));
      const trigger = doc.description ? ` — ${doc.description}` : '';
      return `- \`${doc.sourcePath}\` — **${doc.title}** (≈${cost})${trigger}`;
    })
    .join('\n');
}

const ON_DEMAND_PREAMBLE =
  'Listed, not included. Read one when its trigger matches — the path is relative to the repository root.';

/**
 * The whole project as one markdown document, used by every `single-file` target.
 *
 * Ordering is memory, then skills, then commands: durable facts before procedures before
 * on-demand prompts, so an agent reading top-down gets context before instructions.
 *
 * Only `always: true` memory is inlined. Everything else is referenced, because this file is
 * loaded in full on every turn and a large set of documents would otherwise be paid for
 * continuously to be useful occasionally.
 */
export function flattenProject(project: Project): string {
  const out: string[] = [`# ${project.name}`];

  out.push(
    'Guidance for AI coding agents working in this repository.',
  );

  const always = project.memory.filter((d) => d.always);
  const onDemand = project.memory.filter((d) => !d.always);

  if (always.length > 0) {
    out.push('# Project memory');
    for (const doc of always) out.push(memorySection(doc));
  }

  if (onDemand.length > 0) {
    out.push('# On-demand memory');
    out.push(ON_DEMAND_PREAMBLE);
    out.push(onDemandMemoryIndex(onDemand));
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

  // Listed, never inlined. Subagents are a delegation mechanism only some hosts implement;
  // a host without one cannot act on the body, and a host with one loads the file itself.
  // Either way the useful part here is knowing which specialists exist.
  if (project.agents.length > 0) {
    out.push('# Subagents');
    out.push(
      'Specialists this project defines. Hosts that support delegation load them from the paths below.',
    );
    out.push(
      project.agents
        .map((a) => `- \`${a.sourcePath}\` — **${a.name}** — ${a.description}`)
        .join('\n'),
    );
  }

  return `${out.join('\n\n').trim()}\n`;
}

/**
 * Turn a possibly-nested memory slug into a flat, filesystem-safe basename.
 *
 * Whitespace collapses too. Memory slugs are unconstrained -- only skill and command names
 * must be kebab-case -- so a vault written for humans can hold `Live Map.md`, and without
 * this that becomes a generated filename with spaces in someone's repository.
 */
export function flatSlug(slug: string): string {
  return slug.replace(/[/\\]/g, '-').replace(/\s+/g, '-');
}

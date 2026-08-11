import type { IndexConfig, IndexColumn } from '../config.js';
import type { MemoryDoc, Project, RenderedFile } from '../model.js';
import { estimateTokens, formatTokens } from '../../util/tokens.js';

/**
 * The memory index.
 *
 * Not a table of contents. It is what makes a large set of memory documents affordable: it
 * states what each one costs to load and the condition under which paying that is worth it,
 * so an agent reads three documents instead of thirty. wondev already holds both halves of
 * that -- `description` says when to read, and the body length says what it costs.
 *
 * It renders in `region` mode into a file the user owns, so the prose around it (how to use
 * the vault, house rules, whatever else belongs at the entry point) survives every build
 * while the table stays derived. Nothing here needs maintaining, so nothing here can drift.
 */

/** A `|` inside a cell would close it early and shift every column after it. */
function cell(value: unknown): string {
  if (value === undefined || value === null) return '';
  return String(value).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();
}

export function docTokens(doc: MemoryDoc): number {
  return estimateTokens(doc.body);
}

/** What every target pays on every turn, regardless of what the task is. */
export function alwaysOnTokens(project: Project): number {
  return project.memory.filter((d) => d.always).reduce((sum, d) => sum + docTokens(d), 0);
}

function table(docs: MemoryDoc[], showChecked: boolean, columns: IndexColumn[]): string {
  const head = [
    'Note',
    '≈tok',
    ...(showChecked ? ['Checked'] : []),
    'When to read',
    ...columns.map((c) => c.label),
  ];
  const rows = docs.map((doc) => [
    `[[${doc.slug}]]`,
    formatTokens(docTokens(doc)),
    ...(showChecked ? [doc.verified ? `✓ ${doc.verified}` : ''] : []),
    cell(doc.description),
    ...columns.map((c) => cell(doc.extra[c.key])),
  ]);
  return [
    `| ${head.join(' | ')} |`,
    `| ${head.map(() => '---').join(' | ')} |`,
    ...rows.map((r) => `| ${r.join(' | ')} |`),
  ].join('\n');
}

export function renderIndex(project: Project, config: IndexConfig): RenderedFile {
  // Emitted only when some document uses it, so projects that never verify anything are not
  // given a permanently empty column. This is a pure function of the project, so output
  // stays deterministic and golden-testable.
  const showChecked = project.memory.some((d) => d.verified !== undefined);

  const always = project.memory.filter((d) => d.always);
  const onDemand = project.memory.filter((d) => !d.always);

  const out: string[] = ['# Memory index'];

  if (always.length === 0 && onDemand.length === 0) {
    out.push('No memory documents yet.');
  }

  if (always.length > 0) {
    out.push('## Always loaded');
    out.push("Injected into every target's context on every turn.");
    out.push(table(always, showChecked, config.columns));
    const total = `**Always-on total: ≈${formatTokens(alwaysOnTokens(project))}**`;
    out.push(
      config.budget === undefined
        ? total
        : `${total} (budget ${formatTokens(config.budget)})`,
    );
  }

  if (onDemand.length > 0) {
    out.push('## On demand');
    out.push('Costs nothing until something loads it. Read the trigger before deciding to.');
    out.push(table(onDemand, showChecked, config.columns));
  }

  return { path: config.file, content: `${out.join('\n\n').trim()}\n`, mode: 'region' };
}

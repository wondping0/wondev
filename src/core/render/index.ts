import type { NamedTarget, Project, RenderedFile } from '../model.js';
import { WondevError } from '../../util/errors.js';
import { isInsideRoot } from '../../util/paths.js';
import { renderClaude } from './claude.js';
import { renderRuleDir } from './rule-dir.js';
import { renderSingleFile } from './single-file.js';
import { flattenProject } from './shared.js';

/**
 * Turn a project into the files one target wants. Pure: no filesystem access, so the whole
 * compilation step is testable with golden files and the risky I/O stays in `writer`.
 */
export function renderTarget(
  project: Project,
  named: NamedTarget,
  flattened?: string,
): RenderedFile[] {
  const { target } = named;
  let files: RenderedFile[];

  switch (target.engine) {
    case 'single-file':
      files = renderSingleFile(project, target, flattened);
      break;
    case 'rule-dir':
      files = renderRuleDir(project, target);
      break;
    case 'claude':
      files = renderClaude(project, target);
      break;
    default: {
      const exhaustive: never = target;
      throw new WondevError(`Unsupported engine in target "${named.name}": ${String(exhaustive)}`);
    }
  }

  for (const file of files) {
    if (!isInsideRoot(file.path)) {
      throw new WondevError(
        `Target "${named.name}" tried to write outside the project: ${file.path}`,
      );
    }
  }
  return files;
}

export interface RenderResult {
  files: RenderedFile[];
  /** Output path to the target that produced it, for manifest bookkeeping. */
  owners: Map<string, string>;
}

/** Render every enabled target, and fail loudly if two targets claim the same file. */
export function renderAll(project: Project, targets: NamedTarget[]): RenderResult {
  const byPath = new Map<string, { file: RenderedFile; target: string }>();

  // Every `single-file` target renders the same flattened document. A typical project
  // enables several of them, so flattening once and sharing the result removes work that
  // scales with both project size and target count.
  let flattened: string | undefined;
  const flattenOnce = (): string => (flattened ??= flattenProject(project));

  for (const named of targets) {
    const memo = named.target.engine === 'single-file' ? flattenOnce() : undefined;
    for (const file of renderTarget(project, named, memo)) {
      const existing = byPath.get(file.path);
      if (existing && existing.file.content !== file.content) {
        throw new WondevError(
          `Targets "${existing.target}" and "${named.name}" both write ${file.path} with different content.`,
          'Remove one of them from `targets`, or point one at a different path.',
        );
      }
      if (!existing) byPath.set(file.path, { file, target: named.name });
    }
  }

  const entries = [...byPath.values()].sort((a, b) => a.file.path.localeCompare(b.file.path));
  return {
    files: entries.map((e) => e.file),
    owners: new Map(entries.map((e) => [e.file.path, e.target])),
  };
}

export { flattenProject } from './shared.js';

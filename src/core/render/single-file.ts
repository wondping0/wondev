import type { Project, RenderedFile, SingleFileTarget } from '../model.js';
import { flattenProject } from './shared.js';

/**
 * Flatten the whole project into one markdown file.
 *
 * This covers the large family of agents that read a single instructions file: AGENTS.md
 * consumers, Copilot, Gemini CLI, Aider, Junie, and anything a user adds via customTargets.
 *
 * Several of those are usually enabled at once and all produce byte-identical content, so
 * the caller may pass a memo to flatten the project once per build instead of once per
 * target. Omitting it is always correct, just slower.
 */
export function renderSingleFile(
  project: Project,
  target: SingleFileTarget,
  flattened?: string,
): RenderedFile[] {
  // The memo only applies to targets carrying everything. A target that narrows `include`
  // produces different bytes, so reusing the shared flatten for it would silently give it
  // content it asked not to have.
  const content =
    target.include === undefined
      ? (flattened ?? flattenProject(project))
      : flattenProject(project, target.include);

  return [{ path: target.path, content, mode: target.mode ?? 'region' }];
}

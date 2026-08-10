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
  return [
    {
      path: target.path,
      content: flattened ?? flattenProject(project),
      mode: target.mode ?? 'region',
    },
  ];
}

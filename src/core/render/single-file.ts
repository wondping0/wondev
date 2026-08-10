import type { Project, RenderedFile, SingleFileTarget } from '../model.js';
import { flattenProject } from './shared.js';

/**
 * Flatten the whole project into one markdown file.
 *
 * This covers the large family of agents that read a single instructions file: AGENTS.md
 * consumers, Copilot, Gemini CLI, Aider, Junie, and anything a user adds via customTargets.
 */
export function renderSingleFile(project: Project, target: SingleFileTarget): RenderedFile[] {
  return [
    {
      path: target.path,
      content: flattenProject(project),
      mode: target.mode ?? 'region',
    },
  ];
}

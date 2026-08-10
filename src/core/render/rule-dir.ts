import type { Project, RenderedFile, RuleDirTarget } from '../model.js';
import { stringifyFrontmatter } from '../frontmatter.js';
import { commandSection, flatSlug, memorySection, skillSection } from './shared.js';

/**
 * One file per artifact inside a rules directory.
 *
 * Used by Cursor, Windsurf, Cline, Roo, Continue, and Kiro. They differ only in directory,
 * extension, and frontmatter key names, all of which come from the target definition.
 */
export function renderRuleDir(project: Project, target: RuleDirTarget): RenderedFile[] {
  const files: RenderedFile[] = [];
  const dir = target.path.replace(/\/+$/, '');

  for (const doc of project.memory) {
    files.push({
      path: `${dir}/memory-${flatSlug(doc.slug)}${target.ext}`,
      content: withFrontmatter(target, {
        description: doc.description ?? doc.title,
        globs: doc.globs,
        always: doc.always,
      }, memorySection(doc)),
      mode: 'whole',
    });
  }

  for (const skill of project.skills) {
    files.push({
      path: `${dir}/skill-${skill.name}${target.ext}`,
      content: withFrontmatter(target, {
        description: skill.description,
        globs: skill.globs,
        // Skills are conditional by nature: they load when their description matches.
        always: false,
      }, skillSection(skill)),
      mode: 'whole',
    });
  }

  for (const command of project.commands) {
    files.push({
      path: `${dir}/command-${command.name}${target.ext}`,
      content: withFrontmatter(target, {
        description: command.description,
        always: false,
      }, commandSection(command)),
      mode: 'whole',
    });
  }

  return files;
}

interface Canonical {
  description?: string | undefined;
  globs?: string[] | undefined;
  always: boolean;
}

/**
 * Emit frontmatter under the key names this target expects. A target with no `frontmatter`
 * map gets a plain markdown body, which is what the simpler rules directories want.
 */
function withFrontmatter(target: RuleDirTarget, values: Canonical, body: string): string {
  const map = target.frontmatter;
  if (!map) return `${body.trim()}\n`;

  const data: Record<string, unknown> = {};
  if (map.description && values.description) data[map.description] = values.description;
  if (map.globs && values.globs?.length) {
    data[map.globs] = map.globsFormat === 'csv' ? values.globs.join(',') : values.globs;
  }
  if (map.always) data[map.always] = values.always;

  return stringifyFrontmatter(data, body);
}

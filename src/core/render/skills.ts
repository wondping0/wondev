import type { RenderedFile, Skill } from '../model.js';
import { stringifyFrontmatter } from '../frontmatter.js';

/** The same portable skill tree can be discovered by a host or carried in a plugin. */
export function renderSkills(skills: Skill[], directory: string): RenderedFile[] {
  const base = directory.replace(/\/+$/, '');
  return skills.flatMap((skill): RenderedFile[] => [
    {
      path: `${base}/${skill.name}/SKILL.md`, mode: 'whole',
      content: stringifyFrontmatter({ ...skill.frontmatter, name: skill.name, description: skill.description }, skill.body),
    },
    ...skill.attachments.map((att): RenderedFile => ({
      path: `${base}/${skill.name}/${att.relPath}`, content: att.content, mode: 'whole', raw: true,
      ...(att.encoding ? { encoding: att.encoding } : {}),
      ...(att.executable ? { executable: true } : {}),
    })),
  ]);
}

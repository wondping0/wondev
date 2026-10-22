import type { Project, RenderedFile, SkillPluginTarget } from '../model.js';
import { renderSkills } from './skills.js';

export function renderSkillPlugin(project: Project, target: SkillPluginTarget): RenderedFile[] {
  const base = target.path.replace(/\/+$/, '');
  const identity = { name: target.name, version: target.version, description: `Reusable skills for ${project.name}, compiled by wondev.` };
  const json = (rel: string, value: unknown): RenderedFile => ({ path: `${base}/${rel}`, mode: 'whole', raw: true, content: JSON.stringify(value, null, 2) + '\n' });
  return [
    json('plugin.json', { $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json', ...identity }),
    json('.claude-plugin/plugin.json', { ...identity, skills: './skills/' }),
    json('.codex-plugin/plugin.json', { ...identity, skills: './skills/' }),
    ...renderSkills(project.skills, `${base}/skills`),
  ];
}

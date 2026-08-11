import type { ClaudeTarget, Project, RenderedFile } from '../model.js';
import { stringifyFrontmatter } from '../frontmatter.js';
import { memorySection } from './shared.js';

/**
 * Claude Code's native layout.
 *
 * Unlike the other engines this one splits across three locations, because Claude Code
 * discovers `.claude/skills/` and `.claude/commands/` on its own and only needs memory in
 * `CLAUDE.md`. Duplicating skill bodies into CLAUDE.md would waste context on every turn.
 */
export function renderClaude(project: Project, target: ClaudeTarget): RenderedFile[] {
  const files: RenderedFile[] = [];

  files.push({
    path: target.memory,
    content: claudeMemory(project),
    mode: 'region',
  });

  const skillsDir = target.skills.replace(/\/+$/, '');
  for (const skill of project.skills) {
    const data: Record<string, unknown> = {
      name: skill.name,
      description: skill.description,
    };
    files.push({
      path: `${skillsDir}/${skill.name}/SKILL.md`,
      content: stringifyFrontmatter(data, skill.body),
      mode: 'whole',
    });

    // This engine is the only one with somewhere real to put these. Claude Code reads them
    // when SKILL.md points at them, which is exactly the on-demand behaviour they exist for.
    for (const att of skill.attachments) {
      files.push({
        path: `${skillsDir}/${skill.name}/${att.relPath}`,
        content: att.content,
        mode: 'whole',
      });
    }
  }

  const commandsDir = target.commands.replace(/\/+$/, '');
  for (const command of project.commands) {
    files.push({
      path: `${commandsDir}/${command.name}.md`,
      content: stringifyFrontmatter({ description: command.description }, command.body),
      mode: 'whole',
    });
  }

  return files;
}

function claudeMemory(project: Project): string {
  const out: string[] = [`# ${project.name}`];

  if (project.memory.length > 0) {
    for (const doc of project.memory) out.push(memorySection(doc));
  }

  // An index, not the bodies: Claude Code loads the skill itself when the description matches.
  if (project.skills.length > 0) {
    out.push('# Available skills');
    out.push(
      project.skills
        .map((s) => `- **${s.name}** — ${s.description}`)
        .join('\n'),
    );
  }

  if (project.commands.length > 0) {
    out.push('# Available commands');
    out.push(
      project.commands.map((c) => `- **/${c.name}** — ${c.description}`).join('\n'),
    );
  }

  return `${out.join('\n\n').trim()}\n`;
}

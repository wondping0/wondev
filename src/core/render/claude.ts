import type { ClaudeTarget, MemoryDoc, Project, RenderedFile } from '../model.js';
import { stringifyFrontmatter } from '../frontmatter.js';
import { flatSlug, memorySection, onDemandMemoryIndex } from './shared.js';

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
    content: claudeMemory(project, target.rules !== undefined),
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

  // Only when the target names a location. A custom claude target written before agents
  // existed has no `agents` path, and inventing one would write into a directory its author
  // never asked wondev to own.
  if (target.agents) {
    const agentsDir = target.agents.replace(/\/+$/, '');
    for (const agent of project.agents) {
      const data: Record<string, unknown> = {
        name: agent.name,
        description: agent.description,
      };
      if (agent.tools?.length) data['tools'] = agent.tools.join(', ');
      if (agent.model) data['model'] = agent.model;
      files.push({
        path: `${agentsDir}/${agent.name}.md`,
        content: stringifyFrontmatter(data, agent.body),
        mode: 'whole',
      });
    }
  }

  // Path-scoped memory becomes a rule file. `paths` is Claude Code's own key for this, and
  // wondev's `globs` maps onto it directly -- a field that until now no target used.
  if (target.rules) {
    const rulesDir = target.rules.replace(/\/+$/, '');
    for (const doc of project.memory) {
      if (!doc.globs?.length) continue;
      const data: Record<string, unknown> = { paths: doc.globs };
      if (doc.description) data['description'] = doc.description;
      files.push({
        path: `${rulesDir}/${flatSlug(doc.slug)}.md`,
        content: stringifyFrontmatter(data, doc.body),
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

function claudeMemory(project: Project, hasRulesDir: boolean): string {
  const out: string[] = [`# ${project.name}`];

  // CLAUDE.md is read on every turn, so only always-on memory is inlined. The rest is listed
  // with its path and trigger, matching how this engine already treats skills.
  //
  // Documents with `globs` are neither: they go to `.claude/rules/` as path-scoped rules and
  // are excluded here, because Claude Code loads those only when it reads a matching file.
  const scoped = (d: MemoryDoc): boolean => hasRulesDir && (d.globs?.length ?? 0) > 0;
  const unscoped = project.memory.filter((d) => !scoped(d));
  const always = unscoped.filter((d) => d.always);
  const onDemand = unscoped.filter((d) => !d.always);

  for (const doc of always) out.push(memorySection(doc));

  if (onDemand.length > 0) {
    out.push('# On-demand memory');
    out.push('Listed, not included. Read one when its trigger matches.');
    out.push(onDemandMemoryIndex(onDemand));
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

  // Same reasoning as skills: the description is the dispatch rule, and the host loads the
  // agent itself once it decides to delegate.
  if (project.agents.length > 0) {
    out.push('# Available subagents');
    out.push(project.agents.map((a) => `- **${a.name}** — ${a.description}`).join('\n'));
  }

  return `${out.join('\n\n').trim()}\n`;
}

import path from 'node:path';
import { stringifyFrontmatter } from '../core/frontmatter.js';
import { wondevDir } from '../core/config.js';
import { WondevError } from '../util/errors.js';
import { pathExists, writeFileAtomic } from '../util/fs.js';
import { info, style, success } from '../util/log.js';

export type ArtifactKind = 'skill' | 'memory' | 'command' | 'agent';

const KINDS: ArtifactKind[] = ['skill', 'memory', 'command', 'agent'];
const NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export function parseKind(raw: string): ArtifactKind {
  const kind = raw as ArtifactKind;
  if (!KINDS.includes(kind)) {
    throw new WondevError(`Unknown artifact type "${raw}".`, `Expected one of: ${KINDS.join(', ')}.`);
  }
  return kind;
}

export async function runAdd(root: string, kind: ArtifactKind, name: string): Promise<void> {
  if (!NAME_PATTERN.test(name)) {
    throw new WondevError(
      `"${name}" is not a valid name.`,
      'Use kebab-case: lowercase letters, digits, and hyphens, starting with a letter or digit.',
    );
  }

  const base = wondevDir(root);
  if (!(await pathExists(base))) {
    throw new WondevError('No .wondev/ directory here.', 'Run `wondev init` first.');
  }

  const { file, content } = scaffold(base, kind, name);
  if (await pathExists(file)) {
    throw new WondevError(`${path.relative(root, file)} already exists.`);
  }

  await writeFileAtomic(file, content);
  success(`created ${style.cyan(path.relative(root, file))}`);
  info(style.dim('Edit it, then run `wondev build`.'));
}

function scaffold(base: string, kind: ArtifactKind, name: string): { file: string; content: string } {
  const title = name
    .split('-')
    .map((w) => (w[0] ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');

  switch (kind) {
    case 'skill':
      return {
        file: path.join(base, 'skills', name, 'SKILL.md'),
        content: stringifyFrontmatter(
          {
            name,
            description: `Use when ... (describe the trigger condition precisely)`,
          },
          [
            `# ${title}`,
            '',
            'Replace this with the procedure to follow. Write it as steps an agent can',
            'execute, not as background reading.',
            '',
            '## Steps',
            '',
            '1. ',
            '2. ',
            '3. ',
            '',
            '## Done when',
            '',
            '- ',
          ].join('\n'),
        ),
      };
    case 'memory':
      return {
        file: path.join(base, 'memory', `${name}.md`),
        content: stringifyFrontmatter(
          { title, always: false },
          [
            `# ${title}`,
            '',
            'Replace this with a durable fact about the project: something that stays true',
            'across tasks and is not obvious from reading the code.',
          ].join('\n'),
        ),
      };
    case 'command':
      return {
        file: path.join(base, 'commands', `${name}.md`),
        content: stringifyFrontmatter(
          { name, description: `${title} — describe what this command does` },
          [
            `# ${title}`,
            '',
            'Replace this with the prompt to run when this command is invoked.',
          ].join('\n'),
        ),
      };
    case 'agent':
      return {
        file: path.join(base, 'agents', `${name}.md`),
        content: stringifyFrontmatter(
          {
            name,
            // The description is the dispatch rule the caller matches against, so the
            // placeholder prompts for a condition rather than a job title.
            description: 'Delegate to this agent when — describe the condition, not the role',
          },
          [
            `# ${title}`,
            '',
            'Replace this with the instructions this subagent should follow.',
            '',
            'It runs in its own context window, so say what it needs to know rather than',
            'assuming it can see the conversation that dispatched it.',
          ].join('\n'),
        ),
      };
  }
}

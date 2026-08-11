import { describe, expect, it } from 'vitest';
import type { NamedTarget, Project } from '../src/core/model.js';
import { flattenProject, renderAll, renderTarget } from '../src/core/render/index.js';
import { flatSlug } from '../src/core/render/shared.js';
import { BUILTIN_TARGETS } from '../src/core/registry.js';
import { WondevError } from '../src/util/errors.js';

const project: Project = {
  name: 'demo',
  memory: [
    {
      slug: 'architecture',
      title: 'Architecture',
      always: true,
      extra: {},
      body: 'One binary.',
      sourcePath: '.wondev/memory/architecture.md',
      globs: ['src/**'],
    },
    {
      slug: 'decisions/0001-x',
      title: 'Decision one',
      always: false,
      extra: {},
      body: 'Chose X.',
      sourcePath: '.wondev/memory/decisions/0001-x.md',
    },
  ],
  skills: [
    {
      name: 'debugging',
      description: 'Use when investigating a failure',
      attachments: [],
      body: 'Reproduce first.',
      sourcePath: '.wondev/skills/debugging/SKILL.md',
    },
  ],
  commands: [
    {
      name: 'review',
      description: 'Review the diff',
      body: 'Read the diff.',
      sourcePath: '.wondev/commands/review.md',
    },
  ],
};

function named(name: string): NamedTarget {
  const entry = BUILTIN_TARGETS[name];
  if (!entry) throw new Error(`no such target ${name}`);
  return { name, target: entry.target };
}

describe('single-file engine', () => {
  const files = renderTarget(project, named('agents'));

  it('produces exactly one file at the target path', () => {
    expect(files).toHaveLength(1);
    expect(files[0]?.path).toBe('AGENTS.md');
  });

  it('defaults to region mode so an existing file is not destroyed', () => {
    expect(files[0]?.mode).toBe('region');
  });

  it('includes memory, skills, and commands in that order', () => {
    const content = files[0]?.content ?? '';
    expect(content.indexOf('# Project memory')).toBeLessThan(content.indexOf('# Skills'));
    expect(content.indexOf('# Skills')).toBeLessThan(content.indexOf('# Commands'));
    expect(content).toContain('One binary.');
    expect(content).toContain('Reproduce first.');
    expect(content).toContain('Read the diff.');
  });

  it('states each skill trigger, since that is what an agent matches on', () => {
    expect(files[0]?.content).toContain('**When to use:** Use when investigating a failure');
  });

  it('nests body headings under the section heading instead of beside it', () => {
    const adr: Project = {
      ...project,
      memory: [
        {
          slug: 'decisions/0001-x',
          title: 'Decision one',
          // always-on so the body is inlined; this test is about heading levels, not about
          // which documents a flattened target includes.
          always: true,
          extra: {},
          body: '## Context\n\nWhy.\n\n## Decision\n\nWhat.',
          sourcePath: '.wondev/memory/decisions/0001-x.md',
        },
      ],
    };
    const content = renderTarget(adr, named('agents'))[0]?.content ?? '';
    expect(content).toContain('## Decision one');
    expect(content).toContain('### Context');
    expect(content).toContain('### Decision');
    expect(content).not.toContain('\n## Context');
  });

  it('leaves headings inside fenced code blocks alone', () => {
    const withCode: Project = {
      ...project,
      memory: [
        {
          slug: 'a',
          title: 'A',
          // always-on for the same reason as above: the assertion is about fenced blocks.
          always: true,
          extra: {},
          body: '## Real heading\n\n```bash\n# not a heading, a shell comment\nls\n```',
          sourcePath: '.wondev/memory/a.md',
        },
      ],
    };
    const content = renderTarget(withCode, named('agents'))[0]?.content ?? '';
    expect(content).toContain('### Real heading');
    expect(content).toContain('# not a heading, a shell comment');
  });

  it('does not repeat a heading the author already wrote in the body', () => {
    const withHeading: Project = {
      ...project,
      memory: [
        {
          slug: 'architecture',
          title: 'Architecture',
          always: true,
          extra: {},
          body: '# Architecture\n\nOne binary.',
          sourcePath: '.wondev/memory/architecture.md',
        },
      ],
    };
    const content = renderTarget(withHeading, named('agents'))[0]?.content ?? '';
    expect(content.match(/Architecture/g)?.length).toBe(1);
    expect(content).toContain('One binary.');
  });
});

describe('rule-dir engine', () => {
  const files = renderTarget(project, named('cursor'));

  it('emits one file per artifact', () => {
    expect(files.map((f) => f.path).sort()).toEqual([
      '.cursor/rules/command-review.mdc',
      '.cursor/rules/memory-architecture.mdc',
      '.cursor/rules/memory-decisions-0001-x.mdc',
      '.cursor/rules/skill-debugging.mdc',
    ]);
  });

  it('flattens nested slugs into a safe basename', () => {
    expect(files.some((f) => f.path === '.cursor/rules/memory-decisions-0001-x.mdc')).toBe(true);
  });

  it('owns rule files entirely, since it created them', () => {
    expect(files.every((f) => f.mode === 'whole')).toBe(true);
  });

  it("maps always-on memory to Cursor's alwaysApply key", () => {
    const arch = files.find((f) => f.path.endsWith('memory-architecture.mdc'));
    expect(arch?.content).toContain('alwaysApply: true');
    expect(arch?.content).toContain('globs:');
  });

  it('marks skills as conditional rather than always-on', () => {
    const skill = files.find((f) => f.path.endsWith('skill-debugging.mdc'));
    expect(skill?.content).toContain('alwaysApply: false');
    expect(skill?.content).toContain('description: Use when investigating a failure');
  });

  it('emits a plain body for a target with no frontmatter map', () => {
    const files2 = renderTarget(project, named('windsurf'));
    expect(files2[0]?.content.startsWith('---')).toBe(false);
  });
});

describe('claude engine', () => {
  const files = renderTarget(project, named('claude'));
  const byPath = new Map(files.map((f) => [f.path, f]));

  it('splits across CLAUDE.md, skills, and commands', () => {
    expect([...byPath.keys()].sort()).toEqual([
      '.claude/commands/review.md',
      '.claude/skills/debugging/SKILL.md',
      'CLAUDE.md',
    ]);
  });

  it('keeps CLAUDE.md in region mode so hand-written notes survive', () => {
    expect(byPath.get('CLAUDE.md')?.mode).toBe('region');
  });

  it('indexes skills in CLAUDE.md instead of inlining their bodies', () => {
    const memory = byPath.get('CLAUDE.md')?.content ?? '';
    expect(memory).toContain('**debugging**');
    expect(memory).not.toContain('Reproduce first.');
  });

  it('writes each skill in the format Claude Code expects', () => {
    const skill = byPath.get('.claude/skills/debugging/SKILL.md')?.content ?? '';
    expect(skill).toMatch(/^---\n/);
    expect(skill).toContain('name: debugging');
    expect(skill).toContain('description: Use when investigating a failure');
    expect(skill).toContain('Reproduce first.');
  });
});

describe('renderAll', () => {
  it('is deterministic across repeated renders', () => {
    const a = renderAll(project, [named('claude'), named('cursor')]);
    const b = renderAll(project, [named('claude'), named('cursor')]);
    expect(a.files).toEqual(b.files);
  });

  it('records which target owns each output path', () => {
    const { owners } = renderAll(project, [named('claude'), named('agents')]);
    expect(owners.get('AGENTS.md')).toBe('agents');
    expect(owners.get('CLAUDE.md')).toBe('claude');
  });

  it('refuses two targets writing different content to one path', () => {
    const clash: NamedTarget = {
      name: 'clashing',
      target: { engine: 'single-file', path: 'CLAUDE.md', mode: 'region' },
    };
    expect(() => renderAll(project, [named('claude'), clash])).toThrow(WondevError);
  });

  it('rejects a target that would write outside the project', () => {
    const escape: NamedTarget = {
      name: 'escape',
      target: { engine: 'single-file', path: '../escaped.md' },
    };
    expect(() => renderTarget(project, escape)).toThrow(/outside the project/);
  });
});

describe('skill attachments', () => {
  const withAttachment: Project = {
    name: 'demo',
    memory: [],
    skills: [
      {
        name: 'graphify',
        description: 'Use when querying the code graph',
        attachments: [
          { relPath: 'references/query.md', content: '# Query\n\nRun graphify query.' },
        ],
        body: 'Ask the graph first.',
        sourcePath: '.wondev/skills/graphify/SKILL.md',
      },
    ],
    commands: [],
  };

  it('writes attachments beside SKILL.md for the claude engine', () => {
    const files = renderTarget(withAttachment, {
      name: 'claude',
      target: BUILTIN_TARGETS['claude']!.target,
    });
    const paths = files.map((f) => f.path);
    expect(paths).toContain('.claude/skills/graphify/SKILL.md');
    expect(paths).toContain('.claude/skills/graphify/references/query.md');
    const att = files.find((f) => f.path.endsWith('references/query.md'));
    expect(att?.mode).toBe('whole');
    expect(att?.content).toContain('Run graphify query.');
  });

  it('points at attachments from flat targets rather than inlining them', () => {
    const out = flattenProject(withAttachment);
    expect(out).toContain('.wondev/skills/graphify/references/query.md');
    expect(out).toContain('Ask the graph first.');
    // The whole reason attachments exist is to stay out of the always-loaded file.
    expect(out).not.toContain('Run graphify query.');
  });

  it('adds no pointer block for a skill with no attachments', () => {
    expect(flattenProject(project)).not.toContain('Reference material');
  });
});

describe('flatSlug', () => {
  it('collapses separators and whitespace so filenames stay safe', () => {
    expect(flatSlug('decisions/0001-x')).toBe('decisions-0001-x');
    expect(flatSlug('Alur Live Map')).toBe('Alur-Live-Map');
    expect(flatSlug('a  b')).toBe('a-b');
  });
});

describe('on-demand memory is referenced, not inlined', () => {
  const mixed: Project = {
    name: 'demo',
    memory: [
      {
        slug: 'architecture', title: 'Architecture', always: true, extra: {},
        body: 'ALWAYS BODY: one binary.',
        sourcePath: '.wondev/memory/architecture.md',
      },
      {
        slug: 'hardening', title: 'Hardening', always: false, extra: {},
        description: 'Planning a production rollout.',
        body: 'ONDEMAND BODY: '.padEnd(4000, 'x'),
        sourcePath: '.wondev/memory/hardening.md',
      },
    ],
    skills: [], commands: [],
  };

  it('inlines always-on memory and only references the rest', () => {
    const out = flattenProject(mixed);
    expect(out).toContain('ALWAYS BODY');
    expect(out).not.toContain('ONDEMAND BODY');
    expect(out).toContain('# On-demand memory');
    expect(out).toContain('`.wondev/memory/hardening.md`');
  });

  it('gives each reference its cost and its trigger', () => {
    const out = flattenProject(mixed);
    expect(out).toContain('**Hardening** (≈1.0k)');
    expect(out).toContain('Planning a production rollout.');
  });

  it('applies the same rule to CLAUDE.md', () => {
    const files = renderTarget(mixed, { name: 'claude', target: BUILTIN_TARGETS['claude']!.target });
    const memory = files.find((f) => f.path === 'CLAUDE.md')!.content;
    expect(memory).toContain('ALWAYS BODY');
    expect(memory).not.toContain('ONDEMAND BODY');
    expect(memory).toContain('`.wondev/memory/hardening.md`');
  });

  it('still writes every document in full for rule-dir targets', () => {
    const files = renderTarget(mixed, { name: 'cursor', target: BUILTIN_TARGETS['cursor']!.target });
    const joined = files.map((f) => f.content).join('\n');
    expect(joined).toContain('ALWAYS BODY');
    expect(joined).toContain('ONDEMAND BODY');
  });

  it('omits the section entirely when every document is always-on', () => {
    const allAlways: Project = { ...mixed, memory: [mixed.memory[0]!] };
    expect(flattenProject(allAlways)).not.toContain('On-demand memory');
  });
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hasErrors, loadProject } from '../src/core/source.js';
import { cleanup, seedProject, tmpRoot, write } from './helpers.js';

let root: string;
beforeEach(async () => {
  root = await tmpRoot();
});
afterEach(async () => {
  await cleanup(root);
});

describe('loadProject', () => {
  it('reads memory, skills, and commands', async () => {
    await seedProject(root);
    const { project, issues } = await loadProject(root, 'demo');
    expect(issues.filter((i) => i.level === 'error')).toEqual([]);
    expect(project.memory.map((m) => m.slug)).toEqual(['architecture']);
    expect(project.skills.map((s) => s.name)).toEqual(['debugging']);
    expect(project.commands.map((c) => c.name)).toEqual(['review']);
  });

  it('returns an empty project rather than failing when .wondev is bare', async () => {
    const { project, issues } = await loadProject(root, 'demo');
    expect(project.memory).toEqual([]);
    expect(hasErrors(issues)).toBe(false);
  });

  it('orders always-on memory before the rest', async () => {
    await write(root, '.wondev/memory/a-later.md', '---\ntitle: A\nalways: true\n---\n\nbody\n');
    await write(root, '.wondev/memory/b-early.md', '---\ntitle: B\n---\n\nbody\n');
    const { project } = await loadProject(root, 'demo');
    expect(project.memory.map((m) => m.slug)).toEqual(['a-later', 'b-early']);
  });

  it('keeps nested memory slugs path-like', async () => {
    await write(root, '.wondev/memory/decisions/0001-x.md', '---\ntitle: D\n---\n\nbody\n');
    const { project } = await loadProject(root, 'demo');
    expect(project.memory[0]?.slug).toBe('decisions/0001-x');
  });

  it('accepts a flat skills/<name>.md as well as skills/<name>/SKILL.md', async () => {
    await write(root, '.wondev/skills/flat.md', '---\ndescription: Use when flat\n---\n\nbody\n');
    const { project, issues } = await loadProject(root, 'demo');
    expect(hasErrors(issues)).toBe(false);
    expect(project.skills.map((s) => s.name)).toEqual(['flat']);
  });

  it('errors on a skill with no description, since that is its trigger', async () => {
    await write(root, '.wondev/skills/x/SKILL.md', '---\nname: x\n---\n\nbody\n');
    const { issues } = await loadProject(root, 'demo');
    expect(issues.some((i) => i.level === 'error' && /description/.test(i.message))).toBe(true);
  });

  it('errors on a non-kebab-case name, which would become an unsafe filename', async () => {
    await write(root, '.wondev/skills/x/SKILL.md', '---\nname: Not Kebab\ndescription: d\n---\n\nb\n');
    const { issues } = await loadProject(root, 'demo');
    expect(issues.some((i) => /kebab-case/.test(i.message))).toBe(true);
  });

  it('errors on duplicate skill names declared in frontmatter', async () => {
    await write(root, '.wondev/skills/a/SKILL.md', '---\nname: same\ndescription: d\n---\n\nb\n');
    await write(root, '.wondev/skills/b/SKILL.md', '---\nname: same\ndescription: d\n---\n\nb\n');
    const { issues } = await loadProject(root, 'demo');
    expect(issues.some((i) => /duplicate skill name/.test(i.message))).toBe(true);
  });

  it('errors on an unresolved memory link', async () => {
    await write(root, '.wondev/memory/a.md', '---\ntitle: A\n---\n\nSee [[nowhere]].\n');
    const { issues } = await loadProject(root, 'demo');
    expect(issues.some((i) => /unresolved memory link/.test(i.message))).toBe(true);
  });

  it('accepts a memory link that resolves by basename', async () => {
    await write(root, '.wondev/memory/a.md', '---\ntitle: A\n---\n\nSee [[0001-x]].\n');
    await write(root, '.wondev/memory/decisions/0001-x.md', '---\ntitle: X\n---\n\nbody\n');
    const { issues } = await loadProject(root, 'demo');
    expect(issues.filter((i) => i.level === 'error')).toEqual([]);
  });

  it('falls back to the first heading for a missing title', async () => {
    await write(root, '.wondev/memory/a.md', '# Real Title\n\nbody\n');
    const { project } = await loadProject(root, 'demo');
    expect(project.memory[0]?.title).toBe('Real Title');
  });

  it('warns, but does not fail, on an empty memory document', async () => {
    await write(root, '.wondev/memory/a.md', '---\ntitle: A\n---\n');
    const { issues } = await loadProject(root, 'demo');
    expect(hasErrors(issues)).toBe(false);
    expect(issues.some((i) => i.level === 'warning')).toBe(true);
  });
});

describe('freshness frontmatter', () => {
  it('reads verified and verifiedAgainst, and keeps unknown keys in extra', async () => {
    await write(
      root,
      '.wondev/memory/architecture.md',
      '---\ntitle: A\nverified: 2026-08-10\nverifiedAgainst: ports and arrows\nowner: platform\n---\n\nbody\n',
    );
    const { project, issues } = await loadProject(root, 'demo');
    const doc = project.memory[0];
    expect(hasErrors(issues)).toBe(false);
    expect(doc?.verified).toBe('2026-08-10');
    expect(doc?.verifiedAgainst).toBe('ports and arrows');
    expect(doc?.extra['owner']).toBe('platform');
  });

  it('keeps interpreted keys out of extra', async () => {
    await write(root, '.wondev/memory/a.md', '---\ntitle: A\nalways: true\n---\n\nbody\n');
    const { project } = await loadProject(root, 'demo');
    expect(Object.keys(project.memory[0]?.extra ?? {})).toEqual([]);
  });

  it('gives every document an extra object even with no frontmatter', async () => {
    await write(root, '.wondev/memory/a.md', '# A\n\nbody\n');
    const { project } = await loadProject(root, 'demo');
    expect(project.memory[0]?.extra).toEqual({});
  });

  it('warns and ignores a verified date that is not YYYY-MM-DD', async () => {
    await write(root, '.wondev/memory/a.md', '---\ntitle: A\nverified: last tuesday\n---\n\nbody\n');
    const { project, issues } = await loadProject(root, 'demo');
    expect(project.memory[0]?.verified).toBeUndefined();
    expect(hasErrors(issues)).toBe(false);
    expect(issues.some((i) => i.level === 'warning' && /verified/.test(i.message))).toBe(true);
  });
});

describe('skill attachments', () => {
  it('collects .md files beside SKILL.md, sorted by path', async () => {
    await write(
      root,
      '.wondev/skills/graphify/SKILL.md',
      '---\nname: graphify\ndescription: d\n---\n\nbody\n',
    );
    await write(root, '.wondev/skills/graphify/references/update.md', '# Update\n');
    await write(root, '.wondev/skills/graphify/references/query.md', '# Query\n');

    const { project, issues } = await loadProject(root, 'demo');
    expect(hasErrors(issues)).toBe(false);
    expect(project.skills[0]?.attachments.map((a) => a.relPath)).toEqual([
      'references/query.md',
      'references/update.md',
    ]);
    expect(project.skills[0]?.attachments[0]?.content).toContain('# Query');
  });

  it('warns about and ignores a non-markdown file in a skill directory', async () => {
    await write(root, '.wondev/skills/g/SKILL.md', '---\nname: g\ndescription: d\n---\n\nbody\n');
    await write(root, '.wondev/skills/g/.graphify_version', '1.2.3\n');

    const { project, issues } = await loadProject(root, 'demo');
    expect(hasErrors(issues)).toBe(false);
    expect(project.skills[0]?.attachments).toEqual([]);
    expect(issues.some((i) => i.level === 'warning' && /graphify_version/.test(i.message))).toBe(true);
  });

  it('gives a flat skill file an empty attachment list', async () => {
    await write(root, '.wondev/skills/solo.md', '---\nname: solo\ndescription: d\n---\n\nbody\n');
    const { project } = await loadProject(root, 'demo');
    expect(project.skills[0]?.attachments).toEqual([]);
  });
});

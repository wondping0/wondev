import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadProject } from '../src/core/source.js';
import { renderAll } from '../src/core/render/index.js';
import { BUILTIN_TARGETS } from '../src/core/registry.js';
import { normalizeEol } from '../src/util/fs.js';

/**
 * Golden output tests.
 *
 * Every built-in target renders a frozen fixture project, and the result is compared byte
 * for byte against files committed to the repository. A diff here is not a broken test: it
 * is the signal that generated output changed, which under the versioning contract means
 * the release must be at least MINOR, because every downstream `wondev check` will fail.
 *
 * Regenerate deliberately, and read the diff:
 *
 *   UPDATE_GOLDEN=1 npx vitest run test/golden.test.ts
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureRoot = path.join(here, 'fixtures', 'schema-1');
const goldenRoot = path.join(here, 'fixtures', 'golden');
const updating = process.env['UPDATE_GOLDEN'] === '1';

async function readGolden(rel: string): Promise<string | null> {
  try {
    return normalizeEol(await fs.readFile(path.join(goldenRoot, rel), 'utf8'));
  } catch {
    return null;
  }
}

async function writeGolden(rel: string, content: string): Promise<void> {
  const abs = path.join(goldenRoot, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, 'utf8');
}

/**
 * The fixture directory *is* a `.wondev` tree. `loadProject` expects a project root that
 * contains one, so it is copied into a temp root for the duration of a render.
 */
async function loadFixtureProject() {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'wondev-golden-'));
  try {
    await fs.cp(fixtureRoot, path.join(tmp, '.wondev'), { recursive: true });
    const { project, issues } = await loadProject(tmp, 'fixture-project');
    const errors = issues.filter((i) => i.level === 'error');
    if (errors.length > 0) {
      throw new Error(`fixture has source errors: ${errors.map((e) => e.message).join('; ')}`);
    }
    return project;
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

const targetNames = Object.keys(BUILTIN_TARGETS).sort();

describe('golden output', () => {
  it('renders the fixture without errors', async () => {
    const project = await loadFixtureProject();
    expect(project.memory.length).toBeGreaterThan(0);
    expect(project.skills.length).toBeGreaterThan(0);
    expect(project.commands.length).toBeGreaterThan(0);
  });

  for (const name of targetNames) {
    it(`matches committed output for ${name}`, async () => {
      const project = await loadFixtureProject();
      const entry = BUILTIN_TARGETS[name];
      if (!entry) throw new Error(`missing target ${name}`);

      const { files } = renderAll(project, [{ name, target: entry.target }]);
      expect(files.length).toBeGreaterThan(0);

      for (const file of files) {
        const rel = path.posix.join(name, file.path);
        const content = normalizeEol(file.content);

        if (updating) {
          await writeGolden(rel, content);
          continue;
        }

        const golden = await readGolden(rel);
        expect(
          golden,
          `No golden file for ${rel}. Run: UPDATE_GOLDEN=1 npx vitest run test/golden.test.ts`,
        ).not.toBeNull();
        expect(content, `Generated output changed for ${rel}`).toBe(golden);
      }
    });
  }

  it('produces the same bytes on a repeated render', async () => {
    const project = await loadFixtureProject();
    const targets = targetNames.map((name) => ({ name, target: BUILTIN_TARGETS[name]!.target }));
    const first = renderAll(project, targets);
    const second = renderAll(project, targets);
    expect(first.files).toEqual(second.files);
  });

  it('covers every built-in target, so a new one cannot ship untested', async () => {
    if (updating) return;
    const dirs = await fs.readdir(goldenRoot).catch(() => [] as string[]);
    for (const name of targetNames) {
      expect(dirs, `${name} has no golden output committed`).toContain(name);
    }
  });
});

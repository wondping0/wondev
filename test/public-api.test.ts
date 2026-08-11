import { describe, expect, it } from 'vitest';
import * as api from '../src/index.js';

/**
 * The public surface, pinned.
 *
 * 0.2.0 shipped the memory index, skill attachments and freshness fields without exporting a
 * single one of them, while continuing to export writer internals. A library consumer could
 * call `applyPlan` but could not construct an `IndexConfig`. Nothing failed, because nothing
 * checked — so this checks.
 */
describe('public API', () => {
  it('exports the feature surface a consumer needs', () => {
    for (const name of [
      'loadConfig',
      'loadProject',
      'renderAll',
      'renderTarget',
      'flattenProject',
      'renderIndex',
      'alwaysOnTokens',
      'docTokens',
      'onDemandMemoryIndex',
      'estimateTokens',
      'formatTokens',
      'INDEX_OWNER',
      'BUILTIN_TARGETS',
      'WondevError',
      'SOURCE_SCHEMA_VERSION',
    ]) {
      expect(api, `missing export: ${name}`).toHaveProperty(name);
    }
  });

  it('no longer exposes the writer internals removed in 0.9.9', () => {
    // Re-exporting any of these is how the surface grew by accident the first time: they
    // were exported because they existed. `applyPlan` had already gained a parameter in
    // 0.1.2, which would have broken anyone depending on it.
    for (const name of [
      'planWrites',
      'applyPlan',
      'cleanAll',
      'loadManifest',
      'recordTemplates',
      'templatesDir',
      'compareVersions',
      'MIGRATIONS',
      'runMigrations',
    ]) {
      expect(api, `${name} is internal and must not be re-exported`).not.toHaveProperty(name);
    }
  });

  it('still exposes the commands, which are what the CLI itself calls', () => {
    for (const name of ['runInit', 'runBuild', 'runCheck', 'runClean', 'runAdopt', 'runRemove']) {
      expect(api, `missing export: ${name}`).toHaveProperty(name);
    }
  });

  it('round-trips an IndexConfig through renderIndex without touching internals', () => {
    const file = api.renderIndex(
      {
        name: 'demo',
        memory: [
          {
            slug: 'a',
            title: 'A',
            always: true,
            extra: {},
            body: 'x'.repeat(400),
            sourcePath: '.wondev/memory/a.md',
          },
        ],
        skills: [],
        commands: [],
        agents: [],
      },
      { file: 'Index.md', columns: [] },
    );
    expect(file.path).toBe('Index.md');
    expect(file.mode).toBe('region');
    expect(file.content).toContain('[[a]]');
  });
});

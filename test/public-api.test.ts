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

  it('keeps the provisional writer internals reachable until 1.0 removes them', () => {
    // Documented in src/index.ts as provisional. Asserted so their removal is a deliberate
    // edit to this test rather than an accident nobody noticed.
    for (const name of ['planWrites', 'applyPlan', 'cleanAll', 'loadManifest']) {
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
      },
      { file: 'Index.md', columns: [] },
    );
    expect(file.path).toBe('Index.md');
    expect(file.mode).toBe('region');
    expect(file.content).toContain('[[a]]');
  });
});

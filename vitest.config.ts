import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      reporter: ['text', 'json-summary'],
      /**
       * Floors, not targets.
       *
       * Coverage was never measured before 1.0.1, and measuring it found `list` at zero — a
       * command that had shipped in two releases with no test at all, which is the same gap
       * that let a runaway rebuild loop live in `watch`. These thresholds exist so that
       * cannot happen quietly again: adding an untested command now fails the run rather
       * than lowering an average nobody looks at.
       *
       * Set just under the current numbers. Raise them when the real figure moves up; do not
       * lower them to make a red run green.
       *
       * `src/**` is counted in full, including files no test imports, because the point is
       * to see what is untested rather than to average over what happens to be loaded.
       * `watch.ts` reads as ~4% for a real reason and not a gap: it is a long-running
       * process tested by spawning the CLI, which v8 coverage cannot observe from here.
       */
      thresholds: {
        statements: 90,
        branches: 83,
        functions: 92,
        lines: 91,
      },
    },
  },
});

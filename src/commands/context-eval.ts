import fs from 'node:fs/promises';
import path from 'node:path';
import { loadContext } from './context.js';
import { evaluateContext, type ContextCase } from '../core/context-quality.js';
import { inspectFreshness } from '../core/freshness.js';
import { hasErrors } from '../core/source.js';
import { createRootGuard } from '../util/paths.js';
import { WondevError } from '../util/errors.js';
import { info } from '../util/log.js';

export async function runContextEval(root: string, file: string, profile?: string): Promise<void> {
  const ctx = await loadContext(root, profile);
  if (hasErrors(ctx.issues)) throw new WondevError('Fix source validation errors before evaluating context.');
  await createRootGuard(root)(file);
  const raw = await fs.readFile(path.join(root, file), 'utf8');
  let cases: ContextCase[];
  try { cases = JSON.parse(raw) as ContextCase[]; } catch { throw new WondevError('Context cases must be valid JSON.'); }
  const results = evaluateContext(ctx.project, cases, await inspectFreshness(root, ctx.project.memory));
  info(JSON.stringify(results, null, 2));
  if (results.some((r) => !r.passed)) throw new WondevError('Context evaluation failed. Inspect missing, unexpected, and budget errors above.');
}

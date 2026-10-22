import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolveAlias } from './registry.js';

const execute = promisify(execFile);
export interface AgentEvidence { agent?: string; evidence: string[]; candidates: string[] }

/** Environment hints are evidence, not proof of a host or subscription entitlement. */
export function detectAgent(env: NodeJS.ProcessEnv = process.env, explicit?: string): AgentEvidence {
  if (explicit || env['WONDEV_AGENT']) return { agent: explicit ?? env['WONDEV_AGENT'], evidence: [explicit ? '--agent' : 'WONDEV_AGENT'], candidates: [] };
  const matches = [
    { agent: 'codex', variable: 'CODEX_THREAD_ID', present: !!env['CODEX_THREAD_ID'] },
    { agent: 'claude', variable: 'CLAUDECODE', present: env['CLAUDECODE'] === '1' },
    { agent: 'cursor', variable: 'CURSOR_AGENT', present: env['CURSOR_AGENT'] === '1' },
    { agent: 'gemini', variable: 'GEMINI_CLI', present: env['GEMINI_CLI'] === '1' },
  ].filter((hint) => hint.present);
  return { ...(matches.length === 1 ? { agent: matches[0]!.agent } : {}), evidence: matches.map((hint) => hint.variable), candidates: matches.map((hint) => hint.agent) };
}

export async function pythonRuntime(): Promise<string | null> {
  for (const [command, args] of [['python3', []], ['python', []], ['py', ['-3']]] as const) {
    try {
      const { stdout, stderr } = await execute(command, [...args, '--version'], { cwd: os.tmpdir(), timeout: 3000, windowsHide: true });
      if (/Python 3\./.test(stdout + stderr)) return [command, ...args].join(' ');
    } catch { /* An absent or unusable interpreter is a prerequisite, not a crash. */ }
  }
  return null;
}

export async function understandRuntime(root: string, env: NodeJS.ProcessEnv = process.env, home = os.homedir()): Promise<{ status: string; pluginRoot?: string }> {
  const candidates = [env['UNDERSTAND_ANYTHING_ROOT'], env['CLAUDE_PLUGIN_ROOT'],
    path.join(root, '.wondev/tools/understand-anything/understand-anything-plugin'),
    path.join(home, '.understand-anything/repo/understand-anything-plugin')].filter((p): p is string => !!p);
  const file = async (p: string): Promise<boolean> => fs.stat(p).then((s) => s.isFile(), () => false);
  for (const candidate of candidates) {
    if (await file(path.join(candidate, 'skills/understand/SKILL.md')) && await file(path.join(candidate, 'packages/core/package.json'))) {
      return { status: await file(path.join(candidate, 'packages/core/dist/index.js')) ? 'built-files-present' : 'needs-build', pluginRoot: path.resolve(candidate) };
    }
  }
  return { status: 'needs-setup' };
}

export function canonicalAgent(name: string, customTargets: Record<string, unknown>): string {
  return Object.hasOwn(customTargets, name) ? name : resolveAlias(name);
}

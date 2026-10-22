import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const project = path.resolve(process.argv[2] ?? process.cwd());
const candidates = [
  process.env.UNDERSTAND_ANYTHING_ROOT,
  process.env.CLAUDE_PLUGIN_ROOT,
  path.join(project, '.wondev/tools/understand-anything/understand-anything-plugin'),
  path.join(os.homedir(), '.understand-anything/repo/understand-anything-plugin'),
].filter(Boolean);
const exists = async (file) => fs.stat(file).then((s) => s.isFile(), () => false);
let runtime;
for (const candidate of candidates) {
  if (await exists(path.join(candidate, 'skills/understand/SKILL.md')) && await exists(path.join(candidate, 'packages/core/package.json'))) {
    runtime = { pluginRoot: path.resolve(candidate), built: await exists(path.join(candidate, 'packages/core/dist/index.js')) };
    break;
  }
}
console.log(JSON.stringify({ project, status: runtime ? runtime.built ? 'built-files-present' : 'needs-build' : 'needs-setup', ...runtime,
  note: 'File inspection only; native plugin activation and runtime execution are not verified.' }, null, 2));
if (!runtime?.built) process.exitCode = 1;

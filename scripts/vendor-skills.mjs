// Refresh from reviewed, local upstream checkouts; never fetch or execute upstream code.
// node scripts/vendor-skills.mjs --from <directory containing the three checkouts>
// node scripts/vendor-skills.mjs --check
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lockFile = path.join(root, 'vendor-skills.lock.json');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const sources = [
  { name: 'ui-ux-pro-max', repository: 'nextlevelbuilder/ui-ux-pro-max-skill', commit: '623a9a9037d006ea727f8213f084d02a6b6f11b5', license: 'MIT',
    select: (p) => p === 'LICENSE' ? 'LICENSE.txt' : /^src\/ui-ux-pro-max\/data\//.test(p) || /^src\/ui-ux-pro-max\/scripts\/[^/]+\.py$/.test(p) ? p.replace('src/ui-ux-pro-max/', '') : null },
  { name: 'understand-anything', repository: 'Egonex-AI/Understand-Anything', commit: 'b8c807c632743ab695ec43cb654a0f1efe216bc8', license: 'MIT',
    select: (p) => p === 'LICENSE' ? 'LICENSE.txt' : p === 'understand-anything-plugin/skills/understand/SKILL.md' ? 'references/upstream-understand.md' : null },
  { name: 'webapp-testing', checkout: 'anthropic-skills', repository: 'anthropics/skills', commit: 'dbd4588f9e1033efb41dad4bef2f7947c8993d44', license: 'Apache-2.0',
    select: (p) => p.startsWith('skills/webapp-testing/') && !p.endsWith('/SKILL.md') ? p.replace('skills/webapp-testing/', '') : null },
];

if (process.argv.includes('--check')) {
  const lock = JSON.parse(await fs.readFile(lockFile, 'utf8'));
  for (const source of lock.sources) for (const file of source.files) {
    const bytes = await fs.readFile(path.join(root, file.path));
    if (hash(bytes) !== file.sha256) throw new Error(`Vendored resource changed: ${file.path}`);
  }
  console.log('Vendored skill resources match their pinned checksums.');
} else {
  const input = process.argv[process.argv.indexOf('--from') + 1];
  if (!process.argv.includes('--from') || !input) throw new Error('Use --check or --from <reviewed-checkouts-directory>.');
  const locked = [];
  for (const source of sources) {
    const cwd = path.resolve(input, source.checkout ?? source.name);
    const paths = execFileSync('git', ['ls-tree', '-r', '--name-only', source.commit], { cwd, encoding: 'utf8' }).trim().split('\n');
    const files = [];
    for (const upstreamPath of paths) {
      const rel = source.select(upstreamPath);
      if (!rel) continue;
      const bytes = execFileSync('git', ['show', `${source.commit}:${upstreamPath}`], { cwd, maxBuffer: 10 * 1024 * 1024 });
      const destination = `templates/skills/${source.name}/${rel}`;
      await fs.mkdir(path.dirname(path.join(root, destination)), { recursive: true });
      await fs.writeFile(path.join(root, destination), bytes);
      files.push({ path: destination, upstreamPath, sha256: hash(bytes) });
    }
    locked.push({ name: source.name, repository: `https://github.com/${source.repository}`, commit: source.commit, license: source.license, files });
  }
  await fs.writeFile(lockFile, JSON.stringify({ version: 1, sources: locked }, null, 2) + '\n');
  console.log(`Vendored ${locked.reduce((n, source) => n + source.files.length, 0)} pinned resources.`);
}

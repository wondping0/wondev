import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

const execute = promisify(execFile);
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const npmCli = process.env.npm_execpath ?? path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'wondev-package-smoke-'));
const app = path.join(temp, 'application');
const write = async (relative, content) => {
  const file = path.join(app, relative);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content);
};
const npm = async (args, cwd = repository) => (await execute(process.execPath, [npmCli, ...args], { cwd, windowsHide: true, timeout: 120000, maxBuffer: 4 * 1024 * 1024 })).stdout;
try {
  const packed = JSON.parse(await npm(['pack', '--ignore-scripts', '--json', '--pack-destination', temp]));
  const artifact = path.join(temp, packed[0].filename);
  await write('package.json', '{"name":"wondev-smoke-app","version":"1.0.0","private":true}\n');
  await npm(['install', '--ignore-scripts', '--no-audit', '--no-fund', artifact], app);
  const installed = path.join(app, 'node_modules/wondev');
  const cli = path.join(installed, 'dist/cli.js');
  const run = async (...args) => (await execute(process.execPath, [cli, ...args, '--cwd', app, '--no-color'], { cwd: app, windowsHide: true, timeout: 30000 })).stdout;
  const api = await import(pathToFileURL(path.join(installed, 'dist/index.js')).href);
  const version = JSON.parse(await fs.readFile(path.join(repository, 'package.json'), 'utf8')).version;
  assert.equal((await npm(['exec', '--offline', '--', 'wondev', '--version'], app)).trim(), version);
  assert.match(await fs.readFile(path.join(installed, 'docs/knowledge.md'), 'utf8'), /Active vaults/);
  await run('init', '--vault', 'knowledge', '--targets', 'claude,agents');
  assert.equal(JSON.parse(await run('skills', 'catalog', '--json')).length, 11);
  assert.equal(JSON.parse(await run('plugins', 'catalog', '--json')).length, 13);
  await fs.access(path.join(installed, 'docs/plugins.md'));
  await fs.access(path.join(installed, 'docs/upgrades.md'));
  await run('plugins', 'pin', 'playwright');
  await run('plugins', 'enable', 'playwright');
  const mcp = JSON.parse(await run('plugins', 'export', '--agent', 'claude'));
  assert(mcp.mcpServers.playwright.args.some((arg) => /^@playwright\/mcp@\d+\.\d+\.\d+$/.test(arg)));
  await run('plugins', 'disable', 'playwright');
  assert.deepEqual(JSON.parse(await run('plugins', 'export', '--agent', 'generic')).mcpServers, {});
  await assert.rejects(fs.access(path.join(app, '.mcp.json')), { code: 'ENOENT' });
  const uiSkill = JSON.parse(await run('skills', 'info', 'ui-ux-pro-max', '--json'));
  assert.equal(uiSkill.path, 'knowledge/skills/ui-ux-pro-max/SKILL.md');
  const uiScript = path.join(app, '.agents/skills/ui-ux-pro-max/scripts/search.py');
  assert.deepEqual(await fs.readFile(uiScript), await fs.readFile(path.join(installed, 'templates/skills/ui-ux-pro-max/scripts/search.py')));
  let python;
  for (const [command, prefix] of [['python3', []], ['python', []], ['py', ['-3']]]) {
    try {
      const result = await execute(command, [...prefix, '--version'], { windowsHide: true, timeout: 5000 });
      if (/Python 3\./.test(result.stdout + result.stderr)) { python = { command, prefix }; break; }
    } catch { /* try the next platform interpreter */ }
  }
  assert(python, 'Package smoke requires Python 3 to exercise the shipped UI UX scripts');
  const search = JSON.parse((await execute(python.command, [...python.prefix, '-B', uiScript, 'keyboard focus', '--domain', 'ux', '--json'], { cwd: app, windowsHide: true })).stdout);
  assert(search.count > 0);
  assert.equal(search.domain, 'ux');
  const generated = JSON.parse((await execute(python.command, [...python.prefix, '-B', uiScript, 'saas dashboard', '--design-system', '--json'], { cwd: app, windowsHide: true })).stdout);
  assert(generated.design_system);
  await execute(python.command, [...python.prefix, '-B', path.join(app, '.agents/skills/webapp-testing/scripts/with_server.py'), '--help'], { cwd: app, windowsHide: true });
  await run('skills', 'disable', 'webapp-testing');
  await assert.rejects(fs.access(path.join(app, '.agents/skills/webapp-testing/SKILL.md')), { code: 'ENOENT' });
  await fs.access(path.join(app, 'knowledge/skills/webapp-testing/SKILL.md'));
  await run('skills', 'enable', 'webapp-testing');
  assert.equal(JSON.parse(await run('agent', 'check', '--agent', 'codex', '--json')).currentAgent.enabled, true);
  assert.match(await fs.readFile(path.join(app, '.claude/commands/learn.md'), 'utf8'), /Learn from this development task/);
  assert.match(await fs.readFile(path.join(app, '.wondev/.gitignore'), 'utf8'), /^\.lock$/m);
  assert.match(await fs.readFile(path.join(app, '.wondev/.gitignore'), 'utf8'), /^skill-updates\/$/m);
  await write('src/auth/session.ts', 'export const session = true;\n');
  await write('knowledge/memory/auth.md', '---\nid: module-auth\ntitle: Authentication\ndescription: Read when changing authentication sessions\nglobs: ["src/auth/**"]\nevidence: ["src/auth/**"]\n---\nSessions are checked before protected operations.\n');
  await run('memory', 'verify', 'module-auth', '--against', 'Inspected session.ts in the smoke fixture');
  const packet = JSON.parse(await run('context', '--task', 'fix authentication', '--files', 'src/auth/session.ts', '--budget', '8000', '--json', '--explain'));
  assert(packet.selected.some((item) => item.id === 'module-auth'));
  assert(packet.tokens <= 8000);
  await write('skill-packs/quality/package.json', '{"name":"smoke-quality","version":"1.0.0"}\n');
  await write('skill-packs/quality/skills/quality/SKILL.md', '---\nname: quality\ndescription: Inspect quality checks\nlicense: MIT\n---\nRun scripts/check.mjs when needed.\n');
  await write('skill-packs/quality/skills/quality/scripts/check.mjs', 'process.stdout.write("check");\n');
  const binary = Buffer.from([0, 255, 192, 10, 13]);
  await write('skill-packs/quality/skills/quality/assets/sample.bin', binary);
  await run('skills', 'install', 'local:skill-packs/quality');
  assert.deepEqual(await fs.readFile(path.join(app, '.claude/skills/quality/assets/sample.bin')), binary);
  await write('cases.json', '[{"task":"inspect quality","expected":["quality"]}]');
  await run('skills', 'validate');
  await run('skills', 'eval', 'cases.json');
  await write('session.json', JSON.stringify({ agent: 'codex', task: 'Document session checks', outcome: 'Confirmed the session boundary.', evidence: ['src/auth/session.ts'], decisions: ['Keep checks in the session layer.'] }));
  const session = (await run('session', 'record', '--input', 'session.json')).trim();
  await write('updated-auth.md', (await fs.readFile(path.join(app, 'knowledge/memory/auth.md'), 'utf8')) + '\nThe session layer owns validation.\n');
  await run('session', 'propose', session, 'module-auth', '--input', 'updated-auth.md');
  const proposalFile = (await fs.readdir(path.join(app, 'knowledge/sessions/proposals'))).find((name) => name.endsWith('.json'));
  const proposal = await api.readProposal(app, proposalFile.slice(0, -5));
  await run('session', 'review', proposal.id);
  await run('session', 'apply', proposal.id, '--review-hash', api.proposalReviewHash(proposal));
  assert.equal(JSON.parse(await run('memory', 'stale', '--json')).find((item) => item.id === 'module-auth').status, 'stale');
  await run('memory', 'verify', 'module-auth', '--against', 'Reconciled updated note with session.ts');
  await run('build');
  await run('check');
  await run('skills', 'sync');
  await run('check');
  await run('map', '--exclude', 'skill-packs/**');
  assert(JSON.parse(await fs.readFile(path.join(app, '.wondev/map-coverage.json'), 'utf8')).services.length > 0);
  assert((await api.loadProjectContext(app)).project.memory.some((item) => item.id?.startsWith('map-module-')));
  await run('session', 'learn', session, 'session-boundary', '--files', 'src/auth/**');
  const proposals = await fs.readdir(path.join(app, 'knowledge/sessions/proposals'));
  let learning;
  for (const file of proposals.filter((name) => name.endsWith('.json'))) {
    const candidate = await api.readProposal(app, file.slice(0, -5));
    if (candidate.create) learning = candidate;
  }
  assert(learning);
  await run('session', 'apply', learning.id, '--review-hash', api.proposalReviewHash(learning));
  await write('context-cases.json', JSON.stringify([{ task: 'Document session checks', files: ['src/auth/session.ts'], budget: 10000, expected: { memory: ['session-boundary'] } }]));
  const evaluation = JSON.parse(await run('context', 'eval', 'context-cases.json'));
  assert.equal(evaluation[0].passed, true);
  await run('check', '--freshness', 'stale');
  await assert.rejects(run('check', '--freshness', 'strict'), /unverified/);
  await run('agent', 'use', 'plugin');
  for (const manifest of ['plugin.json', '.claude-plugin/plugin.json', '.codex-plugin/plugin.json']) {
    assert.equal(JSON.parse(await fs.readFile(path.join(app, '.wondev/plugins/project', manifest), 'utf8')).name, 'wondev-project-skills');
  }
  await fs.access(path.join(app, '.wondev/plugins/project/skills/ui-ux-pro-max/data/ux-guidelines.csv'));
  await run('agent', 'use', 'codex');
  await run('check');
  console.log(`Packed wondev ${version}: executable, vault, context, evidence, skills, sessions, application map, reviewed learning, context evaluation, and freshness gates passed.`);
} finally {
  const relative = path.relative(os.tmpdir(), temp);
  if (relative.startsWith('wondev-package-smoke-') && !relative.includes(path.sep)) await fs.rm(temp, { recursive: true, force: true });
}

import { execFile } from 'node:child_process';
import path from 'node:path';
import { loadManifest, MANIFEST_REL } from './writer.js';
import { pathExists } from '../util/fs.js';
import { createRootGuard } from '../util/paths.js';

export interface GitDistribution {
  available: boolean;
  reason?: string;
  files: Array<{ path: string; managed: boolean; status: 'tracked' | 'untracked' | 'ignored' | 'missing'; ignoreRule?: string }>;
}

function git(root: string, args: string[], input?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile('git', args, { cwd: root, windowsHide: true, timeout: 10000, maxBuffer: 16 * 1024 * 1024 }, (error, stdout) => {
      // check-ignore exits 1 when no input path is ignored.
      if (error && !(args[0] === 'check-ignore' && error.code === 1)) reject(error);
      else resolve(stdout);
    });
    child.stdin?.on('error', () => {});
    child.stdin?.end(input);
  });
}

/** Manifest ownership and Git distribution answer different questions. No Git mutation. */
export async function inspectGitDistribution(root: string): Promise<GitDistribution> {
  const manifest = await loadManifest(root);
  const paths = [...new Set([...Object.keys(manifest.files), MANIFEST_REL])].sort();
  let tracked: Set<string>;
  let ignored: Map<string, string>;
  try {
    if ((await git(root, ['rev-parse', '--is-inside-work-tree'])).trim() !== 'true') throw new Error('not a Git working tree');
    tracked = new Set((await git(root, ['ls-files', '--cached', '-z', '--', '.'])).split('\0').filter(Boolean));
    const fields = (await git(root, ['check-ignore', '-z', '-v', '--stdin'], `${paths.join('\0')}\0`)).split('\0');
    ignored = new Map();
    for (let i = 0; i + 3 < fields.length; i += 4) {
      if (!fields[i + 2]!.startsWith('!')) ignored.set(fields[i + 3]!, `${fields[i]}:${fields[i + 1]}:${fields[i + 2]}`);
    }
  } catch {
    return { available: false, reason: 'Git is unavailable, this directory is not a working tree, or Git could not inspect it.', files: [] };
  }
  const files: GitDistribution['files'] = [];
  const guard = createRootGuard(root);
  for (const rel of paths) {
    await guard(rel);
    const ignoreRule = ignored.get(rel);
    files.push({ path: rel, managed: Object.hasOwn(manifest.files, rel),
      status: !await pathExists(path.join(root, rel)) ? 'missing' : tracked.has(rel) ? 'tracked' : ignoreRule ? 'ignored' : 'untracked',
      ...(ignoreRule ? { ignoreRule } : {}),
    });
  }
  return { available: true, files };
}

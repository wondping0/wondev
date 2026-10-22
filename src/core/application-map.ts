import fs from 'node:fs/promises';
import path from 'node:path';
import { parse } from '@babel/parser';
import { sourceDirectory, SOURCE_KINDS, type WondevConfig } from './config.js';
import { stringifyFrontmatter } from './frontmatter.js';
import { matchesPatterns } from './matching.js';
import { createRootGuard } from '../util/paths.js';
import { sha256 } from '../util/fs.js';
import { WondevError } from '../util/errors.js';

const EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];
const IGNORED = new Set(['node_modules', 'dist', 'build', 'coverage', 'vendor']);
export const MAP_START = '<!-- wondev:application-map:start -->';
export const MAP_END = '<!-- wondev:application-map:end -->';
export interface ImportFact { specifier: string; line: number; resolved?: string }
export interface SourceFact { path: string; imports: ImportFact[]; test: boolean; error?: string }
export interface PackageFact { path: string; name: string; entries: string[]; scripts: string[]; dependencies: string[] }
export interface MapCoverage {
  roots: Record<string, string>;
  services: Array<{ name: string; root: string; parsed: number; parseErrors: number; packages: number; unsupported: number }>;
  unsupported: Array<{ path: string; language: string }>;
  unresolvedImports: number;
  excludedEntries: number;
  limits: string[];
}
export interface ApplicationMap { files: SourceFact[]; packages: PackageFact[]; warnings: string[]; coverage?: MapCoverage }
export interface MapNote { id: string; slug: string; content: string; observed: string }

/** Parse syntax without executing code, resolving packages, or reading tsconfig plugins. */
function importsFrom(code: string, file: string): { imports: ImportFact[]; error?: string } {
  try {
    const tree = parse(code, {
      sourceType: 'unambiguous', sourceFilename: file, attachComment: false,
      createImportExpressions: true,
      plugins: [...(/\.[cm]?tsx?$/.test(file) ? ['typescript' as const] : []), ...(/\.[jt]sx$/.test(file) ? ['jsx' as const] : [])],
    });
    const imports: ImportFact[] = [];
    const visit = (value: unknown): void => {
      if (!value || typeof value !== 'object') return;
      if (Array.isArray(value)) { for (const child of value) visit(child); return; }
      const node = value as Record<string, unknown>;
      let source: unknown;
      if (['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration', 'ImportExpression'].includes(String(node['type']))) source = node['source'];
      if (node['type'] === 'TSExternalModuleReference') source = node['expression'];
      if (node['type'] === 'CallExpression') {
        const callee = node['callee'] as Record<string, unknown> | undefined;
        if (callee?.['type'] === 'Identifier' && callee['name'] === 'require') source = (node['arguments'] as unknown[])[0];
      }
      const literal = source as { type?: string; value?: unknown; loc?: { start: { line: number } } } | undefined;
      if (literal?.type === 'StringLiteral' && typeof literal.value === 'string') imports.push({ specifier: literal.value, line: literal.loc!.start.line });
      for (const [key, child] of Object.entries(node)) if (!['loc', 'comments', 'tokens', 'extra', 'errors'].includes(key)) visit(child);
    };
    visit(tree.program);
    return { imports };
  } catch (error) {
    return { imports: [], error: error instanceof Error ? error.message : String(error) };
  }
}

function resolveImport(from: string, specifier: string, files: Set<string>): string | undefined {
  if (!specifier.startsWith('.')) return undefined;
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(from), specifier));
  const candidates = [base];
  const equivalent: Record<string, string[]> = { '.js': ['.ts', '.tsx'], '.jsx': ['.tsx'], '.mjs': ['.mts'], '.cjs': ['.cts'] };
  const ext = path.posix.extname(base);
  for (const suffix of equivalent[ext] ?? []) candidates.push(base.slice(0, -ext.length) + suffix);
  if (!ext) for (const suffix of EXTENSIONS) candidates.push(base + suffix, `${base}/index${suffix}`);
  return candidates.find((file) => files.has(file));
}

/** Inventory JS/TS and package manifests. Limits fail explicitly rather than truncating facts. */
export async function scanApplication(root: string, config: WondevConfig, excludes: string[] = []): Promise<ApplicationMap> {
  const excluded = [...SOURCE_KINDS.map((kind) => sourceDirectory(kind, config.sources)), ...(config.vault ? [config.vault] : [])];
  const candidates: string[] = [];
  const roots = config.map?.roots ?? { project: '.' };
  excludes = [...(config.map?.exclude ?? []), ...excludes];
  const unsupported: MapCoverage['unsupported'] = [];
  const languages: Record<string, string> = { '.py': 'Python', '.go': 'Go', '.rs': 'Rust', '.java': 'Java', '.kt': 'Kotlin', '.kts': 'Kotlin', '.cs': 'C#', '.php': 'PHP', '.rb': 'Ruby', '.swift': 'Swift', '.dart': 'Dart', '.c': 'C', '.h': 'C/C++', '.cpp': 'C++', '.cc': 'C++', '.vue': 'Vue SFC', '.svelte': 'Svelte', '.sql': 'SQL', '.sh': 'Shell', '.ps1': 'PowerShell', '.ex': 'Elixir', '.exs': 'Elixir', '.scala': 'Scala', '.fs': 'F#', '.lua': 'Lua', '.r': 'R' };
  let excludedEntries = 0;
  const guard = createRootGuard(root);
  let visited = 0;
  const walk = async (dir: string): Promise<void> => {
    const entries = await fs.readdir(path.join(root, dir), { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (++visited > 50000) throw new WondevError('Application map exceeds 50000 directory entries. Narrow the scan with --exclude.');
      const rel = dir ? `${dir}/${entry.name}` : entry.name;
      if (entry.name.startsWith('.') || IGNORED.has(entry.name) || excluded.some((base) => rel === base || rel.startsWith(`${base}/`)) || matchesPatterns(rel, excludes)) { excludedEntries++; continue; }
      if (entry.isDirectory()) { await guard(rel); await walk(rel); }
      else if (entry.isFile() && (entry.name === 'package.json' || EXTENSIONS.includes(path.posix.extname(entry.name)))) candidates.push(rel);
      else if (entry.isFile() && languages[path.posix.extname(entry.name).toLowerCase()]) unsupported.push({ path: rel, language: languages[path.posix.extname(entry.name).toLowerCase()]! });
    }
  };
  for (const directory of Object.values(roots)) {
    const rel = directory === '.' ? '' : directory;
    if (rel && (rel.split('/').some((part) => part.startsWith('.') || IGNORED.has(part)) || excluded.some((base) => rel === base || rel.startsWith(`${base}/`)))) throw new WondevError(`Map root is an excluded or knowledge directory: ${directory}`);
    await guard(rel ? `${rel}/.map-root-check` : '.map-root-check');
    if (!await fs.stat(path.join(root, rel)).then((s) => s.isDirectory()).catch(() => false)) throw new WondevError(`Map root is not a directory: ${directory}`);
    await walk(rel);
  }
  if (candidates.length > 10000) throw new WondevError('Application map exceeds 10000 source files. Narrow the scan with --exclude.');
  const map: ApplicationMap = { files: [], packages: [], warnings: [] };
  let bytes = 0;
  for (const rel of candidates.sort()) {
    await guard(rel);
    const stat = await fs.stat(path.join(root, rel));
    bytes += stat.size;
    if (stat.size > 2_000_000 || bytes > 50_000_000) throw new WondevError(`Application map input limit reached at ${rel}. Exclude generated or oversized sources with --exclude.`);
    const raw = await fs.readFile(path.join(root, rel), 'utf8');
    if (path.posix.basename(rel) === 'package.json') {
      let pkg: Record<string, unknown>;
      try { pkg = JSON.parse(raw) as Record<string, unknown>; } catch { throw new WondevError(`Invalid package JSON: ${rel}`); }
      if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg)) throw new WondevError(`Invalid package manifest: ${rel}`);
      const strings = (value: unknown): string[] => typeof value === 'string' ? [value] : value && typeof value === 'object' ? Object.values(value).flatMap(strings) : [];
      const keys = (value: unknown): string[] => value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value) : [];
      map.packages.push({ path: rel, name: typeof pkg['name'] === 'string' ? pkg['name'] : path.posix.dirname(rel),
        entries: [...new Set(['main', 'module', 'types', 'bin', 'exports'].flatMap((key) => strings(pkg[key])))].sort(),
        scripts: keys(pkg['scripts']).sort(), dependencies: [...new Set(['dependencies', 'devDependencies', 'peerDependencies'].flatMap((key) => keys(pkg[key])))].sort(),
      });
    } else {
      const parsed = importsFrom(raw, rel);
      map.files.push({ path: rel, ...parsed, test: /(?:^|\/)(?:__tests__|tests?|specs?)(?:\/|$)|\.(?:test|spec)\.[cm]?[jt]sx?$/.test(rel) });
      if (parsed.error) map.warnings.push(`${rel}: ${parsed.error}`);
    }
  }
  const names = new Set(map.files.map((file) => file.path));
  for (const file of map.files) for (const item of file.imports) {
    const resolved = resolveImport(file.path, item.specifier, names);
    if (resolved) item.resolved = resolved;
  }
  map.coverage = {
    roots, unsupported: unsupported.sort((a, b) => a.path.localeCompare(b.path)), excludedEntries,
    unresolvedImports: map.files.flatMap((f) => f.imports).filter((i) => !i.resolved).length,
    services: Object.entries(roots).map(([name, directory]) => {
      const inside = (rel: string): boolean => directory === '.' || rel.startsWith(`${directory}/`);
      return { name, root: directory, parsed: map.files.filter((f) => inside(f.path) && !f.error).length, parseErrors: map.files.filter((f) => inside(f.path) && f.error).length, packages: map.packages.filter((p) => inside(p.path)).length, unsupported: unsupported.filter((f) => inside(f.path)).length };
    }),
    limits: ['Only JS/TS literal imports and package.json declarations are mapped.', 'Other listed languages are inventoried, not parsed. Unknown extensions and excluded trees are not a language coverage guarantee.', 'Aliases, package exports, dynamic/runtime calls, HTTP/RPC, queues, database relations and cross-language edges require curated evidence.'],
  };
  return map;
}

const safeText = (text: string): string => text.replace(/[\r\n]/g, ' ').replace(/[&<>"'`\[\]|]/g, (char) => `&#${char.charCodeAt(0)};`);
const key = (type: string, location: string): string => `map-${type}-${sha256(location).slice(0, 12)}`;
const slugFor = (id: string, location: string): string => {
  const label = location.replace(/[^a-zA-Z0-9-]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'root';
  return `map/${id.split('-')[1]}-${label}-${id.slice(-12)}`;
};
// Route directories such as [id] are literal paths, not character classes in our glob grammar.
const evidencePath = (value: string): string => value.replace(/[\[\]{}*?]/g, '?').replace(/^!/, '?');

/** Generated facts live inside one owned region; curated prose/frontmatter stay outside it. */
export function applicationMapNotes(map: ApplicationMap, config: WondevConfig, locations: Record<string, string> = {}): MapNote[] {
  const groups = new Map<string, SourceFact[]>();
  for (const file of map.files) {
    const dir = path.posix.dirname(file.path);
    groups.set(dir, [...(groups.get(dir) ?? []), file]);
  }
  const slugs = new Map([
    ...[...groups.keys()].map((dir) => [key('module', dir), slugFor(key('module', dir), dir)] as const),
    ...map.packages.map((pkg) => [key('package', pkg.path), slugFor(key('package', pkg.path), path.posix.dirname(pkg.path))] as const),
  ]);
  const link = (id: string, label: string): string => {
    const memoryDir = sourceDirectory('memory', config.sources);
    const rel = locations[id]?.replace(/\.md$/, '') ?? `${memoryDir}/${slugs.get(id)!}`;
    const target = config.vault && rel.startsWith(`${config.vault}/`) ? rel.slice(config.vault.length + 1) : rel.slice(memoryDir.length + 1);
    return `[[${target}|${safeText(label)}]]`;
  };
  const notes: MapNote[] = [];
  const make = (id: string, title: string, evidence: string[], body: string): void => {
    const observed = `${MAP_START}\n${body}\n${MAP_END}`;
    const content = stringifyFrontmatter({ id, title, kind: 'module', status: 'active', always: false,
      description: `Observed application structure for ${title}. Read before changing this area.`,
      globs: evidence, evidence,
    }, `${observed}\n\n## Curated understanding\n\nRecord responsibilities, invariants, business flows, decisions, and linked lessons here. This section survives map refreshes.\n`);
    notes.push({ id, slug: slugs.get(id)!, content, observed });
  };
  for (const [dir, files] of groups) {
    const id = key('module', dir);
    const consumers = map.files.filter((file) => path.posix.dirname(file.path) !== dir && file.imports.some((i) => i.resolved && path.posix.dirname(i.resolved) === dir));
    const dependencies = [...new Set(files.flatMap((file) => file.imports.flatMap((i) => i.resolved && path.posix.dirname(i.resolved) !== dir ? [path.posix.dirname(i.resolved)] : [])))].sort();
    const lines = files.map((file) => `- ${safeText(file.path)}${file.test ? ' (test)' : ''}${file.error ? ' — syntax could not be parsed; inspect directly' : ''}${file.imports.length ? `\n${file.imports.map((i) => `  - line ${i.line}: ${safeText(i.specifier)} → ${i.resolved ? safeText(i.resolved) : 'external or unresolved; inspect configuration'}`).join('\n')}` : ''}`);
    const prefix = dir === '.' ? '' : `${dir}/`;
    make(id, `Module ${dir}`, [`${evidencePath(prefix)}*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}`], [
      `# Module ${safeText(dir)}`, 'Observed file/import facts, not inferred business behavior. Relative imports use file and index resolution; aliases, package exports, and runtime calls need inspection.',
      '## Files and literal imports', lines.join('\n'),
      '## Dependencies', dependencies.map((dep) => `- ${link(key('module', dep), dep)}`).join('\n') || 'No resolved cross-directory imports.',
      '## Consumers', consumers.map((f) => `- ${link(key('module', path.posix.dirname(f.path)), f.path)}`).join('\n') || 'No observed cross-directory consumers.',
    ].join('\n\n'));
  }
  for (const pkg of map.packages) {
    const local = map.packages.filter((other) => other !== pkg && pkg.dependencies.includes(other.name));
    make(key('package', pkg.path), `Package ${pkg.name}`, [evidencePath(pkg.path)], [
      `# Package ${safeText(pkg.name)}`, `Manifest: ${safeText(pkg.path)}`,
      `Declared entry points: ${pkg.entries.map(safeText).join(', ') || 'none'}`,
      `Available script names (not executed): ${pkg.scripts.map(safeText).join(', ') || 'none'}`,
      `Declared dependencies: ${pkg.dependencies.map(safeText).join(', ') || 'none'}`,
      ...local.map((other) => `- ${link(key('package', other.path), other.name)}`),
    ].join('\n\n'));
  }
  return notes.sort((a, b) => a.slug.localeCompare(b.slug));
}

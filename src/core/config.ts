import path from 'node:path';
import { parse as parseYaml, parseDocument } from 'yaml';
import { SOURCE_SCHEMA_VERSION } from './schema.js';
import { ALL_SECTIONS } from './model.js';
import type {
  ArtifactSection,
  ClaudeTarget,
  SingleFileTarget,
  NamedTarget,
  RuleDirFrontmatterMap,
  RuleDirTarget,
  Target,
  WriteMode,
} from './model.js';
import { BUILTIN_TARGETS, DEFAULT_TARGETS, knownTargetNames, resolveAlias } from './registry.js';
import { WondevError } from '../util/errors.js';
import { readFileIfExists, writeFileAtomic } from '../util/fs.js';
import { createRootGuard, isInsideRoot, toPosix } from '../util/paths.js';

export const WONDEV_DIR = '.wondev';
export const CONFIG_FILE = 'wondev.yaml';

export const SOURCE_KINDS = ['memory', 'skills', 'commands', 'agents', 'sessions'] as const;
export type SourceKind = typeof SOURCE_KINDS[number];
export type SourceConfig = Partial<Record<SourceKind, string>>;
export interface SkillProfile { skills: string[] }

export function sourceDirectory(kind: SourceKind, sources: SourceConfig = {}): string {
  return sources[kind] ?? `${WONDEV_DIR}/${kind}`;
}

/** Resolve a template key without changing the key used by template provenance. */
export function sourceFile(rel: string, sources: SourceConfig = {}): string {
  const [kind, ...rest] = rel.split('/');
  return SOURCE_KINDS.includes(kind as SourceKind)
    ? `${sourceDirectory(kind as SourceKind, sources)}/${rest.join('/')}`
    : `${WONDEV_DIR}/${rel}`;
}

export function projectDirectory(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || !isInsideRoot(value) || /[\\*?\[\]{}]/.test(value)) {
    throw new WondevError(`${label} must be a relative directory inside the project.`);
  }
  const normalized = toPosix(path.normalize(value.trim())).replace(/\/$/, '');
  if (normalized === '.') throw new WondevError(`${label} cannot be the project root.`);
  return normalized;
}

export function readSources(value: unknown): SourceConfig {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new WondevError('sources must be a mapping.');
  }
  const sources: SourceConfig = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!SOURCE_KINDS.includes(key as SourceKind)) throw new WondevError(`Unknown source kind: ${key}`);
    sources[key as SourceKind] = projectDirectory(raw, `sources.${key}`);
  }
  const directories = SOURCE_KINDS.map((kind) => sourceDirectory(kind, sources));
  for (let i = 0; i < directories.length; i++) {
    for (let j = i + 1; j < directories.length; j++) {
      const a = directories[i]!.toLowerCase();
      const b = directories[j]!.toLowerCase();
      if (a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`)) {
        throw new WondevError(`Source directories overlap: ${directories[i]} and ${directories[j]}`);
      }
    }
  }
  return sources;
}

/** An extra index column, drawing on a frontmatter key wondev does not interpret. */
export interface IndexColumn {
  key: string;
  label: string;
}

export interface IndexConfig {
  /** Where the table is written, relative to the project root. */
  file: string;
  /**
   * Ceiling on always-on context, in estimated tokens. Absent means no enforcement.
   *
   * There is deliberately no default. A default would fail `check` in every project that
   * upgrades and happens to sit above a number wondev picked, on a MINOR bump nobody read
   * the notes for -- the exact failure docs/versioning.md exists to prevent.
   */
  budget?: number;
  columns: IndexColumn[];
}

export interface WondevConfig {
  name: string;
  targets: string[];
  customTargets: Record<string, Target>;
  /** Source format version. Absent in a file means 1, the first shape that existed. */
  schema: number;
  /** The wondev release that last wrote this file, for diagnostics. */
  wondevVersion?: string;
  /** Memory index settings. Absent means no index is generated. */
  index?: IndexConfig;
  sources?: SourceConfig;
  /** Obsidian link paths are relative to this directory. */
  vault?: string;
  profiles?: Record<string, SkillProfile>;
  profile?: string;
  /** Disabled skills remain authored sources and can be enabled again. */
  disabledSkills?: string[];
}

export function wondevDir(root: string): string {
  return path.join(root, WONDEV_DIR);
}

export function configPath(root: string): string {
  return path.join(wondevDir(root), CONFIG_FILE);
}

export async function loadConfig(root: string): Promise<WondevConfig> {
  await createRootGuard(root)(`${WONDEV_DIR}/${CONFIG_FILE}`);
  const file = configPath(root);
  const raw = await readFileIfExists(file);
  if (raw === null) {
    throw new WondevError(
      `No ${WONDEV_DIR}/${CONFIG_FILE} found in ${root}`,
      'Run `wondev init` to create one.',
    );
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (err) {
    throw new WondevError(
      `${WONDEV_DIR}/${CONFIG_FILE}: invalid YAML - ${(err as Error).message}`,
    );
  }
  if (parsed === null || parsed === undefined) parsed = {};
  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new WondevError(`${WONDEV_DIR}/${CONFIG_FILE}: expected a YAML mapping.`);
  }

  const obj = parsed as Record<string, unknown>;
  const name = typeof obj['name'] === 'string' && obj['name'].trim() !== ''
    ? obj['name'].trim()
    : path.basename(root);

  const schema = readSchema(obj['schema']);
  const targets = readTargetList(obj['targets']);
  const customTargets = readCustomTargets(obj['customTargets']);

  for (const t of targets) {
    const resolved = resolveAlias(t);
    if (!customTargets[t] && !customTargets[resolved] && !BUILTIN_TARGETS[resolved]) {
      throw new WondevError(
        `${WONDEV_DIR}/${CONFIG_FILE}: unknown target "${t}".`,
        `Known targets: ${knownTargetNames().join(', ')}. Add anything else under customTargets.`,
      );
    }
  }

  const config: WondevConfig = { name, targets, customTargets, schema };
  if (obj['sources'] !== undefined) config.sources = readSources(obj['sources']);
  if (obj['vault'] !== undefined) config.vault = projectDirectory(obj['vault'], 'vault');
  if (obj['profiles'] !== undefined) {
    const profiles = obj['profiles'];
    if (!profiles || typeof profiles !== 'object' || Array.isArray(profiles)) throw new WondevError('profiles must be a mapping.');
    config.profiles = {};
    for (const [key, value] of Object.entries(profiles)) {
      const skills = (value as SkillProfile | null)?.skills;
      if (!/^[a-z0-9][a-z0-9-]*$/.test(key) || !Array.isArray(skills) || skills.some((s) => typeof s !== 'string' || !s.trim())) throw new WondevError(`profiles.${key} needs a skills list of names or glob patterns.`);
      config.profiles[key] = { skills };
    }
  }
  if (obj['profile'] !== undefined) {
    if (typeof obj['profile'] !== 'string' || !Object.hasOwn(config.profiles ?? {}, obj['profile'])) throw new WondevError('profile must name a configured profile.');
    config.profile = obj['profile'];
  }
  if (obj['disabledSkills'] !== undefined) {
    const disabled = obj['disabledSkills'];
    if (!Array.isArray(disabled) || disabled.some((s) => typeof s !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(s))) {
      throw new WondevError('disabledSkills must be a list of skill names.');
    }
    config.disabledSkills = [...new Set(disabled as string[])];
  }
  const writtenBy = typeof obj['wondevVersion'] === 'string' ? obj['wondevVersion'] : undefined;
  if (writtenBy) config.wondevVersion = writtenBy;
  const index = readIndex(obj['index']);
  if (index) config.index = index;
  return config;
}

/**
 * Read the `index:` block.
 *
 * Every key is optional and the whole block is optional: with no `index.file`, wondev
 * generates no index and behaves exactly as it did before the feature existed.
 */
function readIndex(value: unknown): IndexConfig | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new WondevError(`${WONDEV_DIR}/${CONFIG_FILE}: "index" must be a mapping.`);
  }
  const obj = value as Record<string, unknown>;

  const file = typeof obj['file'] === 'string' ? obj['file'].trim() : '';
  if (file === '') {
    throw new WondevError(`${WONDEV_DIR}/${CONFIG_FILE}: "index.file" is required.`);
  }
  // Same guard as target paths: this string comes from a file in the repository and ends up
  // being written to.
  if (!isInsideRoot(file)) {
    throw new WondevError(
      `${WONDEV_DIR}/${CONFIG_FILE}: "index.file" must be a relative path inside the project (got "${file}").`,
    );
  }

  const out: IndexConfig = { file, columns: [] };

  const budget = obj['budget'];
  if (budget !== undefined && budget !== null) {
    if (typeof budget !== 'number' || !Number.isInteger(budget) || budget <= 0) {
      throw new WondevError(
        `${WONDEV_DIR}/${CONFIG_FILE}: "index.budget" must be a positive integer.`,
      );
    }
    out.budget = budget;
  }

  const columns = obj['columns'];
  if (columns !== undefined && columns !== null) {
    if (!Array.isArray(columns)) {
      throw new WondevError(`${WONDEV_DIR}/${CONFIG_FILE}: "index.columns" must be a list.`);
    }
    for (const raw of columns) {
      const c = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
      const key = typeof c['key'] === 'string' ? c['key'].trim() : '';
      const label = typeof c['label'] === 'string' ? c['label'].trim() : '';
      if (key === '' || label === '') {
        throw new WondevError(
          `${WONDEV_DIR}/${CONFIG_FILE}: each entry in "index.columns" needs a "key" and a "label".`,
        );
      }
      out.columns.push({ key, label });
    }
  }

  return out;
}

/**
 * A file with no `schema` key predates the stamp, which can only mean version 1. A file
 * claiming a version this build has never heard of is refused rather than guessed at:
 * rendering it with older rules would silently produce wrong output.
 */
function readSchema(value: unknown): number {
  if (value === undefined || value === null) return 1;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new WondevError(
      `${WONDEV_DIR}/${CONFIG_FILE}: "schema" must be a positive integer.`,
    );
  }
  if (value > SOURCE_SCHEMA_VERSION) {
    throw new WondevError(
      `This project uses source schema ${value}, but this wondev supports up to ${SOURCE_SCHEMA_VERSION}.`,
      'Upgrade wondev: npm install -g wondev@latest',
    );
  }
  return value;
}

/**
 * Rewrite `schema` and `wondevVersion` in place.
 *
 * Uses the YAML document API rather than re-serialising, so the explanatory comments the
 * init template writes are not destroyed by a migration.
 */
export async function stampConfig(root: string, schema: number, version: string): Promise<void> {
  const file = configPath(root);
  const raw = await readFileIfExists(file);
  if (raw === null) throw new WondevError(`No ${WONDEV_DIR}/${CONFIG_FILE} to update.`);

  const doc = parseDocument(raw);
  doc.set('schema', schema);
  doc.set('wondevVersion', version);
  await writeFileAtomic(file, doc.toString({ lineWidth: 0 }));
}

function readTargetList(value: unknown): string[] {
  if (value === undefined || value === null) return [...DEFAULT_TARGETS];
  if (!Array.isArray(value)) {
    throw new WondevError(`${WONDEV_DIR}/${CONFIG_FILE}: "targets" must be a list.`);
  }
  const out = value.filter((v): v is string => typeof v === 'string' && v.trim() !== '');
  if (out.length === 0) {
    throw new WondevError(`${WONDEV_DIR}/${CONFIG_FILE}: "targets" is empty.`);
  }
  return out.map((v) => v.trim());
}

function readCustomTargets(value: unknown): Record<string, Target> {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new WondevError(`${WONDEV_DIR}/${CONFIG_FILE}: "customTargets" must be a mapping.`);
  }
  const out: Record<string, Target> = {};
  for (const [name, raw] of Object.entries(value as Record<string, unknown>)) {
    out[name] = validateTarget(name, raw);
  }
  return out;
}

/**
 * Target definitions come from user config, so every path is checked to stay inside the
 * project root before it can reach the writer.
 */
/** Shared by every engine that can narrow what it carries. */
function readInclude(name: string, value: unknown): ArtifactSection[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.length === 0) {
    throw new WondevError(
      `customTargets.${name}: "include" must be a non-empty list.`,
      `Valid sections: ${ALL_SECTIONS.join(', ')}.`,
    );
  }
  for (const v of value) {
    if (!ALL_SECTIONS.includes(v as ArtifactSection)) {
      throw new WondevError(
        `customTargets.${name}: unknown section "${String(v)}" in "include".`,
        `Valid sections: ${ALL_SECTIONS.join(', ')}.`,
      );
    }
  }
  return value as ArtifactSection[];
}

export function validateTarget(name: string, raw: unknown): Target {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new WondevError(`customTargets.${name}: must be a mapping.`);
  }
  const obj = raw as Record<string, unknown>;
  const engine = obj['engine'];

  const requirePath = (key: string): string => {
    const v = obj[key];
    if (typeof v !== 'string' || v.trim() === '') {
      throw new WondevError(`customTargets.${name}: "${key}" is required and must be a string.`);
    }
    const p = v.trim();
    if (!isInsideRoot(p)) {
      throw new WondevError(
        `customTargets.${name}: "${key}" must be a relative path inside the project (got "${p}").`,
      );
    }
    return p;
  };

  switch (engine) {
    case 'skill-plugin': {
      const pluginName = obj['name'];
      const version = obj['version'];
      if (typeof pluginName !== 'string' || pluginName.length > 64 || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(pluginName)) throw new WondevError(`customTargets.${name}: plugin name must be kebab-case, up to 64 characters.`);
      if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) throw new WondevError(`customTargets.${name}: plugin version must be an exact X.Y.Z version.`);
      return { engine, path: requirePath('path'), name: pluginName, version };
    }
    case 'single-file': {
      const mode = obj['mode'];
      if (mode !== undefined && mode !== 'region' && mode !== 'whole') {
        throw new WondevError(`customTargets.${name}: "mode" must be "region" or "whole".`);
      }
      const single: SingleFileTarget = {
        engine: 'single-file',
        path: requirePath('path'),
        mode: (mode as WriteMode | undefined) ?? 'region',
      };
      const singleInclude = readInclude(name, obj['include']);
      if (singleInclude) single.include = singleInclude;
      if (obj['skills'] !== undefined) single.skills = requirePath('skills');
      return single;
    }
    case 'rule-dir': {
      const ext = typeof obj['ext'] === 'string' && obj['ext'].trim() !== ''
        ? obj['ext'].trim()
        : '.md';
      if (!ext.startsWith('.')) {
        throw new WondevError(`customTargets.${name}: "ext" must start with a dot (got "${ext}").`);
      }
      const target: RuleDirTarget = { engine: 'rule-dir', path: requirePath('path'), ext };
      const ruleInclude = readInclude(name, obj['include']);
      if (ruleInclude) target.include = ruleInclude;
      const fm = obj['frontmatter'];
      if (fm !== undefined) {
        if (typeof fm !== 'object' || fm === null || Array.isArray(fm)) {
          throw new WondevError(`customTargets.${name}: "frontmatter" must be a mapping.`);
        }
        target.frontmatter = fm as RuleDirFrontmatterMap;
      }
      return target;
    }
    case 'claude': {
      const claude: ClaudeTarget = {
        engine: 'claude',
        memory: requirePath('memory'),
        skills: requirePath('skills'),
        commands: requirePath('commands'),
      };
      // Optional: a claude target defined before subagents existed stays valid, and simply
      // produces no agent files.
      if (obj['agents'] !== undefined) claude.agents = requirePath('agents');
      if (obj['rules'] !== undefined) claude.rules = requirePath('rules');
      const claudeInclude = readInclude(name, obj['include']);
      if (claudeInclude) claude.include = claudeInclude;
      return claude;
    }
    case 'html':
      return { engine: 'html', path: requirePath('path') };
    default:
      throw new WondevError(
        `customTargets.${name}: unknown engine "${String(engine)}".`,
        'Valid engines: single-file, rule-dir, claude, html, skill-plugin.',
      );
  }
}

/**
 * Resolve configured target names to definitions, dropping duplicates that arise when a
 * user lists both an alias and its canonical name (e.g. `codex` and `agents`).
 */
export function resolveTargets(config: WondevConfig): NamedTarget[] {
  const seen = new Set<string>();
  const out: NamedTarget[] = [];
  for (const requested of config.targets) {
    const custom = config.customTargets[requested];
    if (custom) {
      if (seen.has(requested)) continue;
      seen.add(requested);
      out.push({ name: requested, target: custom });
      continue;
    }
    const canonical = resolveAlias(requested);
    if (seen.has(canonical)) continue;
    const builtin = BUILTIN_TARGETS[canonical];
    if (!builtin) {
      throw new WondevError(`Unknown target "${requested}".`);
    }
    seen.add(canonical);
    out.push({ name: canonical, target: builtin.target });
  }
  return out;
}

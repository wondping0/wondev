import path from 'node:path';
import { parse as parseYaml, parseDocument } from 'yaml';
import { SOURCE_SCHEMA_VERSION } from './schema.js';
import type {
  ClaudeTarget,
  NamedTarget,
  RuleDirFrontmatterMap,
  RuleDirTarget,
  Target,
  WriteMode,
} from './model.js';
import { BUILTIN_TARGETS, DEFAULT_TARGETS, knownTargetNames, resolveAlias } from './registry.js';
import { WondevError } from '../util/errors.js';
import { readFileIfExists, writeFileAtomic } from '../util/fs.js';
import { isInsideRoot } from '../util/paths.js';

export const WONDEV_DIR = '.wondev';
export const CONFIG_FILE = 'wondev.yaml';

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
}

export function wondevDir(root: string): string {
  return path.join(root, WONDEV_DIR);
}

export function configPath(root: string): string {
  return path.join(wondevDir(root), CONFIG_FILE);
}

export async function loadConfig(root: string): Promise<WondevConfig> {
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
    case 'single-file': {
      const mode = obj['mode'];
      if (mode !== undefined && mode !== 'region' && mode !== 'whole') {
        throw new WondevError(`customTargets.${name}: "mode" must be "region" or "whole".`);
      }
      return {
        engine: 'single-file',
        path: requirePath('path'),
        mode: (mode as WriteMode | undefined) ?? 'region',
      };
    }
    case 'rule-dir': {
      const ext = typeof obj['ext'] === 'string' && obj['ext'].trim() !== ''
        ? obj['ext'].trim()
        : '.md';
      if (!ext.startsWith('.')) {
        throw new WondevError(`customTargets.${name}: "ext" must start with a dot (got "${ext}").`);
      }
      const target: RuleDirTarget = { engine: 'rule-dir', path: requirePath('path'), ext };
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
      return claude;
    }
    default:
      throw new WondevError(
        `customTargets.${name}: unknown engine "${String(engine)}".`,
        'Valid engines: single-file, rule-dir, claude.',
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

import type { Target } from './model.js';
import { compareVersions } from '../util/semver.js';

export interface RegistryEntry {
  target: Target;
  /** Human-readable label used in CLI output. */
  label: string;
  /** wondev version this target first shipped in, for `wondev targets --new`. */
  addedIn: string;
  /** Other tools that consume this same output file. Purely informational. */
  readBy: string[];
  /**
   * When a maintainer last checked this target's output path against the vendor's own
   * documentation, ISO `YYYY-MM-DD`.
   *
   * This exists because of the one failure mode wondev has no symptom for. Agents move their
   * config locations -- Windsurf's documentation already shows `.devin/` taking precedence
   * over `.windsurf/` -- and when that happens wondev keeps writing to the old path and
   * every command still reports success. Nothing fails. The files are simply never read
   * again.
   *
   * Absent means never verified since the entry was written, which is the honest state for
   * most of them. `wondev targets --verbose` shows it, so a user can see how current
   * wondev's knowledge actually is rather than assuming it is current.
   */
  pathVerified?: string;
  /**
   * Set when an agent moves or retires its config location. Nothing is removed without one
   * MINOR release carrying this warning first.
   */
  deprecated?: {
    since: string;
    replacedBy?: string;
    note?: string;
  };
}

/**
 * Built-in targets.
 *
 * Deliberately small: many agents converged on `AGENTS.md`, so they share one entry rather
 * than each getting a near-duplicate definition that would fight over the same output path.
 * Anything not listed here is a two-line `customTargets` entry in `wondev.yaml`, which is
 * how wondev supports agents that do not exist yet.
 */
export const BUILTIN_TARGETS: Record<string, RegistryEntry> = {
  guide: {
    label: 'HTML project guide',
    // wondev owns this path; there is no vendor documentation to check it against.
    pathVerified: '2026-08-11',
    addedIn: '0.5.0',
    readBy: ['people'],
    target: {
      engine: 'html',
      path: 'GUIDE.html',
    },
  },

  claude: {
    label: 'Claude Code',
    pathVerified: '2026-08-11',
    addedIn: '0.1.0',
    readBy: ['Claude Code'],
    target: {
      engine: 'claude',
      memory: 'CLAUDE.md',
      skills: '.claude/skills',
      commands: '.claude/commands',
      agents: '.claude/agents',
      rules: '.claude/rules',
    },
  },

  agents: {
    label: 'AGENTS.md',
    pathVerified: '2026-08-11',
    addedIn: '0.1.0',
    readBy: [
      'OpenAI Codex',
      'Cursor',
      'GitHub Copilot',
      'Gemini CLI',
      'Aider',
      'Windsurf',
      'Zed',
      'Jules',
      'Factory',
      'opencode',
      'goose',
      'Devin',
      'Warp',
      'RooCode',
      'Kilo Code',
      'Amp',
    ],
    target: { engine: 'single-file', path: 'AGENTS.md', mode: 'region' },
  },

  copilot: {
    label: 'GitHub Copilot',
    pathVerified: '2026-08-11',
    addedIn: '0.1.0',
    readBy: ['GitHub Copilot'],
    target: {
      engine: 'single-file',
      path: '.github/copilot-instructions.md',
      mode: 'region',
    },
  },

  gemini: {
    label: 'Gemini CLI',
    pathVerified: '2026-08-12',
    addedIn: '0.1.0',
    readBy: ['Gemini CLI'],
    target: { engine: 'single-file', path: 'GEMINI.md', mode: 'region' },
  },

  aider: {
    label: 'Aider',
    pathVerified: '2026-08-11',
    addedIn: '0.1.0',
    readBy: ['Aider'],
    target: { engine: 'single-file', path: 'CONVENTIONS.md', mode: 'region' },
  },

  junie: {
    label: 'JetBrains Junie',
    pathVerified: '2026-08-12',
    addedIn: '0.1.0',
    readBy: ['JetBrains Junie'],
    target: { engine: 'single-file', path: '.junie/guidelines.md', mode: 'region' },
    // Verified 2026-08-12: Junie now searches `.junie/AGENTS.md`, then `AGENTS.md`, then
    // `.junie/guidelines.md`, which its own documentation calls "Junie's legacy format for
    // guidelines (still supported)".
    //
    // The consequence is sharper than "legacy": `agents` is in DEFAULT_TARGETS, so a project
    // with both enabled has an AGENTS.md that outranks this file, and the guidelines wondev
    // writes here are never read. Working output that nothing consumes is worse than an
    // error, because everything reports success.
    deprecated: {
      since: '1.0.1',
      replacedBy: 'agents',
      note: 'Junie prefers AGENTS.md; .junie/guidelines.md is its legacy format and is outranked whenever AGENTS.md exists.',
    },
  },

  cursor: {
    label: 'Cursor',
    pathVerified: '2026-08-11',
    addedIn: '0.1.0',
    readBy: ['Cursor'],
    target: {
      engine: 'rule-dir',
      path: '.cursor/rules',
      ext: '.mdc',
      frontmatter: {
        description: 'description',
        globs: 'globs',
        always: 'alwaysApply',
        globsFormat: 'array',
      },
    },
  },

  windsurf: {
    label: 'Windsurf',
    addedIn: '0.1.0',
    readBy: ['Windsurf'],
    pathVerified: '2026-08-11',
    target: { engine: 'rule-dir', path: '.windsurf/rules', ext: '.md' },
    // Verified 2026-08-11 and found moved: Windsurf's documentation now redirects to
    // docs.devin.ai, which states `.devin/rules/` is preferred and `.windsurf/rules/` is
    // "kept as a fallback for backward compatibility". This target keeps writing the
    // fallback, which is still read, and points at the successor rather than silently
    // producing files at a path nobody prefers any more.
    deprecated: {
      since: '1.0.0',
      replacedBy: 'devin',
      note: '.devin/rules/ is now the preferred location; .windsurf/rules/ is read as a fallback.',
    },
  },

  devin: {
    label: 'Devin / Windsurf (Cascade)',
    addedIn: '1.0.0',
    readBy: ['Devin', 'Windsurf'],
    pathVerified: '2026-08-11',
    target: { engine: 'rule-dir', path: '.devin/rules', ext: '.md' },
  },

  cline: {
    label: 'Cline',
    pathVerified: '2026-08-11',
    addedIn: '0.1.0',
    readBy: ['Cline'],
    target: { engine: 'rule-dir', path: '.clinerules', ext: '.md' },
  },

  roo: {
    label: 'Roo Code',
    pathVerified: '2026-08-11',
    addedIn: '0.1.0',
    readBy: ['Roo Code'],
    target: { engine: 'rule-dir', path: '.roo/rules', ext: '.md' },
  },

  continue: {
    label: 'Continue',
    pathVerified: '2026-08-11',
    addedIn: '0.1.0',
    readBy: ['Continue'],
    // Continue reads optional YAML frontmatter on rule files; without this map the glob
    // scoping authored in .wondev/ would be silently dropped for this target.
    target: {
      engine: 'rule-dir',
      path: '.continue/rules',
      ext: '.md',
      frontmatter: {
        description: 'description',
        globs: 'globs',
        globsFormat: 'array',
      },
    },
  },

  kiro: {
    label: 'Kiro',
    pathVerified: '2026-08-11',
    addedIn: '0.1.0',
    readBy: ['Kiro'],
    target: { engine: 'rule-dir', path: '.kiro/steering', ext: '.md' },
  },
};

/**
 * Tools that read a file another target already produces. Writing `targets: [codex]` is
 * friendlier than making users know Codex reads `AGENTS.md`.
 */
export const TARGET_ALIASES: Record<string, string> = {
  codex: 'agents',
  zed: 'agents',
  opencode: 'agents',
  jules: 'agents',
  factory: 'agents',
  goose: 'agents',
  amp: 'agents',
  warp: 'agents',
  'agents-md': 'agents',
  'gemini-cli': 'gemini',
  'claude-code': 'claude',
  copilot_instructions: 'copilot',
  kilocode: 'roo',
};

/** Targets `wondev init` enables when the user does not choose. */
export const DEFAULT_TARGETS = ['claude', 'agents', 'cursor', 'copilot', 'gemini'];

export function resolveAlias(name: string): string {
  return TARGET_ALIASES[name] ?? name;
}

export function knownTargetNames(): string[] {
  return Object.keys(BUILTIN_TARGETS).sort();
}

export function lookupBuiltin(name: string): Target | undefined {
  return BUILTIN_TARGETS[resolveAlias(name)]?.target;
}

/**
 * The warning line for a deprecated target, or null when it is fine.
 *
 * Takes the registry as a parameter so this can be tested with a synthetic deprecated entry.
 * No built-in target is deprecated yet, and a branch first exercised on the day it matters
 * is a branch nobody has checked.
 */
export function deprecationNotice(
  name: string,
  registry: Record<string, RegistryEntry> = BUILTIN_TARGETS,
): string | null {
  const deprecated = registry[resolveAlias(name)]?.deprecated;
  if (!deprecated) return null;

  const replacement = deprecated.replacedBy ? ` Use "${deprecated.replacedBy}" instead.` : '';
  const note = deprecated.note ? ` ${deprecated.note}` : '';
  return `target "${name}" is deprecated since ${deprecated.since}.${replacement}${note}`;
}

/** Targets added after `since`, for telling a user what became available. */
export function targetsAddedSince(
  since: string,
  registry: Record<string, RegistryEntry> = BUILTIN_TARGETS,
): string[] {
  return Object.keys(registry)
    .filter((name) => compareVersions(registry[name]?.addedIn ?? '0.0.0', since) > 0)
    .sort();
}

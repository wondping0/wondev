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
    addedIn: '0.5.0',
    readBy: ['people'],
    target: {
      engine: 'html',
      path: 'GUIDE.html',
    },
  },

  claude: {
    label: 'Claude Code',
    addedIn: '0.1.0',
    readBy: ['Claude Code'],
    target: {
      engine: 'claude',
      memory: 'CLAUDE.md',
      skills: '.claude/skills',
      commands: '.claude/commands',
      agents: '.claude/agents',
    },
  },

  agents: {
    label: 'AGENTS.md',
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
    addedIn: '0.1.0',
    readBy: ['Gemini CLI'],
    target: { engine: 'single-file', path: 'GEMINI.md', mode: 'region' },
  },

  aider: {
    label: 'Aider',
    addedIn: '0.1.0',
    readBy: ['Aider'],
    target: { engine: 'single-file', path: 'CONVENTIONS.md', mode: 'region' },
  },

  junie: {
    label: 'JetBrains Junie',
    addedIn: '0.1.0',
    readBy: ['JetBrains Junie'],
    target: { engine: 'single-file', path: '.junie/guidelines.md', mode: 'region' },
  },

  cursor: {
    label: 'Cursor',
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
    target: { engine: 'rule-dir', path: '.windsurf/rules', ext: '.md' },
  },

  cline: {
    label: 'Cline',
    addedIn: '0.1.0',
    readBy: ['Cline'],
    target: { engine: 'rule-dir', path: '.clinerules', ext: '.md' },
  },

  roo: {
    label: 'Roo Code',
    addedIn: '0.1.0',
    readBy: ['Roo Code'],
    target: { engine: 'rule-dir', path: '.roo/rules', ext: '.md' },
  },

  continue: {
    label: 'Continue',
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
  devin: 'agents',
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

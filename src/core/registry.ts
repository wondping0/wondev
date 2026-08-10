import type { Target } from './model.js';

export interface RegistryEntry {
  target: Target;
  /** Human-readable label used in CLI output. */
  label: string;
  /** Other tools that consume this same output file. Purely informational. */
  readBy: string[];
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
  claude: {
    label: 'Claude Code',
    readBy: ['Claude Code'],
    target: {
      engine: 'claude',
      memory: 'CLAUDE.md',
      skills: '.claude/skills',
      commands: '.claude/commands',
    },
  },

  agents: {
    label: 'AGENTS.md',
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
    readBy: ['GitHub Copilot'],
    target: {
      engine: 'single-file',
      path: '.github/copilot-instructions.md',
      mode: 'region',
    },
  },

  gemini: {
    label: 'Gemini CLI',
    readBy: ['Gemini CLI'],
    target: { engine: 'single-file', path: 'GEMINI.md', mode: 'region' },
  },

  aider: {
    label: 'Aider',
    readBy: ['Aider'],
    target: { engine: 'single-file', path: 'CONVENTIONS.md', mode: 'region' },
  },

  junie: {
    label: 'JetBrains Junie',
    readBy: ['JetBrains Junie'],
    target: { engine: 'single-file', path: '.junie/guidelines.md', mode: 'region' },
  },

  cursor: {
    label: 'Cursor',
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
    readBy: ['Windsurf'],
    target: { engine: 'rule-dir', path: '.windsurf/rules', ext: '.md' },
  },

  cline: {
    label: 'Cline',
    readBy: ['Cline'],
    target: { engine: 'rule-dir', path: '.clinerules', ext: '.md' },
  },

  roo: {
    label: 'Roo Code',
    readBy: ['Roo Code'],
    target: { engine: 'rule-dir', path: '.roo/rules', ext: '.md' },
  },

  continue: {
    label: 'Continue',
    readBy: ['Continue'],
    target: { engine: 'rule-dir', path: '.continue/rules', ext: '.md' },
  },

  kiro: {
    label: 'Kiro',
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

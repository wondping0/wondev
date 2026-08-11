/**
 * The neutral intermediate representation.
 *
 * `source` parses `.wondev/` into a `Project`; `render` turns a `Project` plus a `Target`
 * into `RenderedFile[]`. Nothing else in the codebase needs to know both sides.
 */

/** A durable project fact: architecture, conventions, a decision record, the glossary. */
export interface MemoryDoc {
  /** Path-like id without extension, e.g. `architecture` or `decisions/0001-use-esm`. */
  slug: string;
  title: string;
  description?: string;
  /** Inject into always-on context rather than loading on demand. */
  always: boolean;
  /** Optional path scoping for targets that support it. */
  globs?: string[];
  /** Date this document was last checked against the code, ISO `YYYY-MM-DD`. */
  verified?: string;
  /** What it was checked against -- the evidence, not just the date. */
  verifiedAgainst?: string;
  /**
   * Frontmatter keys wondev does not interpret, preserved verbatim.
   *
   * Never injected into a target's own frontmatter: `.mdc` and `.md` rule files are parsed
   * by other people's tools, and posting unknown keys into them risks breaking a parser
   * wondev does not control. They surface in the memory index instead, on request.
   */
  extra: Record<string, unknown>;
  body: string;
  /** Source path relative to `.wondev/`, always forward-slashed. */
  sourcePath: string;
}

/**
 * A file a skill carries alongside it.
 *
 * Reference material exists so it can be read on demand rather than injected, which is why
 * flat targets get a pointer to it rather than its contents.
 */
export interface Attachment {
  /** Path relative to the skill directory, forward-slashed, e.g. `references/query.md`. */
  relPath: string;
  content: string;
}

/** A reusable procedure the agent should follow when its trigger condition matches. */
export interface Skill {
  name: string;
  description: string;
  globs?: string[];
  /**
   * Copy the body into flattened targets instead of referencing it.
   *
   * Defaults to false, for the same reason on-demand memory is not inlined: a flattened
   * target is read on every turn, and a procedure that applies occasionally should not be
   * paid for continuously. Set it for the short, universal skills an agent should never
   * have to open a file to follow.
   */
  inline: boolean;
  /** Sorted by `relPath`. Empty for the flat `skills/<name>.md` form, which has no directory. */
  attachments: Attachment[];
  body: string;
  sourcePath: string;
}

/** A repeatable prompt the user invokes explicitly. */
export interface Command {
  name: string;
  description: string;
  body: string;
  sourcePath: string;
}

/**
 * A delegated worker with its own context window.
 *
 * The `description` is the dispatch rule, not a summary: it is what the main agent matches
 * against when deciding whether to hand a task off. Only some agents support the concept,
 * so targets that do not get a listing rather than the bodies.
 */
export interface Agent {
  name: string;
  description: string;
  /** Tool names the agent may use. Omit to inherit whatever the host grants by default. */
  tools?: string[];
  /** Model override, passed through verbatim to targets that understand one. */
  model?: string;
  body: string;
  sourcePath: string;
}

export interface Project {
  name: string;
  memory: MemoryDoc[];
  skills: Skill[];
  commands: Command[];
  agents: Agent[];
}

/** How much of a file wondev owns. */
export type WriteMode = 'whole' | 'region';

/** One file a renderer wants written. `path` is relative to the project root. */
export interface RenderedFile {
  path: string;
  content: string;
  mode: WriteMode;
}

/** Maps wondev's canonical frontmatter fields onto a target's own key names. */
export interface RuleDirFrontmatterMap {
  /** Key name for "always apply", e.g. `alwaysApply`. Omit to emit nothing. */
  always?: string;
  /** Key name for path globs, e.g. `globs`. */
  globs?: string;
  /** Key name for the description, e.g. `description`. */
  description?: string;
  /** Whether globs serialize as a YAML array or a comma-separated string. */
  globsFormat?: 'array' | 'csv';
}

/** The artifact types a flattened target can carry. */
export type ArtifactSection = 'memory' | 'skills' | 'commands' | 'agents';

export const ALL_SECTIONS: readonly ArtifactSection[] = ['memory', 'skills', 'commands', 'agents'];

export interface SingleFileTarget {
  engine: 'single-file';
  /** Output path relative to project root. */
  path: string;
  /** Defaults to `region` so hand-written content in the same file survives. */
  mode?: WriteMode;
  /**
   * Which artifact types to include. Defaults to all of them.
   *
   * Exists because some hosts have their own mechanism for part of this. A tool that
   * discovers skills itself does not need them repeated in its context file, and repeating
   * them is not neutral -- it is paid for on every turn.
   */
  include?: ArtifactSection[];
}

export interface RuleDirTarget {
  engine: 'rule-dir';
  /** Output directory relative to project root. */
  path: string;
  /** File extension including the dot, e.g. `.mdc`. */
  ext: string;
  frontmatter?: RuleDirFrontmatterMap;
}

export interface ClaudeTarget {
  engine: 'claude';
  memory: string;
  skills: string;
  commands: string;
  /** Where subagents go. Optional so a custom claude target written before 0.4 still loads. */
  agents?: string;
  /**
   * Where path-scoped memory goes, as Claude Code's `.claude/rules/`.
   *
   * A memory document with `globs` describes part of the codebase, not all of it. Claude Code
   * loads a rule with `paths:` frontmatter only when it reads a file matching the pattern, so
   * routing scoped documents here keeps them out of the context of every unrelated task.
   * Optional, so a custom claude target written before 1.0 keeps working.
   */
  rules?: string;
}

/** A self-contained HTML guide, rendered for people rather than for an agent. */
export interface HtmlTarget {
  engine: 'html';
  /** Output path relative to project root. */
  path: string;
}

export type Target = SingleFileTarget | RuleDirTarget | ClaudeTarget | HtmlTarget;

/** A target plus the registry key it was looked up under. */
export interface NamedTarget {
  name: string;
  target: Target;
}

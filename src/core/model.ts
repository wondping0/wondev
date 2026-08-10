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
  body: string;
  /** Source path relative to `.wondev/`, always forward-slashed. */
  sourcePath: string;
}

/** A reusable procedure the agent should follow when its trigger condition matches. */
export interface Skill {
  name: string;
  description: string;
  globs?: string[];
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

export interface Project {
  name: string;
  memory: MemoryDoc[];
  skills: Skill[];
  commands: Command[];
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

export interface SingleFileTarget {
  engine: 'single-file';
  /** Output path relative to project root. */
  path: string;
  /** Defaults to `region` so hand-written content in the same file survives. */
  mode?: WriteMode;
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
}

export type Target = SingleFileTarget | RuleDirTarget | ClaudeTarget;

/** A target plus the registry key it was looked up under. */
export interface NamedTarget {
  name: string;
  target: Target;
}

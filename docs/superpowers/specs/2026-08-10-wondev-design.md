# wondev — Design Spec

**Date:** 2026-08-10
**Status:** Approved for implementation

## 1. Problem

A repo that is worked on by AI coding agents accumulates one config file per agent:
`CLAUDE.md`, `AGENTS.md`, `.cursor/rules/`, `.github/copilot-instructions.md`, `GEMINI.md`,
and more. They say overlapping things. They drift. Nobody updates all of them.

## 2. Solution

`wondev` treats agent knowledge as source code. Authors write it once in `.wondev/`.
`wondev build` compiles it into the native format of every AI agent the project uses.
`wondev check` fails CI when generated files drift from source.

Analogy: TypeScript → JavaScript, but for agent instructions.

## 3. Goals / Non-goals

**Goals**

- One source of truth for skills, memory, and commands.
- Support *every* AI agent, including ones that do not exist yet, via a data-driven registry.
- Safe to run in a repo that already has hand-written agent config.
- Ship a curated starter pack so `wondev init` produces something useful immediately.
- Cross-platform: Windows, Linux, macOS. Runs via `npx wondev`.

**Non-goals**

- No LLM calls. wondev never needs an API key and is not a paid tool.
- No editing of the user's source code.
- Not a package manager. Sharing/`pack` commands are out of scope for v1.

## 4. Architecture

```
.wondev/  ──parse──▶  Project (neutral IR)  ──render──▶  RenderedFile[]  ──write──▶  disk
                      { memory, skills,      per enabled target              + .manifest.json
                        commands }           from the registry
```

Five modules with one job each:

| Module     | Job                                          | I/O    |
| ---------- | -------------------------------------------- | ------ |
| `config`   | load + validate `wondev.yaml`                | reads  |
| `source`   | read `.wondev/**` into a `Project`           | reads  |
| `registry` | built-in target definitions (data)           | pure   |
| `render`   | `Project` + `Target` → `RenderedFile[]`      | pure   |
| `writer`   | atomic writes, manifest, managed regions     | writes |

`render` is a pure function. Same input always yields the same output, so it is tested
with golden files. All filesystem risk is isolated in `writer`, which is small enough to
audit line by line.

### Directory layout

```
src/
  cli.ts                  entry point, shebang, arg dispatch
  commands/               one file per command
    init.ts build.ts watch.ts add.ts check.ts clean.ts
  core/
    model.ts              Project / MemoryDoc / Skill / Command types
    frontmatter.ts        YAML frontmatter parse + serialize
    config.ts             wondev.yaml
    source.ts             .wondev/ → Project
    registry.ts           built-in targets
    render/
      index.ts            engine dispatch
      single-file.ts rule-dir.ts claude.ts
    writer.ts             manifest + safe writes
  util/
    fs.ts log.ts paths.ts
templates/                starter pack, shipped in the npm tarball
```

## 5. Source format

```
.wondev/
  wondev.yaml
  memory/
    architecture.md
    conventions.md
    glossary.md
    decisions/0001-example.md
  skills/
    debugging/SKILL.md
  commands/
    review.md
```

### `wondev.yaml`

```yaml
name: my-project
targets:
  - claude
  - codex
  - cursor
customTargets:
  my-inhouse-agent:
    engine: single-file
    path: .myagent/context.md
```

### Frontmatter

Memory doc:

```yaml
---
title: Architecture
always: true        # inject into always-on context
globs: ["src/**"]   # optional, used by targets that support path scoping
---
```

Skill (`SKILL.md`):

```yaml
---
name: debugging
description: Use when investigating a bug, test failure, or unexpected behavior
globs: ["**/*.ts"]  # optional
---
```

Command:

```yaml
---
name: review
description: Review the current diff for correctness and clarity
---
```

Required fields: memory `title`; skill `name` + `description`; command `name` + `description`.
Missing required fields is a `wondev check` error and a hard build failure.

Memory docs may cross-reference each other with `[[slug]]`, where `slug` is another memory
doc's filename without extension. `check` reports unresolved links.

## 6. Target registry

A target is data, not code. Three engines cover the entire field.

| Engine        | Output shape                             | Example agents                                       |
| ------------- | ---------------------------------------- | ---------------------------------------------------- |
| `single-file` | one flattened markdown file              | Codex, Copilot, Gemini, Aider, Zed, Junie, OpenCode   |
| `rule-dir`    | one markdown file per artifact in a dir  | Cursor, Windsurf, Cline, Roo, Continue, Kiro          |
| `claude`      | `CLAUDE.md` + `skills/` + `commands/`    | Claude Code                                          |

Built-in registry entries (each output path is verified against that tool's documentation
during implementation; unverified entries are not shipped):

```
claude    claude       CLAUDE.md, .claude/skills/, .claude/commands/
codex     single-file  AGENTS.md
copilot   single-file  .github/copilot-instructions.md
gemini    single-file  GEMINI.md
aider     single-file  CONVENTIONS.md
cursor    rule-dir     .cursor/rules/       ext .mdc, fm: alwaysApply/globs/description
windsurf  rule-dir     .windsurf/rules/     ext .md
cline     rule-dir     .clinerules/         ext .md
roo       rule-dir     .roo/rules/          ext .md
continue  rule-dir     .continue/rules/     ext .md
```

Users register unknown or future agents under `customTargets` with the same schema, so
supporting a new agent never requires a wondev release.

A target definition is:

```ts
type Target =
  | { engine: 'single-file'; path: string; mode?: 'region' | 'whole' }
  | { engine: 'rule-dir'; path: string; ext: string;
      frontmatter?: Record<'always' | 'globs' | 'description', string> }
  | { engine: 'claude'; memory: string; skills: string; commands: string }
```

## 7. Write safety

wondev writes into files the user may already own. The rules, in priority order:

1. **Manifest.** `.wondev/.manifest.json` maps every wondev-written path to a content hash,
   its owning target, and its mode (`region` or `whole`).
2. **Never clobber unknown files.** Path exists on disk but is absent from the manifest →
   build refuses with a message naming the file. `--force` overrides.
3. **Never clobber user edits.** Path is in the manifest but its current hash differs →
   build refuses. `--force` overrides.
4. **Managed regions.** All `single-file` targets default to `mode: region`, as does the
   `CLAUDE.md` produced by the `claude` engine. wondev owns only the span between markers:

   ```markdown
   <!-- wondev:start -->
   generated content
   <!-- wondev:end -->
   ```

   Content outside the markers is preserved byte for byte. In `region` mode the manifest
   hashes only the region content, so edits outside the markers are never flagged.
5. **`wondev clean`** deletes exactly the paths listed in the manifest and nothing else.
   For `region`-mode files it strips the region and leaves the file.
6. **Atomic writes.** Write to a temp file in the same directory, then `rename`. An
   interrupted build cannot leave a truncated file.

## 8. Commands

| Command                              | Behaviour                                                     |
| ------------------------------------ | ------------------------------------------------------------- |
| `wondev init`                        | scaffold `.wondev/` + starter pack, select targets, first build |
| `wondev build`                       | compile to enabled targets. `--force`, `--target=<n>`, `--dry-run` |
| `wondev watch`                       | debounced rebuild on change                                   |
| `wondev add <skill\|memory\|command> <name>` | scaffold one new artifact from a template             |
| `wondev check`                       | validate + drift detection, exit 1 on failure                 |
| `wondev clean`                       | remove generated files per manifest                           |

Global flags: `--help`, `--version`, `--cwd=<dir>`, `--no-color`.

`wondev check` is the CI entry point. It reports, with non-zero exit:

- invalid or missing frontmatter fields
- duplicate skill/command names
- unresolved `[[slug]]` memory links
- unknown target names or malformed `customTargets`
- drift: any generated file whose content differs from a fresh render

## 9. Starter pack

`wondev init` writes six skills, each a real procedure rather than a placeholder:

`writing-tests`, `debugging`, `code-review`, `planning-work`, `git-workflow`,
`verify-before-done`.

Plus memory scaffolds: `architecture.md`, `conventions.md`, `glossary.md`, and
`decisions/0001-record-architecture-decisions.md` as a worked ADR example. Scaffolds
contain guiding prompts and a filled example section, not empty headings.

## 10. Tech choices

TypeScript compiled to ESM, Node >= 20.

Dependencies are deliberately minimal: `node:util.parseArgs` instead of commander,
`node:fs.watch` instead of chokidar, hand-rolled ANSI instead of chalk. The single runtime
dependency is `yaml`. This keeps `npx wondev` fast to cold-start and reduces supply-chain
surface.

Cross-platform correctness: `node:path` for all path work, no shell invocation anywhere,
LF-normalized output, and forward-slash paths stored in the manifest so a build on Windows
and a build on Linux produce byte-identical results.

## 11. Testing

- **Unit** — frontmatter parser, config validation, source loader, each render engine,
  manifest and region logic.
- **Golden files** — a fixture `.wondev/` rendered to every target, compared against
  checked-in expected output. Catches unintended format changes.
- **Ownership** — tests proving build refuses to overwrite an unknown file, refuses to
  overwrite a user-edited file, preserves content outside managed regions, and that
  `clean` removes only manifest entries.
- **Integration** — the real CLI run in a temp directory through
  `init → build → check → clean`, asserting filesystem state.
- **CI** — GitHub Actions, matrix of ubuntu/windows/macos across Node 20 and 22.

## 12. Publish readiness

`package.json` with `bin`, `files`, `exports`, `engines`, MIT license, repository and
keywords. README with a quickstart. Verification before release: `npm pack`, then install
the resulting tarball into a scratch directory and run `wondev init` and `wondev build`
from it, on Windows and Linux.

The npm name `wondev` was confirmed unclaimed on 2026-08-10. Publishing itself requires the
maintainer's npm credentials and is performed by the maintainer, not by tooling.

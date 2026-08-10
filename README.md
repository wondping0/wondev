# wondev

**Write your AI agent knowledge once. Compile it for every agent.**

```bash
npx wondev init
```

## The problem

A repository worked on by AI agents ends up with one config file per tool:

```
CLAUDE.md
AGENTS.md
.cursor/rules/
.github/copilot-instructions.md
GEMINI.md
...
```

They say overlapping things. They drift apart. Nobody updates all of them.

## What wondev does

You write agent knowledge once, in `.wondev/`. `wondev build` compiles it into the native
format of every agent your team uses. `wondev check` fails CI when they drift.

TypeScript compiles to JavaScript. wondev compiles to agent config.

```
.wondev/                          CLAUDE.md
  memory/                         AGENTS.md
  skills/       ──  build  ──▶    .cursor/rules/*.mdc
  commands/                       .github/copilot-instructions.md
  wondev.yaml                     GEMINI.md ... and any agent you add
```

## Quick start

```bash
npx wondev init          # scaffold .wondev/ with a starter pack, then build
npx wondev check         # validate and detect drift
```

`init` writes six ready-to-use skills — `debugging`, `writing-tests`, `code-review`,
`planning-work`, `git-workflow`, `verify-before-done` — plus memory scaffolds for
architecture, conventions, glossary, and decision records. Edit them; they are yours.

## Commands

| Command | What it does |
| ------- | ------------ |
| `wondev init` | Scaffold `.wondev/` with the starter pack, then build |
| `wondev build` | Compile to every enabled target |
| `wondev watch` | Rebuild whenever `.wondev/` changes |
| `wondev add <skill\|memory\|command> <name>` | Scaffold one new artifact |
| `wondev check` | Validate sources and detect drift — exits 1 on failure |
| `wondev clean` | Remove generated files, per the manifest |
| `wondev targets` | List known targets and what reads them |

Useful flags: `--targets a,b,c` and `--all` on `init`; `--dry-run`, `--force`, and
`--target <name>` on `build`; `--cwd <dir>` and `--no-color` everywhere.

## The three artifact types

**Memory** — durable project facts. Architecture, conventions, glossary, decision records.
Set `always: true` for the few worth loading into every conversation.

```markdown
---
title: Architecture
always: true
---
Handlers live in `src/routes/` and never contain business logic.
```

**Skills** — procedures. The `description` is the *trigger*: it is what an agent matches
against when deciding whether to load the skill.

```markdown
---
name: debugging
description: Use when investigating a bug or failing test, before proposing a fix
---
1. Reproduce it. 2. Read the actual error. ...
```

**Commands** — repeatable prompts a person invokes by name, like `/review`.

## Supported agents

Run `wondev targets` for the current list. Built in:

| Target | Output | Also read by |
| ------ | ------ | ------------ |
| `claude` | `CLAUDE.md`, `.claude/skills/`, `.claude/commands/` | Claude Code |
| `agents` | `AGENTS.md` | Codex, Cursor, Copilot, Gemini CLI, Aider, Windsurf, Zed, Jules, Factory, opencode, goose, Devin, Warp, RooCode, Kilo Code, Amp |
| `cursor` | `.cursor/rules/*.mdc` | Cursor (with native `globs` / `alwaysApply`) |
| `copilot` | `.github/copilot-instructions.md` | GitHub Copilot |
| `gemini` | `GEMINI.md` | Gemini CLI |
| `windsurf` | `.windsurf/rules/` | Windsurf |
| `cline` | `.clinerules/` | Cline |
| `roo` | `.roo/rules/` | Roo Code |
| `continue` | `.continue/rules/` | Continue |
| `kiro` | `.kiro/steering/` | Kiro |
| `aider` | `CONVENTIONS.md` | Aider |
| `junie` | `.junie/guidelines.md` | JetBrains Junie |

Aliases work too: `codex`, `zed`, `opencode`, `jules`, and others resolve to `agents`.

### Any agent, including ones that do not exist yet

A target is data, not code. Three engines cover the whole field, so adding an agent is a
config entry — no wondev release required:

```yaml
# .wondev/wondev.yaml
customTargets:
  my-inhouse-agent:
    engine: single-file        # one flattened markdown file
    path: .myagent/context.md

  my-rules-agent:
    engine: rule-dir           # one file per artifact
    path: .myagent/rules
    ext: .md
    frontmatter:
      description: description
      globs: globs
      always: alwaysApply
```

## It is safe to run in a real repository

wondev never silently overwrites your work.

- **A manifest** (`.wondev/.manifest.json`) records a hash of every span wondev owns.
- **Unknown files are never clobbered.** If `AGENTS.md` exists but wondev did not write it,
  build refuses and names the file.
- **Your edits are never clobbered.** If a generated file changed since wondev wrote it,
  build refuses. `--force` overrides.
- **Managed regions.** In shared files, wondev owns only the span between markers:

  ```markdown
  Your own notes stay here, untouched.

  <!-- wondev:start -->
  generated
  <!-- wondev:end -->
  ```

  Adopting an existing `AGENTS.md` appends the block and preserves every other byte.
- **`clean` removes exactly the manifest entries** — deleting files it created outright, and
  stripping only the region from files it shares.
- **Atomic writes**, so an interrupted build cannot leave a truncated file.

## In CI

```yaml
- run: npx wondev check
```

Fails the build when someone edits `CLAUDE.md` by hand or forgets to rebuild after changing
`.wondev/`.

## Design notes

Near-zero dependencies (`yaml` is the only runtime dep) — `node:util.parseArgs` instead of
commander, `node:fs.watch` instead of chokidar, hand-rolled ANSI instead of chalk. Fast
`npx` cold start and a small supply-chain surface.

Rendering is a pure function of the source tree, so builds are deterministic: Windows and
Linux produce byte-identical output.

Requires Node 20+. Works on Windows, macOS, and Linux.

## License

MIT

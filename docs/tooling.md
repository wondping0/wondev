# Giving an agent tools

wondev does not install, wrap, or manage any of the tools below. It compiles the knowledge
of *how and when to use them* into every agent's config, which is the part that otherwise
gets written once in `CLAUDE.md`, never repeated in `AGENTS.md`, and forgotten by whoever
switches editor.

This page is a pattern plus a shortlist. The pattern outlasts the shortlist.

## Why this is not in the starter pack

`wondev init` ships no tool-specific skills, deliberately. A skill for one third-party binary
imposes it on every project that runs `init`, and goes stale the moment that tool changes its
interface — a stale skill is worse than a missing one, because an agent follows it.

What the starter pack does ship is `memory/context-discipline.md`, which is the transferable
half: read the index before the documents, prefer a structural answer over reading files,
delegate wide investigations. Those hold whichever tool you pick.

## The pattern

A tool becomes useful to an agent when three things are written down. Miss any one and the
tool sits there unused.

**1. The trigger.** A skill's `description` is not a summary, it is the condition under
which the skill should be loaded. `"Use when you need to know who calls a function, before
grepping"` gets matched. `"Documentation for the code graph tool"` does not.

**2. The commands, exactly.** Including the flags. An agent that has to guess a flag will
guess wrong, discover the error, and burn a turn recovering — or quietly give up and grep
instead.

**3. The limits.** Every tool answers some questions and not others, and the failure mode is
an agent trusting it outside its range. State what it cannot see. This is the part people
skip and the part that pays.

```markdown
---
name: code-graph
description: Use when you need to know who calls what, where a symbol is defined, or what a
  change would affect — before falling back to grep and reading files
---

# Code graph

## Commands

    <tool> query "who calls processPayment" --graph .graph/out.json
    <tool> affected "PaymentService"        --graph .graph/out.json

## What it cannot see

Cross-service behaviour. Message channels, environment contracts, and proxy configuration
are invisible to a static index — those live in `memory/`. Do not infer architecture from
the graph.

## Before trusting it

Compare the index's timestamp against the last commit. Older than the working tree means
verify findings against the files.
```

Long reference material goes in `references/` beside `SKILL.md` — wondev carries those as
[attachments](../README.md#reference-material-a-skill-does-not-carry), copying them for
Claude Code and naming their paths for flat targets, so a large manual never lands in the
file an agent reads on every turn.

```
.wondev/skills/code-graph/
├── SKILL.md                 the trigger, the commands, the limits
└── references/
    ├── query-syntax.md      opened only when needed
    └── maintenance.md
```

## Worth having

Grouped by the problem they solve, because the specific tools change faster than the
problems do. Check each project's own documentation for current usage — the point here is
what to look for, not the flags.

### Answer structural questions without reading files

The single highest-value category. "Who calls this?" answered by an index costs a fraction
of the same question answered by grep plus reading six files, and it comes back with
file and line attached.

| Tool | Shape |
| ---- | ----- |
| [ast-grep](https://ast-grep.github.io/) | Structural search and rewrite by syntax pattern rather than text. Good for "find every call shaped like this". |
| [graphify](https://github.com/Graphify-Labs/graphify) | Builds a queryable symbol graph from a codebase; answers callers, impact, and paths between symbols. |
| Language servers | Many editors expose go-to-definition and find-references over LSP; some agents can drive it directly. |

### Search fast, when structure is not needed

| Tool | Shape |
| ---- | ----- |
| [ripgrep](https://github.com/BurntSushi/ripgrep) | Fast recursive search that respects `.gitignore`. Usually already what an agent's search tool wraps. |
| [fd](https://github.com/sharkdp/fd) | Finding files by name, when the question is "where is it" rather than "what is in it". |

### Turn review rules into something checkable

An agent can be told "we never do X in this repository". It will forget. A rule expressed as
a lint check is enforced whether or not it was remembered.

| Tool | Shape |
| ---- | ----- |
| [Semgrep](https://semgrep.dev/) | Pattern-based static analysis with custom rules; good for encoding project-specific prohibitions. |
| Your existing linter | ESLint, Ruff, golangci-lint, clippy. A custom rule is often cheaper than another paragraph of documentation. |

### Prove a change works, rather than asserting it

| Tool | Shape |
| ---- | ----- |
| [Playwright](https://playwright.dev/) | Drives a real browser. Lets an agent verify a UI change instead of claiming it. |
| Your test runner | The verification skill in the starter pack exists for this; point it at the actual command. |

### Connect systems the agent cannot reach

| Tool | Shape |
| ---- | ----- |
| [MCP servers](https://modelcontextprotocol.io/) | A protocol for exposing external systems — databases, issue trackers, internal APIs — as tools. Configured per host, not by wondev. |
| [`gh`](https://cli.github.com/) | GitHub from the command line. Frequently simpler than an integration. |

## What wondev does not do

**It does not manage `.claude/settings.json`, hooks, or MCP configuration.** Those files are
hand-maintained and frequently contain real work — permission rules, lifecycle hooks, server
credentials. Generating them would overwrite it. wondev writes memory, skills, commands, and
agents; the host's own configuration stays yours.

That is a boundary, not a gap. A compiler that also owned your settings file would be a
worse compiler.

## Adding one

```bash
npx wondev add skill code-graph
```

Write the trigger, the commands, and the limits. Put anything long in `references/`. Then:

```bash
npx wondev build
```

Every agent your project targets now knows the tool exists, when to reach for it, and where
it stops being trustworthy.

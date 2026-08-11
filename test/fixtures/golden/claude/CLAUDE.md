# fixture-project

## Architecture

_How the fixture system is put together_

Applies to: `src/**`

The service is one process with three layers: transport, domain, and storage.

Transport never touches storage directly. That rule is the whole point of the split, and
breaking it is the most common mistake in this codebase.

See also: [[conventions]].

## Conventions

Tests live beside the code they cover, named `*.test.ts`.

Errors that a caller can reasonably handle are returned; everything else throws.

# On-demand memory

Listed, not included. Read one when its trigger matches.

- `.wondev/memory/decisions/0001-single-process.md` — **0001 — Stay a single process** (≈74)

# Available skills

- **example-skill** — Use when the fixture needs a skill with globs attached

# Available commands

- **/example-command** — A repeatable prompt used by the golden output tests

# Available subagents

- **example-agent** — Delegate when a change touches more than three services and the blast radius needs checking first

# fixture-project

## Conventions

Tests live beside the code they cover, named `*.test.ts`.

Errors that a caller can reasonably handle are returned; everything else throws.

# On-demand memory

Listed, not included. Read one when its trigger matches.

- `.wondev/memory/decisions/0001-single-process.md` — **0001 — Stay a single process** (≈74)

# Available skills

- **always-on** — Use for the short universal rules an agent should never open a file to read
- **example-skill** — Use when the fixture needs a skill with globs attached

# Available commands

- **/example-command** — A repeatable prompt used by the golden output tests

# Available subagents

- **example-agent** — Delegate when a change touches more than three services and the blast radius needs checking first

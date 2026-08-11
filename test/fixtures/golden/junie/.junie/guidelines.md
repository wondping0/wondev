# fixture-project

Guidance for AI coding agents working in this repository.

# Project memory

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

Listed, not included. Read one when its trigger matches — the path is relative to the repository root.

- `.wondev/memory/decisions/0001-single-process.md` — **0001 — Stay a single process** (≈74)

# Skills

Each skill below is a procedure. Follow it when its "when to use" condition matches the task at hand.

## Skill: example-skill

**When to use:** Use when the fixture needs a skill with globs attached

**Applies to:** `src/**/*.ts`, `test/**/*.ts`

1. Do the first thing.
2. Verify it worked.
3. Only then do the second thing.

**Reference material** — read on demand, not included here:
- `.wondev/skills/example-skill/references/deep-dive.md`

# Commands

Repeatable prompts a user may invoke by name.

## Command: example-command

**Purpose:** A repeatable prompt used by the golden output tests

Summarise what changed and why, then stop.

# Subagents

Specialists this project defines. Hosts that support delegation load them from the paths below.

- `.wondev/agents/example-agent.md` — **example-agent** — Delegate when a change touches more than three services and the blast radius needs checking first

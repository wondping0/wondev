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

## 0001 — Stay a single process

**Status:** accepted

### Context

Splitting into services was proposed to allow independent scaling.

### Decision

Stay a single process until a measured bottleneck justifies otherwise.

### Consequences

Deployment stays trivial. Scaling is vertical only, which is acceptable at current volume.

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

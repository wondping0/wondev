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

## 0001 — Stay a single process

**Status:** accepted

### Context

Splitting into services was proposed to allow independent scaling.

### Decision

Stay a single process until a measured bottleneck justifies otherwise.

### Consequences

Deployment stays trivial. Scaling is vertical only, which is acceptable at current volume.

# Available skills

- **example-skill** — Use when the fixture needs a skill with globs attached

# Available commands

- **/example-command** — A repeatable prompt used by the golden output tests

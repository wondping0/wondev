---
title: Architecture
always: true
description: How this system is put together and where things belong
---

# Architecture

> Replace the bracketed prompts below. Delete anything that does not apply.
> Keep this document about structure that is stable, not about current tasks.

## What this project is

[One paragraph: what it does, who uses it, and what it is deliberately not.]

## Shape of the system

[The major pieces and how they talk to each other. A short list beats a long diagram.]

| Piece | Responsibility | Talks to |
| ----- | -------------- | -------- |
|       |                |          |

## Where code goes

[Rules an agent can follow without asking. For example: "HTTP handlers live in
`src/routes/`, and never contain business logic" or "anything touching the database goes
through `src/db/`".]

## Boundaries that matter

[The lines that must not be crossed, and why. These are the rules whose violation causes
real damage — circular dependencies, layering violations, direct database access from the
UI layer.]

## What is intentionally simple

[Places where the obvious "improvement" is wrong. Recording this prevents an agent from
helpfully refactoring something that is simple on purpose.]

See also: [[conventions]], [[glossary]].

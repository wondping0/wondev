---
title: 0001 — Record architecture decisions
always: false
description: Why this project keeps decision records, and the format they use
---

# 0001 — Record architecture decisions

**Status:** accepted
**Date:** [YYYY-MM-DD]

## Context

Decisions with long-lived consequences get made in issues, chat, and code review, and then
the reasoning is lost. Six months later nobody remembers whether a constraint was a careful
trade-off or an accident, so it gets "fixed" and the original problem returns.

This costs more when AI agents work in the repository: an agent reads the current code, sees
something that looks suboptimal, and improves it — undoing a deliberate choice it had no way
to know about.

## Decision

Record every significant decision as a numbered file in `.wondev/memory/decisions/`.

Significant means: hard to reverse, or surprising to a newcomer, or previously argued about.
Routine choices do not need a record.

Each record uses this structure: Context, Decision, Consequences. Status is one of
`proposed`, `accepted`, or `superseded` with a link to the record that replaced it.

Records are immutable. When a decision changes, write a new record and mark the old one
superseded rather than editing history.

## Consequences

Agents and humans get the reasoning, not just the result, which makes "why is this like
this?" answerable without archaeology.

The cost is a few minutes per decision, and the discipline to notice a decision is being
made at all.

Superseded records stay in the repository. That is intentional: the trail of what was tried
and rejected is as useful as the current answer.

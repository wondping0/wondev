---
title: Context discipline
always: true
description: Deciding what to read before reading it — applies to every task in this repository
---

Loading everything is not thoroughness. It is the most common way an agent runs out of room
to think, and it degrades quietly: nothing fails, answers just get worse as the useful
context is crowded out by material nobody needed.

## Read the index first

`wondev build` writes a memory index listing every document with its approximate token cost
and the condition under which it is worth reading. Read that, then load only what matches.
Documents marked `always: true` are already in your context — you do not need to open them.

## Read a section, not a file

For a large document, find the heading you need with a search and read that section. Opening
a 15k-token file to use 300 tokens of it is the same mistake as loading the whole set.

## Prefer structure over text search

If a tool that indexes this codebase's symbols is available, ask it who calls what and where
a symbol is defined before falling back to grep plus reading files. A structural answer
arrives with file and line attached and costs a fraction of the reading.

Do not infer cross-service behaviour from a code index. Message channels, environment
contracts, and proxy configuration are invisible to it — those live in the memory documents.

## Hand off wide investigations

When a question spans more of the codebase than fits comfortably, dispatch a subagent and
ask it to return conclusions rather than file contents. The point of delegation is that its
reading happens in its context, not yours.

## Keep this true

A stale document is worse than a missing one, because it is trusted. When a document is
reconciled against the code, stamp it:

```yaml
verified: 2026-08-11
verifiedAgainst: what you actually checked it against
```

`wondev check` reports documents that have never been verified.

# .wondev — agent knowledge source

This directory is the single source of truth for what AI coding agents know about this
project. Everything outside it that agents read — `CLAUDE.md`, `AGENTS.md`,
`.cursor/rules/`, and the rest — is **generated**. Edit here, then run `wondev build`.

## Layout

```
memory/      durable facts: architecture, conventions, glossary, decisions
skills/      procedures: how to do a kind of work in this repo
commands/    repeatable prompts a person invokes by name
agents/      subagents: specialists that run in their own context window
wondev.yaml  project name and which agents to generate for
```

## The four types

**Memory** is what stays true between tasks. Architecture, conventions, domain vocabulary,
and the reasoning behind past decisions.

`always: true` is the flag that matters. Documents marked always-on are copied into the
files an agent reads on every single turn; everything else is listed with its cost and its
trigger, and opened only when the trigger matches. Mark a document always-on only if it is
worth paying for in every request.

**Skills** are procedures. Each one has a `description` that states *when to use it* — that
sentence is what an agent matches against, so write the trigger condition, not a summary.

**Commands** are prompts a person runs deliberately, like `/review`.

**Agents** are specialists you delegate to. Each runs in its own context window and cannot
see the conversation that dispatched it, so write them to state what they need rather than
to assume. As with skills, the `description` is the dispatch rule — the condition under
which handing work over is the right move — not a description of the role.

## Working here

```bash
wondev build          # regenerate every target
wondev watch          # rebuild as you edit
wondev add skill <name>
wondev check          # validate and detect drift (use this in CI)
```

## Rules of thumb

- Write what is not derivable from the code. Structure, reasoning, and constraints — not
  descriptions of functions that an agent can simply read.
- Record what was tried and rejected. It stops the same bad idea returning.
- Be specific enough to act on. "Follow best practices" changes no behaviour.
- Keep it current. Wrong memory is more harmful than missing memory.

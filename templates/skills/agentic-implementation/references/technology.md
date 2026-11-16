# Technology map for agentic implementation

Checked 2026-11. This is orientation: what each building block is for, when to use it,
and what to verify. It deliberately omits model names, prices, limits, and code
signatures — those change within months. Read the vendor documentation linked from your
project's SDK before implementing, and record what you verified in project memory.

## Tool (function) calling

The model emits a structured request to call a function you defined; your code runs it
and returns the result. It is the base mechanism under every agent.

- Use for: any action or lookup the model cannot do from its context.
- Verify: the provider's schema dialect, parallel tool calls, how tool errors are
  returned, forced/disabled tool choice, and strict schema modes.
- Watch: tool descriptions consume context on every request; large tool sets may need
  on-demand tool loading or search rather than listing everything up front.

## Model Context Protocol (MCP)

An open protocol for connecting models to tools, data ("resources"), and prompt
templates through servers that any compatible client can use. Local servers typically
run over stdio; remote servers over HTTP with OAuth-based authorization.

- Use for: capabilities you want to reuse across several agents or hosts, or to consume
  an existing server instead of writing an integration.
- Do not use for: a tool only one application calls — a plain function is simpler.
- Verify: the spec revision your client and server support, the transport, and the
  authorization flow. Specification: <https://modelcontextprotocol.io>.
- Watch: an MCP server is third-party code with your agent's reach. Pin versions, read
  what it can access, and treat its tool descriptions and results as untrusted content.

## Agent Skills

A skill is a directory with a `SKILL.md` (name, a description stating when to use it,
and instructions) plus optional scripts and reference files. The agent sees only the
description until a task matches, then loads the rest — progressive disclosure.

- Use for: procedures and domain knowledge that should load on demand instead of living
  in an always-on prompt.
- Verify: where your host loads skills from and which frontmatter it honours.
  Specification: <https://agentskills.io/specification>.
- Watch: the description is the trigger. Vague descriptions never fire; broad ones fire
  on everything.

## Agent instruction files

Repository files that hosts read on every session: `AGENTS.md` (a cross-tool
convention, <https://agents.md>), `CLAUDE.md`, editor rule directories, and similar.

- Use for: short, always-true project rules and commands.
- Watch: they are paid for on every turn. Keep them small and move detail into
  on-demand documents or skills. In a wondev project these files are generated — edit
  the source and rebuild.

## Structured output

Constraining the response to a JSON schema, either by constrained decoding or by a
forced tool call.

- Use for: any output parsed by code.
- Verify: supported schema features (recursion, unions, formats, size limits) and
  whether strictness is guaranteed or best-effort for your provider and model.
- Watch: a schema guarantees shape, not truth. Validate values, and handle refusals and
  length-truncated output.

## Prompt caching

Providers can reuse the processed prefix of a prompt across requests at reduced cost
and latency.

- Use for: long stable prefixes — system instructions, tool definitions, documents.
- Verify: whether caching is automatic or explicit, minimum cacheable size, lifetime,
  and what invalidates it.
- Watch: order the prompt stable-first. Changing anything early (a timestamp, tool
  order) discards the cache for everything after it.

## Extended reasoning

Many models can spend additional tokens reasoning before answering, with a configurable
budget or effort level.

- Use for: multi-step problems, planning, hard debugging.
- Verify: how it is enabled and billed, and how reasoning content must be passed back
  across tool-call turns.
- Watch: more reasoning is slower and costlier; measure whether it changes results on
  your evaluation set.

## Context management and memory

Long tasks exceed any context window. Common mechanisms: summarising or compacting
history, clearing old tool results, file- or store-backed memory the agent reads and
writes, and retrieval of past notes.

- Use for: sessions spanning many tool calls, and knowledge that must persist between
  sessions.
- Watch: memory the agent writes is also untrusted input the next time it is read;
  stale memory is trusted and wrong. Date entries and verify before acting on them.

## Agent frameworks and SDKs

Vendor agent SDKs and open-source frameworks package the loop, tool plumbing, tracing,
handoffs, and guardrails.

- Use for: getting the loop, streaming, and tracing right without rebuilding them.
- Verify: licence, release cadence, and that you can see and control the exact prompts
  and tool calls sent.
- Watch: abstraction that hides the prompt makes debugging hard. Prefer the thinnest
  layer that covers your need, and follow whatever the project already uses.

## Coding agents and their extension points

Terminal and IDE agents can be extended with hooks (commands run on lifecycle events),
custom commands, subagents, plugins, and MCP servers, and can run headless in CI.

- Use for: automating repository work with the same rules people use interactively.
- Watch: hooks and CI runs execute with real credentials. Scope tokens, restrict tools,
  and never run an agent with write access on untrusted pull-request content without
  isolation.

## Agent-to-agent protocols

Protocols such as A2A (<https://a2a-protocol.org>) describe how independently built
agents advertise capabilities and exchange tasks, complementing MCP's agent-to-tool
scope.

- Use for: integration across organisational or vendor boundaries.
- Do not use for: coordinating subagents inside one application; direct calls are
  simpler.
- Verify: maturity and adoption at the time you build; this area is young.

## Computer and browser use

Models can operate a GUI or browser through screenshots and input actions.

- Use for: systems with no API, and end-to-end UI verification.
- Watch: slow, costly, and the most exposed surface for prompt injection because every
  page is untrusted content. Run in an isolated environment with no ambient credentials
  and confirm consequential actions.

## Multimodal input and output

Images, PDFs, audio, and video as inputs; images, speech, and real-time voice as outputs.

- Verify: size and count limits, token cost per item, and whether documents are read as
  text, as images, or both.
- Watch: text inside an image or document is untrusted content like any other.

## Local and small models

Open-weight models run on your own hardware or a private endpoint.

- Use for: data that cannot leave your environment, high-volume simple tasks, offline
  operation, and predictable cost.
- Watch: tool-calling and structured-output reliability vary widely. Run your own
  evaluation set; do not assume parity from a leaderboard.

## Keeping this current

When you verify something here against primary documentation, record the finding and
date in project memory. When this file and the documentation disagree, the
documentation is right; correct or delete the stale entry rather than working around it.

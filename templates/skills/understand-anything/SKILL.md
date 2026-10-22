---
name: understand-anything
description: Use when mapping unfamiliar application architecture, explaining component relationships, onboarding to a codebase, or building an Understand Anything knowledge graph.
license: MIT; see LICENSE.txt
metadata:
  requirements: Portable wondev workflow; full upstream graph/dashboard needs a separate Understand Anything checkout, Node 22+, pnpm 10+, and a shell-capable agent.
  upstream: https://github.com/Egonex-AI/Understand-Anything
  revision: b8c807c632743ab695ec43cb654a0f1efe216bc8
  distribution: wondev-integration-bridge
---

# Understand Anything integration

This is a portable integration with Understand Anything, not its complete native plugin.
The original analysis procedure is in `references/upstream-understand.md`, with its MIT
license. The upstream runtime, dashboard, hooks, and provider integrations are separate.
Read paths relative to this SKILL.md, including when this skill is inside a plugin or vault.

## Understand the application

1. Read repository instructions and run `wondev agent check` to inspect host evidence,
   enabled rules, selected skills, and output drift. Host instructions and task scope apply.
2. Retrieve existing knowledge with `wondev context --task "<question>" --budget 4000
   --explain`. Follow the referenced sources and verify architectural claims against code.
3. For a requested architecture map, `wondev map --dry-run` previews wondev's local JS/TS
   import map; `wondev map` saves observations while preserving curated sections. For other
   languages, inspect manifests, entry points, imports, and tests with available tools.
   A wondev import map is not an Understand Anything knowledge graph.
4. Trace one real operation through entry point, domain logic, persistence, and external
   boundary. Explain ownership, contracts, coupling, and uncertainties with file evidence.
5. Persist useful conclusions in the configured memory sources, not generated host files.
   Keep observations distinct from inferred intent. Verify memory only after checking its
   evidence; capture lessons through `wondev session learn` and review before applying.

## Full upstream knowledge graph and dashboard

When the user requests Understand Anything's graph or dashboard, run
`node "<skill-dir>/scripts/runtime.mjs" "<absolute-project-root>"` to locate the runtime.
It only checks files; it does not install anything or claim the plugin is activated.
If missing, follow [setup](references/setup.md). Explain prerequisites instead of
reporting a graph as complete. An already authorized installation may proceed directly.

With a built runtime, read the original procedure in `references/upstream-understand.md`.
Use the reported `pluginRoot` as `PLUGIN_ROOT`, and read its agent prompts and runtime
files there. Keep the requested project as `PROJECT_ROOT`; set
`UNDERSTAND_NO_WORKTREE_REDIRECT=1` to retain the current worktree. Adapt the upstream
Bash examples to the actual shell. Preserve legacy `.understand-anything/` data when present.
Use parallel workers only when the host supports them and the task authorizes delegation;
otherwise perform the phases sequentially. Do not enable commit hooks or background
auto-updates as a side effect of a one-off analysis.

Validate the resulting graph with the upstream validator before opening the dashboard.
Bring reviewed architectural conclusions back into wondev memory with evidence paths.

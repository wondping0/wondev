---
name: context-maintenance
description: Use when recording development lessons, updating application memory after architectural changes, or reviewing stale project knowledge.
license: MIT
---

# Maintain application context

Keep knowledge in the application's configured wondev sources or Obsidian vault.
The generated host files are outputs. Read `.wondev/wondev.yaml` to locate sources.

1. Retrieve relevant notes with `wondev context --task "<current task>" --files
   <changed-path> --budget 4000 --explain`. Check claims against current code.
2. After changing JS/TS structure, preview `wondev map --dry-run`, then refresh the map.
   Preserve curated responsibilities, invariants, and rationale beside generated facts.
3. Capture the outcome, decisions, evidence paths, failed attempts, and next actions in
   `wondev session record --input summary.json`. Keep credentials and personal data out.
4. Propose an update using `wondev session propose` or a scoped new lesson using
   `wondev session learn`. Review the proposal and evidence before `session apply`.
   A successful command is evidence of that check, not proof of unrelated behavior.
5. Use `wondev memory stale` to find notes needing review. Verify a note with
   `wondev memory verify <id> --against "<what was checked>"` only after inspecting it.
6. If an approach is reusable, update a skill and add positive/negative retrieval cases
   for `wondev context eval`. Avoid converting a one-off workaround into a universal rule.

Rebuild after source edits. Report what was learned and what remains uncertain.

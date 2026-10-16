---
name: learn
description: Preserve verified development experience as project memory or improve a reusable skill after meaningful work
---

# Learn from this development task

Review the work just completed and preserve only knowledge that will help a future task.
If there is no durable finding, say so; do not manufacture a lesson.

1. Read the current diff, relevant tests, and existing project memory and skills. Run
   `npx --no-install wondev context --task "the task" --files path/to/file --explain`.
   Distinguish observed outcomes from hypotheses and unfinished next actions.
2. Write a short session JSON with `agent`, `task`, `outcome`, and optional `decisions`,
   `evidence`, `failedAttempts`, and `next` string arrays. Include the checks actually run
   and their outcomes. Do not copy a transcript, credentials, or unrelated personal data.
   Record it with `wondev session record --input summary.json`.
3. Prefer updating an existing note using `wondev session propose <session-id> <memory-id>
   --input updated-note.md`. For a new scoped lesson, use `wondev session learn <session-id>
   <lesson-name> --files "src/affected-area/**"`. Inspect the proposed content and its
   evidence using `wondev session review`, then apply the reviewed hash. A successful
   command does not establish the truth of a claim: verify against code and tests before
   recording `wondev memory verify <note> --against "the actual check"`.
4. If the finding changes a reusable development procedure, inspect the existing matching
   skill first. Update its applicability, prerequisites, steps, checks, and exceptions.
   Create a new skill with `wondev add skill <name>` only for a distinct procedure. Keep
   application-specific facts in memory; link or reference them from the skill. Do not
   generalize one successful fix into an unconditional instruction.
5. Add representative task cases to a project-owned context evaluation file: expected
   memory and skills, forbidden unrelated guidance, file paths, and a realistic token
   budget. Run `wondev context eval <cases.json>`. This tests selection, not the quality of
   the model's eventual answer.
6. Refresh `wondev map` if module structure changed, then build and check. Summarize the
   knowledge saved, its evidence, and any unresolved uncertainty. Respect the project's
   retention policy for the intermediate session input and record.

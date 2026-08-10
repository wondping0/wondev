---
name: planning-work
description: Use before starting any task that spans more than one file or one obvious edit — plan before writing code
---

# Planning work

The purpose of a plan is to surface the wrong assumption before it becomes a day of work.
Plans that only restate the request do not do that.

## Steps

1. **Restate the goal** in one sentence, in terms of the outcome rather than the mechanism.
   If it cannot be stated in one sentence, the task needs splitting before it needs planning.
2. **Find the constraints.** Existing patterns to follow, interfaces that cannot change,
   data that must be migrated, things that must keep working. Read the code; do not guess.
3. **Name the uncertainty.** What is genuinely unknown? Decide whether to resolve it now or
   proceed under a stated assumption. Write the assumption down.
4. **Break it into steps that can each be verified.** A step whose completion cannot be
   checked is not a step, it is a hope. Order them so something works early.
5. **Identify what could go wrong** and what the response would be. One line each.
6. **Confirm the scope.** State what is deliberately not included, so it is a decision
   rather than an omission.

## Rules

- Plan against the code as it is, not as it is remembered.
- Prefer the smallest change that fully solves the problem. Ambition belongs in the design
  discussion, not smuggled into an unrelated task.
- If the task turns out to be several independent projects, say so and plan only the first.
- Do not plan past the first real unknown. Resolve it, then continue.

## Done when

- Each step has a way to tell whether it worked.
- Assumptions and excluded scope are written down, not implied.

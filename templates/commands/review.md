---
name: review
description: Review the current uncommitted changes for defects, ranked by consequence
---

# Review current changes

Review everything currently uncommitted in this repository.

1. Read the full diff, staged and unstaged.
2. Apply the `code-review` skill.
3. Report findings ranked by consequence, each with a file, a line, and a concrete failure
   scenario — the input or state that makes it go wrong.
4. If nothing serious is wrong, say so directly instead of padding the list with
   observations.

Do not change any code. This command reports; it does not fix.

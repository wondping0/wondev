---
name: code-review
description: Use when reviewing a diff, a pull request, or code just written — including your own, before declaring it finished
---

# Code review

A review that lists everything it noticed is worse than one that names the two things that
matter. Rank by consequence, and say plainly when there is nothing serious to report.

## Steps

1. **Understand the intent.** What was this change supposed to do? Review against that, not
   against the reviewer's preferred design.
2. **Read the diff completely** before commenting. A confusing line often explains itself
   forty lines later.
3. **Look for defects first**, in this order:
   - Wrong behaviour: off-by-one, inverted condition, wrong variable, missing await.
   - Unhandled cases: empty input, null, failure paths, concurrent access.
   - Security: unvalidated input reaching a query, a shell, a filesystem path, or a
     rendered page. Secrets in code or logs.
   - Resource handling: things opened and not closed, unbounded growth.
4. **Then look for durability**: names that mislead, duplicated logic that will drift,
   an abstraction covering one case, missing tests for the new behaviour.
5. **Rank by consequence.** What breaks in production, what breaks in six months, what is
   merely taste. Say which is which.
6. **Give each finding a failure scenario.** "This is fragile" is not actionable.
   "With an empty `items` array this throws at line 42" is.

## Rules

- Distinguish a defect from a preference, explicitly. Both are worth saying; conflating them
  wastes the author's judgement.
- Suggest the fix when it is short. Describe the problem when it is not.
- Do not invent findings to seem thorough. "No blocking issues" is a legitimate result.
- Check the tests as carefully as the code. Tests that assert nothing are a common defect.

## Done when

- Every finding names a file, a line, and what actually goes wrong.
- Findings are ordered by severity, with taste-level notes marked as such.

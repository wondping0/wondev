---
name: debugging
description: Use when investigating a bug, a failing test, or any behaviour that differs from what was expected — before proposing or applying a fix
---

# Debugging

The failure mode this skill prevents is guessing: changing something plausible, seeing the
symptom disappear, and calling it fixed. That leaves the real defect in place and adds a
change nobody can justify.

## Steps

1. **Reproduce it.** Find the smallest command or input that shows the failure every time.
   If it only fails sometimes, say so explicitly and treat frequency as data.
2. **Read the actual error.** The full message, the full stack, the line it names. Do not
   skip to the fix because the error "looks familiar".
3. **State what you expected.** Write the expected behaviour and the observed behaviour side
   by side. Vague expectations produce vague fixes.
4. **Locate it before changing it.** Narrow to the specific line or condition, using
   whatever is cheapest: bisecting the input, logging intermediate values, or reading the
   code path top-down. Confirm the location before editing.
5. **Explain the mechanism.** Say why this code produces this symptom. If that sentence
   cannot be written, the cause has not been found yet — go back to step 4.
6. **Fix the cause.** Not the symptom. Suppressing an error, adding a null check at the
   crash site, or widening a type usually hides the defect rather than removing it.
7. **Prove it.** Re-run the reproduction from step 1 and show the output. Add a test that
   fails without the fix and passes with it.

## Rules

- One hypothesis at a time. Changing several things at once destroys the evidence.
- Revert failed attempts before trying the next idea, so the tree stays clean.
- If a fix works but the mechanism is still unclear, say so rather than implying confidence.

## Done when

- The reproduction from step 1 now passes, and its output has been shown.
- A test covers the defect.
- The mechanism can be stated in one sentence.

---
name: verify-before-done
description: Use before claiming that work is complete, fixed, passing, or ready to merge — evidence must come before the claim
---

# Verify before done

"It should work now" is not a result. This skill exists because the gap between believing
something works and having watched it work is where most wasted time lives.

## Steps

1. **List the claims** about to be made. "Tests pass", "the bug is fixed", "the build is
   clean" are three separate claims needing three separate proofs.
2. **Run the command for each claim.** Not a similar command — the actual one. A passing
   unit test does not prove the build compiles.
3. **Read the output.** Exit code and the last lines. A suite that ran zero tests exits
   zero.
4. **Quote the evidence** when reporting. The command and its relevant output, not a
   paraphrase.
5. **Report what failed, plainly.** Partial completion reported honestly is useful; partial
   completion reported as done destroys trust in every later report.

## Claims and their proof

| Claim | Proof |
| ----- | ----- |
| tests pass | full test command, showing the pass count |
| the bug is fixed | the original reproduction, now succeeding |
| it builds | the build command, exit code zero |
| types are clean | the typecheck command, no errors |
| it works end to end | the app actually run, not just its tests |

## Rules

- Never claim a command succeeded without running it in this session.
- Never describe expected output as if it were observed output.
- If something was not verified, say which parts were not, rather than staying silent.
- A skipped or filtered test run is not a passing test run. Say which was used.

## Done when

- Every claim has a command behind it, and every command has been run and read.

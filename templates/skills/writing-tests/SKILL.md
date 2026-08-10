---
name: writing-tests
description: Use when adding a feature or fixing a bug, before writing the implementation code
---

# Writing tests

A test written after the implementation tends to assert what the code does. A test written
first asserts what the code should do. Only the second kind catches a mistake.

## Steps

1. **Write the failing test first.** Name it after the behaviour, not the function:
   `rejects an expired token`, not `test_validate`.
2. **Run it and watch it fail.** A test that has never failed proves nothing. Confirm it
   fails for the intended reason, not because of a typo or a missing import.
3. **Write the minimum code that passes.** Resist building for requirements that have not
   been asked for yet.
4. **Run the full suite.** A new test passing while an old one breaks is not progress.
5. **Refactor with the tests green.** Now that behaviour is pinned, improve the shape of the
   code. Re-run after each change.

## What to test

- The behaviour a user or caller depends on.
- Boundaries: empty, one, many, maximum, and one past the maximum.
- The error paths. Untested error handling is usually broken error handling.

## What not to test

- Private helpers, directly. Test them through the public surface that uses them.
- Language or framework behaviour. Assume the standard library works.
- Exact log strings or incidental formatting, unless a consumer parses them.

## Rules

- Never weaken an assertion to make a test pass. If it fails, either the code or the
  expectation is wrong — decide which, and say so.
- Never delete or skip a failing test to get a green run. A skipped test is a silent
  regression.
- Tests must not depend on execution order or on each other's leftover state.

## Done when

- Every new behaviour has a test that fails without the change.
- The full suite passes, and its output has been shown rather than assumed.

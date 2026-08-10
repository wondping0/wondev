---
name: git-workflow
description: Use when committing, branching, or preparing a pull request — and before any command that rewrites history
---

# Git workflow

## Before committing

1. **Read the diff.** `git diff` for unstaged, `git diff --staged` for staged. Never commit
   changes that have not been looked at.
2. **Check for accidents**: debug prints, commented-out experiments, secrets, `.env` files,
   large binaries, unrelated formatting churn.
3. **Confirm the tests pass**, and confirm it by running them.

## Commits

- One logical change per commit. A commit that both fixes a bug and renames a module is two
  commits.
- Subject line in the imperative, under ~70 characters: `add retry to token refresh`, not
  `added retries` or `fixes`.
- The body explains *why*, since the diff already shows *what*. Skip it when the subject is
  genuinely sufficient.
- Never commit generated output that the build reproduces, unless the project deliberately
  vendors it.

## Branches and pull requests

- Branch from an up-to-date default branch. Do not commit directly to it.
- Name branches after the change: `fix-expired-token-refresh`.
- A pull request description says what changed, why, and how it was verified. Include the
  command output that proves it.

## Rules

- Destructive commands — `reset --hard`, `push --force`, `checkout --` over local changes,
  `clean -fd` — require confirmation from the human first. Prefer `push --force-with-lease`
  when a force push is genuinely needed.
- Never skip hooks (`--no-verify`) to get a commit through. A failing hook is information.
- Do not amend or rebase commits that have already been pushed and shared.
- Do not commit or push unless it was asked for.

## Done when

- The diff has been read, the tests have been run, and the message explains the reasoning.

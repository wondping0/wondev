# Security policy

## Supported versions

| Version | Supported |
| ------- | --------- |
| 0.1.x   | yes       |

While wondev is pre-1.0, only the latest release receives fixes.

## Reporting a vulnerability

Report privately through
[GitHub Security Advisories](https://github.com/wondping0/wondev/security/advisories/new).
Please do not open a public issue for something exploitable.

Include a reproduction if you can. For wondev that usually means a small `.wondev/`
directory, or a crafted `.wondev/.manifest.json`, plus the command you ran.

Expect an acknowledgement within a week. There is no bounty programme.

## What counts as a vulnerability

wondev writes across a repository and deletes files it previously wrote, and it is routinely
run on freshly cloned repositories. **Everything under `.wondev/` is untrusted input**,
including the manifest wondev wrote itself.

In scope — a repository that, when a user clones it and runs wondev, causes any of:

- a read, write, or delete outside the project root
- process execution, network access, or credential access
- a hang or unbounded resource use from crafted input

Out of scope:

- **Generated content influencing an agent.** wondev compiles whatever `.wondev/` says into
  files AI agents read as instructions. A hostile repository can therefore instruct an
  agent — exactly as a hostile `CLAUDE.md` could without wondev. Review `.wondev/` in an
  unfamiliar repository as you would review any agent instructions.
- Anything requiring the attacker to already control the user's machine or wondev install.

The full threat model, the boundaries wondev enforces, and the residual risks it accepts are
documented in [docs/security.md](docs/security.md).

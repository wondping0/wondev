---
name: onboard
description: Explain this codebase to someone seeing it for the first time
---

# Onboard

Explain this repository to a competent engineer who has never opened it.

First run `wondev agent check` to inspect host hints, enabled rules and skill prerequisites.
Use `--agent <target>` when the host is known but environment detection is unavailable.
Read the `understand-anything` skill when a deeper architecture map is useful.

Cover, in this order:

1. What the project does, in one paragraph.
2. How to run it and how to test it — the actual commands, verified against the repository
   rather than assumed.
3. The three or four directories that matter, and what belongs in each.
4. The path a typical request or operation takes through the system, end to end.
5. The two or three things that would surprise a newcomer, and why they are that way.

Prefer reading the code over reading the documentation, and say so when the two disagree.

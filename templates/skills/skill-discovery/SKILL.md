---
name: skill-discovery
description: Use when finding, adding, replacing, enabling, or disabling agent skills or checking whether an agent supports a skill or plugin.
license: MIT
---

# Find and manage skills

Run `wondev agent check` to inspect current host evidence, target capabilities, active
profile, rules, and skill readiness. If detection is uncertain, use the host stated in the
task with `--agent <name>`; project directories alone do not identify a running host.

Run `wondev skills catalog` for the bundled choices and `wondev skills info <name>` for
the actual project source, prerequisites, and origin. Prefer an existing focused skill
over duplicating it. For a new capability, consult the author's official repository and
check its license, exact version, supporting files, runtime, and host requirements.

- `wondev skills disable <name>` removes generated copies while keeping the source.
- `wondev skills enable <name>` restores it, subject to the current profile.
- `wondev skills use <profile>` selects a configured profile; `--all` clears the profile.
- `wondev agent use <target>` switches the generated target; `--dry-run` previews it.
- `wondev skills install local:<path>` or `npm:<package>@<exact-version>` installs a
  compatible skill pack. A random npm package or host plugin is not a wondev skill pack.

Preview pack updates with `wondev skills update <name> --dry-run`; preserve local edits.
For another host, use `customTargets` with its documented paths. A single-file custom
target can set `skills` to a native skill directory. Plugin hooks, MCP servers, credentials,
and marketplace activation are host features; a copied SKILL.md does not install them.
Respect applicable repository rules and existing task authorization when changing setup.

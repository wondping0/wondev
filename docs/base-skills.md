# Base skills and agent selection

`wondev init` bundles eleven skills locally. They are procedures and resources loaded
on demand; they do not train a model, install OS tools, or activate host plugins.
Use `wondev upgrade --dry-run`, then `wondev upgrade` in an existing application.
Template provenance preserves user edits and offers incoming changes for review.

| Skill | Included | Prerequisites |
| --- | --- | --- |
| ui-ux-pro-max | Upstream search engine, design-system generator and design data; portable instructions | Python 3, standard library only |
| understand-anything | Wondev integration, original upstream analysis procedure, runtime probe and pinned setup recipe | Local memory workflow works immediately; full graph/dashboard needs Git, Node 22+, pnpm 10+ and upstream checkout |
| webapp-testing | Adapted instructions, Anthropic Python examples and server helper | Existing browser runner, or Python Playwright plus browser |
| skill-discovery | Find, assess and switch skills for a host | Agent with repository access |
| context-maintenance | Review memory, preserve evidence and capture scoped lessons | Wondev project |
| debugging, writing-tests, code-review, planning-work, git-workflow, verify-before-done | Existing development procedures | Project's normal tools |

The UI UX data and scripts are from [Next Level Builder](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill)
at `623a9a9037d006ea727f8213f084d02a6b6f11b5` (MIT). The Understand Anything procedure
is from [Egonex AI](https://github.com/Egonex-AI/Understand-Anything) at
`b8c807c632743ab695ec43cb654a0f1efe216bc8` (MIT). Web testing resources are from
[Anthropic](https://github.com/anthropics/skills/tree/main/skills/webapp-testing) at
`dbd4588f9e1033efb41dad4bef2f7947c8993d44` (Apache-2.0). Licenses ship inside each skill;
adaptations are identified in SKILL.md. `vendor-skills.lock.json` records upstream paths
and SHA-256 hashes. Maintainers verify it with `npm run test:vendor`; refresh only from
reviewed checkouts using `scripts/vendor-skills.mjs --from <directory>`.

## Check the agent and its rules

```bash
wondev agent check
wondev agent check --agent codex --json
wondev skills info ui-ux-pro-max --json
```

Detection uses an explicit `--agent`, then `WONDEV_AGENT`, then environment hints
(`CODEX_THREAD_ID`, `CLAUDECODE=1`, `CURSOR_AGENT=1`, `GEMINI_CLI=1`). Multiple hints are
ambiguous. Environment values are never printed. A `.claude/` directory alone is not
proof that Claude is running. Other hosts should specify a configured target explicitly.

The report lists configured targets and capabilities, active profile, source rules and
path scopes, enabled/disabled/out-of-profile skills, Python availability, Understand
Anything runtime files, and output conflicts/drift. It reads project-root plugin
manifests when present. It does not verify global plugins, actual host activation,
subscription tiers, browser installation, or semantic contradictions between prose rules.
Missing optional prerequisites are reported without blocking unrelated work. Source
errors, output drift, an explicitly/detectably mismatched target, or invalid local plugin
JSON produce a nonzero exit code. Use `wondev check` for normal generated-output CI checks.

## Change a skill or host

```bash
wondev skills disable ui-ux-pro-max --dry-run
wondev skills disable ui-ux-pro-max
wondev skills enable ui-ux-pro-max
wondev skills use frontend
wondev skills use --all
wondev agent use codex --dry-run
wondev agent use codex
```

Disable/enable changes `disabledSkills` in `.wondev/wondev.yaml`. Sources, memory,
licenses and upstream provenance remain intact. Profiles still narrow the enabled set:
enabling a skill outside the selected profile reports that it remains inactive. Define
profiles in config, for example `profiles: { frontend: { skills: ["ui-ux-pro-max", "webapp-testing"] } }`.

`agent use` replaces the configured target list with one target and rebuilds. It removes
old owned outputs, preserving handwritten text outside managed regions. Edited owned
outputs block the switch before config changes. `--no-build` changes config only, leaving
output stale until `wondev build`. To support several hosts together, edit `targets`:

```yaml
targets: [claude, agents, cursor]
```

| Target | Skills and resources |
| --- | --- |
| claude | `.claude/skills/<name>/`; native path rules |
| agents / codex | `.agents/skills/<name>/` plus AGENTS.md source references |
| cursor and other rule-dir targets | Rule files with references to configured skill resources |
| copilot, gemini and other single-file targets | On-demand source references, or explicitly inline procedures |
| plugin | Portable skills package with Claude and Codex compatibility manifests |

Codex's repository skill location is documented in [OpenAI's skill guide](https://learn.chatgpt.com/docs/build-skills#where-codex-loads-local-skills).
Custom hosts can use documented native skill paths without being hard-coded into wondev:

```yaml
customTargets:
  my-agent:
    engine: single-file
    path: MY_AGENT.md
    skills: .my-agent/skills
targets: [my-agent]
```

The host must actually support those paths. Names such as `claude-pro` or `codex-pro`
are not assumed to be known products or plugins; define a custom target when appropriate.

## Package skills as a plugin

Add `plugin` to `targets` and build, or use `wondev agent use plugin` for a package-only
output. The package is `.wondev/plugins/project`, containing `plugin.json`,
`.claude-plugin/plugin.json`, `.codex-plugin/plugin.json`, and `skills/` with resources.
It contains selected skills only, not application memory, subagents, MCP servers or hooks.
The default identity is `wondev-project-skills@1.0.0`; set an intentional identity/version
before distributing your own package:

```yaml
targets: [team-plugin]
customTargets:
  team-plugin:
    engine: skill-plugin
    path: plugins/team-development
    name: team-development
    version: 1.0.0
```

Use [Claude's plugin validation and installation](https://code.claude.com/docs/en/plugins-reference)
or [OpenAI's plugin packaging workflow](https://developers.openai.com/plugins/build/plugins)
to load it into the host. Build success does not mean it is activated. Avoid loading both
the native project copy and the plugin copy of the same skill. Host hooks and runtime
dependencies cannot be made portable merely by copying skill instructions.

For full Understand Anything, `wondev skills info understand-anything` displays the
pinned setup recipe. It uses a separate checkout in `.wondev/tools/`, leaves global host
configuration alone, and requires an explicit installation workflow. Once built, use
the bridge skill to run upstream analysis and bring reviewed conclusions into wondev.

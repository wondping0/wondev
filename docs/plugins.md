# Curated skills and plugin controls

Wondev's catalog groups eleven bundled skills with two optional MCP integrations:
[Playwright MCP](https://github.com/microsoft/playwright-mcp) for browser work, and
[Context7 MCP](https://context7.com/docs/resources/all-clients) for library documentation.
The catalog identifies each distribution kind; MCP servers, portable skills, and native
host plugin packages have different installation and activation mechanisms.

## Discover and inspect

```bash
wondev plugins catalog
wondev plugins catalog --json
wondev plugins info playwright
wondev plugins info understand-anything
wondev plugins install ui-ux-pro-max --dry-run
```

Catalog entries include their purpose, upstream URL, documentation, prerequisites, access
requirements, and metadata-check date. Bundled skill installation delegates to
`skills install bundled:<name>`. It works after `adopt` and follows configured source paths.

The initial MCP metadata snapshot was checked on 2026-10-22:

| Integration | Snapshot | Access and setup |
| --- | --- | --- |
| Playwright MCP | `@playwright/mcp@0.0.83`, Apache-2.0 | Node 18+, browser; local execution, website access and browser actions. Export selects an isolated profile. |
| Context7 MCP | `@upstash/context7-mcp@4.4.4`, MIT | Node 20.18.1+; documentation queries go to Context7. Set `CONTEXT7_API_KEY` in the host environment for authenticated access. |

These are snapshots, not a permanent claim to be the latest versions. Selection favors
an identified upstream, a documented interface, a distinct development use case, and
explicit prerequisites. There is no universal "best" ranking.

## Pin, enable, and export

```bash
wondev plugins pin playwright
wondev plugins enable playwright
wondev plugins status
wondev plugins export --agent codex
wondev plugins export --agent claude
wondev plugins export --agent generic
```

Pinning saves package identity, exact version, registry SHA-512 integrity, upstream URL,
metadata date, and selection state in `.wondev/plugins.lock.json`. New pins start disabled.
Pinning the catalog snapshot is offline. It neither downloads nor starts the server.
Enable/disable changes what goes into the next export, not a running agent's state.

`export` prints a snippet to review: Codex `[mcp_servers.<id>]` TOML, or `mcpServers` JSON
for Claude and compatible clients. On Windows it uses the `cmd /d /c npx` launcher; on
other platforms it uses `npx`. The launch pins the top-level package version and disables
npm lifecycle scripts during package acquisition. Starting the server still executes its
code. Browser dependencies may need explicit setup.

Merge reviewed output into the host configuration using its documented workflow. Do not
redirect over an existing configuration file: it may contain other integrations and
preferences. Re-exporting disabled or removed entries omits them; remove their previous
entries from the host when applying that change. Wondev does not edit global agent
settings, store credentials, or prove that a host loaded the configuration. `agent check`
reports project catalog selection separately from plugin manifest presence.

Host references: [Codex MCP configuration](https://learn.chatgpt.com/docs/extend/mcp),
[Claude Code MCP configuration](https://code.claude.com/docs/en/mcp).

## Check and select a newer release

```bash
wondev plugins check --online
wondev plugins check --online --json
# Use the exact version you have reviewed; ranges and "latest" are refused here:
wondev plugins pin playwright --plugin-version <exact-version> --dry-run
wondev plugins pin playwright --plugin-version <exact-version>
wondev plugins export --agent codex
```

`check --online` inspects pinned MCPs only. It verifies that the pinned package still has
the recorded integrity and reports the registry's latest version. It never changes pins.
Selecting an explicit version checks registry package name, exact version, upstream
repository, deprecation status and SHA-512 metadata before saving it. Network failures,
identity mismatches and changed pinned integrity are reported as failures, not success.
Re-pin an older exact version to roll back the selection; then apply the revised export
in your host. Existing enabled/disabled selection is retained when changing a pin.

```bash
wondev plugins disable playwright
wondev plugins remove playwright
```

`remove` removes only the project selection record. It does not uninstall an external
package or remove host configuration. Bundled skills use `plugins enable/disable <name>`
or the equivalent `skills` commands; authored sources are preserved.

## What the checks establish

Catalog metadata and exact pins make choices inspectable and reproducible at the
top-level package version. They are not a security audit, vulnerability scan, signature
verification, sandbox, or certification. Registry metadata is an assertion from that
registry. The integrity is recorded and compared; wondev does not download the tarball
or enforce its recorded checksum when a host later runs `npx`. Transitive dependencies
are resolved by npm and are not locked by this selection file. For stricter deployment,
use a separately reviewed local installation with its own dependency lock and configure
the host to run that installation.

External tool output can contain untrusted instructions. Keep host tool permissions and
approval controls appropriate to the task. An isolated browser profile avoids reusing
an existing login; it does not prevent external network access or side effects.

Build, check, discovery, and snapshot pinning stay local. Only explicit `--online` checks,
explicit version lookup, npm skill-pack operations, or later host runtime use contact
external services. New catalog entries and snapshot metadata arrive through reviewed
wondev releases; there is no remote catalog that can silently replace executable commands.

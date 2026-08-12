# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
follows [Semantic Versioning](https://semver.org/) as specified in
[docs/versioning.md](docs/versioning.md).

Note the local rule: **any change to generated output is at minimum a MINOR release**, never
a patch, because it makes `wondev check` fail in every project that upgrades.

## [Unreleased]

## [1.1.1] - 2026-08-12

Generated output is byte-identical to 1.1.0. Nothing needs rebuilding.

### Added

- **Coverage is measured by `npm run verify` and enforced by thresholds**, so an untested
  command fails the run instead of quietly lowering an average nobody reads. Documented in
  `CONTRIBUTING.md` as floors, not targets.

- **`doctor` reaches 100%** — statements, branches, functions, and lines. Two of its findings
  could not be reached from a running process at all: a Node version below the minimum, and
  a source schema older than this build, which `loadConfig` refuses before `doctor` ever sees
  it. Both are now pure functions (`nodeFinding`, `schemaFinding`) tested directly, following
  the precedent `assertSchemaCurrent` set. A branch first executed on the day it matters is a
  branch nobody has checked.

- **`cli.ts` went from 0% to 82%.** It ran `main()` on import, so no test could load it and
  the only thing exercising 334 lines of argument parsing and dispatch was a child process
  the coverage tool cannot see. It now guards the auto-run behind an entry-point check and
  exports `main` and `reportFailure`, and every command's wiring is tested in-process.

- More `list` coverage: sections that are absent rather than empty, and a memory document
  with no description.

### Notes

Counting is deliberately honest: `src/**` is measured in full, including files no test
imports, because the point is to see what is untested rather than to average over whatever
happened to load. `watch.ts` reads at ~4% for a real reason — it is tested by spawning the
CLI, which v8 cannot observe from inside the runner.

## [1.1.0] - 2026-08-12

Generated output changes for projects whose documents use nested lists, underlined headings,
or reference links. Run `wondev build` and commit the result.

### Fixed

- **Nested lists were flattened.** Every item rendered as a sibling, so a two-level procedure
  lost the distinction between a step and its sub-steps — the structure a reader navigates by.

- **List items spanning more than one line broke the list.** Indenting continuation text is
  the ordinary way to write a long item; the renderer ended the list at the first wrapped
  line, turning the item's own text into a stray paragraph and the list beneath it into a
  second top-level list. On the vault this was tested against, that pattern appears eighteen
  times and nested lists in the output went from two to six once it worked.

- **Underlined (setext) headings** showed their `=====` as paragraph text. `---` is both a
  thematic break and a setext underline, and which one it is now depends on whether a
  paragraph precedes it.

- **Reference-style links** printed raw, definitions included. They now resolve, and the
  definition lines are removed.

- Images no longer leak their `!`. They render as **links, never `<img>`** — the page's one
  hard guarantee is that it makes no external request, and an image source is a request the
  moment the page opens. The scheme allowlist applies to them too.

- Task list markers and `~~strikethrough~~` render instead of showing their syntax.

### Added

- **`wondev init` says something when the project already has agent config**, naming what it
  found and pointing at `adopt`. Scaffolding beside an existing `CLAUDE.md` is not
  destructive, but it leaves that content outside `.wondev/` where wondev never compiles it —
  two sets of agent knowledge, one of them maintained. A warning, not a refusal.

- **`include` works on `rule-dir` and `claude` targets**, not only `single-file`. Excluding
  `memory` from a claude target now also excludes its path-scoped rule files, since a scoped
  memory document is still memory.

- Tests for `init`, and the markdown renderer reaches 100% statement coverage.

### Notes

`adopt` across sibling repositories turned out not to be a missing feature: `--cwd` already
does it, and one `.wondev/` per repository is the right shape. Copying a service's
conventions into a coordinating repository duplicates content that then goes stale.
Documented in `docs/tooling.md` rather than built.

## [1.0.1] - 2026-08-12

Generated output is byte-identical to 1.0.0. Nothing needs rebuilding.

### Changed

- **`junie` is deprecated**, replaced by `agents`. Verified against JetBrains' documentation:
  Junie now searches `.junie/AGENTS.md`, then `AGENTS.md`, then `.junie/guidelines.md`, which
  it calls its "legacy format". Since `agents` is a default target, a project with both
  enabled has an `AGENTS.md` that outranks the guidelines file — so wondev was writing a file
  that would never be read. `build` now says so.

- **`wondev doctor` names source problems instead of counting them.** It reported
  "N source problem(s). Run `wondev check`", which spends a round trip to deliver one line.
  It now prints the first three with their file and message, and points at `check` only when
  there are more.

- **`wondev list` shows freshness for on-demand memory too**, not only always-loaded. "Is
  this still true?" is asked precisely when someone is about to rely on a document, which is
  when an on-demand one gets read.

### Added

- **Every built-in target path is now verified** against its vendor's own documentation —
  14 of 14, up from 12. `gemini` (`GEMINI.md`) and `junie` were the two that could not be
  checked at 1.0.0.

- **Test coverage measurement**, and the gaps it found closed. `list` shipped in 0.8.0 and
  reached 1.0.0 with **no test at all** — the same gap that hid a runaway rebuild loop in
  `watch` for two releases. Coverage is now 90%, with `list` at 100% and `doctor` raised from
  68% to 78%.

- **The migrate command's execution path is tested.** `MIGRATIONS` is empty, so the code that
  applies a migration could not run until the day a real schema bump shipped. `runMigrate`
  now takes an optional migration list — the same seam `pendingMigrations` already had — and
  the full apply-and-stamp path is exercised.

- A guard against a mistake that path exposed: a shipped migration advancing past
  `SOURCE_SCHEMA_VERSION` means someone added the migration and forgot the constant, and
  `migrate` would stamp the project into a schema its own build refuses to load.

## [1.0.0] - 2026-08-11

The API and the source format are now stable. Breaking changes require a MAJOR release from
here; see [docs/versioning.md](docs/versioning.md).

### Added

- **Path-scoped memory reaches Claude Code.** A memory document with `globs` is now written
  to `.claude/rules/<slug>.md` with `paths:` frontmatter, and left out of `CLAUDE.md`.
  Claude Code loads such a rule only when it reads a matching file, so a rule about the API
  layer costs nothing while you work on the frontend. `globs` existed since 0.1.0 and no
  target had ever used it.

- **A `devin` target** writing `.devin/rules/`, found by verifying the registry against
  vendor documentation: Windsurf's docs now redirect to `docs.devin.ai`, which states
  `.devin/rules/` is the preferred location and `.windsurf/rules/` is "kept as a fallback
  for backward compatibility".

- **`pathVerified` is populated.** 12 of 14 target paths were checked against their vendor's
  own documentation on 2026-08-11. `wondev targets --verbose` shows which, and honestly
  reports the two that were not (`gemini`, `junie` — their documentation would not load).

### Changed

- **`windsurf` is deprecated**, replacing `devin`. It still writes `.windsurf/rules/`, which
  is still read, and `build` now warns once per run naming the successor. Nothing is removed;
  per `docs/versioning.md`, removal requires a MAJOR after a MINOR of warning.

- `devin` is no longer an alias for `agents`. It is a target in its own right.

### Notes

Verification also confirmed two things wondev already had right: Claude Code reads
`CLAUDE.md` and explicitly **not** `AGENTS.md`, and Cursor ignores `.md` files in
`.cursor/rules` — only `.mdc` — which is what the `cursor` target has always written.

## [0.9.11] - 2026-08-11

### Security

- **The HTML guide rendered `javascript:` links as clickable links.** Escaping stops a URL
  breaking out of its attribute; it does nothing about what the URL does when followed, and
  `[click](javascript:alert(1))` in a memory document produced a working link in a page
  built from repository content — which the threat model treats as untrusted.

  Link targets are now checked against an allowlist (`http`, `https`, `mailto`, `ftp`, plus
  relative paths and anchors). Anything else renders as plain text: visible, inert. An
  allowlist rather than a blocklist, because `javascript:` is the one people remember and
  `data:` and `vbscript:` are the ones they forget.

  Probed alongside `<script>`, `<img onerror>`, `<svg onload>`, `<iframe>`, and attribute
  break-out, all of which were already handled correctly.

## [0.9.10] - 2026-08-11

### Security

- **`wondev remove` could delete files outside the project.** It built a path from its
  `name` argument and called `fs.rm` directly, bypassing the guards every other deletion in
  wondev routes through. `wondev remove memory ../../../notes` deleted a file outside the
  project entirely, and `wondev remove skill ../../../dir` removed a whole directory tree
  recursively — both reporting success. Introduced in 0.8.0, present through 0.9.9.

  Names containing `..` or an absolute path are now refused before anything is resolved, and
  the resolved path is re-checked against its own directory before the delete, mirroring the
  defence in depth already in `removeOwned`.

  This matters more than a typo hazard: wondev is built to be used by agents, and an agent
  composing a command from repository content is the ordinary case.

- **`wondev adopt --vault` could read outside the project.** Adopt copies what it reads into
  `.wondev/`, which is committed, so a mistyped path could place external content —
  credentials, anything — into git. A vault outside the project is now refused.

Upgrade if you are on 0.8.0 or later.

## [0.9.9] - 2026-08-11

The pre-1.0 cleanup. **Breaking for library consumers**; the CLI is unaffected.

### Removed

- The writer internals (`planWrites`, `applyPlan`, `cleanAll`, `loadManifest`, `Manifest`,
  `PlanItem`), the template bookkeeping (`recordTemplates`, `templatesDir`,
  `loadTemplateManifest`), the semver helpers, and the migration registry are no longer
  exported.

  They were exported because they existed, not because their shapes were designed to be
  built on — `applyPlan` had already gained a parameter in 0.1.2, which would have been a
  breaking change had anyone depended on it. What remains is the format (types, loaders,
  pure render functions) and the `run*` commands the CLI itself calls. Call those instead;
  they do the bookkeeping correctly, including the parts that are easy to get wrong.

### Added

- **The migration engine is now exercised end to end**, against synthetic schema versions.
  `MIGRATIONS` is empty because schema 1 is the only shape that has existed, which meant
  every path through the engine was unreachable — the first real schema bump would have been
  the first time any of it ran, on the day it mattered, against someone's authored files.
  Nine tests now cover multi-step chains, a broken chain, a failure mid-chain, the refusal
  that sends a user to `wondev migrate`, and that `stampConfig` does not destroy the comments
  around the key it rewrites.

- **A filter box in the generated HTML guide.** Inline script, no fetch, and the page works
  without it: with the script blocked the input is inert and every section is still present
  and linked.

### Fixed

- The guide's "no external requests" test asserted that no URL appeared anywhere, which
  passed only because the fixture contained none. It now checks the constructs that actually
  cause a request — `src`, `<link>`, `@import`, `url()` — and separately asserts the only
  script is inline.

## [0.9.0] - 2026-08-11

### Added

- **`include` on `single-file` targets** — choose which artifact types a flattened target
  carries, e.g. `include: [memory]`. Useful when a host discovers skills itself; repeating
  them in its context file is paid for on every turn. The shared flatten memo is
  deliberately not reused for a narrowed target, which would otherwise hand it everything.

- `docs/tooling.md` now explains **why engines are not user-pluggable**: loading a JS module
  named by `wondev.yaml` would execute code from what the threat model calls untrusted
  input, so a cloned repository could run arbitrary code on `wondev build`. A new engine is
  a small pull request; a code-loading mechanism is a permanent hole.

### Fixed

- `flatSlug` now replaces `< > : " | ? *` as well as separators and whitespace. Those are
  legal in a POSIX filename and rejected outright by Windows, so a memory slug containing
  one produced a repository that could not be checked out on Windows at all — a failure the
  author never sees, because their own checkout works. Runs are collapsed and edges trimmed,
  so no generated filename begins or ends with a separator.

## [0.8.0] - 2026-08-11

### Added

- **`wondev remove <type> <name>`.** Deleting an artifact was always possible — remove the
  source, rebuild, and the stale-file sweep cleans up — but nothing said so, so the
  reasonable conclusion was that it could not be done safely. The rebuild is included
  deliberately: removing the source without it leaves generated copies in every target,
  which is worse than not removing it at all. `--dry-run` and `--no-build` are available.

- **`wondev list`.** What this project defines, and what each piece costs: always-on memory
  with its running total, on-demand memory with triggers, skills marked inlined or
  referenced, subagents, and commands. `doctor` diagnoses and `check` verifies; neither
  answered the plainest question about an unfamiliar repository.

- **`wondev adopt --map <from>=<to>`.** Renames a frontmatter key on the way in. A project
  with its own vocabulary — `diperiksa` where wondev reads `verified` — previously adopted
  cleanly and lost the meaning: the key survived in `extra`, nothing read it, and no
  freshness tick ever appeared. A malformed pair is refused rather than ignored, since
  silently dropping it produces exactly that same invisible failure.

- **`wondev targets --verbose`** shows when each output path was last checked against its
  vendor's documentation, and how many never have been.

## [0.7.0] - 2026-08-11

Generated output changes substantially again, in the same direction as 0.3.0. Run
`wondev build` and commit the result.

### Changed

- **Skill bodies are no longer inlined into flattened targets by default.** 0.3.0 fixed this
  for memory and missed skills, which turned out to be the larger half: measured on a real
  project, **95% of `AGENTS.md` was skill bodies** — 10,262 tokens of 10,751, from a single
  skill.

  Each non-inlined skill now gets one line: path, estimated cost, attachment count, and its
  trigger. Set `inline: true` on a skill to keep its body in the file, for the short
  universal ones an agent should never have to open a file to follow.

  Same project after this change: `AGENTS.md` fell from 10.7k tokens to **630**. Across
  0.3.0 and 0.7.0 together, from 66.4k.

  `rule-dir` and `claude` targets are unaffected — neither ever inlined skill bodies.

### Added

- `pathVerified` on registry entries, and `wondev targets --verbose` to show it.

  Every built-in target writes to a path a vendor controls, and vendors move them. That is
  the one failure wondev has no symptom for: the old path keeps being written, every command
  reports success, and the file is never read again. There is no way to detect it
  automatically, so it is a review task — and the dates are now recorded, visible, and
  honestly absent where nobody has checked. `CONTRIBUTING.md` documents the review.

## [0.6.1] - 2026-08-11

### Added

- [docs/tooling.md](docs/tooling.md) — how to teach an agent to use a tool, and which tools
  are worth the trouble. Covers the three things a tool skill must state (the trigger, the
  exact commands, and the limits), where long reference material goes, and a shortlist
  grouped by problem rather than by product: structural code queries, fast search, rules
  expressed as lint checks, verification that proves rather than asserts, and MCP for
  systems the agent cannot otherwise reach.

  Also records why the starter pack ships no tool-specific skills, and why wondev does not
  manage `settings.json`, hooks, or MCP configuration.

Generated output is byte-identical to 0.6.0.

## [0.6.0] - 2026-08-11

### Added

- **`wondev adopt`** — the compiler run backwards, for projects that already have agent
  config but no wondev source. Reads `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`,
  `.github/copilot-instructions.md`, `CONVENTIONS.md`, and the whole `.claude/` tree
  (skills with attachments, commands, subagents), and writes `.wondev/` plus a config naming
  the targets it found evidence of.

  `--dry-run` prints the plan. `--vault <dir>` additionally takes a directory of markdown in
  as on-demand memory, normalising human filenames (`Alur Live Map.md` → `alur-live-map`)
  and rewriting the `[[wikilinks]]` between them so an internally consistent vault stays
  consistent. Links naming things that were never notes are reported with counts at adopt
  time rather than appearing as errors on the first build.

  It takes only the hand-written part of a file wondev previously generated, so adopting
  cannot round-trip wondev's own output back into the source. Nothing is deleted.

  Deliberately lossy where it must be: a skill trigger that was never written down is left
  absent rather than invented.

## [0.5.0] - 2026-08-11

### Added

- **An HTML guide target.** Enable `guide` and wondev writes `GUIDE.html`: one
  self-contained page covering every artifact type, with sidebar navigation, per-document
  token cost, and freshness stamps. No scripts, fonts, stylesheets, or external requests,
  so it works from `file://` and cannot phone anywhere when opened.

  Markdown is converted at build time by a small built-in renderer rather than a
  dependency. Fenced blocks stay fenced — a Mermaid diagram renders as labelled code, not a
  drawing.

  Also available as `engine: html` for custom targets.

- **Starter pack additions.** `wondev init` now ships an example subagent and a
  context-discipline memory document, so a new project inherits the shape rather than
  discovering it. Deliberately not shipped: a skill for any specific third-party tool.

### Fixed

- `wondev init` and `wondev check` printed "1 agents".

## [0.4.0] - 2026-08-11

### Added

- **Subagents, as a fourth artifact type.** `.wondev/agents/<name>.md` with `name`,
  `description`, and optional `tools` and `model`. The `description` is the dispatch rule the
  caller matches against, the same way a skill's is a trigger rather than a summary.

  Claude Code gets real files at `.claude/agents/<name>.md` plus an index in `CLAUDE.md`.
  Every other target gets a listing — name, rule, and source path — because delegation is a
  host capability and a host without one cannot use the body.

  `wondev add agent <name>` scaffolds one. A custom `claude` target that names no `agents`
  directory keeps working and simply produces no agent files.

- `wondev check` reports an agent count when a project defines any.

## [0.3.0] - 2026-08-11

Generated output changes substantially. Run `wondev build` and commit the result; expect
flattened targets to get **much** smaller.

### Fixed

- **`wondev watch` rebuilt forever after a single edit.** Every build rewrites
  `.wondev/.manifest.json`, which lives inside the watched directory, so a build triggered
  its own successor — roughly six rebuilds per second, indefinitely, until the process was
  killed. An idle `watch` looked stable because the first build runs before the watchers
  exist, so only an edit started the cycle. Present in every release so far.

### Changed

- **Memory that is not `always: true` is no longer inlined into flattened targets.**
  `AGENTS.md`, `CLAUDE.md` and the other single-file targets are read on every turn, and
  until now they carried every memory document regardless of the flag, which only affected
  sort order. Each on-demand document now gets one line — path, title, estimated cost, and
  its `description` as the trigger — and the agent opens what matches.

  Measured on a 22-note vault with nothing marked always-on: `AGENTS.md` fell from ~66k to
  ~10.7k tokens, `CLAUDE.md` from ~56k to ~0.6k.

  `rule-dir` targets are unaffected; they already write one file per document.

### Added

- The public API now exports the memory index, attachment and freshness surface
  (`renderIndex`, `alwaysOnTokens`, `docTokens`, `onDemandMemoryIndex`, `estimateTokens`,
  `formatTokens`, `INDEX_OWNER`, `Attachment`, `IndexConfig`, `IndexColumn`) — all of which
  0.2.0 shipped without exporting.
- `src/index.ts` documents which exports are stable and which are provisional. The writer
  internals (`planWrites`, `applyPlan`, `cleanAll`) and the `run*` entry points are
  provisional and will be narrowed or removed in 1.0.

## [0.2.0] - 2026-08-11

Generated output changes, so `wondev check` will report drift until you run `wondev build`
and commit the result. See below for exactly what moves.

### Added

- **Memory index.** Set `index.file` in `wondev.yaml` and wondev writes a table of every
  memory document with its estimated token cost and its "when to read" trigger, split into
  always-loaded and on-demand. It is written into a managed region, so prose around it
  survives. Nothing about the table is hand-maintained, so it cannot fall out of date.

- **Context budget.** Set `index.budget` and `wondev check` fails when always-on context
  exceeds it, naming the three largest contributors. There is no default: enforcement
  happens only where it was asked for.

- **Skill attachments.** Any `.md` file beside `SKILL.md` is carried with the skill. The
  `claude` target copies them; flat targets like `AGENTS.md` name their paths instead of
  inlining them, so occasional reference material is not paid for on every turn.
  Non-markdown files warn and are skipped.

- **Freshness fields.** `verified` (a `YYYY-MM-DD` date) and `verifiedAgainst` (what it was
  reconciled with) on memory documents. The date drives a ✓ in the index. Documents with no
  `verified` are reported by `check` as warnings, never errors.

- **Frontmatter passthrough.** Keys wondev does not interpret are preserved instead of
  discarded, and can be surfaced as extra index columns via `index.columns`. They are never
  injected into a target's own frontmatter.

### Changed

- Skills with attachments gain a `**Reference material**` block on every flat target. This
  is the output change referred to above; projects with no attachments see no difference.
- `flatSlug` now collapses whitespace as well as path separators, so a memory document named
  `Live Map.md` no longer produces a generated filename containing a space.

### Notes

`SOURCE_SCHEMA_VERSION` stays at 1. Every addition here is optional, so a project written
for 0.1.x parses unchanged and no migration is needed.

## [0.1.2] - 2026-08-11

0.1.1 was prepared and tagged locally but never published; its change is included here.

### Fixed

- **`build --target <name>` deleted every other target's generated output.** The stale-file
  sweep removes any file the current render did not produce, and a narrowed build renders
  only one target — so `wondev build --target claude` deleted `AGENTS.md`, `.cursor/rules/`
  and everything else, reporting it as a routine removal. A partial build now retires files
  only for the targets it actually built. If you have run `build --target`, re-run a full
  `wondev build` to restore what went missing.

- `require('wondev/package.json')` threw `ERR_PACKAGE_PATH_NOT_EXPORTED`. The `exports` map
  now includes the `./package.json` subpath, which bundlers and tooling routinely read.
  Found by installing 0.1.0 from the registry and reading its version back.

Generated output is byte-identical to 0.1.0, so upgrading requires no rebuild.

This is the first release published from CI through npm trusted publishing, so unlike 0.1.0
the tarball carries a signed provenance attestation linking it to the commit and workflow run
that built it. No long-lived npm token exists anywhere in the pipeline.

## [0.1.0] - 2026-08-10

First release.

### Added

- `wondev init` — scaffold `.wondev/` with a starter pack, then build.
- `wondev build` — compile `.wondev/` into every enabled target. `--force`, `--dry-run`,
  `--target`.
- `wondev watch` — debounced rebuild on change.
- `wondev add <skill|memory|command> <name>` — scaffold one artifact.
- `wondev check` — validate sources and detect drift; exits 1. Intended for CI.
- `wondev clean` — remove generated files, per the manifest.
- `wondev migrate` — bring an older `.wondev/` up to the current source schema.
- `wondev upgrade` — update starter-pack files. Untouched files are replaced; files you
  edited are never modified, and the new version is written to `<name>.new` for you to
  merge. `--dry-run`, `--only`, `--restore`, `--no-new`.
- `wondev doctor` — diagnose Node version, config, schema, sources, build state, and
  starter-pack age. `--online` additionally asks npm whether a newer wondev exists; without
  that flag wondev makes no network requests at all.
- `wondev targets` — list known targets and what reads each one. `--new` shows only those
  added since the project was initialised.

- Three render engines covering the field: `single-file`, `rule-dir`, and `claude`.
- Twelve built-in targets: Claude Code, AGENTS.md, Cursor, GitHub Copilot, Gemini CLI,
  Windsurf, Cline, Roo Code, Continue, Kiro, Aider, and JetBrains Junie — plus aliases so
  `codex`, `zed`, `opencode`, `jules`, and others resolve to `AGENTS.md`.
- `customTargets` in `wondev.yaml`, so an agent with no built-in entry — including one that
  does not exist yet — is supported by a two-line config addition.
- Starter pack: six skills (`debugging`, `writing-tests`, `code-review`, `planning-work`,
  `git-workflow`, `verify-before-done`) and memory scaffolds for architecture, conventions,
  glossary, and decision records.

### Write safety

- A hashed manifest at `.wondev/.manifest.json` recording every span wondev owns.
- Build refuses to overwrite a file wondev did not write, or one edited since it did.
  `--force` overrides.
- Managed regions, so adopting an existing `AGENTS.md` or `CLAUDE.md` appends a block and
  preserves every other byte. `clean` strips only that block.
- Atomic writes via temp file plus rename.

### Versioning

- `schema` and `wondevVersion` stamped into `wondev.yaml` and the manifest, so a future
  release can identify and migrate a project.
- Source and manifest formats from a newer wondev are refused with a clear message rather
  than reinterpreted.
- `check` distinguishes "you forgot to rebuild" from "wondev changed its output", naming
  both versions.
- Starter-pack provenance in `.wondev/.templates.json`, recording what was shipped so a
  later `wondev upgrade` can tell an edited file from an untouched one.
- Registry entries record `addedIn` and support a `deprecated` marker; `build` warns once
  per run when a deprecated target is enabled.
- Golden output files for every built-in target, rendered from a frozen fixture project, so
  any change to generated bytes shows up as a reviewable diff.

### Security

Both issues below were found by probing wondev against a hostile repository before release,
and are covered by regression tests in `test/security.test.ts`. See
[docs/security.md](docs/security.md) for the threat model.

- **Arbitrary file deletion via a crafted manifest.** `.wondev/.manifest.json` lists the
  paths `clean` deletes, and it is committed to the repository like any other file. An entry
  such as `../../.ssh/authorized_keys` caused deletion outside the project. `loadManifest`
  now rejects any manifest containing an escaping path, and `removeOwned` re-checks
  independently.
- **Write outside the project through a directory symlink.** Path validation was lexical
  only, so a repository shipping `.claude -> ~/.ssh` passed the check while every write
  landed outside. Output directories are now resolved through symlinks before use.

### Performance

- File reads and writes use bounded concurrency instead of running one at a time. Compiling
  a project of 886 output files across 12 targets went from 436ms of work to 82ms.
- The flattened document shared by every `single-file` target is built once per build rather
  than once per target.
- CLI commands are imported on demand, so `wondev --version` and `wondev targets` no longer
  load the YAML parser and the whole core. Overhead above bare Node startup fell from about
  270ms to about 20ms.

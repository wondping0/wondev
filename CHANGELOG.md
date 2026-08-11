# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
follows [Semantic Versioning](https://semver.org/) as specified in
[docs/versioning.md](docs/versioning.md).

Note the local rule: **any change to generated output is at minimum a MINOR release**, never
a patch, because it makes `wondev check` fail in every project that upgrades.

## [Unreleased]

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

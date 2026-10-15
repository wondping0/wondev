# Knowledge and skill management implementation

This records the completed October 2026 development plan for wondev 1.2.0. The final
working-tree audit covers CLI/API behavior, documentation, compatibility, and the
repository's verification gates. The package has not been published.

## Active vault and project knowledge

- [x] Configurable in-project source directories used by load, add, remove, upgrade, and watch.
- [x] Obsidian vault scaffold, module/flow/decision/runbook templates, and Bases dashboards.
- [x] Stable memory IDs, kinds, statuses, evidence patterns, and related-note graph.
- [x] Link resolution for paths, aliases, labels, headings, blocks, and Markdown links;
      reject ambiguous links, preserve folders on import, and ignore code examples.
- [x] Existing projects keep their default source layout and compatible output.

## Context and freshness

- [x] Task/path-based context selection with bounded graph expansion and explanations.
- [x] Budget includes the complete emitted packet; required context cannot be silently dropped.
- [x] CLI Markdown/JSON output and a reusable selection API; generated agent entry guidance.
- [x] Evidence fingerprints detect modifications, additions, deletions, and changed notes.
- [x] Explicit verification records, stale reports, and actionable Obsidian review dashboard.

## Skills and collaboration

- [x] Complete skill resources copied byte-for-byte with metadata preserved.
- [x] Versioned local/npm skill packs, checksum lockfile, and edit-preserving update preview.
- [x] Named activation profiles and documented target capabilities/fallbacks.
- [x] Positive/negative trigger evaluation cases.
- [x] Unique session records with evidence, decisions, failed attempts, and next actions.
- [x] Proposed memory updates, explicit review/apply, expected-hash conflict checks,
      and process-level serialization of shared mutations.

## Delivery

- [x] CLI help, README, usage examples, public exports, and changelog.
- [x] Behavior, migration/compatibility, path-boundary, and concurrent-update tests.
- [x] Full typecheck, build, coverage thresholds, golden diff review, and packed CLI smoke test.
- [x] Requirement-by-requirement audit against the final working tree.

## Requirement audit and evidence

| Requirement | Implementation | Verification |
| --- | --- | --- |
| Active vault and configurable sources | `core/config.ts`, `core/source.ts`, `commands/vault.ts`; source-aware lifecycle commands | `vault.test.ts` covers conversion, templates, Bases schema, add/remove/upgrade, and preserved index settings; `watch.test.ts` edits the vault and changes its source mapping through a real CLI process |
| Stable identities, lifecycle, and links | `core/model.ts`, `core/links.ts`, `commands/adopt.ts` | `links.test.ts` covers IDs, aliases, headings, blocks, ambiguity, and ignored examples; `vault.test.ts` covers hierarchical imports and inactive notes; `freshness.test.ts` covers renames |
| Task context, bounded graph, and complete budget | `core/retrieval.ts`, `commands/select-context.ts`, generated entry guidance | `retrieval.test.ts` covers scoring, backlinks, expansion limits, deterministic order, Markdown/JSON overhead, and required-context overflow; `knowledge-cli.test.ts` covers CLI dispatch |
| Evidence freshness and review | `core/freshness.ts`, `commands/memory.ts`, `commands/output.ts` | `freshness.test.ts` covers added/deleted/changed evidence, changed claims, exclusions, explicit verification, and review output |
| Complete skill resources and metadata | `core/source.ts`, native renderers, `core/writer.ts` | `skill-management.test.ts` checks script bytes, Markdown line endings, binary resources, metadata, build/check/clean; packed smoke checks binary output |
| Reproducible skill packs and safe updates | `core/packs.ts`, `commands/packs.ts` | `packs.test.ts` covers checksums, exact versions, frozen sync, local edits/deletions, collisions, previews, and conflicts; `npm-pack-integration.test.ts` uses real npm and a local registry with a failing lifecycle script |
| Profiles, capabilities, and trigger quality | `commands/context.ts`, `core/registry.ts`, `core/skill-quality.ts` | `skill-management.test.ts` covers default/override profiles, retiring inactive outputs, compiler fallbacks, and positive/negative cases |
| Session capture and reviewed memory updates | `core/sessions.ts`, `commands/session.ts`, `util/lock.ts` | `sessions.test.ts` covers unique records, stale review hashes, competing proposals, and resumable apply; `freshness.test.ts` covers concurrent writer serialization and failure cleanup |
| Compatibility and path boundaries | Default schema/path behavior, root guards, source/output separation | Existing golden fixtures are unchanged; `vault.test.ts` and `security.test.ts` cover source/output overlap and escaping directory/leaf symlinks; the complete regression suite passes |
| Usable package and documentation | CLI help, `index.ts`, README, changelog, `docs/knowledge.md`, `scripts/smoke-package.mjs` | `public-api.test.ts`, `knowledge-cli.test.ts`, and installation of the actual packed npm artifact into a fresh application |

Implementation paths in this table are relative to `src/`; test paths are relative to `test/`.

## Final validation

- `npm run verify`: typecheck, build, and **448 tests across 33 files passed**.
- Coverage after the packaging follow-up: statements **91.70%**, branches **86.81%**,
  functions **94.55%**, lines **92.97%**. Existing thresholds (90/83/92/91) were retained.
- `npm run test:package`: packed and installed wondev **1.2.0**, then passed executable,
  vault, context, verification, complete-resource, proposal/apply, sync, and drift checks.
- `git diff --check` passed. Existing golden fixture files have no diff. Resource/header
  byte changes are intentional and documented as a minor release.

Obsidian configuration and Bases documents are checked as generated artifacts; this audit
does not claim interactive testing inside the Obsidian application. Trigger evaluation
tests wondev's selector; each agent host retains its own native activation behavior.

MCP and embeddings remain optional future interfaces, as in the proposal; the CLI and
public API provide the complete local workflow. The original implementation scope ended
before publishing; release preparation is recorded below.

## Release readiness follow-up

- [x] CI enforces the existing coverage thresholds on Windows, macOS, and Linux.
- [x] Package and upgrade smoke scripts are wired into CI for all three platforms and
      required by the release workflow before publishing.
- [x] `npm run test:upgrade` passed locally from the actual published 1.1.1 package to
      the packed 1.2.0 build, preserving user edits, reference bytes, binary resources,
      human-owned output prose, and default paths before explicit vault conversion.
- [x] Release diagnostics report authentication configuration presence without printing
      npm configuration contents.
- [x] npm-safe ignore-template packaging installs `.wondev/.gitignore` on both fresh
      initialization and upgrade, checked through the actual installed tarball.

These workflow changes have been checked locally; hosted matrix results require a push.
See [the release procedure](releasing.md) for the remaining external release steps.

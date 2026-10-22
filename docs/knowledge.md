# Active vaults, task context, and shared skills

wondev keeps project knowledge in ordinary files and compiles it for each agent. Obsidian
is an optional editor for those same sources. No Obsidian server, plugin, subscription,
embedding service, or model API is required. Builds and context queries work offline.

## Start with a vault

```bash
npx wondev init --vault knowledge --targets claude,agents
```

For an already initialized project:

```bash
wondev vault knowledge --dry-run
wondev vault knowledge
wondev build
```

The conversion moves the existing memory, skills, commands, agents, and sessions into the
new vault. It refuses an existing destination and checks all paths before moving sources.
`.wondev/` continues to contain configuration, provenance, locks, and verification records.
Open `knowledge/` as a folder vault in Obsidian.
Enable the core Templates plugin to insert the provided templates; its folder is preconfigured.

```text
.wondev/
  wondev.yaml
  .manifest.json
  .templates.json
  .memory.json
  .map.json                   baselines for generated application-map regions
  skills.lock.json
knowledge/
  index.md                    managed memory index plus your own introduction
  review.md                   evidence status from the last build
  memory/                     durable project knowledge
  skills/                     reusable procedures and their resources
  commands/
  agents/
  sessions/                   work summaries and proposed memory changes
  templates/                  module, flow, decision, runbook, and lesson templates
  dashboards/project.base     Obsidian Bases views
```

For an existing vault, configure the sources directly instead of converting directories:

```yaml
vault: knowledge
sources:
  memory: knowledge/memory
  skills: knowledge/skills
  commands: knowledge/commands
  agents: knowledge/agents
  sessions: knowledge/sessions
index:
  file: knowledge/index.md
  columns:
    - { key: kind, label: Kind }
    - { key: status, label: Status }
    - { key: owner, label: Owner }
```

Every source is optional; omitted entries retain their `.wondev/<kind>` default. Source
directories must be distinct, non-overlapping directories inside the application repository.
Generated output cannot be placed inside a source directory. `add`, `remove`, `upgrade`,
and `watch` use these configured paths. Template provenance continues to use logical keys
such as `memory/architecture.md`, even after moving to a vault.

`adopt --vault <dir>` remains a one-time import. It now preserves normalized folder paths
and rewrites note links, including relative Markdown links. Import does not establish a
live connection to the original folder. Ambiguous links require an explicit folder path.

## Model the application

Keep one coherent subject per note: a module, cross-module flow, decision, or runbook.
Record entry points, responsibilities, contracts, invariants, rejected approaches, and the
checks that demonstrate the note is still accurate.

### Bootstrap understanding from code

```bash
wondev map --dry-run
wondev map --exclude "fixtures/**" --exclude "generated/**"
```

`map` inventories JavaScript/TypeScript files, literal imports/re-exports/require calls,
test locations, and package manifests. It writes one memory note per source directory and
package under the configured `memory/map/`, then builds agent output. Package notes list
declared entry points, script names, dependencies, and links to local packages. Module
notes link resolved dependencies and consumers, including observed importing test files.
Code and package scripts are never executed. `--no-build` skips the final build.

Notes contain an owned **observed facts** region and a **Curated understanding** section.
Write responsibilities, business flows, invariants, design reasons, and links to lessons
in the curated section. Refreshing preserves that section and frontmatter; editing the
owned region produces a conflict instead of silently replacing your edits. Commit
`.wondev/.map.json` with the notes. Stable IDs let a moved note retain its identity.
Removed modules keep their note with a removal notice so curated knowledge is not deleted;
review and archive it explicitly. No observation is automatically marked verified.

The mapper resolves relative imports against scanned files, extension equivalents such as
`.js` to `.ts`, and directory indexes. It does not resolve tsconfig aliases, package exports,
runtime/computed imports, or framework routing semantics. Syntax failures and unresolved
imports remain visible; they are not guessed. Babel's [syntax parser](https://babeljs.io/docs/babel-parser)
reads code without invoking the application's compiler or plugins.

Hidden paths, dependency/vendor directories, `dist`, `build`, `coverage`, configured wondev
sources, and the vault are excluded. Symlinks are not traversed. Other ignored paths require
explicit `--exclude` globs; `.gitignore` is not interpreted. Directory names containing glob
syntax (for example `[id]`) use single-character wildcards in evidence patterns, which can
include similarly named sibling paths. Scans fail explicitly above 50,000 directory entries,
10,000 source files, 2 MB per input, or 50 MB total input. Narrow large/generated trees with
exclusions. The output is a navigation aid; business meaning still needs code inspection.

```markdown
---
id: module-auth
title: Authentication
kind: module
status: active
description: Read when changing login, sessions, or authorization.
globs: ["src/auth/**"]
evidence: ["src/auth/**", "test/auth/**"]
related:
  - "[[memory/flows/login]]"
  - "[[memory/decisions/session-storage]]"
aliases: [Authentication module]
owner: platform
---

# Authentication

## Responsibility

Validate credentials and issue sessions.

## Invariants

Every session is checked before a protected operation.

## Decisions and rejected alternatives

Explain the reasoning that cannot be recovered from the code alone.

## Verification

Describe the relevant tests and deployment checks.
```

Assign a unique `id` that survives file and title changes. Without one, the path-like slug
is the identity. `status` is `draft`, `active`, or `archived`; an absent status means active
for existing projects. Draft and archived notes remain available to humans but are not
compiled into agent context or selected for tasks. New Obsidian templates begin as drafts.

Links support vault paths, unique basenames, aliases, `[[note#Heading|label]]`,
`[[note#^block]]`, local headings, note embeds, and relative Markdown links. Code examples
and comments do not become graph edges. Missing or ambiguous note links fail validation.
Non-note resource links are not interpreted as memory. Links in `related` also become
graph edges and may use stable IDs.

Bases reads the Markdown properties directly. Its provided views cover all memory,
modules, decisions, and notes with no verification date. `review.md` separately reports
fingerprint changes; run `wondev memory stale` for live results between builds.

## Select context for a task

```bash
wondev context --task "fix refresh token handling" --files src/auth/session.ts --budget 4000 --explain
wondev context --task "review session storage" --json --budget 8000
```

Selection uses task terms, word prefixes, paths matching `globs` (or `evidence` when no
globs are supplied), and a bounded graph traversal. Metadata matches rank above body
matches; matching paths receive the strongest boost. One hop and at most eight additional
graph notes are the defaults. Related notes and backlinks both participate. The public
`selectContext` API accepts `depth` (0–3) and `graphLimit` (0–100).

Always-on memory and inline skills are required. If these and the packet overhead exceed
the budget, the command fails with an actionable message. Other whole documents are added
in deterministic relevance order when they fit. The output includes source paths, evidence
status, and the number of omitted relevant items. `--explain` adds selection reasons.

The ceiling applies to the **complete emitted Markdown or JSON**, including wrappers and
metadata. Counts remain estimates at four characters per token, not model tokenizer
counts. A small budget can omit relevant material; inspect the omissions and raise it when
needed. Stale or unverified notes are labeled and may still be useful as leads.

Active vault projects receive generated startup instructions explaining this command.
Use `npx --no-install wondev ...` when the executable is installed locally. The public API
supports the same workflow without launching a subprocess:

```ts
import { loadProjectContext, inspectFreshness, selectContext } from 'wondev';

const { project } = await loadProjectContext(root); // honors the configured skill profile
const freshness = await inspectFreshness(root, project.memory);
const packet = selectContext(project, { task: 'fix refresh tokens', budget: 4000 }, freshness);
```

The existing `index.budget` remains a separate limit on always-on memory bodies. It is not
a measure of a particular host's entire runtime context. Host-specific skill activation,
cached context, and tool output are outside the compiler's control.

## Verify memory against evidence

After actually reviewing the relevant code and checks:

```bash
wondev memory verify module-auth --against "Reviewed session.ts and ran authentication tests"
wondev memory stale
wondev memory stale --json
wondev build
```

Verification records the note's claims, the matching evidence files and their checksums,
the date, and your description of the check. Changes to a note's claims or metadata,
modified evidence, additions, and deletions mark it stale. Moving a note with a stable ID
does not by itself invalidate the record. A historical `verified` date without a fingerprint
record is reported as unverified.

Evidence patterns are repository-relative and support `*`, `**`, `?`, `{a,b}`, and `!`
exclusions. Character classes and platform-specific separators are not supported. Each
positive evidence pattern must match at least one file when recording verification.
Dependency, Git, Obsidian settings, and wondev state directories are excluded from scans;
symlinks are not followed. A note cannot count itself as evidence. Prefer precise code and
test paths over `**`.

This is evidence-change detection and an explicit verification record. The CLI does not
run the described tests or infer whether a claim is true. A changed file means review is
needed; it does not establish that the note is wrong.

## Manage portable skills

Version 1.4 bundles eleven base skills and adds `agent check`, reversible skill/host
selection, native Codex resources, and optional plugin packaging. See
[base skills and agent selection](base-skills.md) for prerequisites and usage.

Skills can include Markdown references, executable scripts, binary assets, and templates:

```text
skills/review-auth/
  SKILL.md
  references/contracts.md
  scripts/check.mjs
  assets/schema.json
```

Native skill output preserves `license`, `compatibility`, `metadata`, and `allowed-tools`.
Resources are copied byte-for-byte without generated Markdown headers. Hidden bookkeeping
files and pending `.new` files are excluded. wondev never executes these scripts during a
build. Other target engines expose source references or rule files according to their
capabilities; `wondev targets --verbose` describes the actual compiler behavior.

```bash
wondev skills validate
wondev skills eval trigger-cases.json
```

```json
[
  { "task": "investigate a failing login test", "expected": ["debugging"] },
  { "task": "write a release announcement", "expected": [], "forbidden": ["review-auth"] }
]
```

Cases may include `files`. Evaluation tests wondev's deterministic selector and exits
nonzero for missing expected or selected forbidden skills. Native host models can choose
skills differently. Validation checks portable naming, directory identity, description,
and standard metadata requirements; it does not execute skill procedures.

Profiles select which skills are available:

```yaml
profile: backend
profiles:
  backend:
    skills: [debugging, writing-tests, "api-*", "!api-legacy"]
  review:
    skills: [code-review, verify-before-done]
```

Use `--profile review` on build, check, context, list, or skill validation/evaluation to
override the configured profile. A build updates the usual output paths and retires skills
excluded by that profile. Check with the same profile. Profiles do not change host tool
permissions or model configuration.

## Install and update skill packs

A local or npm pack is an ordinary package with skills included in its published files:

```json
{
  "name": "@your-team/backend-skills",
  "version": "1.0.0",
  "files": ["skills"],
  "wondev": { "skills": "skills" }
}
```

```bash
wondev skills install local:packs/backend --dry-run
wondev skills install local:packs/backend
wondev skills install npm:@your-team/backend-skills@1.0.0

wondev skills update @your-team/backend-skills --source npm:@your-team/backend-skills@1.1.0 --dry-run
wondev skills update @your-team/backend-skills --source npm:@your-team/backend-skills@1.1.0
wondev skills sync
```

`skills.lock.json` records exact resolved versions, package content checksums, and per-file
installation baselines. Updates use the declared source; specify `--source` to change a
pinned version. Sync fetches the exact locked npm version and rejects checksum differences
or local modifications. It can restore missing locked files. Local packs must still match
their locked content to sync.

Untouched files update automatically. Edited or intentionally deleted files are preserved;
incoming versions are offered under `.wondev/skill-updates/`, outside active skill sources.
Dry runs show changed paths, hashes, and before/after text for reasonably sized text files.
Unchanged obsolete resources are removed. Skill name collisions across packs or existing
unmanaged skills are refused. Commit your chosen local customizations along with the lock.

npm downloads run in a temporary directory with lifecycle scripts disabled, no binary
links, and no audit/funding requests. A project's package.json is not changed. Only explicit
install, update, or sync operations access npm; builds never download anything. Private
registries use the npm environment already configured on the machine. Pack transport adds no
runtime dependency. `WONDEV_NPM_CLI` can identify `npm-cli.js` on unusual installations.

## Capture results from several agents

Create a short JSON summary instead of storing a complete conversation:

```json
{
  "agent": "claude",
  "task": "Investigate session expiry",
  "outcome": "Found an inconsistent expiry check.",
  "decisions": ["Keep expiry validation in the session service."],
  "evidence": ["src/auth/session.ts", "npm test -- auth"],
  "failedAttempts": ["Changing only the UI timeout did not resolve expired sessions."],
  "next": ["Add coverage for refresh near expiry."]
}
```

```bash
wondev session record --input summary.json
wondev session propose <session-id> module-auth --input updated-auth.md
wondev session review <proposal-id>
wondev session apply <proposal-id> --review-hash <hash-from-review>
# Or:
wondev session reject <proposal-id>
```

Session records have unique IDs. A proposal contains the original note, the proposed note,
the expected source hash, and a review hash. JSON is its canonical record; its Markdown
companion is a review view usable in Obsidian. Editing a Markdown companion does not change
the proposal. Changing the canonical proposal changes its review hash.

Apply requires the reviewed hash and refuses if another writer changed the note after the
proposal was created. Applying the same unchanged proposal again is safe. An interrupted
application can resume when the note already equals the proposed version. Applying updates
regenerates outputs unless `--no-build` is supplied. The changed memory must still be checked
against evidence before recording a fresh verification.

Cooperating wondev writers serialize changes with `.wondev/.lock`. A competing operation
waits briefly, then reports contention. Locks are never removed merely because they are old.
After a crash, verify the writer has stopped before removing a leftover lock. External
editors do not participate in this lock; expected-hash checks catch edits observed before
application. Avoid simultaneous manual editing of the note being applied.

## Compatibility and checks

### Make development experience available to the next agent

wondev stores application knowledge in the **consuming application's repository**, not inside
`node_modules/wondev`. Reinstalling wondev does not discard that knowledge. Committing the
sources makes the same reviewed lessons available to teammates and other configured agents.
Reusable development procedures live in skills; use the existing versioned skill-pack
workflow to share general procedures across projects.

The starter `learn` command guides agents through this loop, including improving an existing
skill when supported by evidence. It is available as `/learn` on targets with native commands
and as a named prompt on flattened targets. Existing installations receive it through
`wondev upgrade` followed by `wondev build`.

The working loop is: retrieve relevant context → inspect current evidence → implement and
test → record the result → review a durable lesson or update → retrieve it on the next task.
wondev does not change model weights or guarantee that a host follows instructions. Agent
entry guidance describes this loop for vaults and projects using map/lesson notes. Retrieval
remains deterministic and local; no transcript collection or background model call occurs.

After `session record` returns a session ID:

```bash
wondev session learn <session-id> auth-expiry --files "src/auth/**"
wondev session review <proposal-id>
wondev session apply <proposal-id> --review-hash <hash-from-review>
wondev memory verify auth-expiry --against "Inspected the expiry check and reran its regression test"
wondev build

# A later task, potentially handled by a different agent:
wondev context --task "debug login expiry" --files src/auth/session.ts --budget 4000 --explain
```

`learn` creates a pending proposal for `memory/lessons/auth-expiry.md`, retaining the task,
outcome, decisions, failed attempts, evidence, and next actions from the session. The lesson
does not enter active memory until the reviewed proposal is applied. It keeps session/agent
provenance, explicit file scope, and evidence patterns. Reviewing applicability is essential:
an approach that failed under one set of conditions is not forbidden universally, and next
actions remain pending work. A successful apply creates an **unverified**, on-demand lesson;
verification is a separate claim about the actual checks performed.

Prefer updating an existing related note with `session propose` when it already covers the
subject. For a repeatable procedure, curate a skill with a precise trigger, prerequisites,
steps, expected result, and exceptions. A single successful session is not enough evidence
to rewrite a shared skill automatically. Test its selection together with application memory
using the evaluation below. New vaults include a lesson template and a Development lessons
dashboard view; existing vault dashboards remain user-owned and can add a `kind == "lesson"`
view manually.

### Evaluate what the agent will actually receive

Create a project-owned `context-cases.json` with known tasks and expected/forbidden items:

```json
[
  {
    "task": "debug login expiry",
    "files": ["src/auth/session.ts"],
    "budget": 4000,
    "format": "json",
    "expected": { "memory": ["auth-expiry"], "skills": ["debugging"] },
    "forbidden": { "memory": ["billing-overview"] }
  }
]
```

Use actual active memory IDs and skill names in your application; unknown/inactive IDs,
profile-excluded skills, and contradictory expectations fail validation.

```bash
wondev context eval context-cases.json
wondev context eval context-cases.json --profile backend
```

Evaluation uses the same memory, skills, graph expansion, and complete packet token estimate
as `context`, at the case's budget (default 4000). It reports selections, missing items,
forbidden activations, token usage, and overflow errors, and fails the command if any case
fails. It tests context selection, not the model's reasoning quality or native host skill
activation. Keep representative positive and negative cases from real development tasks.

### Require current knowledge in CI

```bash
wondev check --freshness stale
wondev check --freshness strict --files src/auth/session.ts,test/auth.test.ts
```

`stale` fails on changed previously verified memory. `strict` additionally fails on
unverified memory. Both ignore draft/archived notes. `--files` scopes the freshness gate to
matching evidence/globs, directly edited notes, and all always-on memory; include deleted
paths as well. It does not scope the usual generated-output drift check. Without these
flags, existing `check` behavior is unchanged. Strict mode requires evidence-backed
verification for the included starter notes as well. A rebuild updates generated files but
cannot satisfy a failed freshness gate; review and verify the actual source claims.

### Compatibility

Existing projects keep source schema 1 and their default paths. All features are additive;
moving to a vault is explicit. Resource headers change for skill attachments, so this is a
minor release under wondev's output-version contract. Rebuild and commit generated changes
when upgrading. No automatic semantic merge, embeddings, background model calls, host
settings ownership, or MCP configuration is introduced.

Commit sources, configuration, verification records, pack locks, template provenance, and
the usual generated-file manifest, plus map baselines when mapping is used. Commit session records according to your project's
retention policy. Exclude transient `.lock` and review-offer scratch files as appropriate.
Do not commit private credentials in memory or skill resources.

The formats follow [Obsidian internal links](https://obsidian.md/help/links),
[Bases syntax](https://obsidian.md/help/bases/syntax), and the
[Agent Skills specification](https://agentskills.io/specification).

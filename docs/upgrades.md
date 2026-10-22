# Upgrade, diagnose, and reconcile existing projects

## Upgrade a tracked starter

```bash
npm install --save-dev wondev@1.5.0
npx wondev upgrade --dry-run
npx wondev upgrade
npx wondev build
npx wondev check
```

Edited starter files remain yours; an upstream change is offered in a `.new` file.
Review those offers before committing. Build still refuses real edits to generated output.
The source schema remains 1.

## Add bundled skills after adopt

Adopted projects do not have a starter baseline. `upgrade` cannot infer which authored
files came from a starter. Add the bundles you want explicitly:

```bash
npx wondev skills catalog
npx wondev skills install bundled:understand-anything --dry-run
npx wondev skills install bundled:understand-anything
# Or explicitly choose all eleven bundles:
npx wondev skills install bundled:all
```

The installer respects configured source paths, copies resources without executing them,
and refuses conflicting existing files. A repeated identical install is harmless.
Selective provenance restricts later `upgrade` runs to those skills; it does not insert
unrelated starter memory into your adopted project. `--no-build` leaves rebuilding to you.
If an existing skill already uses a selected name, keep or rename it before installing.

## Windows line endings

Generated text and Markdown skill references compare LF and CRLF as the same content.
Legacy manifests with either spelling remain readable. This does not ignore changes to
words, whitespace within lines, or binary resources. Resource copies retain their bytes;
the comparison policy does not rewrite authored attachments.

A repository may still choose `* text=auto eol=lf` in its own `.gitattributes`, with binary
or byte-sensitive resource exceptions. Wondev does not rewrite repository-wide Git policy.
Non-Markdown attachments are byte-preserved resources, including scripts and data files;
use `-text` attributes for those paths if Git conversion must be disabled.

## Check whether teammates will receive output

```bash
npx wondev doctor --git
npx wondev check --git
```

The ownership manifest records what wondev may manage. Git's index records what is staged
or tracked for distribution. These are independent: a generated `.agents/` directory can
be correctly built yet ignored by Git.

`doctor --git` reports tracked, untracked, ignored, and missing outputs, including the
ignore rule responsible. `check --git` fails unless generated output and
`.wondev/.manifest.json` are present in the Git index. It does not stage files, change
ignore rules, or verify a commit/push. It checks output distribution, not every input or
application dependency. A project that intentionally regenerates output in CI can keep
using plain `check`. The optional Git check needs Git and a working tree.

## Reconcile an existing Obsidian vault

New empty destinations still use `wondev vault knowledge`. For a legacy vault and a
separate `.wondev/memory`, start with a preview:

```bash
npx wondev vault reconcile knowledge
npx wondev vault reconcile knowledge --json
```

The preview compares the active memory source with `knowledge/memory`, or loose notes
under `knowledge` when it has no `memory` directory. Hidden paths, root `index.md` and
`review.md`, templates, dashboards, skills, commands, agents, and sessions are excluded
from the loose-note import. Use a dedicated project knowledge directory, not a general
personal vault.

The report includes source/vault titles and paths, identical duplicates, conflicts,
destination paths, link validation, and a hash of the proposed changes. Stable ids and
normalized filename identities match copies; ambiguous identities block migration.
Human filenames, titles and metadata are retained. Real note links and `related` links
are rewritten while code examples stay intact. No prose conflict is merged automatically.

Resolve each conflict by destination path in a project-local JSON file:

```json
{
  "knowledge/memory/Architecture.md": "vault",
  "knowledge/memory/runbook.md": "source"
}
```

```bash
npx wondev vault reconcile knowledge --resolutions vault-choices.json
# Copy the hash from this new preview:
npx wondev vault reconcile knowledge --resolutions vault-choices.json --apply --review-hash <hash>
npx wondev build
npx wondev check
```

Unresolved conflicts, invalid links, or a stale review hash block application. Conflicting
resources need manual reconciliation. Matched notes that move directories and have
resource links also need review. Original files and configuration are backed up under
`.wondev/vault-backups/<hash>/files/`, with a change list in `plan.json`. After the files
are ready, configuration switches to one active memory source at `knowledge/memory`.
Duplicate original memory files are removed; their backup copies are outside the vault.
Skills, commands, agents, and sessions keep their existing configured paths.

The backup is an archive, not another active source. For manual recovery, restore the
listed originals from `files/` to their project-relative paths and the saved configuration,
then rebuild. Review files marked `create` before removing any new destination copies.
Avoid overwriting work authored after migration. External links, vault navigation files,
and outstanding session proposals may still reference old paths; review them separately.

## Describe a mixed-language workspace honestly

```yaml
# .wondev/wondev.yaml
map:
  roots:
    web: apps/web
    api: services/api
    worker: services/worker
  exclude:
    - "apps/web/generated/**"
```

```bash
npx wondev map --dry-run --json
npx wondev map
```

The report lists parsed files, parse errors, packages, and unsupported source files for
each configured service. `.wondev/map-coverage.json` records that report after refresh.
Roots must be project-relative, nonoverlapping directories; use `.` to scan the project.
CLI `--exclude` patterns extend configured exclusions.

Native relationships cover JS/TS literal imports and package declarations. Python, Go,
Rust, Java, PHP and other recognized source extensions are inventoried, not parsed into
relationships. Unknown extensions and excluded directories are not a completeness
guarantee. Unresolved imports include external packages and aliases, not only failures.
HTTP/RPC, queues, database relations, runtime calls and cross-language behavior belong in
curated memory with evidence.

| Tool | Role in the project |
| --- | --- |
| wondev map | Local observed JS/TS/package facts, coverage report, and refreshable notes with preserved curated understanding |
| [Graphify](https://github.com/Graphify-Labs/graphify) | Separate queryable graph/index; inspect its supported inputs and edge evidence for the question at hand |
| [Understand Anything](https://github.com/Egonex-AI/Understand-Anything) | Separate interactive graph and exploration workflow; wondev bundles a bridge and runtime setup instructions |
| Active vault | The shared authored facts, decisions, runbooks and reviewed lessons that agents actually use |

`.claude/skills` and `.agents/skills` are intentional outputs for different hosts from one
authored source. Two independently maintained memory directories are a different problem;
reconciliation establishes one active memory library. A bridge without its optional full
runtime is not evidence that the upstream integration is broken.

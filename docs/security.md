# Security model

## Threat model

wondev reads `.wondev/`, writes generated files across the repository, and **deletes** files
it previously wrote. It is routinely run against freshly cloned repositories.

That makes the trust boundary sharp: **everything under `.wondev/` is untrusted input**,
including `.wondev/.manifest.json`, which wondev wrote itself. A repository is data supplied
by whoever authored it, and `.wondev/` is committed like any other directory.

The attacker is assumed to control the full contents of a repository the user clones. They
do not control the user's wondev installation or command-line arguments.

## What wondev does not do

Verified by inspection of `src/`, and asserted in `test/security.test.ts`:

- **No process execution.** No `child_process`, no `exec`, no `spawn`, no shell anywhere.
- **No dynamic evaluation.** No `eval`, no `new Function`.
- **No network access**, except `wondev doctor --online`, which requests one npm registry
  URL and only when that flag is passed. A test asserts `fetch` is never called otherwise.
- **No credentials, no telemetry, no postinstall script.**

## Boundaries that are enforced

### Writes and deletes stay inside the project

Two independent checks, because each defeats a different attack:

1. **Lexical** — `isInsideRoot` rejects absolute paths, drive-qualified Windows paths, and
   anything normalising to `../`. Applied to every configured target path and every
   generated output path.
2. **Resolved** — `createRootGuard` resolves each output directory through symlinks and
   confirms it still lands inside the project.

The second exists because the first is not sufficient. A repository can contain a directory
symlink, and git preserves symlinks on clone. A repository shipping `.claude -> ~/.ssh`
passes any lexical check while every write lands in the user's SSH directory. Combined with
attacker-controlled memory content, that is a write-what-where primitive against a file like
`authorized_keys`.

### A command argument cannot direct deletion outward

`wondev remove <type> <name>` builds a path from `name` and deletes it, which makes it the
only place besides the manifest where untrusted text becomes `fs.rm`. A name containing `..`
or an absolute path is refused before anything is resolved, and the resolved path is checked
again against the directory it came from before the delete.

This was a real defect, not a hypothetical: between 0.8.0 and 0.9.9,
`wondev remove memory ../../../notes` deleted a file outside the project, and the skill form
removed an entire directory tree recursively. Both reported success. Fixed in 0.9.10.

The reason it matters beyond a typo: wondev exists to be used by agents, and an agent
constructing a command from repository content is the ordinary case, not an exotic one.

### Reads stay inside the project too

`wondev adopt --vault <dir>` copies what it reads into `.wondev/`, which is committed. A
vault outside the project is refused, so a mistyped path cannot land external content — a
credentials file, anything — in git. A vault that genuinely lives elsewhere is copied in
deliberately first.

### The manifest cannot direct deletion outward

`.wondev/.manifest.json` lists paths wondev will delete on `clean`, and on any build that
sweeps stale output. A crafted entry such as `../../.ssh/authorized_keys` would otherwise
make cloning a repository and running `wondev clean` delete arbitrary files.

`loadManifest` rejects the whole file if any entry escapes the project, rather than quietly
dropping the bad entry: wondev never writes such a path, so its presence means tampering and
deserves a loud failure. `removeOwned` — the only function in wondev that deletes — repeats
both checks regardless of caller.

### Formats from the future are refused, not guessed

A source schema or manifest version newer than the running build is rejected with a message
naming the versions. An older build that tried to interpret a newer format could delete
files it does not understand.

## Denial of service

- **Regex backtracking.** The lazy quantifiers in the frontmatter and managed-region
  patterns are anchored and non-nested. Measured linear on 2 MB of pathological input;
  asserted in tests with a time bound.
- **YAML expansion.** Alias-bomb input is rejected without hanging.
- **Descriptor exhaustion.** File I/O runs through a bounded-concurrency map rather than an
  unbounded `Promise.all`, so a project with thousands of files cannot exhaust the
  descriptor table.

## Integrity of writes

Every write goes to a uniquely named sibling temp file and is then renamed into place. An
interrupted build cannot leave a truncated file, and concurrent writes cannot interleave.

When an output path is an existing symlink, the rename **replaces the link** rather than
writing through it, so the link target is not modified.

## Deliberate residual risks

- **Generated content is trusted by the agent that reads it.** wondev compiles whatever
  `.wondev/` says into files AI agents treat as instructions. A hostile repository can
  therefore instruct an agent, exactly as a hostile `CLAUDE.md` or `AGENTS.md` could without
  wondev. wondev neither adds nor removes this risk; review `.wondev/` in an unfamiliar
  repository as you would review any agent instructions.
- **Region mode reads an existing file before rewriting it.** If a user has replaced
  `CLAUDE.md` with a symlink to a sensitive file, its contents are read and written back
  into the repository. No data leaves the machine, and the rename does not modify the link
  target, but the content becomes visible in the working tree.

## Reporting

Open a GitHub issue for anything found here. There is no separate embargo process for a tool
of this size; please do include a reproduction.

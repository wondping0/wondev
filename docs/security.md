# Security model

## Threat model

wondev reads configured source directories and `.wondev/`, writes generated files across
the repository, and **deletes** files it previously wrote. It is routinely run against
freshly cloned repositories.

That makes the trust boundary sharp: **configured sources and everything under `.wondev/`
are untrusted input**, including `.wondev/.manifest.json`, which wondev wrote itself. A
repository is data supplied by whoever authored it, and these files are committed like
any other directory. Downloaded skill packs are also untrusted content.

The attacker is assumed to control the full contents of a repository the user clones. They
do not control the user's wondev installation or command-line arguments.

## What wondev does not do

- **No source execution during builds.** Skill scripts are copied as resources, never run.
  Explicit npm skill-pack install/update/sync commands invoke the installed npm CLI using
  an argument array without a shell. Downloads use an isolated temporary directory with
  lifecycle scripts, binary links, audit, and funding requests disabled. They do not alter
  the project's package.json. The npm transport integration test includes a failing
  postinstall script to verify that package lifecycle scripts are not executed.
- **No dynamic evaluation.** No `eval`, no `new Function`.
- **No network access during builds or local-pack operations.** Network access is limited
  to explicit npm pack operations and `wondev doctor --online`. npm uses the user's existing
  registry configuration, which can include credentials for private registries.
- **No credential collection, telemetry, or wondev postinstall script.**

## Boundaries that are enforced

### Writes and deletes stay inside the project

Two independent checks, because each defeats a different attack:

1. **Lexical** — `isInsideRoot` rejects absolute paths, drive-qualified Windows paths, and
   anything normalising to `../`. Applied to every configured target path and every
   generated output path.
2. **Resolved** — `createRootGuard` resolves parent directories and existing leaf symlinks
   and confirms they still land inside the project. Sources, state, and generated files
   are checked at their read/write boundaries.

The second exists because the first is not sufficient. A repository can contain a directory
symlink, and git preserves symlinks on clone. A repository shipping `.claude -> ~/.ssh`
passes any lexical check while every write lands in the user's SSH directory. Combined with
attacker-controlled memory content, that is a write-what-where primitive against a file like
`authorized_keys`.

### A command argument cannot direct deletion outward

`wondev remove <type> <name>` builds a path from `name` and deletes it. A name containing `..`
or an absolute path is refused before anything is resolved, and the resolved path is checked
again against the directory it came from before the delete.

This was a real defect, not a hypothetical: between 0.8.0 and 0.9.9,
`wondev remove memory ../../../notes` deleted a file outside the project, and the skill form
removed an entire directory tree recursively. Both reported success. Fixed in 0.9.10.

The reason it matters beyond a typo: wondev exists to be used by agents, and an agent
constructing a command from repository content is the ordinary case, not an exotic one.

### The HTML guide cannot be made to execute

`wondev build` can produce a page opened in a browser, from content the threat model calls
untrusted. Everything is escaped before any markup is produced, so a document containing
HTML is displayed rather than run.

Escaping alone was not enough for links. A `javascript:` target escaped perfectly and still
produced a working link; link schemes are now allowlisted and anything else renders as inert
text. Fixed in 0.9.11.

The page also loads nothing — no script `src`, `<link>`, `@import`, or `url()` — so opening
it makes no network request. The one script it carries is inline, and the page works with it
blocked.

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
deserves a loud failure. `removeOwned`, which deletes generated output, repeats both checks
regardless of caller. Skill-pack updates only remove individually owned, unchanged files
after validating their paths and checking their installation baselines.

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

Source updates, generated files, and state records use sibling temporary files followed by
rename, so an interrupted file replacement cannot leave truncated content. Cooperating
writers serialize shared mutations with `.wondev/.lock`. A multi-file operation is not a
filesystem transaction; a crash can leave a partially completed operation that needs a
rerun. Reviewed memory proposals record their progress so application can resume safely.
New lesson and map files are published from complete sibling temporary files using an
exclusive hard link; an existing destination is never overwritten by creation. Map refreshes
check generated-region baselines and preserve authored frontmatter and curated prose.

Application mapping parses syntax without executing application code, compiler plugins,
or package scripts. It skips symlinks, limits scanned input, and reports unsupported syntax
instead of inventing relationships. A session lesson is only activated after reviewed-hash
application and remains unverified until an explicit evidence check.

An existing symlink that resolves outside the project is refused before it is read or
written. For an allowed in-project output symlink, atomic rename replaces the link rather
than writing through it.

## Deliberate residual risks

- **Generated content is trusted by the agent that reads it.** wondev compiles whatever
  configured sources say into files AI agents treat as instructions. A hostile repository can
  therefore instruct an agent, exactly as a hostile `CLAUDE.md` or `AGENTS.md` could without
  wondev. Review source notes and skill packs as you would review any agent instructions.
- **External editors do not participate in the project lock.** Expected-hash checks detect
  observed changes, but cannot make simultaneous manual edits or hostile filesystem swaps
  atomic. Path guards are not an operating-system sandbox against another process actively
  replacing directories during an operation.

## Reporting

Follow the private reporting process in [SECURITY.md](../SECURITY.md), and include a
reproduction.

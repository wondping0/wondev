# Releasing wondev

Version 1.3.0 adds application maps, reviewed development lessons, joint memory/skill
evaluation, and optional freshness gates. See [the usage guide](knowledge.md) and [changelog](../CHANGELOG.md).

## Verify the release candidate

Run from a checkout with dependencies installed:

```bash
npm run verify
npm run test:package
npm run test:upgrade
npm run test:upgrade:previous
git diff --check
```

`verify` checks types, builds the package, and enforces coverage thresholds. The package
smoke test installs the real tarball into a fresh application and exercises the shipped
CLI. The upgrade smoke test installs published 1.1.1, makes user changes, installs the
candidate, and checks the documented upgrade and vault-conversion workflows. CI and release
also run these upgrade checks against the previous knowledge release, 1.2.0.

CI runs the verification matrix on Node 20/22 across Windows, macOS, and Linux. Package
and upgrade smoke tests run on all three platforms with Node 22. Local success does not
replace these hosted results.

Inspect the artifact before publishing:

```bash
npm pack --dry-run --json
```

The package ships compiled code and declarations, starter templates, the knowledge guide,
README, and license. It should not contain tests, coverage reports, working-project memory,
credentials, or temporary directories. Keep the generated-output compatibility notes in
the changelog; users of 1.1.1 must rebuild their generated files after upgrading.

The ignore template is packaged as `templates/gitignore` because npm can omit or rename
`.gitignore`. Initialization and upgrade install it as `.wondev/.gitignore`, and template
provenance uses that logical filename. Both smoke tests check the installed result.

## Publisher configuration

The npm package must have a trusted publisher configured for repository `wondping0/wondev`
and workflow `release.yml`. The workflow does not create that account setting. Check it at
the package's [access settings](https://www.npmjs.com/package/wondev/access) if an OIDC
publication fails. Do not print npm configuration or tokens in logs.

Keep `NODE_AUTH_TOKEN` unset for this workflow. Its setup-node registry configuration can
create a placeholder `_authToken` entry; the cleanup step removes that entry before npm
tries OIDC. The workflow pins its Node version and npm range for this publishing path.
Changing to token authentication is a separate workflow change, not a fix to apply blindly
after an authentication failure.

The historical first-publish token should be reviewed and revoked by its owner once trusted
publishing is confirmed. This repository does not track or establish its current status.

## Publish the reviewed commit

The repository's release mechanism is `.github/workflows/release.yml`. A pushed `v*` tag
starts it. Use the tag for the package.json version only after the reviewed commit's CI is
green. For the 1.3.0 release:

```bash
git tag -a v1.3.0 -m "wondev 1.3.0"
git push origin v1.3.0
```

Pushing this tag publishes publicly to npm if verification succeeds. The workflow uses
npm trusted publishing through GitHub OIDC; it does not need a local npm token. It checks
the tag against package.json and runs verification, the installed-package smoke test, and
the published-baseline upgrade test before publishing.

Do not move a published version tag to another commit. If publishing fails, inspect the
failed run and npm registry state before deciding whether to rerun the same tag or prepare
a new version.

After the workflow succeeds, verify the registry record:

```bash
npm view wondev@1.3.0 version dist.integrity --json
npm view wondev dist-tags --json
```

## Upgrade an application

```bash
npm install --save-dev wondev@1.3.0
npx wondev migrate
npx wondev upgrade
npx wondev build
npx wondev check
```

Review any `.new` offers and generated-file changes before committing them. Existing source
paths remain the default. To adopt the active vault afterward, run `npx wondev vault knowledge`,
then build and check again. `knowledge/` must not already exist for this conversion command;
the [guide](knowledge.md) describes configuring an existing vault directly.

## Schema changes and release history

When `SOURCE_SCHEMA_VERSION` changes, add a migration in `src/core/migrate/index.ts`, freeze
an old-schema fixture, and test migration through a successful build/check. Old schemas
must be refused by build/check with guidance to run migrate. An automatic migration can
ship in a minor release; a change requiring manual intervention needs a major release.
The complete rules are in [the versioning contract](versioning.md).

Version 0.1.0 was published manually on 2026-08-10 before tag automation. There is no
`v0.1.0` release tag; do not backfill it, because that would start the publishing workflow
for an existing npm version. Tag history starts at `v0.1.1`.

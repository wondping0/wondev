# Contributing

## Getting set up

```bash
npm ci
npm run verify   # typecheck, build, then 191 tests
```

`npm run verify` is the same pipeline CI runs. If it passes locally it will pass there.

## The one rule that catches people

**A change to generated output is never a patch release.**

Renderers are pure functions, so editing one changes the bytes in every project that
upgrades — and those projects run `wondev check` in CI. A reworded heading shipped as a
patch turns every downstream pipeline red at once.

The golden tests tell you when this applies. If `test/fixtures/golden/` shows a diff, your
change affects real users' files. That is fine, it just has to be deliberate and land in a
MINOR release. Regenerate and **read the diff** before committing it:

```bash
UPDATE_GOLDEN=1 npx vitest run test/golden.test.ts
git diff test/fixtures/golden
```

Never regenerate goldens to make a red test go green without looking at what changed.

## Adding support for a new agent

Most agents need no code at all. Add an entry to `BUILTIN_TARGETS` in
`src/core/registry.ts` with the right engine, and set `addedIn` to the next version.

Before you do, **verify the output path against that tool's own documentation** and say
where you checked it in the pull request. A wrong path fails silently: wondev writes a file
nothing reads, and everything looks like it worked.

New engines are a bigger change. The `Target` union is exhaustively checked, so the compiler
will point you at every place that needs updating.

## Tests

- Put behaviour tests next to the behaviour: `test/writer.test.ts`, `test/render.test.ts`.
- Anything touching paths, deletion, or untrusted input belongs in `test/security.test.ts`.
- Prefer testing through the public function over reaching into internals.
- If a branch cannot happen yet — a deprecation that does not exist, a schema version that
  has not shipped — extract it into a pure function and test it with synthetic input. A
  branch first exercised on the day it matters is a branch nobody has checked.

## Style

Follow the surrounding code. A few conventions worth stating:

- Comments explain **why**, never what. If a line needs a comment to say what it does,
  rename something instead.
- Errors get a message and, where there is a next step, a `hint`. The message says what is
  wrong; the hint says what to do.
- Keep `src/core/render/` pure. All filesystem risk lives in `src/core/writer.ts`, which is
  small enough to audit line by line, and that is worth preserving.

## Pull requests

Say what changed, why, and how you verified it — with the command output, not a summary.
Small and focused beats large and comprehensive.

## Reviewing target paths

Every built-in target writes to a path some other vendor controls, and vendors move them.
Windsurf's documentation already shows `.devin/` taking precedence over `.windsurf/`.

This is the only failure mode wondev has no symptom for. When an agent moves its config
location, wondev keeps writing the old path, `build` reports success, `check` stays green,
and the file is simply never read again. Everything looks like it worked.

There is no way to detect this automatically — wondev cannot know a path it was never told
about. So it is a review task, and the registry records when each one was last done:

```ts
// src/core/registry.ts
cursor: {
  target: { engine: 'rule-dir', path: '.cursor/rules', ext: '.mdc' },
  pathVerified: '2026-08-11',   // checked against Cursor's own documentation on this date
  ...
}
```

`wondev targets --verbose` shows these, including how many have never been checked, so the
gap is visible rather than assumed away.

**When reviewing:** open the vendor's current documentation, confirm the path and file
extension, then set `pathVerified` to today. If the path moved, add a `deprecated` record
pointing at the replacement rather than editing the old one away — projects still have files
at the old location, and `wondev migrate` is what moves them.

Do not set `pathVerified` because the tests pass. The tests check wondev's own behaviour;
they cannot check what a vendor decided last month.

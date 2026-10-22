# Full Understand Anything runtime

Upstream: https://github.com/Egonex-AI/Understand-Anything
Reviewed revision: `b8c807c632743ab695ec43cb654a0f1efe216bc8`.

The default wondev skill works with local memory immediately. Graph analysis and the
dashboard require the actual upstream runtime. Installation downloads dependencies and
builds upstream code; do it when the user requests that capability, not during wondev init.

Check Git, Node >=22, and pnpm >=10. From the application root, with an unused destination:

```sh
git clone --no-checkout https://github.com/Egonex-AI/Understand-Anything.git .wondev/tools/understand-anything
git -C .wondev/tools/understand-anything checkout --detach b8c807c632743ab695ec43cb654a0f1efe216bc8
```

From `.wondev/tools/understand-anything/understand-anything-plugin`, run:

```sh
pnpm install --frozen-lockfile
pnpm --filter @understand-anything/core build
```

Check `git rev-parse HEAD` in the checkout and re-run the skill's `scripts/runtime.mjs`.
For an existing installation, set `UNDERSTAND_ANYTHING_ROOT` to its absolute
`understand-anything-plugin` directory. The probe also checks `CLAUDE_PLUGIN_ROOT`
and the upstream installer's `~/.understand-anything/repo` location. A file check is
not proof that every language parser or optional integration works; validate actual output.

The pinned procedure refers to scripts and agent prompts inside that checkout; copying
its SKILL.md alone will not work. Use `skills/understand-dashboard/SKILL.md` there for
the dashboard. Native host installation is optional: follow the upstream README's
Claude, Codex, Cursor, or other platform section if native slash commands or hooks are
needed. Wondev does not translate hooks or modify global agent configuration.

This revision is pinned deliberately. To use a newer revision, review its installation
requirements and set `UNDERSTAND_ANYTHING_ROOT` to the reviewed checkout. Do not silently
replace a user's existing runtime or fall back from a frozen lockfile to an unlocked install.

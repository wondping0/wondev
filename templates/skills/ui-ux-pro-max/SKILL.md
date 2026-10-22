---
name: ui-ux-pro-max
description: Use when designing or reviewing interfaces, layouts, typography, palettes, accessibility, charts, or responsive UI components.
license: MIT; see LICENSE.txt
metadata:
  requirements: Python 3 for local search; no API key or Python packages required.
  upstream: https://github.com/nextlevelbuilder/ui-ux-pro-max-skill
  revision: 623a9a9037d006ea727f8213f084d02a6b6f11b5
  distribution: wondev-portable-instructions-with-upstream-data-and-scripts
---

# UI UX Pro Max

The upstream Python search engine and design data are bundled next to this file.
Resolve `scripts/search.py` **relative to this SKILL.md**, then use its absolute path
in commands. This works from a native skill, a plugin, or the configured wondev vault.
Do not assume `.claude/skills` or the shell's current directory is the skill directory.

1. Read the existing UI and identify its stack, design conventions, audience, and task.
   Preserve established product choices unless the request calls for changing them.
2. Check `python --version` (or `python3`, or Windows `py -3`). Use Python 3.
   Missing Python is a prerequisite to report; do not pretend a search ran.
3. Search with 2–5 terms expressing one dominant intent. For a new page or design
   system, run `python <skill-dir>/scripts/search.py "saas dashboard" --design-system`.
   For a focused issue use, for example, `"keyboard focus" --domain ux`,
   `"fintech" --domain color`, or `"line chart" --domain chart`.
   Use `--stack react` (or the detected supported stack) in a separate query.
   Run `--help` for available domains and stacks; quote paths containing spaces.
4. If no relevant match exists, retry once with simpler terms, then disclose that
   the advice is general rather than a database result. Do not invent search results.
5. Implement the chosen design in the project's existing framework. Check keyboard
   navigation, focus visibility, labels, contrast, reduced motion, responsive behavior,
   and loading/empty/error states relevant to the change. Use a real browser when available.
6. Record durable design decisions in the application's design system or wondev memory,
   with file evidence. Describe what was verified and any untested interactions.

To save a requested design system, use `--design-system --persist --output-dir
"<absolute-project-root>" -p "Project Name"`. Existing `MASTER.md` is preserved;
only use `--force` for an intentional replacement. Search alone writes no project files.
Font and icon catalogs contain references, not a grant to redistribute third-party assets;
the bundled data includes their provenance and license references.

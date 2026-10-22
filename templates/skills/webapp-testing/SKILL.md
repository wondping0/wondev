---
name: webapp-testing
description: Use when testing local web application interactions, browser rendering, responsive behavior, screenshots, or browser console errors with Playwright.
license: Apache-2.0; see LICENSE.txt
metadata:
  requirements: Python 3 plus Playwright and an installed browser, or the project's existing browser test runner.
  upstream: https://github.com/anthropics/skills/tree/main/skills/webapp-testing
  revision: dbd4588f9e1033efb41dad4bef2f7947c8993d44
  distribution: wondev-portable-adaptation
---

# Web application testing

Adapted by wondev from Anthropic's webapp-testing skill. The supporting Python examples
and server helper are unchanged upstream files; paths are relative to this SKILL.md.

1. Read the app's scripts and existing browser tests. Reuse its runner and assertions
   when present. Otherwise use Python Playwright after checking it and its browser are
   installed. Report missing prerequisites; don't treat an unavailable browser as a pass.
2. Use an existing local development server when available. If a server must be started,
   run `python "<skill-dir>/scripts/with_server.py" --help` for the bundled helper.
   Supply only known project commands. The helper waits for a port, not application
   readiness; wait for a visible page landmark before interacting. Manage the server with
   the host's process tools when reliable child-process cleanup is needed, especially
   on Windows. Stop only processes started for this task.
3. Inspect the rendered DOM, then choose accessible role/name locators. Wait for the
   relevant element or response; long-lived connections can make network-idle waits hang.
4. Exercise the changed behavior, an important failure state, and relevant viewport sizes.
   Capture console errors and a screenshot where visual evidence helps. Use the examples
   in `examples/` as starting points; replace their URLs, paths, and selectors for this app.
5. Assert outcomes instead of merely clicking through. Close browser contexts and owned
   processes. Report the tested environment, commands, failures, and anything untested.

For a project choosing Python Playwright, setup is `python -m pip install playwright`
and `python -m playwright install chromium` in its chosen virtual environment. These
download packages/browsers and are not part of wondev initialization.

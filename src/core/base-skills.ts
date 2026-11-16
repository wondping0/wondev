/** Bundled procedures, not an assertion that external runtimes are installed. */
export const BASE_SKILLS = [
  { name: 'ui-ux-pro-max', kind: 'bundled-upstream-resources', requires: 'Python 3', source: 'https://github.com/nextlevelbuilder/ui-ux-pro-max-skill', revision: '623a9a9037d006ea727f8213f084d02a6b6f11b5' },
  { name: 'understand-anything', kind: 'integration-bridge', requires: 'Full graph/dashboard: separate upstream checkout, Node 22+, pnpm 10+', source: 'https://github.com/Egonex-AI/Understand-Anything', revision: 'b8c807c632743ab695ec43cb654a0f1efe216bc8' },
  { name: 'webapp-testing', kind: 'adapted-upstream-skill', requires: 'Python 3 + Playwright + browser, or existing project test runner', source: 'https://github.com/anthropics/skills/tree/main/skills/webapp-testing', revision: 'dbd4588f9e1033efb41dad4bef2f7947c8993d44' },
  { name: 'motion-dev', kind: 'wondev-procedure', requires: 'Project using motion (or legacy framer-motion)', source: 'https://github.com/wondping0/wondev', revision: 'bundled' },
  { name: 'animejs', kind: 'wondev-procedure', requires: 'Project using animejs', source: 'https://github.com/wondping0/wondev', revision: 'bundled' },
  { name: 'shadcn-charts', kind: 'wondev-procedure', requires: 'React project using shadcn/ui and Recharts', source: 'https://github.com/wondping0/wondev', revision: 'bundled' },
  { name: 'agentic-implementation', kind: 'wondev-procedure', requires: 'Agent with project file access; vendor documentation for version-specific details', source: 'https://github.com/wondping0/wondev', revision: 'bundled' },
  ...['skill-discovery', 'context-maintenance', 'debugging', 'writing-tests', 'code-review', 'planning-work', 'git-workflow', 'verify-before-done'].map((name) => ({ name, kind: 'wondev-procedure', requires: 'Agent with project file access', source: 'https://github.com/wondping0/wondev', revision: 'bundled' })),
];

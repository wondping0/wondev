---
name: motion-dev
description: Use when adding or changing animation with Motion (motion.dev, formerly Framer Motion) — motion components, gestures, layout and exit animations, scroll-linked effects, springs, or the vanilla animate/scroll/inView functions.
license: MIT
metadata:
  requirements: A project that already depends on `motion` (or legacy `framer-motion`), or approval to add it.
  documentation: https://motion.dev/docs
  distribution: wondev-procedure
---

# Motion (motion.dev)

Written by wondev; not affiliated with Motion. It records durable usage patterns. APIs
move between major versions, so confirm against the installed version and
<https://motion.dev/docs> before relying on a detail below.

## Before writing code

1. Read `package.json`. `motion` is the current package; `framer-motion` is the legacy
   name with the same React API. Follow what the project already imports — do not mix
   both, and do not migrate package names as a side effect of an unrelated task.
2. Pick the entry point that matches the stack:
   - React: `import { motion, AnimatePresence } from "motion/react"`
   - React Server Components files: `import * as motion from "motion/react-client"`, or
     put the animated part in a `"use client"` component
   - Vanilla JS / any framework: `import { animate, scroll, inView, stagger } from "motion"`
   - Vue: the separate `motion-v` package
3. Check whether CSS alone is enough. A hover colour change or a simple fade is a CSS
   transition. Reach for Motion when you need springs, interruption, gestures, layout or
   exit animation, sequencing, or scroll linking.

## Core patterns (React)

```tsx
<motion.div
  initial={{ opacity: 0, y: 8 }}
  animate={{ opacity: 1, y: 0 }}
  exit={{ opacity: 0 }}
  transition={{ type: "spring", visualDuration: 0.3, bounce: 0.2 }}
/>
```

- **Exit animations** need `<AnimatePresence>` around the conditional, and every direct
  child needs a stable, unique `key`. The `AnimatePresence` itself must stay mounted.
- **Variants** name states once and propagate to children; use `staggerChildren` /
  `delayChildren` (or `stagger()`) on the parent transition for orchestration.
- **Gestures**: `whileHover`, `whileTap`, `whileFocus`, `whileDrag`, `whileInView`
  (`viewport={{ once: true }}` for one-shot reveals).
- **Layout**: `layout` animates size/position changes with transforms; `layoutId` shares
  an element between two components. Wrap siblings that affect each other in
  `<LayoutGroup>`. Layout animation distorts children with `border-radius`/`box-shadow`
  unless those are set through `style`.
- **Motion values**: `useMotionValue`, `useTransform`, `useSpring`, `useScroll` update
  the DOM without re-rendering React. Pass them through `style`, never read them into
  state inside a render loop.
- **Scroll**: `const { scrollYProgress } = useScroll({ target, offset })`, then
  `useTransform(scrollYProgress, [0, 1], [from, to])`.
- **Imperative**: `const [scope, animate] = useAnimate()` for sequences scoped to a
  subtree; selectors resolve inside `scope`.

## Core patterns (vanilla)

```js
animate(".card", { opacity: [0, 1], y: [16, 0] }, { delay: stagger(0.05) });
const stop = inView(".section", (el) => { animate(el, { opacity: 1 }); });
scroll(animate(".progress", { scaleX: [0, 1] }));
```

`animate` returns controls (`play`, `pause`, `stop`, `complete`, `cancel`, awaitable).
Keep the handle and stop it when the element or component is torn down.

## Rules

- Animate `transform` and `opacity`. Animating `width`, `height`, `top`, or `left`
  triggers layout on every frame; use `layout` or scale instead.
- Honour reduced motion: `useReducedMotion()` or `<MotionConfig reducedMotion="user">`.
  Replace movement with a fade or nothing; never remove the state change itself.
- Animation must not gate interaction. Content has to be reachable and usable if the
  animation never runs (no-JS, failed hydration, reduced motion).
- Keep UI motion short: roughly 150–300 ms for feedback, longer only for large spatial
  transitions. Prefer springs for things the user moves, tweens for opacity and colour.
- Bundle size: when it matters, use `LazyMotion` with the `m` component and a feature
  bundle (`domAnimation` or `domMax`) instead of the full `motion` component.
- Do not set `initial` values that differ from server-rendered markup in a way that hides
  primary content before hydration; use `initial={false}` when the first paint should be
  the final state.
- One animation system per element. Do not let Motion and a CSS transition or another
  library drive the same property.

## Common failures

| Symptom | Usual cause |
| --- | --- |
| Exit animation never plays | Conditional is outside `AnimatePresence`, or child has no `key` |
| "motion is not a function" / hooks error in Next.js App Router | Imported `motion/react` in a server component |
| Layout animation jumps | Parent scrolls or resizes without `layoutScroll` / `layoutRoot`, or sibling not in a `LayoutGroup` |
| Element stuck in `initial` state | `whileInView` target has zero size or is inside an `overflow` container not set as `viewport.root` |
| Janky scroll effect | Reading scroll position into React state instead of using motion values |

## Done when

- The animation works with keyboard and pointer, and under `prefers-reduced-motion`.
- Mount, update, interruption (trigger it mid-flight), and unmount were each exercised
  in a browser, not inferred from the code.
- No new layout shift or hydration warning appears in the console.

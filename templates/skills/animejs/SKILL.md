---
name: animejs
description: Use when adding or changing animation with Anime.js — animate calls, timelines, stagger, SVG drawing or morphing, scroll-triggered animation, draggables, or migrating Anime.js v3 code to v4.
license: MIT
metadata:
  requirements: A project that already depends on `animejs`, or approval to add it.
  documentation: https://animejs.com/documentation
  distribution: wondev-procedure
---

# Anime.js

Written by wondev; not affiliated with Anime.js. It records durable usage patterns. Check
the installed version and <https://animejs.com/documentation> before relying on a detail.

## Before writing code

1. Read `package.json` for the `animejs` major version. **v3 and v4 are different APIs.**
   Most tutorials and older answers show v3; do not paste v3 code into a v4 project.
2. Follow the version already installed. Upgrading a major version is its own task.
3. Check whether CSS alone is enough. Use Anime.js for timelines, staggering, SVG,
   scroll-linked sequences, or values that are not CSS properties.

## v4 shape

v4 is ES-module first with named exports and no default `anime` function.

```js
import { animate, createTimeline, stagger, utils } from 'animejs';

animate('.card', {
  opacity: [0, 1],
  y: [16, 0],
  duration: 400,
  delay: stagger(60),
  ease: 'outQuad',
});

const tl = createTimeline({ defaults: { duration: 500, ease: 'outExpo' } });
tl.add('.title', { y: [24, 0], opacity: [0, 1] })
  .add('.subtitle', { opacity: [0, 1] }, '-=200')
  .add('.cta', { scale: [0.9, 1] }, '<');
```

Other v4 modules, imported by name: `createTimer`, `createAnimatable`, `createDraggable`,
`createScope`, `onScroll`, `svg` (`svg.createDrawable`, `svg.morphTo`,
`svg.createMotionPath`), `waapi` (a lighter Web Animations API-backed `animate`), and
`utils` (`utils.$`, `utils.set`, `utils.random`, `utils.remove`, …). Text splitting and
some other helpers arrived in later 4.x minors — confirm they exist in the installed
version before using them.

## v3 → v4 differences that cause silent bugs

| v3 | v4 |
| --- | --- |
| `anime({ targets, ...params })` | `animate(targets, params)` |
| `anime.timeline()` | `createTimeline()`; `.add(targets, params, position)` |
| `easing: 'easeOutQuad'` | `ease: 'outQuad'` |
| `direction: 'alternate'` | `alternate: true` (with `loop`) |
| `direction: 'reverse'` | `reversed: true` |
| `endDelay` | `loopDelay` |
| `translateX`, `translateY` | `x`, `y` shorthands also accepted |
| `update`, `begin`, `complete` callbacks | `onUpdate`, `onBegin`, `onComplete` |
| `anime.stagger`, `anime.remove`, `anime.set` | `stagger`, `utils.remove`, `utils.set` |
| `.finished` promise | animations are thenable: `await animate(...)` / `.then()` |

An unknown key such as `easing` in v4 is not an error — it is ignored, or treated as a
property to animate. When an animation "does nothing", check the option names first.

## Frameworks and cleanup

Selectors are global unless scoped. In components, scope and revert:

```jsx
useEffect(() => {
  const scope = createScope({ root: rootRef }).add(() => {
    animate('.item', { x: 100, delay: stagger(50) });
  });
  return () => scope.revert();
}, []);
```

`scope.revert()` stops the animations and restores inline styles; without it, React
strict mode, route changes and hot reload leave duplicate animations running. Outside a
scope, keep the returned animation and call `.revert()` or `.cancel()` on teardown.
Anime.js touches the DOM: run it in effects/`onMounted`, never during server rendering.

## Rules

- Animate transforms and opacity; avoid per-frame layout properties (`width`, `top`).
- Honour reduced motion. Check `matchMedia('(prefers-reduced-motion: reduce)')` and skip
  or shorten movement; scopes accept `mediaQueries` so one definition covers both cases.
- Content must be readable and operable if the script never runs. Do not hide primary
  content in CSS and rely on an animation to reveal it.
- Use a timeline for anything with more than two dependent steps instead of chained
  `delay` arithmetic. Position parameters (`'<'`, `'-=200'`, labels) stay correct when a
  duration changes.
- Scroll-linked work uses `onScroll` via `autoplay: onScroll({ ... })`; do not attach a
  raw `scroll` listener that calls `animate` on every event.
- SVG line drawing needs a drawable (`svg.createDrawable`) and a stroked path; morphing
  needs compatible paths — verify the result visually, not from the code.
- One animation system per element and property.

## Done when

- Option names match the installed major version.
- Every animation started in a component is reverted on unmount.
- The sequence was watched in a browser, including a re-trigger mid-flight and with
  reduced motion enabled.

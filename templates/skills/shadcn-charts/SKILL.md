---
name: shadcn-charts
description: Use when building or changing charts with shadcn/ui chart components and Recharts — ChartContainer, ChartConfig, chart tooltips and legends, chart colour tokens, or area, bar, line, pie, radar and radial charts in a shadcn project.
license: MIT
metadata:
  requirements: A React project using shadcn/ui (a components.json file) and Recharts, or approval to add them.
  documentation: https://ui.shadcn.com/docs/components/chart
  distribution: wondev-procedure
---

# shadcn/ui charts

Written by wondev; not affiliated with shadcn/ui or Recharts. shadcn charts are not a
chart library: they are a thin set of copied-in components around **Recharts**. You
compose Recharts primitives and use the shadcn wrapper for theming, tooltip and legend.
Confirm details against <https://ui.shadcn.com/docs/components/chart> and the Recharts
version in `package.json`.

## Before writing code

1. Confirm `components.json` exists and find the UI directory and alias (often
   `@/components/ui`). If `chart.tsx` is missing, add it with the project's package
   runner: `npx shadcn@latest add chart` (or `pnpm dlx` / `bunx`). Do not hand-write it.
2. Read the existing `chart.tsx` and one existing chart. The component is project-owned
   and may have been edited; follow what is there.
3. Check the Tailwind major version and how `--chart-1` … `--chart-5` are defined in the
   global CSS. That decides the colour syntax (see below).
4. Decide the chart type from the question the chart answers, not from what looks good:
   trend over time → line/area; compare categories → bar; part of a whole with few
   slices → pie/donut; single progress value → radial. If the `ui-ux-pro-max` skill is
   enabled, its chart data can help choose.

## Shape of a chart

```tsx
"use client";

import { Bar, BarChart, CartesianGrid, XAxis } from "recharts";
import {
  ChartContainer, ChartLegend, ChartLegendContent,
  ChartTooltip, ChartTooltipContent, type ChartConfig,
} from "@/components/ui/chart";

const chartConfig = {
  desktop: { label: "Desktop", color: "var(--chart-1)" },
  mobile: { label: "Mobile", color: "var(--chart-2)" },
} satisfies ChartConfig;

export function VisitorsChart({ data }: { data: { month: string; desktop: number; mobile: number }[] }) {
  return (
    <ChartContainer config={chartConfig} className="min-h-[200px] w-full">
      <BarChart accessibilityLayer data={data}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="month" tickLine={false} axisLine={false} tickMargin={10} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar dataKey="desktop" fill="var(--color-desktop)" radius={4} />
        <Bar dataKey="mobile" fill="var(--color-mobile)" radius={4} />
      </BarChart>
    </ChartContainer>
  );
}
```

How the pieces connect:

- `ChartConfig` keys match the data keys. It holds presentation only (label, icon,
  colour) — never the data.
- `ChartContainer` turns each config entry into a CSS variable `--color-<key>` scoped to
  that chart. Series reference `var(--color-<key>)`.
- `ChartTooltipContent` and `ChartLegendContent` read labels and colours from the same
  config, so a renamed key must be renamed in data, config and series together.

## Rules

- **Give the container a size.** `ChartContainer` wraps Recharts' `ResponsiveContainer`,
  which renders nothing at zero height. Set `min-h-[…]` or an aspect class, and make
  sure the parent is not `display: none` at mount (tabs, collapsed panels).
- **Colour syntax follows the theme.** If the tokens are complete colours
  (`--chart-1: oklch(…)`, Tailwind v4 era), use `var(--chart-1)`. If they are bare HSL
  channels (`--chart-1: 12 76% 61%`, Tailwind v3 era), use `hsl(var(--chart-1))`. A
  mismatch renders black or transparent series with no error.
- Use the theme tokens rather than hex literals so light/dark mode keeps working. Per
  theme overrides go in config as `theme: { light: "…", dark: "…" }` instead of `color`.
- Charts are client components: add `"use client"` to the chart file, fetch data in the
  server component and pass it down as props.
- Keep `accessibilityLayer` on the Recharts chart for keyboard and screen-reader
  support, and do not encode meaning by colour alone — labels, legend or direct
  annotation must carry it too.
- Format in one place: `tickFormatter` on axes, `labelFormatter` / `formatter` on
  `ChartTooltipContent`. Pass dates as sortable values and format at the edge.
- For data keyed by a field's value (pie slices), set `nameKey` on the tooltip/legend
  content and put `fill: "var(--color-<key>)"` on each data row.
- Handle empty, loading and single-point data explicitly; a blank chart area looks like
  a bug. Large series should be aggregated before rendering, not thinned in the chart.
- Do not add a second chart library to a project that already has shadcn charts
  without recording the reason.

## Common failures

| Symptom | Usual cause |
| --- | --- |
| Chart area is empty, no error | Container has no height, or parent hidden at mount |
| Series are black or invisible | `hsl(var(--chart-n))` vs `var(--chart-n)` mismatch, or config key differs from `--color-<key>` used in the series |
| Tooltip shows raw keys | Config key missing for that `dataKey`, or `nameKey` not set |
| "createContext is not a function" / hydration error | Chart rendered in a server component |
| Type errors after a Recharts upgrade | Project `chart.tsx` predates that Recharts major; update the component through the shadcn CLI and review the diff |

## Done when

- The chart renders at mobile and desktop widths, in light and dark themes.
- Tooltip, legend and axis labels show human labels and formatted values.
- Empty and loading states were checked in a browser, and the console is clean.

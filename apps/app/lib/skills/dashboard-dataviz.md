---
name: dashboard-dataviz
description: Dashboards, analytics, and charts — information density, chart selection, and readable data UI.
when: data-dashboard, machine-learning, python-script
---

## Dashboard & data UI

A dashboard answers questions. Every element earns its pixels by answering one.

### Before laying out
Name the 3 questions this screen answers. The primary one gets the top-left position and the
largest type. If you cannot name them, the dashboard is decoration.

### Layout
- Lead with the answer, not the filters. Filter bars pinned above the fold push the value down.
- KPI rows are fine — 3 to 5 tiles, each with value, label, and a comparison (delta or sparkline).
  A tile with a bare number and no baseline is not information.
- Do not build a wall of identical cards. Vary size by importance; the main chart should be
  visibly dominant.
- Tables are a first-class layout, not a fallback. When the user's job is scanning rows, ship a
  real table with sticky headers, aligned numerics, and sortable columns.

### Chart selection
- Trend over time → line. Comparison across categories → horizontal bar. Part-to-whole → stacked
  bar or a single stat, **not** a pie beyond 3 slices. Distribution → histogram. Correlation →
  scatter.
- Never a 3D chart. Never a donut with 9 segments. Never dual y-axes unless the units are related.
- Sort bars by value, not alphabetically, unless the category order is meaningful.

### Chart craft
- Numeric axes start at zero for bars. Line charts may crop — say so in the axis.
- Right-align numbers, use tabular figures, keep decimal places consistent within a column.
- Label the units once, clearly. `₹`, `%`, `ms`, `req/s` — never leave a bare number.
- Direct-label series where possible instead of forcing a legend round-trip.
- Grid lines are faint. Data is not.

### Color for data
- Categorical: distinct hues at similar lightness, 6 max. Beyond that, group into "Other".
- Sequential: single hue, varying lightness. Diverging: two hues around a meaningful midpoint.
- Semantic colors keep meaning (red = bad) — do not use red as a decorative series color.
- Never rely on color alone: pair with shape, label, or position.

### Density
Dashboards may be dense. Dense means high signal, not cramped: tighten line-height and padding,
keep the spacing rhythm consistent, and let the grid do the separating instead of drawing a
border around everything.

### States
Empty (no data yet, with how to get data), loading (skeleton in the chart's shape), error
(what failed and retry), and stale (last-updated timestamp) all ship with visible copy.

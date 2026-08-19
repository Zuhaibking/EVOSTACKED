---
name: frontend-craft
description: Anti-generic UI craft — typography, spacing, color, and the tells that make generated interfaces look AI-made.
when: always
---

## Frontend craft

The failure mode is not "ugly". It is **templated** — an interface that could belong to any
product. Every choice below exists to make the UI belong to THIS domain.

### Typography
- Pick a type pairing with intent. Inter/Geist for everything is the default tell — use it only
  when the domain genuinely wants neutral (devtools, dashboards).
- Set a real scale. Ratios, not random px: 12 / 14 / 16 / 20 / 24 / 32 / 48 / 64.
- Headlines get tight tracking (`-0.02em` to `-0.03em`) and leading (`1.05`–`1.15`). Body gets
  `1.5`–`1.65`.
- One display face + one text face is enough. Three families is noise.
- Never center long body copy. Measure caps at ~65–75ch.

### Color
- Build roles, not a palette dump: surface, surface-raised, border, text, text-muted, accent,
  and exactly one semantic set (success/warn/danger) if the product needs it.
- One accent. It marks the primary action and nothing else. An accent used on six elements
  stops meaning anything.
- Derive borders from the surface (a hair lighter/darker), never `#ccc` floating on a dark theme.
- Banned unless the domain demands it: purple→blue gradients, glassmorphism for its own sake,
  neon-on-black "AI" styling, rainbow category chips.

### Space and layout
- Commit to one spacing unit (4px or 8px) and stay on the grid.
- Whitespace is hierarchy. Section padding should be large and consistent — cramped generous
  sections read as unfinished.
- Break the single-column-of-cards reflex. Consider: split panes, sidebars, an asymmetric hero,
  a table that is actually a table, a timeline, a canvas.
- Align to a grid you can name. Random max-widths per section look accidental.

### Depth
- Shadows are light physics: one light source, larger blur for higher elevation, low opacity
  (`0.04`–`0.12`). Two stacked shadows (tight + diffuse) beat one heavy one.
- On dark surfaces prefer a 1px top highlight border over a black shadow.
- Radius is a system: pick a base (e.g. 8px), use `base*2` for cards, `999px` for pills. Mixed
  arbitrary radii is the loudest amateur tell.

### Content
- Write real copy. Named people, plausible amounts, real-looking dates, domain vocabulary.
- "Lorem ipsum", "Item 1", "User A", "Card Title", and "Lorem" placeholder images fail the brief.
- Numbers should be plausible together — a dashboard where revenue is ₹412 and users are 4.2M
  reads as fake.

### States
Every primary flow ships four states, with visible copy:
- **empty** — explains what goes here and how to add the first one
- **loading** — skeleton matched to the real layout, not a centered spinner
- **error** — what broke and the next action
- **success/feedback** — confirmation that the action landed

### Motion
- Motion clarifies causality (this came from that) or gives feedback. Nothing else.
- 120–220ms for UI feedback, 250–400ms for layout/entrance. Ease-out on entry.
- Respect `prefers-reduced-motion`.
- No scroll-jacking, no confetti, no animated gradients as a background.

### Make it actually render (these fail silently — check every one)

**One styling system per project.** Pick the template's system and stay in it. The
common disaster is mixing Tailwind utilities with hand-written classes that *look*
like utilities (`text-coffee-dark`, `bg-cream`, `font-display`). Tailwind does not
know those names, so they resolve to nothing and the element renders unstyled.
- Tailwind template → use real Tailwind utilities, including arbitrary values
  (`text-[#472c1b]`, `bg-[#f8f5f1]`). Define brand colors in `tailwind.config`
  or use arbitrary values inline. Do not invent utility class names.
- Plain CSS → write real selectors and import the stylesheet globally.

**Never use a CSS Module with plain-string class names.** `foo.module.css` hashes
every class at build time, so `className="my-card"` will never match `.my-card`
inside it. Either `import styles from './foo.module.css'` and use
`className={styles.myCard}`, or make it a global stylesheet — not a module.

**Every stylesheet you generate must be imported by a file you generate.** An
orphan CSS file passes import checks (nothing points at a missing file) while
contributing zero styles. Trace it: which generated file imports this?

**Set text color wherever you set a background.** Never inherit it and hope. A
section with a light background and no explicit text color renders in the
template's default — which is often near-white, giving invisible text. State both
colors on the same element, then confirm they contrast.

**Images: never a local path, always a working remote URL.** You cannot create
binary assets, so `src="/hero.jpg"`, `bean.image`, and `url(/photo.png)` render
as broken-image icons. Use real photography from these verified endpoints:

- **Topical photo** — `https://loremflickr.com/1600/900/coffee,roastery`
  Keyword-driven, so it matches the domain. Comma-separate up to 3 keywords.
- **High-quality generic** — `https://picsum.photos/seed/beans-01/1600/900`
  Stable per seed, so the same seed always returns the same photo.

Verified 2026-08-20. Rules:
- `https://source.unsplash.com/...` is **dead — returns 503**. Never use it.
- Never invent an `images.unsplash.com/photo-<id>` id; a wrong id 404s.
- Use a plain `<img>`, not `next/image` — external hosts need `remotePatterns`
  config the sandbox does not have.
- Always set `alt`, explicit `width`/`height` or an aspect-ratio box, and
  `object-cover`, so layout does not jump while loading.
- Vary the seed/keyword per card so a grid is not the same photo six times.

Photography is the default for hero and card art. Reach for CSS gradients or
inline SVG for *texture behind content* (blooms, grain, patterns) — not as a
replacement for the main visual.

### Accessibility (non-negotiable)
- Semantic elements: `button` for actions, `a` for navigation, real `label` for every input,
  headings in order.
- Visible focus rings. Never `outline: none` without a replacement.
- Body text contrast ≥ 4.5:1. Muted text is still text — check it.
- Touch targets ≥ 44px. Mobile navigation must actually open and close.

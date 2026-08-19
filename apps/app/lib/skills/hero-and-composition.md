---
name: hero-and-composition
description: Hero design, page rhythm, and filling space with intent — kills the empty-right-column and beige-on-beige failure modes.
when: always
---

## Hero & composition

### The empty-region rule (most common failure)

**Never ship a large region with almost nothing in it.** The classic failure is a
hero split 50/50 where the left holds text and the right holds one small
decorative shape floating in empty background. That reads as broken, not minimal.

If you do not have substantial content for a region, **change the layout** — do
not pad it out. A hero with only a headline and a button should be a *centered*
or *full-bleed* hero, not a two-column hero with a hole in it.

Decorative SVG belongs *behind or around* content as texture. A single small
glyph alone in a 700×600 area is not a composition.

### Pick a hero archetype deliberately

Choose one and commit. Do not default to #1.

1. **Split** — text one side, a *substantial* visual the other. Only valid if the
   visual genuinely fills its half: a photo, a product shot, a real UI mock, a
   stacked card cluster, a large image grid. Not one icon.
2. **Centered statement** — huge headline, one line of support, one CTA, generous
   air. Works when the claim is the whole story. Needs real typographic scale
   (clamp to 56–96px on desktop) or it looks unfinished.
3. **Full-bleed image** — photo edge to edge, dark scrim over it, text on top.
   Most reliable way to look expensive. Always add the scrim or text drowns.
4. **Editorial** — oversized type as the visual itself, small supporting image,
   asymmetric offset grid. Strong for brands, publications, portfolios.
5. **Product-forward** — the interface/product occupies 60%+, often bleeding off
   the right or bottom edge to imply continuation.

Whatever you pick: the CTA is visible without scrolling on a 1280×720 laptop.

### Vertical rhythm — stop the monochrome scroll

A page where every section shares one background reads flat and cheap, no matter
how good the type is.

- **Alternate section tone.** Light → dark → light, or tinted → white → tinted.
  At least one section must break the dominant tone hard. A dark section in a
  light page (or vice versa) is the cheapest way to create quality perception.
- Give consecutive sections different *structures*, not just different copy:
  cards → table → quote → stepper → split → grid.
- Section padding is large and consistent (80–140px desktop, 48–72px mobile).
- End on a strong close: a full-width CTA band in the accent or dark tone.

### Density

Every section needs enough real content to justify existing. If a section is one
sentence and a button, merge it into a neighbour. Three cards with two words each
is worse than one well-built block.

Rough floor per section: a heading, a line of context, and either 3+ content
items or one substantial visual.

### Navigation

Ship a real header: wordmark left, 3–5 anchor links, one CTA button right. Make
it sticky with a background/blur on scroll. A landing page with no nav looks
unfinished no matter how good the hero is.

### Depth and texture

Flat beige on flat beige is the "AI made this" signature. Add, in order of payoff:
1. A tonal shift between sections (see rhythm above)
2. A large soft radial gradient bloom behind the hero, offset from center
3. Real borders — `1px` hairlines at low contrast to define card edges
4. Layered shadows on raised surfaces (tight + diffuse)
5. A subtle noise/grain overlay via inline SVG `feTurbulence` at 2–4% opacity

### Colour anchor

Pick one saturated anchor colour and use it with conviction — CTA, active states,
one accent surface. A page built only from neutrals and one muted tan will always
look washed out. The anchor can be deep (forest, oxblood, ink) — it does not need
to be bright, it needs to be *decided*.

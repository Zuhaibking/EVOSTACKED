# EvoStack — screenshots (2026-11-26)

These are real captures, not mockups. Each one comes from a headless Chrome run against the local dev server, using live OpenAI and Gemini calls, real E2B sandboxes and the per-project SQLite backends. Shots 03–08 show one uninterrupted run that took about 3 minutes: an idea goes through discovery and a 3-model tournament, gets measured evidence, launches a backend and ends in a generated control center.

## 1. Landing

**01 — Landing (after the UI polish pass).** Fonts are restored and the copy describes the new flow: discover → compete → measure → launch.
![Landing](01-landing.png)

**02 — Landing before the polish pass.** Fonts were silently broken by the Tailwind 4 upgrade.
![Landing before](02-landing-before-polish.png)

## 2. Idea → adaptive discovery → spec

**03 — Discovery, round 1.** The first prompt opens adaptive discovery instead of a fixed questionnaire.
![Discovery round 1](03-discovery-round-1.png)

**04 — Discovery, round 2.** Questions get sharper each round and topics already known are never asked again. The live spec on the right (name, audience, features, data entities, workflows, integrations) updates every round.
![Discovery round 2](04-discovery-round-2-live-spec.png)

## 3. Multi-model tournament → evidence-based judging

**05 — Tournament running.** Three design directions are generated in parallel, each on a different model.
![Tournament](05-tournament-generating.png)

**06 — Evidence leaderboard.** Each candidate is measured inside its own sandbox: p50 and p95 response time, error rate across 60 requests, JS weight, and accessibility, SEO and best-practice audits. Candidates are ranked on those numbers, with weight sliders to re-rank. The "Judge's pick" badge shows the LLM judge's choice next to the measured ranking. The **Launch backend** button sits above.
![Evidence leaderboard](06-evidence-leaderboard-and-launch.png)

## 4. Pick one → isolated backend + tailored control center

**07 — Launch backend.** Steps shown: data model designed (7 collections, 12 modules) → isolated database created (83 seeded records) → website connected → ready.
![Launch backend ready](07-launch-backend-ready.png)

**08 — Generated control center** for the winning coffee-roastery build. Modules (coffees, subscriptions, reviews, leads, newsletter) and currency (₹) are inferred from the spec.
![Control center](08-generated-control-center-coffee.png)

## 5. Every project type gets the tools it needs

### E-commerce (sneaker store)

**09 — Overview.**
![E-commerce overview](09-ecommerce-overview.png)

**10 — A website order lands in the dashboard in real time.** The toast and activity entry come from a submission marked `source: website`.
![Live website order](10-ecommerce-live-website-order.png)

**11 — Analytics.**
![Analytics](11-ecommerce-analytics.png)

**12 — Workflows.**
![Workflows](12-ecommerce-workflows.png)

**13 — Customers.**
![Customers](13-ecommerce-customers.png)

### Restaurant (Italian bistro)

**14 — Overview.**
![Restaurant overview](14-restaurant-overview.png)

**15 — Reservations week calendar.**
![Reservations](15-restaurant-reservations-calendar.png)

### Booking platform (dental clinic)

**16 — Overview.**
![Clinic overview](16-dental-clinic-overview.png)

**17 — Appointments calendar.**
![Appointments](17-dental-clinic-appointments-calendar.png)

### SaaS (B2B analytics)

**18 — Overview:** MRR, usage revenue, active subscriptions, trials, MRR by plan.
![SaaS overview](18-saas-overview.png)

**19 — Subscriptions.**
![Subscriptions](19-saas-subscriptions.png)

### Schema-driven data modules (any collection)

**20 — Kanban.** Drag a card to change its status; if the save fails, the card moves back.
![Kanban](20-module-kanban.png)

**21 — Record drawer** for create and edit.
![Record drawer](21-module-record-drawer.png)

**22 — Record drawer with validation errors** returned by the API.
![Validation](22-module-record-drawer-validation.png)

## 6. Preview layout fix (before / after)

**23 — Before: the preview is crushed.** Owner's screen at 1918×850. The launch card (~157 px) and the expanded evidence leaderboard (~400 px) were stacked above the preview in a fixed-height pane, so the website was squeezed into a ~50 px strip.
![Before](23-preview-layout-before-1918x850.png)

**24 — After: the preview fills the pane.** Same 1918×850 viewport. Launch is one compact row and evidence is one summary line, so the preview iframe is 554 px tall.
![After](24-preview-layout-after-1918x850.png)

**25 — The full leaderboard opens as an overlay.** "View leaderboard" opens it on top of the preview without moving or resizing it. Esc closes it.
![Leaderboard overlay](25-evidence-leaderboard-overlay.png)

**26 — Mobile (390×844).** The launch bar, evidence row and preview stack in order, and the preview no longer covers them.
![Mobile](26-preview-layout-after-mobile.png)

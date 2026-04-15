# EvoStack — Phases (Agent Dispatch Plan)

Each phase below is a **self-contained mission** for a Claude agent. No implementation detail — every agent already knows how to write code. What they need from us is **what to build, what "done" looks like, and what the phase delivers to the user.**

Dispatch one phase per agent. Phases marked `parallel-safe` can run at the same time without conflicting.

---

## Ground truth for every agent

Before any phase starts, the agent must read these three files:

- `README.md` — the product vision
- `PLAN.md` — deep engineering plan (technical grounding)
- `PHASES.md` — this file (their mission)

Every agent also inherits the core constraint: **we are building on top of the Fragments codebase**, which already turns a prompt into a running sandboxed app. Do not rebuild that. Extend it.

---

## Phase 0 — Rebrand to EvoStack

**Mission.** Make the app look and read as EvoStack. No functional changes.

**Deliverables.**
- Logo, wordmark, navbar say EvoStack
- App title, meta description, social cards say EvoStack
- Color palette shifts from neutral Fragments look to a distinctive EvoStack identity (propose a "tournament / evolution" feel — dark mode first, sharp accent color for winning candidates)
- Footer keeps a small "forked from E2B Fragments" credit (license obligation + honesty)
- Existing single-prompt flow still works end-to-end

**Done when.** Running `npm run dev`, the user sees "EvoStack" everywhere, and can still type a prompt and get one sandboxed app back.

**Parallel-safe.** Yes. Can run alongside Phase 1.

---

## Phase 1 — Population (one prompt → many candidates)

**Mission.** Turn the single-candidate app into a population-based one. When the user submits a prompt, we generate N different implementations in parallel — different tech stacks, different models, different architectural choices — and show each as its own live preview card.

**Deliverables.**
- User can submit a prompt and choose population size (default 20, capped at 50 for cost)
- N candidate cards appear immediately, each labeled with its chosen stack
- Each card streams through: generating code → deploying → live sandbox URL
- Failed candidates are marked clearly, not hidden
- User can cancel the run and all sandboxes stop

**Done when.** One prompt spawns 20 visibly different live apps side by side, each clickable to inspect its code and open its URL.

**Not in this phase.** Measuring them. Scoring them. Evolving them. We're just proving we can run many at once.

**Parallel-safe.** No. Must complete before Phases 2, 4, 5.

---

## Phase 2 — Budget safety

**Mission.** Make sure no one accidentally burns ₹50,000 of LLM + sandbox cost in a single click. This phase ships alongside Phase 1, not after it.

**Deliverables.**
- Before every run: show estimated cost in the user's currency, require explicit confirmation
- Per-user daily spend cap, stored in our rate-limit store
- Per-run hard cap (configurable, default low)
- Mid-run monitor: if a run is projected to exceed budget, stop spawning further generations and surface a clear message
- All cost calculations visible to the user — no opaque charges

**Done when.** A user can never be surprised by the bill. Every candidate and every generation has a visible cost meter.

**Parallel-safe.** Yes, with Phase 1. These two must ship together.

---

## Phase 3 — Real measurement (load harness)

**Mission.** Every deployed candidate gets hit with synthetic traffic that represents the workload the user asked for. We collect real numbers: latency, errors, memory, cold start, throughput.

**Deliverables.**
- Workload auto-generated from user's brief (e.g., "5k MAU" → modest sustained RPS with realistic scenario mix)
- Per-candidate metrics panel updates live during the test
- Hard kill rules enforced: a candidate that crashes, runs out of memory, or stays unresponsive is marked dead and removed from the tournament
- Different template types are measured fairly (a Python data-analyst candidate is not scored like a Next.js app — the harness adapts)
- Test duration is short enough to feel interactive (~60–90s per generation) but long enough to surface real behavior

**Done when.** Clicking any candidate shows honest latency / error / cost numbers that correspond to what actually happened when we hit it with traffic.

**Parallel-safe.** No. Needs Phase 1.

---

## Phase 4 — Scoring & ranking

**Mission.** Collapse multi-dimensional metrics into a single score per candidate, rank them live, and let the user retune the tradeoff without re-running.

**Deliverables.**
- Composite score across: latency, projected monthly cost, reliability, footprint
- Leaderboard updates as candidates finish measuring
- User-facing weight sliders ("I care more about cost" / "I care more about speed") that re-rank without re-running anything
- Projected monthly cost is believable — grounded in a published rate model per deploy target, not a guess
- Top candidate is visually obvious (crown, glow, whatever — make it feel like a tournament)

**Done when.** At the end of a generation, the user sees a clear leaderboard with a #1 candidate, can adjust priorities, and the ranking updates immediately.

**Parallel-safe.** No. Needs Phase 3.

---

## Phase 5 — Evolution (generations)

**Mission.** Losers die. Winners reproduce with modifications. Next generation is better than the last.

**Deliverables.**
- After a generation completes, top candidates carry over unchanged (elitism)
- Remaining slots filled by mutation (a winner is edited to fix its weakest metric — e.g., "this one was slow, try edge runtime") or crossover (two winners are merged)
- Each new generation shows clearly: which parent(s) it came from, what mutation was applied
- Run stops automatically when scores plateau, budget is hit, or a max-generation cap is reached
- Best score visibly improves across generations (if it doesn't, the algorithm is failing — surface that too)

**Done when.** A 3-generation run visibly climbs the score curve, and the user can inspect the family tree of how the winner evolved.

**Parallel-safe.** No. Needs Phase 4. This is the phase where "EvoStack" earns its name.

---

## Phase 6 — Tournament dashboard

**Mission.** Make the competition dramatic, readable, and share-worthy. This is the demo money-shot.

**Deliverables.**
- Live grid of candidate cards with thumbnail screenshots of their running UIs
- Leaderboard pinned on top; clicking a row expands the full candidate view
- Kill-feed ticker: "Candidate #12 died: out of memory under load"
- Generation-timeline chart showing score progression across generations, with parent → child lines connecting candidates
- Compare mode: select 2 candidates, see side-by-side metrics, code diff, cost breakdown
- At run end: winner pane expands dramatically, scorecard reveals

**Done when.** A first-time viewer immediately understands: what the app is doing, which candidate is winning, why, and can replay the evolution visually.

**Parallel-safe.** Yes, with Phase 5 (but needs Phase 1 and Phase 4 complete for real data to render).

---

## Phase 7 — Export winner

**Mission.** Turn the winning sandbox into a downloadable, deploy-ready project. Ship the code out of EvoStack into the real world.

**Deliverables.**
- Download a .zip of the winner containing: full source code, Dockerfile, deploy config for the target cloud (Cloud Run, Vercel, Fly — pick based on user's original brief), environment template, scorecard.md
- Scorecard explains, in plain language, why this candidate won: numbers, comparisons to runners-up, cost projection, stress-test results
- One-command deploy instructions included in the README inside the zip
- Winner code is preserved even after the sandbox expires — we snapshot before it dies

**Done when.** The user downloads the zip, runs one command, and their winning app is live on the cloud they asked for.

**Parallel-safe.** Yes, can start as soon as Phase 4 is stable.

---

## Phase 8 — Run history & sharing

**Mission.** Make runs permanent, shareable, and comparable.

**Deliverables.**
- Past runs list per user; can reopen any finished run and re-explore its tournament
- Public share URL per run — read-only, no auth required, great for portfolios and demos
- Compare two runs side by side: did the second approach beat the first?
- Re-run button: re-execute a past run with tweaked priorities or more generations

**Done when.** A user can share a link that shows their tournament to anyone on the internet, and can come back in a week to see past results.

**Parallel-safe.** Yes, independent of Phases 5–7.

---

## Phase 9 — Polish & trust

**Mission.** Make EvoStack feel professional, trustworthy, and educational — not like a magic black box.

**Deliverables.**
- Empty states, loading states, error states are all handled with clear copy
- Help tooltips explain every metric ("what is p95 latency? why does it matter?")
- Onboarding flow walks a first-time user through their first run
- Honest disclaimers: synthetic load ≠ real users, cost projections are estimates, etc.
- Keyboard shortcuts for power users
- Accessibility pass: color contrast, keyboard navigation, screen reader labels
- Mobile responsive (view-only is fine; running tournaments on mobile is not expected)

**Done when.** A stranger can land on EvoStack, run a tournament, understand what happened, and trust the result — without us explaining anything.

**Parallel-safe.** Yes, ongoing.

---

## How to dispatch

**Sequential, critical-path agents (must run in order):**

```
Phase 0 rebrand   ──▶  Phase 1 population  ──▶  Phase 3 harness
                                            ──▶  Phase 4 scoring   ──▶  Phase 5 evolution
```

**Parallel agents (can run anytime alongside the critical path):**

```
Phase 2 budget safety     — pair with Phase 1
Phase 6 dashboard         — start once Phase 4 is stable
Phase 7 export            — start once Phase 4 is stable
Phase 8 history/sharing   — start once Phase 1 is stable
Phase 9 polish            — continuous
```

**Recommended parallel dispatch waves:**

- **Wave 1 (concurrent):** Phase 0, Phase 1
- **Wave 2 (concurrent):** Phase 2 (with Phase 1), Phase 3
- **Wave 3 (concurrent):** Phase 4, begin Phase 9
- **Wave 4 (concurrent):** Phase 5, Phase 6, Phase 7, Phase 8

Total calendar time if dispatched aggressively: ~2 weeks instead of ~5.

---

## What every agent must respect

1. **Don't break single-candidate mode.** Users exploring EvoStack for the first time should be able to generate just one app if they want, as a fallback.
2. **Don't surprise users with cost.** Every action that spends money shows the bill first.
3. **Don't fake numbers.** If a metric is estimated, label it estimated. If a test was short, say it was short.
4. **Preserve the winner.** The winning code must survive the sandbox's 10-minute expiry, always.
5. **Make failure visible.** Dead candidates stay on screen with their failure reason — that's the point of a tournament.
6. **Keep the Fragments foundation intact.** The sandbox creation pipeline, the LLM routing, the Morph editor — these are proven. Build on them, don't replace them.

---

## The one-sentence vision, for every agent

**EvoStack turns a project idea into 100 competing implementations, tests them with real traffic, evolves the winners, and hands you the champion as deploy-ready code — all while you watch it happen live.**

If something an agent is building doesn't serve that sentence, they should stop and ask.

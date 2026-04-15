# EvoStack Build Plan

From **Fragments** (prompt → 1 sandboxed app) to **EvoStack** (prompt → N competing sandboxed apps → evolved winner).

---

## Architecture

```
                                   ┌─────────────────────┐
   User prompt + constraints ─────▶│  Run Orchestrator   │
                                   │  (new)              │
                                   └──────────┬──────────┘
                                              │ spawns N
                         ┌────────────────────┼────────────────────┐
                         ▼                    ▼                    ▼
                  ┌────────────┐       ┌────────────┐       ┌────────────┐
                  │ Candidate 1│       │ Candidate 2│  ...  │ Candidate N│
                  │ (gen+deploy│       │            │       │            │
                  │  +score)   │       │            │       │            │
                  └─────┬──────┘       └─────┬──────┘       └─────┬──────┘
                        │                    │                    │
                        └─────────┬──────────┴─────────┬──────────┘
                                  ▼                    ▼
                          ┌──────────────┐      ┌──────────────┐
                          │ Load Harness │      │   Scorer     │
                          │    (new)     │─────▶│    (new)     │
                          └──────────────┘      └──────┬───────┘
                                                       │
                                                       ▼
                                              ┌────────────────┐
                                              │  Evolution Loop│
                                              │     (new)      │
                                              └────────┬───────┘
                                                       │
                                          ┌────────────┴─────────────┐
                                          ▼                          ▼
                                  ┌──────────────┐           ┌──────────────┐
                                  │ Dashboard UI │           │  Exporter    │
                                  │   (extend)   │           │    (new)     │
                                  └──────────────┘           └──────────────┘
```

---

## Current capabilities (inherited)

| Capability | File(s) |
|---|---|
| Prompt → structured fragment (code + deps + port) | `app/api/chat/route.ts`, `lib/schema.ts`, `lib/prompt.ts` |
| Fragment → live E2B sandbox | `app/api/sandbox/route.ts` |
| Iterative code editing via Morph | `app/api/morph-chat/route.ts`, `lib/morph.ts` |
| Multi-provider LLM routing | `lib/models.ts`, `lib/models.json` |
| Multi-template support (Next, Vue, Streamlit, Gradio, Py) | `lib/templates.ts`, `sandbox-templates/` |
| Chat UI with preview pane | `components/chat.tsx`, `components/preview.tsx`, `components/fragment-*.tsx` |
| Auth, rate limiting, telemetry | `lib/auth.ts`, `lib/ratelimit.ts`, `app/providers.tsx` |

**Translation**: we already own the "generate one candidate and run it" primitive. Everything below is scaling that to N and adding feedback loops.

---

## Phase 0 — Rebrand & Foundation (day 1)

Quick wins so the project reads as EvoStack before we touch logic.

- [ ] `components/logo.tsx` → EvoStack mark
- [ ] `components/navbar.tsx` → title, links
- [ ] `app/layout.tsx` → metadata (title, description, OG)
- [ ] `package.json` → `"name": "evostack"`
- [ ] New palette + accent in `tailwind.config.ts` (pick a "tournament" vibe — deep indigo + lime signal color works)
- [ ] Keep Fragments attribution in footer (Apache-2.0 requirement)

---

## Phase 1 — Population Manager (week 1)

Goal: one prompt spawns N candidates in parallel, each visible as a card.

### New files

```
lib/population/
  types.ts              # Candidate, Generation, RunConfig
  strategy.ts           # how to pick varied configs (template × model × options)
  orchestrator.ts       # spawn, track, cancel
app/api/run/
  route.ts              # POST  → starts a Run, returns runId (SSE)
  [runId]/
    route.ts            # GET   → stream candidate events
    cancel/route.ts     # POST  → kill all sandboxes
components/run/
  run-view.tsx          # replaces single-preview pane
  candidate-card.tsx    # per-candidate status, logs, metrics strip
  candidate-grid.tsx    # layout
```

### Changes to existing files

- `app/page.tsx` — chat input now posts to `/api/run` instead of `/api/chat`
- `lib/schema.ts` — add `Candidate` schema (inherits `FragmentSchema`, adds `id`, `config`, `metrics`, `generation`)
- `lib/templates.ts` — expose "strategy" helpers that pick a subset of templates per run

### Strategy (how to diversify candidates)

Axes of variation:
1. **Sandbox template** — `nextjs-developer`, `vue-developer`, `streamlit-developer`, `gradio-developer`, `code-interpreter-v1`
2. **LLM** — rotate across providers so one model's bias doesn't dominate
3. **Config prompts** — inject variations ("use Postgres", "use SQLite", "use edge runtime", "use server actions")
4. **Mode** — `json` vs structured-output vs tool-use

Orchestrator builds a Cartesian sample, clamps to `N`, queues them.

### Storage

Use Upstash KV (already wired) for `run:{id}` state. No new DB needed in phase 1.

---

## Phase 2 — Load Harness (week 2)

Goal: each deployed candidate gets real traffic and real numbers.

### New files

```
lib/harness/
  workload.ts           # parse user's "expected load" → request plan
  runner.ts             # fires requests at a sandbox URL, collects timings
  collector.ts          # normalize results into Metrics
sandbox-templates/
  _probe/               # tiny standard endpoints injected into every template
    health.ts
    echo.ts
```

### Metric set (v1)

| Metric | Source |
|---|---|
| p50/p95/p99 latency | harness |
| Error rate | harness |
| RSS peak | sandbox `/proc/meminfo` poll |
| Cold start | first request timing |
| Bundle size | build artifact size |
| LLM token cost | summed from provider responses |
| Projected monthly cost | `(rps × avg_ms × infra_rate) + token_rate × est_traffic` |

### Key decisions

- **Warm-up phase**: 5s of ramp before measurement — compiled-on-first-hit frameworks (Next dev) otherwise look 10× slower
- **Timeout cap**: hard-kill any candidate that exceeds 30s response or 512MB RSS — it's out of the tournament
- **Fairness**: same workload replayed against every candidate (deterministic seed)

---

## Phase 3 — Scoring & Selection (week 2–3)

### New files

```
lib/scoring/
  scorer.ts             # weighted composite score
  weights.ts            # user-tunable (cost-sensitive vs speed-sensitive)
  kill-rules.ts         # hard-fail conditions (crash, 5xx > X%, budget exceeded)
```

### Composite score (default)

```
score = w1 * (1 / p95_latency_ms)
      + w2 * (1 / projected_monthly_cost)
      + w3 * (1 - error_rate)
      + w4 * (1 / bundle_size_kb)
```

Weights exposed in the UI so the user can slide "cheap ← → fast" and re-rank without re-running.

---

## Phase 4 — Evolution Loop (week 3)

Goal: winners influence the next generation.

### New files

```
lib/evolution/
  selector.ts           # tournament selection, elitism
  mutator.ts            # edit a candidate via Morph with a targeted prompt
  crossover.ts          # ask LLM to merge two candidates' winning traits
  loop.ts               # generation runner
```

### Mutation prompts (examples)

- "Keep the architecture but swap Postgres for SQLite"
- "The winner had lower latency because it used edge runtime — apply this pattern"
- "Reduce bundle: replace X dep with lighter alternative"

Use Morph (`lib/morph.ts`) for mutation — it's designed exactly for targeted code edits and is token-efficient.

### Termination

Stop when any of:
- `maxGenerations` reached (default 3)
- Score plateau: best score improves < 2% for 2 generations
- Budget cap: total E2B sandbox-minutes or LLM tokens hit user-set ceiling
- User clicks Stop

---

## Phase 5 — Tournament Dashboard (week 4)

Goal: make the competition visible and dramatic. This is the demo money shot.

### UI layout

```
┌─────────────────────────────────────────────────────────────┐
│ EvoStack      [prompt bar]                      [Run] [⚙]  │
├─────────┬───────────────────────────────────────────────────┤
│ Runs    │  Gen 2 · 48 alive · 12 killed · best score: 0.87  │
│ (side)  │  ╔═ Leaderboard ══════════════════════════════╗   │
│         │  ║ #87 Next+SQLite+Edge      0.87 🏆          ║   │
│         │  ║ #23 Vue+Postgres          0.81             ║   │
│         │  ║ #41 Streamlit+DuckDB      0.78             ║   │
│         │  ║ ...                                        ║   │
│         │  ╚════════════════════════════════════════════╝   │
│         │  ┌─────────┬─────────┬─────────┬─────────┐        │
│         │  │ card 87 │ card 23 │ card 41 │ card 05 │ ...    │
│         │  │ ✅ 98ms │ ⚡ 140ms│ ⚡ 180ms│ 💀 OOM  │        │
│         │  └─────────┴─────────┴─────────┴─────────┘        │
│         │  [Latency chart] [Cost chart] [Error chart]        │
├─────────┴───────────────────────────────────────────────────┤
│ Winner pane (expands when tournament ends)                   │
└─────────────────────────────────────────────────────────────┘
```

Use Tremor or Recharts for charts, shadcn for layout. Leaderboard updates via SSE.

---

## Phase 6 — Export Winner (week 4–5)

### New files

```
app/api/export/[runId]/route.ts    # zip the winning sandbox + write deploy files
lib/export/
  repo.ts                          # tar.gz of sandbox filesystem
  terraform.ts                     # generate Cloud Run / Vercel config
  scorecard.ts                     # markdown report
```

### Deliverable bundle

```
winner-{runId}.zip
├── src/                # full code from winning sandbox
├── Dockerfile          # adapted from sandbox template
├── deploy/
│   ├── cloud-run.tf    # or vercel.json, fly.toml
│   └── README.md
├── scorecard.md        # why this won — metrics, comparisons, cost projection
└── .env.example
```

---

## Phase 7 — Polish (week 5+)

- [ ] Run history (Supabase) — compare past runs, re-run a gen
- [ ] Share URL — publish a read-only tournament view
- [ ] Collaborative runs — team members watch the same tournament
- [ ] Cost caps hard-enforced at orchestrator level (kill early if projected burn exceeds cap)
- [ ] Custom metric plug-ins (e.g., Lighthouse score, accessibility score)

---

## Non-goals (explicit)

- **Not a general IDE.** No multi-file editing beyond what Morph provides.
- **Not building a new sandbox.** E2B is the substrate; we don't replace it.
- **Not training models.** Evolution is prompt/config level, not weights.
- **Not multi-region deploy in v1.** Winner export targets one region; multi-region is a future phase.

---

## Build order / critical path

```
Phase 0  ──▶  Phase 1  ──▶  Phase 2  ──▶  Phase 3  ──▶  Phase 4
(brand)    (spawn N)     (measure)     (rank)       (evolve)
                                                        │
                                                        ▼
                                            Phase 5  ──▶  Phase 6
                                           (dashboard)   (export)
```

Phase 1 is the riskiest — parallel sandbox fan-out, streaming N concurrent SSE events, rate limits. Get that right and everything downstream is additive.

---

## Demo script (college project pitch)

1. Type: *"AI agent platform for creators, Indian users, GCP, under ₹10k/month, 5k MAU"*
2. Show 40 candidate cards spawn in real time, each running a live preview
3. Charts animate as load tests fire
4. Candidate #12 dies (OOM on Postgres) — card flips to 💀
5. Generation 2 spawns — cards mutate (labels show "swapped Postgres → SQLite")
6. Leaderboard settles: #87 Next + SQLite + Edge wins
7. Click **Export** → zip downloads → `cd winner-87 && terraform apply` → live on Cloud Run
8. Show scorecard: "₹3,100/month projected · p95 52ms · 5000 user stress test passed"

**Headline**: *"Built a working SaaS in 20 minutes vs 2 weeks manually, 60% cheaper."*

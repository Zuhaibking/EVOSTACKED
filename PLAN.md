# EvoStack — In-Depth Build Plan

> This is the engineering plan. Every recommendation is grounded in the actual Fragments codebase we forked. File paths, function signatures, and line references point to real code in this repo.

---

## 0. Read this first — what we inherited

We did **not** start from a blank Next.js app. We forked E2B Fragments, which already implements the hardest primitive EvoStack needs: *prompt → structured code → live sandbox URL*.

### The existing pipeline (single-candidate)

```
┌──────────────────────────────────────────────────────────────────────┐
│ CLIENT (app/page.tsx)                                                │
│                                                                      │
│  useObject({ api: '/api/chat', schema: fragmentSchema })            │
│    ├─ submit({ messages, template, model, config })                 │
│    ├─ streams FragmentSchema object into React state                │
│    └─ onFinish: POST /api/sandbox → ExecutionResult (URL or stdout) │
└──────────────────────────────────────────────────────────────────────┘
                 │
                 ▼
┌──────────────────────────────────────────────────────────────────────┐
│ SERVER                                                               │
│                                                                      │
│  /api/chat/route.ts           (maxDuration = 300)                   │
│   └─ streamObject({ model, schema: fragmentSchema, system, msgs })  │
│                                                                      │
│  /api/sandbox/route.ts        (maxDuration = 60)                    │
│   ├─ Sandbox.create(template, { metadata, timeoutMs: 10min })       │
│   ├─ if has_additional_dependencies: sbx.commands.run(install)      │
│   ├─ sbx.files.write(file_path, code)                               │
│   └─ return { sbxId, template, url: `https://${sbx.getHost(port)}` }│
│                                                                      │
│  /api/morph-chat/route.ts     (maxDuration = 300)                   │
│   ├─ generateObject({ schema: morphEditSchema }) → edit plan        │
│   └─ applyPatch(initialCode, edit) → updated fragment               │
└──────────────────────────────────────────────────────────────────────┘
```

### What that gives us for free

| Primitive | Where | What EvoStack uses it for |
|---|---|---|
| Structured LLM output | `streamObject` + `fragmentSchema` (`lib/schema.ts:3`) | Generating each candidate's code |
| Sandbox provisioning | `Sandbox.create(template, ...)` (`app/api/sandbox/route.ts:26`) | One per candidate |
| Live public URL | `sbx.getHost(port)` (`route.ts:82`) | Load-test endpoint |
| Dependency install | `sbx.commands.run(install_dependencies_command)` (`route.ts:45`) | Setting up candidate runtime |
| File write | `sbx.files.write(path, content)` (`route.ts:54`) | Writing generated code |
| Multi-template support | `lib/templates.ts`, `sandbox-templates/` | Diversity axis #1 |
| Multi-provider LLM | `lib/models.ts:28` `getModelClient` | Diversity axis #2 |
| Targeted code edit | `applyPatch` (`lib/morph.ts:4`) | Mutation step of evolution |
| Rate limiting | `lib/ratelimit.ts` (Upstash) | Reuse + extend with budget caps |
| Auth + teams | `lib/auth.ts` (Supabase) | Attach runs to users |

### What it does NOT give us

- **Fan-out**: everything is single-candidate. No orchestrator, no population.
- **Measurement**: no load harness, no metrics collection, no scoring.
- **Feedback**: generations don't inform each other.
- **Persistence of runs**: fragments aren't stored; each session is ephemeral.
- **Cost safety**: no budget cap. A runaway tournament could burn money.
- **Multi-file codebases**: schema has single `code: string` field (array form is commented out at `lib/schema.ts:45-50`).
- **Deployment export**: sandbox dies after 10min; no way to extract code.

Every phase below adds exactly one of these.

### Real constraints (do not design around)

| Constraint | Source | Impact |
|---|---|---|
| `maxDuration = 300s` on chat route | `app/api/chat/route.ts:10` | Single call fits; fan-out of 100 cannot block one request |
| `maxDuration = 60s` on sandbox route | `app/api/sandbox/route.ts:7` | Install-heavy templates (Next/Vue npm i) can exceed — will need queue |
| `timeoutMs: 10 min` per sandbox | `app/api/sandbox/route.ts:5` | Entire candidate lifecycle (gen + deploy + load test + mutation) must fit |
| Rate limit is IP-based | `lib/ratelimit.ts` via `lib/api-errors.ts` | Fan-out from one user hits limit fast — bypass with user API keys or scope to user |
| Schema is single-file | `lib/schema.ts:42` `code: z.string()` | Either extend to array (schema's commented block) or keep single-file for v1 |
| E2B concurrent sandbox tier | External (E2B account) | Hard cap on population size per generation |
| LLM provider rate limits | External | Rotate providers in strategy |

---

## 1. Architecture

### Component view

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              CLIENT                                     │
│  ┌─────────────────────────┐    ┌───────────────────────────────────┐   │
│  │ Prompt + Constraints UI │    │  Tournament Dashboard             │   │
│  │  (replaces ChatInput)   │    │   ├─ Leaderboard (SSE)            │   │
│  │                         │    │   ├─ Candidate grid (N cards)     │   │
│  │                         │    │   ├─ Live charts (latency/cost)   │   │
│  │                         │    │   └─ Generation timeline          │   │
│  └────────────┬────────────┘    └────────────────┬──────────────────┘   │
│               │                                  ▲                      │
│               │ POST /api/run                    │ SSE /api/run/:id     │
│               ▼                                  │                      │
└───────────────┼──────────────────────────────────┼──────────────────────┘
                │                                  │
┌───────────────┼──────────────────────────────────┼──────────────────────┐
│ SERVER        ▼                                  │                      │
│  ┌───────────────────────────────────────────────┴──────────────────┐   │
│  │ /api/run                   (orchestrator entry)                  │   │
│  │  ├─ validate budget                                              │   │
│  │  ├─ create Run record in KV                                      │   │
│  │  ├─ strategy.sample(N) → Candidate configs                       │   │
│  │  └─ enqueue all candidates → return runId                        │   │
│  └──────────────────────────┬───────────────────────────────────────┘   │
│                             │                                           │
│                             ▼                                           │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │ Candidate worker loop  (per-candidate API routes or queue tasks) │   │
│  │                                                                  │   │
│  │   generate  →  deploy  →  probe  →  load-test  →  score  →  emit │   │
│  │   (chat)      (sandbox)  (health)  (harness)     (scorer)  (SSE) │   │
│  │                                                                  │   │
│  │   on-kill: sbx.kill()                                            │   │
│  └──────────────────────────┬───────────────────────────────────────┘   │
│                             │                                           │
│                             ▼                                           │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │ Generation end → evolution.loop                                  │   │
│  │  ├─ selector.pick(survivors)                                     │   │
│  │  ├─ mutator.mutate(parent) via Morph                             │   │
│  │  ├─ crossover.merge(parents) via LLM                             │   │
│  │  └─ spawn next gen                                               │   │
│  └──────────────────────────┬───────────────────────────────────────┘   │
│                             │                                           │
│                             ▼                                           │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │ /api/export/:runId                                               │   │
│  │  └─ tar sandbox fs → + Dockerfile + terraform + scorecard → .zip │   │
│  └──────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

### Run state machine

```
                   ┌──────────────────────────────┐
                   │                              │
                   ▼                              │
  ┌─────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐  ┌─────────┐
  │ created │─▶│generating│─▶│ deploying│─▶│ load_testing │─▶│ scoring │
  └─────────┘  └──────────┘  └──────────┘  └──────────────┘  └────┬────┘
                                                                  │
                                                                  ▼
                                                          ┌────────────────┐
                                                          │ gen_complete   │
                                                          └───────┬────────┘
                                                                  │
                            ┌───────────── stop? ──────────────── ┤
                            │                                     │
                            ▼                                     ▼
                     ┌────────────┐                         ┌──────────┐
                     │  finished  │                         │ evolving │
                     └────────────┘                         └─────┬────┘
                                                                  │
                                                                  └─▶ generating (gen+1)
```

Transitions controlled by orchestrator. Each candidate has its own substate: `queued | generating | deploying | running | measuring | scored | failed | killed`.

### Data model (canonical — goes in `lib/population/types.ts`)

```ts
export type RunStatus =
  | 'created' | 'generating' | 'deploying' | 'load_testing'
  | 'scoring' | 'gen_complete' | 'evolving' | 'finished' | 'cancelled' | 'failed'

export type CandidateStatus =
  | 'queued' | 'generating' | 'deploying' | 'running'
  | 'measuring' | 'scored' | 'failed' | 'killed'

export interface RunConfig {
  prompt: string                        // user's original ask
  constraints: {
    maxMonthlyCostINR?: number          // "under ₹10k/month"
    targetRPS?: number                  // "5k users" → we estimate rps
    targetP95ms?: number
    regionHint?: string                 // "GCP asia-south1"
  }
  population: {
    size: number                        // N candidates per generation
    maxGenerations: number              // default 3
    elitismCount: number                // top-K carried over unchanged
  }
  strategy: {
    templates: string[]                 // subset of lib/templates.ts keys
    models: string[]                    // subset of lib/models.json ids
    configVariations: string[]          // e.g. ['postgres', 'sqlite', 'edge', 'node']
  }
  budget: {
    maxSandboxMinutes: number           // hard cap across whole run
    maxLLMTokens: number
    maxUSD: number                      // derived ceiling
  }
  scoring: ScoringWeights
}

export interface Candidate {
  id: string                            // nanoid
  runId: string
  generation: number
  parentIds: string[]                   // [] for gen 0, [id] mutation, [a,b] crossover
  config: {
    template: string
    model: string
    configVariation: string             // one token e.g. 'edge-sqlite'
  }
  status: CandidateStatus
  fragment?: FragmentSchema             // from lib/schema.ts
  sbxId?: string
  url?: string
  metrics?: Metrics
  score?: number
  failureReason?: string
  timings: {
    queuedAt: number
    generatedAt?: number
    deployedAt?: number
    measuredAt?: number
  }
  costs: {
    llmUSD: number                      // from AI SDK usage
    sandboxSeconds: number
  }
}

export interface Metrics {
  p50ms: number
  p95ms: number
  p99ms: number
  errorRate: number                     // 0..1
  throughputRPS: number                 // sustained
  coldStartMs: number                   // time to first healthy response
  peakRSSBytes: number                  // from probe
  bundleSizeBytes?: number              // build artifact
  projectedMonthlyUSD: number           // derived
  samples: number                       // number of requests in the test
}

export interface ScoringWeights {
  latency: number      // default 0.30
  cost: number         // default 0.30
  reliability: number  // default 0.25
  footprint: number    // default 0.15
}

export interface Run {
  id: string
  userId?: string
  createdAt: number
  status: RunStatus
  config: RunConfig
  candidates: Record<string, Candidate>  // id → candidate
  generationIndex: number
  winnerId?: string
  cancelled: boolean
}

export type RunEvent =
  | { type: 'run.created';       run: Run }
  | { type: 'candidate.spawned'; candidate: Candidate }
  | { type: 'candidate.update';  id: string; patch: Partial<Candidate> }
  | { type: 'candidate.metric';  id: string; metrics: Partial<Metrics> }
  | { type: 'generation.end';    gen: number; leaderboard: string[] }
  | { type: 'run.finished';      winnerId: string }
  | { type: 'run.error';         message: string }
```

---

## 2. Phase-by-phase plan

Each phase ends with a demo-able outcome.

### Phase 0 — Rebrand & wiring (0.5–1 day)

**Goal.** Everything reads as EvoStack; nothing functional changes.

**Files to edit (exact changes):**

| File | Change |
|---|---|
| `components/logo.tsx` | Replace Fragments mark with EvoStack wordmark SVG |
| `components/navbar.tsx` | Title `EvoStack`, update social links / tagline |
| `app/layout.tsx` | `metadata.title`, `.description`, OG image |
| `app/page.tsx:253-257` | Update `handleSocialClick` URLs (currently points to fragments repo + e2b twitter) |
| `package.json:2` | `"name": "evostack"` |
| `tailwind.config.ts` | Extend palette — add `brand.primary` (deep indigo), `brand.accent` (lime signal), `brand.danger` |
| `app/globals.css` | Update CSS vars for new palette |
| `components/repo-banner.tsx` | Change to EvoStack repo banner or remove |

**Keep** the Apache-2.0 LICENSE and a "Forked from E2B Fragments" footer line (license obligation + honesty).

**Verify.** `npm run dev` → visually EvoStack. Single-candidate flow still works end-to-end.

---

### Phase 1 — Population manager (4–6 days)

**Goal.** One prompt spawns N candidates in parallel. Each gets its own card showing generation progress + sandbox URL. Everything is still gen-0, no measurement yet.

**New files:**

```
lib/population/
  types.ts                   # the data model above
  strategy.ts                # builds Candidate.config array from RunConfig.strategy
  orchestrator.ts            # Run lifecycle, candidate queue, events
  store.ts                   # KV-backed persistence of Run + Candidates
  events.ts                  # typed event bus (server-side) + SSE encoder

app/api/run/
  route.ts                   # POST: create run, spawn gen-0, return { runId }
  [runId]/route.ts           # GET: SSE stream of RunEvents; DELETE: cancel

components/run/
  run-view.tsx               # replaces single Preview pane
  candidate-grid.tsx         # grid layout of CandidateCards
  candidate-card.tsx         # per-card: status, thumb, URL, logs
  candidate-status-badge.tsx
```

**Exact file changes:**

- `app/page.tsx` — gut the `useObject` block. Replace with:
  ```ts
  const { runId, events, start, cancel } = useEvoRun()
  // start(prompt, constraints) → POST /api/run → opens EventSource to /api/run/:id
  ```
  Replace the right-hand `<Preview>` with `<RunView events={events} />`.

- `lib/schema.ts` — leave `fragmentSchema` untouched. Add a `CandidateSchema` for serialization if needed.

- `lib/prompt.ts:3` — `toPrompt` currently takes `Templates`. Extend to take `(template, variation)` so the `configVariation` ('postgres' / 'sqlite' / 'edge') gets injected as a directive:
  ```ts
  export function toPrompt(template, variation?: string) {
    const base = `You are a skilled software engineer. …`
    const varHint = variation ? `\nArchitecture directive: ${variationToPrompt(variation)}` : ''
    return base + varHint + `\n${templatesToPrompt(template)}`
  }
  ```

- `lib/ratelimit.ts` — add `budgetLimit(userId, cost)` that tracks USD per user per window. Enforce in `/api/run`.

**Strategy — how to sample N candidates:**

```ts
// lib/population/strategy.ts
export function sampleCandidates(cfg: RunConfig): Candidate['config'][] {
  const { templates, models, configVariations } = cfg.strategy
  const N = cfg.population.size
  const all = cartesian(templates, models, configVariations)  // all combos
  if (all.length <= N) return all
  return diversifiedSample(all, N)  // Latin-hypercube-ish: ensure spread across each axis
}
```

Diversification matters: naïve Cartesian truncation will repeat the same template. Use a simple "round-robin then random" — first cycle through each template once, then each model once, then fill from remaining.

**Orchestrator skeleton (server-side):**

```ts
// lib/population/orchestrator.ts
export async function startRun(cfg: RunConfig, userId?: string): Promise<string> {
  const runId = nanoid()
  const configs = sampleCandidates(cfg)
  const run: Run = { id: runId, userId, createdAt: Date.now(), status: 'created',
                     config: cfg, candidates: {}, generationIndex: 0, cancelled: false }

  for (const c of configs) {
    const candidate: Candidate = { id: nanoid(), runId, generation: 0, parentIds: [],
                                   config: c, status: 'queued', timings: { queuedAt: Date.now() },
                                   costs: { llmUSD: 0, sandboxSeconds: 0 } }
    run.candidates[candidate.id] = candidate
  }
  await store.saveRun(run)
  await events.emit(runId, { type: 'run.created', run })

  // Fire-and-forget: worker loop. Do NOT block the API response.
  processRun(runId).catch(err => events.emit(runId, { type: 'run.error', message: String(err) }))
  return runId
}

async function processRun(runId: string) {
  const run = await store.getRun(runId)
  // Gate concurrency: E2B tier cap. Default to 10 parallel.
  const MAX_PARALLEL = Number(process.env.EVOSTACK_MAX_PARALLEL ?? 10)
  await processBatch(Object.values(run.candidates), MAX_PARALLEL, processCandidate)
  // gen complete → later phase triggers evolution
}
```

**Why fire-and-forget, not block?** `POST /api/run` must return the `runId` fast so the client can open the SSE. On Vercel serverless, though, you can't reliably keep work running after the response. **Pick ONE** of these paths:

- **A. Serverless + client-pull per candidate.** `/api/run` returns configs; client spawns N `useObject` hooks, one per card, each hitting `/api/chat` then `/api/sandbox`. Orchestrator logic lives in the browser. Pros: easiest, matches existing pattern. Cons: client must stay open.
- **B. Durable queue.** Use Inngest / Trigger.dev / Upstash QStash to run the worker loop. SSE endpoint tails KV. Pros: robust, cancellation-safe, survives tab close. Cons: new dep.
- **C. Long-lived Node process.** Deploy a small worker next to Vercel (Fly.io, Railway). Pros: most control. Cons: ops overhead.

**Recommendation: start with A, migrate to B at Phase 4 (evolution needs durability).** A is cheapest to build and the MVP user keeps the tab open during a demo anyway.

**Client-side orchestrator (path A):**

```tsx
// components/run/run-view.tsx
function RunView({ runConfig }) {
  const [candidates, setCandidates] = useState<Candidate[]>([])
  useEffect(() => {
    const configs = sampleCandidatesClient(runConfig)  // same strategy, client-side
    setCandidates(configs.map(toQueuedCandidate))
    configs.forEach(c => processCandidate(c, updateCandidate))  // all in parallel
  }, [runConfig])
  return <CandidateGrid candidates={candidates} />
}

function processCandidate(config, onUpdate) {
  // uses useObject.submit() against /api/chat
  // onFinish → POST /api/sandbox
  // each step calls onUpdate(candidateId, patch)
}
```

**SSE schema (for path B, when we get there):**

```
event: candidate.update
data: {"id":"abc","patch":{"status":"deploying","sbxId":"s_123"}}

event: candidate.metric
data: {"id":"abc","metrics":{"p95ms":140}}
```

**Edge cases:**

- One candidate's LLM call fails → mark `status='failed'`, don't kill the run.
- Sandbox quota exhausted → fail all queued candidates gracefully, surface a toast.
- User closes tab mid-run (path A) → sandboxes auto-expire after `timeoutMs`. Cost still accrues for LLM calls in-flight — short abort signal chain via `AbortController`.
- Rate limit hit → exponential backoff per-provider, rotate to next model in strategy.

**Tests (manual for MVP):**
1. Submit prompt with `population.size=4` — 4 cards appear, each becomes a sandbox URL.
2. Cancel mid-run — all sandboxes killed within 5s.
3. One candidate uses a forced-failing model ID — its card shows failed, others complete.

**Demo checkpoint after Phase 1:** "Type prompt → 4 live apps appear side by side, built from different stacks." Already compelling.

---

### Phase 2 — Load harness (4–5 days)

**Goal.** Hit every deployed sandbox with synthetic traffic; collect latency/error/memory numbers.

**New files:**

```
lib/harness/
  workload.ts                # translate RunConfig.constraints → RequestPlan
  runner.ts                  # fires requests, collects timings
  collector.ts               # normalize + percentile
  probes.ts                  # per-template health + memory probes
  index.ts                   # runHarness(candidate) → Metrics

sandbox-templates/_probe/
  probe.js                   # tiny standalone script injected into every sandbox
```

**Workload model:**

```ts
export interface RequestPlan {
  targetRPS: number          // default 10; capped at 50 to protect Vercel egress
  durationSec: number        // default 60
  warmupSec: number          // default 10 (discarded from percentiles)
  scenarios: Scenario[]
}
export interface Scenario {
  name: string
  weight: number             // 0..1
  request: { method: 'GET'|'POST'; path: string; body?: any; headers?: Record<string,string> }
}
```

Scenarios are prompt-derived. For "AI agent platform", default scenarios:
- `GET /` (load home)
- `GET /api/health` (liveness)
- `POST /api/echo` (round-trip)

Users can paste custom cURLs later. For v1, auto-pick scenarios based on template:
- `nextjs-developer` → hit `/` and discovered routes from code AST scan
- `streamlit-developer` → hit `/` only (Streamlit's single-page)
- `gradio-developer` → hit `/` and `/api/predict` (Gradio standard)
- `code-interpreter-v1` → N/A (no HTTP surface — skip harness, score on execution time)

**Runner design:**

```ts
// lib/harness/runner.ts
export async function runHarness(target: string, plan: RequestPlan): Promise<Metrics> {
  const timings: number[] = []
  const errors: Array<{ code: number | 'network'; at: number }> = []
  const controller = new AbortController()
  const endAt = Date.now() + (plan.warmupSec + plan.durationSec) * 1000

  // schedule with rate-limited concurrency
  const limiter = pLimit(Math.max(1, Math.floor(plan.targetRPS * 2)))

  while (Date.now() < endAt) {
    const scenario = pickWeighted(plan.scenarios)
    limiter(async () => {
      const t0 = performance.now()
      try {
        const res = await fetch(target + scenario.request.path, {
          method: scenario.request.method,
          body: scenario.request.body && JSON.stringify(scenario.request.body),
          headers: scenario.request.headers,
          signal: AbortSignal.timeout(10_000),
        })
        const dt = performance.now() - t0
        if (Date.now() > plan.warmupSec * 1000) timings.push(dt)
        if (!res.ok) errors.push({ code: res.status, at: Date.now() })
      } catch (e: any) {
        errors.push({ code: 'network', at: Date.now() })
      }
    })
    await sleep(1000 / plan.targetRPS)
  }

  await limiter.onIdle()
  return collect(timings, errors, plan.durationSec)
}
```

**Memory / CPU probes via E2B shell:**

```ts
// lib/harness/probes.ts
export async function sampleResourceUsage(sbx: Sandbox, candidatePID?: number) {
  // Sample 4x per second for the test duration, average + peak.
  const { stdout } = await sbx.commands.run(
    `cat /proc/meminfo | grep -E '^(MemTotal|MemAvailable):' && \
     ps -eo pid,rss,pcpu --sort=-rss | head -n 5`
  )
  return parseMeminfo(stdout)
}
```

Run this in a background loop (`setInterval` alongside the harness), stop when load test ends.

**Bundle size:**

- Next.js / Vue: `sbx.commands.run('du -sb .next/ 2>/dev/null || du -sb .output/')`
- Streamlit / Gradio: `du -sb app.py requirements.txt`
- Python: `wc -c script.py`

**Cold start:**

Attach a pre-load polling loop: poll `/` every 500ms immediately after sandbox creation until first 2xx. Time elapsed = cold-start.

**Integration:**

`/api/sandbox/route.ts` already returns the URL. After a successful sandbox creation, the orchestrator calls `runHarness(url, plan)` and patches `Candidate.metrics`.

**Hard rules (kill switches):**

- Any candidate whose `p95 > 30s` during warm-up → killed (`sbx.kill()`), status=`killed`, reason='slow_warmup'.
- Error rate > 50% during warm-up → killed.
- RSS > 512MB sustained for 10s → killed.

These are mercy kills — they stop the tournament from waiting on zombies.

**Edge cases:**
- Sandbox dies mid-test (hit E2B timeout) → harness `network` errors spike → mark candidate `failed` with reason `sandbox_timeout`.
- Template = `code-interpreter-v1` has no URL → route to different metric capture (execution time of `sbx.runCode`, not HTTP).

---

### Phase 3 — Scoring & selection (2 days)

**Goal.** Collapse Metrics into a single score; rank candidates.

**New files:**

```
lib/scoring/
  scorer.ts                  # composite score
  weights.ts                 # default + user-tunable
  cost-model.ts              # projected monthly cost from measured rps
  kill-rules.ts              # hard-fail conditions (shared with harness)
```

**Composite score (default, all axes normalized to [0,1] with higher = better):**

```ts
export function score(m: Metrics, w: ScoringWeights): number {
  // normalize each metric against the field's best/worst
  // (done at leaderboard-time, not per-candidate, because we need the relative range)
  const latencyScore     = 1 / (1 + m.p95ms / 1000)         // 0.5 when p95=1s, 0.91 when p95=100ms
  const costScore        = 1 / (1 + m.projectedMonthlyUSD / 100)  // 0.5 at $100/mo
  const reliabilityScore = 1 - m.errorRate
  const footprintScore   = m.bundleSizeBytes ? 1 / (1 + m.bundleSizeBytes / 1_000_000) : 0.5

  return w.latency * latencyScore
       + w.cost * costScore
       + w.reliability * reliabilityScore
       + w.footprint * footprintScore
}
```

Default weights: `{ latency: 0.30, cost: 0.30, reliability: 0.25, footprint: 0.15 }`. Expose in UI as sliders that re-rank without re-running.

**Cost model:**

```ts
// lib/scoring/cost-model.ts
export function projectMonthlyUSD(m: Metrics, template: string, targetRPS: number): number {
  const infraRates = {
    'nextjs-developer':    { perSecond: 0.00005 },  // Vercel Pro estimate
    'vue-developer':       { perSecond: 0.00005 },
    'streamlit-developer': { perSecond: 0.00008 },  // needs full container
    'gradio-developer':    { perSecond: 0.00008 },
    'code-interpreter-v1': { perSecond: 0.00010 },
  }
  const rate = infraRates[template]?.perSecond ?? 0.00006
  const avgConcurrent = (targetRPS * m.p50ms) / 1000   // Little's Law
  const secondsPerMonth = 30 * 24 * 3600
  return avgConcurrent * secondsPerMonth * rate
}
```

**Tournament selection (for Phase 4):**

- Elitism: top-`elitismCount` (default 2) carry over unchanged.
- The rest: stochastic tournament — sample 3 random candidates, pick best, repeat to fill the next generation.

---

### Phase 4 — Evolution loop (4–5 days)

**Goal.** Gen 1+ candidates are derived from gen 0's survivors via mutation and crossover. Best score improves generation-over-generation.

**New files:**

```
lib/evolution/
  selector.ts                # tournament selection, elitism
  mutator.ts                 # calls Morph via existing applyPatch
  crossover.ts               # LLM merges two candidates
  mutation-catalog.ts        # library of mutation prompts
  loop.ts                    # generation stepper
```

**Mutation catalog (hard-coded prompts, chosen based on the candidate's weak spots):**

```ts
export const MUTATIONS = {
  'swap-db-sqlite': {
    trigger: (m) => m.projectedMonthlyUSD > 50,
    prompt: 'Swap the database to SQLite for lower cost, keeping the same query API.',
  },
  'enable-edge-runtime': {
    trigger: (m) => m.p95ms > 500,
    prompt: 'Move the main route to the Edge runtime for lower cold-start and latency.',
  },
  'cache-responses': {
    trigger: (m) => m.p95ms > 300,
    prompt: 'Add in-memory caching with 60s TTL for GET routes that do not mutate state.',
  },
  'reduce-deps': {
    trigger: (m) => m.bundleSizeBytes > 2_000_000,
    prompt: 'Remove the heaviest dependency and replace with a lighter alternative or stdlib.',
  },
  'streamlit-to-gradio': {
    trigger: (cfg) => cfg.template === 'streamlit-developer',
    prompt: 'Rewrite as a Gradio app for lower idle cost.',
  },
}
```

The mutator picks 1–2 triggers whose `trigger(metrics)` returns true and issues a Morph edit.

**Mutator flow (reuses existing infra):**

```ts
// lib/evolution/mutator.ts
export async function mutate(parent: Candidate, mutation: Mutation): Promise<Candidate> {
  // 1. Ask Morph/LLM to produce an edit plan
  const editPlan = await generateObject({
    model: getModelClient(...),
    schema: morphEditSchema,   // reuses lib/schema.ts:58
    system: `You are editing a ${parent.config.template} app. Apply: ${mutation.prompt}`,
    messages: [{ role: 'user', content: parent.fragment.code }],
  })
  // 2. Apply via Morph (reuses lib/morph.ts:4)
  const { code } = await applyPatch({
    targetFile: parent.fragment.file_path,
    instructions: editPlan.object.instruction,
    initialCode: parent.fragment.code,
    codeEdit: editPlan.object.edit,
  })
  // 3. Synthesize new candidate
  return {
    id: nanoid(),
    runId: parent.runId,
    generation: parent.generation + 1,
    parentIds: [parent.id],
    config: { ...parent.config },                    // inherit; mutation can override
    fragment: { ...parent.fragment, code },
    status: 'queued',
    ...
  }
}
```

**Crossover flow:**

```ts
// lib/evolution/crossover.ts
export async function crossover(a: Candidate, b: Candidate): Promise<Candidate> {
  // Use a full-model call (not Morph) because the merge is semantic
  const system = `Merge the best traits of two implementations. Prefer lower-latency patterns from A and lower-cost patterns from B. Output one file.`
  const prompt = `# Implementation A (p95=${a.metrics.p95ms}ms, cost=$${a.metrics.projectedMonthlyUSD})
${a.fragment.code}

# Implementation B (p95=${b.metrics.p95ms}ms, cost=$${b.metrics.projectedMonthlyUSD})
${b.fragment.code}
`
  const result = await streamObject({ model, schema: fragmentSchema, system, messages: [...]})
  return { ..., parentIds: [a.id, b.id], generation: Math.max(a.generation, b.generation) + 1 }
}
```

**Generation loop:**

```ts
// lib/evolution/loop.ts
export async function nextGeneration(run: Run): Promise<Candidate[]> {
  const ranked = rankCandidates(run.candidates, run.config.scoring)
  const elites = ranked.slice(0, run.config.population.elitismCount)
  const needed = run.config.population.size - elites.length

  const children: Candidate[] = []
  for (let i = 0; i < needed; i++) {
    if (Math.random() < 0.7) {
      // mutation
      const parent = tournamentSelect(ranked)
      const mutation = pickTriggeredMutation(parent.metrics!, parent.config)
      children.push(await mutate(parent, mutation))
    } else {
      // crossover
      const a = tournamentSelect(ranked)
      const b = tournamentSelect(ranked, a.id)
      children.push(await crossover(a, b))
    }
  }
  return [...elites, ...children]
}
```

**Termination conditions:**

```ts
function shouldStop(run: Run): boolean {
  const last = bestScoreOfGen(run, run.generationIndex)
  const prev = bestScoreOfGen(run, run.generationIndex - 1)
  if (run.generationIndex >= run.config.population.maxGenerations) return true
  if (prev && (last - prev) / prev < 0.02) return true          // <2% improvement
  if (run.totalCostUSD >= run.config.budget.maxUSD) return true
  if (run.cancelled) return true
  return false
}
```

**This is the phase where we NEED the durable queue (path B).** Evolution is 3 generations × N candidates × ~90s each = easily 20+ minutes. Can't rely on a single Vercel invocation. Wire Inngest or Upstash QStash here.

---

### Phase 5 — Tournament dashboard (3–4 days)

**Goal.** The demo money-shot. Make the competition visible and dramatic.

**New files:**

```
components/run/
  leaderboard.tsx            # sortable, live-updating
  candidate-card.tsx         # already created in Phase 1 — extend now
  metric-sparkline.tsx       # little inline chart per candidate
  score-radar.tsx            # 4-axis radar per candidate
  generation-timeline.tsx    # gen-0, gen-1, gen-2 timeline with score band
  kill-feed.tsx              # "Candidate #12 died: OOM" ticker
  winner-pane.tsx            # big expanded view at end
```

**Charting:** use `recharts` (already small) or `@tremor/react` (higher-level). Pick one.

**Visual language:**

- Alive candidates: card with live thumbnail of `url` (iframe or screenshot every 5s).
- Measuring: spinner over thumbnail + live latency tick.
- Scored: card border color = quartile (green / yellow / orange / red).
- Killed: 💀 overlay + reason in tooltip.
- Leaderboard: top-5 pinned, others collapsed. Click to expand to full card.
- Generation timeline: horizontal axis = generations, vertical = score, points = candidates, lines connect parents → children. This makes evolution visually legible.

**Live updates:** client opens `EventSource('/api/run/:id')`, receives `RunEvent` stream, patches local state via reducer. No polling.

---

### Phase 6 — Export winner (2–3 days)

**Goal.** The winning sandbox becomes a downloadable, deploy-ready repo.

**New files:**

```
app/api/export/[runId]/
  route.ts                   # GET → streams a .zip
lib/export/
  repo-builder.ts            # tar the sandbox fs via sbx.files.read
  terraform.ts               # generate deploy files per target cloud
  dockerfile.ts              # per-template Dockerfile
  scorecard.ts               # markdown report
```

**Flow:**

1. Resolve winner candidate → `sbxId`.
2. **Problem**: sandbox may have expired by export time (10-min cap). Mitigation:
   - (a) Immediately after the run ends, before the sandbox expires, snapshot the filesystem into KV / blob storage.
   - (b) Keep a "preservation" flag that extends the winning sandbox's lifetime via a follow-up `Sandbox.create` with the winner's code.
   - Ship (a).
3. Generate deploy artifacts for chosen target:
   - Google Cloud Run: `cloud-run.tf` + `cloudbuild.yaml`
   - Vercel: `vercel.json`
   - Fly.io: `fly.toml`
4. Compose scorecard.md:
   ```markdown
   # EvoStack Winner Report
   Run: {runId} · Prompt: "{prompt}"
   Winner: candidate {id} ({template} + {model} + {variation})

   ## Why this won
   - p95 latency: 52ms (best of {N})
   - Projected monthly cost: $3,100 (2nd-lowest)
   - Error rate: 0.01% under 500rps load test
   - Bundle: 840KB

   ## Competitors
   | # | Template | p95 | $/mo | err | score |
   |---|----------|-----|------|-----|-------|
   | 87 | nextjs+sqlite+edge | 52ms | $3.1k | 0.01% | **0.87** |
   | 23 | vue+postgres | 140ms | $4.8k | 0.2% | 0.81 |
   ...
   ```
5. Zip everything, stream response.

---

### Phase 7 — Polish & safety (ongoing)

**Budget guardrails (do this ALONGSIDE Phase 1, not last):**

- Hard `maxUSD` cap per run. Orchestrator refuses to spawn a gen if projected cost exceeds remaining budget.
- Before fan-out, estimate cost of generating N candidates (avg 4k tokens × N × $/Mtoken for chosen model) + N × sandbox-minutes. Show user a "This run will cost approx $X" confirmation.
- Per-user daily cap stored in Upstash KV.

**Observability:**

- PostHog already wired (`app/providers.tsx`) — emit events per candidate lifecycle transition.
- Add a `/api/run/:id/debug` endpoint that dumps timings + costs for retrospective analysis.

**Run history:**

- Supabase table `runs` and `candidates` (mirror of KV). Enables the "past runs" sidebar + run comparison.

**Share URL:**

- Public read-only view of a finished run — `/r/:runId` that reads from KV + Supabase, no auth. Great for sharing the demo.

**Custom metrics:**

- Plugin shape in `lib/scoring/weights.ts`: `customMetrics: Array<{ name, scoreFn, weight }>`. Users can paste a Lighthouse score, accessibility audit, or a custom assertion.

---

## 3. Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Runaway cost (100 sandboxes × 3 gens) | High | High | Hard budget caps, pre-run estimate, kill-on-exceed |
| E2B concurrent cap hit | High | Med | Queue + `MAX_PARALLEL` env var; surface clearly in UI |
| LLM rate limits cascade | Med | Med | Provider rotation in strategy; exponential backoff |
| Single-file schema too limiting | High | Med | Flip to array schema at Phase 4 when apps get real; Morph already file-aware |
| Sandbox 10-min timeout < full lifecycle | Med | High | Snapshot fs at scoring time; never depend on sandbox being alive at export |
| `maxDuration=60` on sandbox route | Med | Med | Move sandbox creation to client-direct call, or split install into separate route |
| Harness RPS causes Vercel egress cost | Low | Low | Cap at 50 rps; run harness from sandbox-side if needed (shell `wrk`) |
| Scoring bias (Next always wins because fastest cold start) | Med | Med | Normalize per-template expectations; weight cost higher for Python templates |
| User closes tab during run (path A) | High | Med | Migrate to durable queue at Phase 4 |

---

## 4. File-by-file summary (what we'll touch or create)

```
Will create:
  lib/population/{types,strategy,orchestrator,store,events}.ts
  lib/harness/{workload,runner,collector,probes,index}.ts
  lib/scoring/{scorer,weights,cost-model,kill-rules}.ts
  lib/evolution/{selector,mutator,crossover,mutation-catalog,loop}.ts
  lib/export/{repo-builder,terraform,dockerfile,scorecard}.ts
  app/api/run/route.ts
  app/api/run/[runId]/route.ts
  app/api/run/[runId]/cancel/route.ts
  app/api/export/[runId]/route.ts
  components/run/{run-view,candidate-grid,candidate-card,
                  leaderboard,metric-sparkline,score-radar,
                  generation-timeline,kill-feed,winner-pane,
                  candidate-status-badge}.tsx
  sandbox-templates/_probe/probe.js

Will modify:
  app/page.tsx              - replace single-preview flow with RunView
  app/layout.tsx            - metadata
  components/logo.tsx       - rebrand
  components/navbar.tsx     - rebrand + links
  components/repo-banner.tsx- remove or retheme
  lib/prompt.ts             - accept variation directive
  lib/ratelimit.ts          - add budget-limit
  lib/schema.ts             - (Phase 4+) flip to array form
  tailwind.config.ts        - palette
  app/globals.css           - palette vars
  package.json              - name + add deps (recharts, p-limit, inngest?)

Will leave alone:
  lib/models.{ts,json}      - reused as-is
  lib/templates.ts          - reused; sampled by strategy
  lib/morph.ts              - reused by mutator
  app/api/chat/route.ts     - still used, one call per candidate
  app/api/sandbox/route.ts  - still used, one call per candidate
  app/api/morph-chat/route.ts - still used during mutation
  components/ui/*           - shadcn, reuse
  components/fragment-*.tsx - reuse inside CandidateCard's expanded view
```

---

## 5. Build order (critical path)

```
Phase 0 rebrand                 [1 day]
   │
   ▼
Phase 1 population manager      [5 days]      ◄── THE hard phase; de-risks everything
   │
   ├─── Phase 7 budget caps     [2 days]      ◄── MUST ship with Phase 1 or bankruptcy
   │
   ▼
Phase 2 load harness            [5 days]
   │
   ▼
Phase 3 scoring                 [2 days]
   │
   ▼
Phase 4 evolution loop          [5 days]      ◄── requires durable queue (Inngest)
   │
   ▼
Phase 5 tournament dashboard    [4 days]      ◄── polish of the MVP shown in Phase 1
   │
   ▼
Phase 6 export winner           [3 days]
   │
   ▼
Phase 7 polish (ongoing)
```

**Total: ~5 weeks of solo engineering for a demo-ready build.** Parallelizable with a second engineer starting Phase 5 in parallel with Phase 3/4.

---

## 6. Demo storyboard (college project pitch)

The demo is engineered into the plan. Each phase makes the demo more compelling — you can demo at the end of any phase.

1. **"I need a creator platform with AI chatbots, GCP, under ₹10k/month, 5k MAU."**
2. EvoStack estimates: "This run will cost ~$0.80 in LLM + sandbox time. Continue? [Yes]"
3. 20 candidate cards materialize, each a different stack. Live iframes flicker on. (Phase 1)
4. Latency bars fill in as the harness runs. (Phase 2)
5. Leaderboard re-ranks. Top candidate glows green. (Phase 3)
6. Gen 1 spawns — cards animate with "mutated from #03: swapped Postgres → SQLite". (Phase 4)
7. Kill feed: "💀 Candidate #12 died: OOM on 450rps"
8. Gen 2 settles. Winner: Next.js + SQLite + Edge. Score 0.87. (Phase 5)
9. Click **Export**. `.zip` downloads. `cd winner-87 && terraform apply` → live on Cloud Run. (Phase 6)
10. Open scorecard: "₹3,100/month · p95 52ms · 5000-user stress test passed."

**Headline for the pitch:** *"Built a working SaaS in 20 minutes instead of 2 weeks, at 60% lower cost — and we can prove it, because we tested 60 alternatives."*

---

## 7. What we're deliberately NOT building in v1

- Not a general IDE. No multi-file editing beyond Morph's file-local scope.
- Not a new sandbox. E2B is the substrate forever.
- Not model fine-tuning. Evolution is prompt/config level, not weights.
- Not multi-region deploy in v1. Winner export targets one region.
- Not real user testing. Synthetic load only. "500rps harness" is not the same as "5k real users", and the scorecard will say so.
- Not a marketplace of templates. `lib/templates.ts` is curated, additions are PRs.

Each of these is a good phase-8+ follow-up. None are blockers for the demo.

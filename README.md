
. # EvoStack . 


**AI that builds, deploys, and battle-tests 100 versions of your app — then hands you the winner.**

You describe the idea. EvoStack generates dozens of implementations with different tech stacks, deploys each to a real cloud sandbox, hits them with synthetic traffic, measures cost / latency / reliability, evolves the survivors, and ships you the champion as deploy-ready code.

---

## The Pitch (30 seconds)

```
You:       "Creator platform with AI chatbots, GCP, under ₹10k/month"
EvoStack:  spawns 100 candidate stacks
           → deploys each to E2B sandbox
           → runs load test (500 rps, 60s)
           → scores: latency, cost-projection, error rate, bundle size
           → kills bottom 50%, mutates the top 50%
           → repeats for N generations
You get:   1 winner repo + scorecard + one-click deploy to GCP
```

Think AI code tournament. Best code survives. You ship the champion.

---

## Why

| Problem | EvoStack |
|--------|----------|
| Picking a stack is guesswork | Empirically tests the tradeoffs |
| Manual MVP takes 2–3 months | Runs an evolutionary search in ~1 hour |
| Scaling surprises hit in prod | Load tests every candidate before you commit |
| Cost overruns discovered late | Projects monthly cost per candidate up front |

---

## How It's Built

EvoStack is forked from [E2B Fragments](https://github.com/e2b-dev/fragments) — the Next.js + Vercel AI SDK + E2B sandbox scaffold that already knows how to turn a prompt into a running app inside a secure sandbox.

We extend it with:

- **Population manager** — spawns N candidates in parallel, each with different template / model / config
- **Synthetic traffic harness** — hammers each sandbox with a configurable workload
- **Scorer** — collects latency percentiles, error rate, memory, cost estimate, bundle size
- **Evolution loop** — selection, mutation (prompt rewrites), crossover (merge winning patterns)
- **Tournament dashboard** — live bracket of candidates competing in real time
- **Export** — dumps winner as a git repo + Terraform / Cloud Run deploy files

---

## Quickstart

```bash
npm install
cp .env.template .env.local   # fill in keys
npm run dev
```

Required keys:

- `E2B_API_KEY` — sandbox runtime ([e2b.dev](https://e2b.dev))
- At least one LLM provider: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GROQ_API_KEY`, …

Optional:

- `MORPH_API_KEY` — faster / cheaper code-editing for mutation step
- `SUPABASE_URL` / `SUPABASE_ANON_KEY` — auth + run history
- `KV_REST_API_URL` / `KV_REST_API_TOKEN` — rate limit + short URLs

---

## Status

Early development. Foundation (prompt → one candidate → sandbox) inherited from Fragments. Tournament layer is in progress — see [`PLAN.md`](./PLAN.md) for the build roadmap.

---

## License

Apache-2.0 (inherited from E2B Fragments).

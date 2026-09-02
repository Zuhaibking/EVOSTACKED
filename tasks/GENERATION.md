# Generation engine — next agent brief

The old LLM generation pipeline was removed. Arena UI, auth, runs, memory, and restore still work. New generation plugs in here.

## What still exists

- **Arena** (`apps/app/app/app/page.tsx`) — command bar, 3 specimen chips, preview, vault, history.
- **Runs API** — `POST/GET /v1/runs`, messages, brain, candidates, fragments, versions.
- **SSE client** — `useTournament()` still POSTs `/v1/tournament` and applies `TournamentEvent`s.
- **Follow-up** — `submit()` still POSTs `/v1/chat` or `/v1/morph`, then `/v1/sandbox`.

## Scaffold to implement (501 today)

| Route | File | Job |
|-------|------|-----|
| `POST /v1/tournament` | `apps/api/src/generation/tournament.runner.ts` → `handleTournament` | Plan → generate Product / Premium / Innovate → SSE events → persist candidates |
| `POST /v1/chat` | `apps/api/src/generation/chat.runner.ts` → `handleChat` | One-shot fragment JSON |
| `POST /v1/morph` | `apps/api/src/generation/morph.runner.ts` → `handleMorph` | Targeted file edit |
| `POST /v1/sandbox` | `apps/api/src/generation/sandbox.runner.ts` → `handleSandbox` | Deploy fragment, return `{ url, sbxId, template }` |

Controllers already persist the user message and call these handlers. Keep that. Return a `Response` (JSON or SSE). Adapter: `apps/api/src/generation/fetch-request.ts`.

## Controllers already pass you

- `runId`, `userID`, `messages`, `model`, `config`, `template`
- `memoryVersion` / `memoryPack`
- Tournament: `llmCache.get/set`, `persistCandidate`, `updateCandidate`

## Event contract the UI already understands

`apps/app/lib/tournament.ts` — `TournamentEvent`:
`plan`, `candidate_start`, `candidate_delta`, `candidate_done`, `candidate_error`, `candidate_skipped`, `candidate_architecture_checking`, `candidate_verified`, `candidate_repairing`, `candidate_tested`, `provider_quota`, `verdict`, `tournament_done`

Variants: `minimal` (Product), `rich` (Premium), `playful` (Innovate) — `VARIANTS` in the same file.

## Types you can reuse

- Fragment: `apps/app/lib/schema.ts`, `apps/app/lib/fragment.ts`
- Models catalog: `apps/app/lib/model-catalog.ts`, `apps/app/lib/models.json`
- Plan: `apps/app/lib/plan.ts`
- Stored candidate rows: `apps/app/lib/tournament-candidate-record.ts`

Do not restore the old 1k-line runners. Write a smaller engine.

## Deleted (do not hunt for them)

Prompts, model client, tournament queue, verify/repair/smoke runners, integrity chain, skills packs, stack advisor, morph SDK, E2B transport, CLI `preview`/`bench`.

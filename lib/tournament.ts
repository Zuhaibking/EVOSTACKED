import { z } from 'zod'

export const VARIANTS = [
  {
    id: 'minimal',
    label: 'Minimalist',
    sigil: 'M',
    temperature: 0.3,
    systemSuffix:
      'Bias toward minimalism, restraint, generous whitespace, and visual silence. Strip ornamentation. A monochrome palette with one careful accent. Prefer simple typography hierarchies.',
  },
  {
    id: 'rich',
    label: 'Editorial',
    sigil: 'E',
    temperature: 0.7,
    systemSuffix:
      'Bias toward editorial density: considered typography pairings, layered detail, evocative copy, structured sections, and a magazine-grade rhythm. Use a refined accent color and tasteful texture.',
  },
  {
    id: 'playful',
    label: 'Vivid',
    sigil: 'V',
    temperature: 1.0,
    systemSuffix:
      'Bias toward vivid personality: bold color, unexpected layout, decorative motion, and friendly micro-copy. Make the page feel alive without becoming chaotic. Decorative motion must stay legal: never pair spring/inertia with 3+ keyframe arrays.',
  },
] as const

export type VariantId = (typeof VARIANTS)[number]['id']

/** Public identity of the model that produced a candidate (shown on tabs / evidence board). */
export type CandidateModel = { id: string; name: string; providerId: string }

/** A server-side model slot. Every id must also be listed in lib/models.json (getModelClient allowlist). */
export type BattleModel = CandidateModel & { provider: string; temperature?: number }

const GPT41: BattleModel = { id: 'gpt-4.1', name: 'GPT-4.1', provider: 'OpenAI', providerId: 'openai' }
const GPT5_MINI: BattleModel = { id: 'gpt-5-mini', name: 'GPT-5 mini', provider: 'OpenAI', providerId: 'openai' }

/**
 * Multi-model battle: each design direction runs on a different provider. The
 * first model whose provider key is configured is tried; on failure the next
 * entry takes over (so a quota-exhausted provider degrades to a distinct
 * OpenAI configuration instead of a dead candidate). gpt-4.1 honours
 * temperature, so the fallbacks still differ in sampling as well as direction.
 * Verified 2026-11-26 against the server keys — see the TOURNAMENT report.
 */
export const BATTLE_LINEUP: Record<VariantId, BattleModel[]> = {
  minimal: [
    { ...GPT41, temperature: 0.3 },
  ],
  rich: [
    { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash', provider: 'Google', providerId: 'google', temperature: 0.7 },
    { ...GPT41, temperature: 0.7 },
  ],
  // Flash-Lite leads: ~6 s and schema-valid in live runs. MiniMax (NVIDIA NIM) stays as the
  // second choice — it was the only fast NIM model, but under load it failed fragment
  // validation ("Web projects require a reusable component") and scored 0.15 with the judge.
  playful: [
    { id: 'gemini-3.1-flash-lite', name: 'Gemini 3.1 Flash-Lite', provider: 'Google', providerId: 'google', temperature: 1.0 },
    { id: 'minimaxai/minimax-m3.1-flash', name: 'MiniMax M3.1 Flash', provider: 'NVIDIA', providerId: 'nvidia', temperature: 1.0 },
    { ...GPT41, temperature: 1.0 },
  ],
}

/** Judge preference: the first entry that is not one of this run's competitors wins the seat. */
export const JUDGE_CANDIDATES: BattleModel[] = [GPT5_MINI, { id: 'gpt-4o-mini', name: 'GPT-4o mini', provider: 'OpenAI', providerId: 'openai' }, GPT41]
/** Second judge attempt (required by the spec: never fabricate scores). */
export const JUDGE_RETRY: BattleModel = GPT41

const PROVIDER_KEYS: Record<string, string[]> = {
  openai: ['OPENAI_API_KEY'],
  google: ['GOOGLE_GENERATIVE_AI_API_KEY'],
  nvidia: ['NVIDIA_API_KEY'],
}

/** Server-only: is a provider usable with the server's own keys? */
export function providerConfigured(providerId: string, env: Record<string, string | undefined> = process.env): boolean {
  const keys = PROVIDER_KEYS[providerId]
  return Boolean(keys && keys.some((key) => (env[key] || '').trim()))
}

/** Ordered, de-duplicated attempts for one variant (only providers whose server key exists). */
export function battleAttempts(id: VariantId, env?: Record<string, string | undefined>): BattleModel[] {
  const chain = BATTLE_LINEUP[id].filter((m) => providerConfigured(m.providerId, env))
  return chain.length ? chain : [{ ...GPT41, temperature: VARIANTS.find((v) => v.id === id)?.temperature }]
}

export function pickJudge(competitorIds: Iterable<string>): BattleModel {
  const used = new Set(competitorIds)
  return JUDGE_CANDIDATES.find((m) => !used.has(m.id)) ?? GPT41
}

export function publicModel(m: { id: string; name: string; providerId: string }): CandidateModel {
  return { id: m.id, name: m.name, providerId: m.providerId }
}

// LLM-facing schema (OpenAI structured outputs: no optional fields).
export const verdictSchema = z.object({
  winnerId: z
    .enum(['minimal', 'rich', 'playful'])
    .describe('Id of the candidate that best fulfils the brief.'),
  reasoning: z
    .string()
    .describe('One short sentence explaining the verdict in editorial voice.'),
  scores: z
    .array(
      z.object({
        id: z.enum(['minimal', 'rich', 'playful']),
        clarity: z.number().min(0).max(1),
        fit: z.number().min(0).max(1),
        polish: z.number().min(0).max(1),
        composite: z.number().min(0).max(1),
        comment: z
          .string()
          .describe('One short critique of this candidate, ~10 words.'),
      }),
    )
    .describe('One scoring entry per candidate.'),
})

export type JudgeVerdict = z.infer<typeof verdictSchema>

/** Scores are null when the judge was unavailable — never fabricated. */
export type VerdictScore = {
  id: VariantId
  clarity: number | null
  fit: number | null
  polish: number | null
  composite: number | null
  comment: string
}

export type Verdict = {
  /** null when the verdict is provisional (no judge) — the client reconciles a winner from evidence/health. */
  winnerId: VariantId | null
  reasoning: string
  scores: VerdictScore[]
  /** true when both judge attempts failed; scores are null and nothing was invented. */
  provisional?: boolean
  judge?: CandidateModel | null
}

export type TournamentEvent =
  | { type: 'candidate_start'; id: VariantId; label: string; sigil: string; model?: CandidateModel; note?: string }
  | { type: 'candidate_chunk'; id: VariantId; fragment: any; model?: CandidateModel }
  | { type: 'candidate_done'; id: VariantId; fragment: any; model?: CandidateModel }
  | { type: 'candidate_error'; id: VariantId; error: string; model?: CandidateModel }
  | { type: 'verdict'; verdict: Verdict }
  | { type: 'tournament_done' }

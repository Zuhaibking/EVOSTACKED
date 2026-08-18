/**
 * Controlled generation output budgets — avoid TPM blowups.
 * ZERO network / LLM calls.
 */
import type { ApplicationPlan } from '@/lib/plan'

export type GenerationBudgetTier = 'small' | 'medium' | 'large'

/**
 * Soft caps for a single streamObject (evolution / chat / one in-flight job).
 * Caps still prevent runaway 47k requests.
 */
export const GENERATION_MAX_TOKENS = {
  small: 8000,
  medium: 14000,
  large: 20000,
} as const

/**
 * Per-job caps when Product / Premium / Innovate stream concurrently.
 * Raised once (medium 10k→14k, large 14k→18k) after Step-2 evidence:
 * survivors already emitted ~15–19k chars under a 10k cap with a *null*
 * plan; richer shared plans + quality prompts need solo-medium headroom
 * without returning to the old 3×20k TPM blowups.
 */
export const CONCURRENT_GENERATION_MAX_TOKENS = {
  small: 6000,
  medium: 14000,
  large: 18000,
} as const

export function resolveGenerationBudgetTier(
  plan?: ApplicationPlan | null,
): GenerationBudgetTier {
  const c = plan?.complexity
  if (c === 'simple') return 'small'
  if (c === 'complex') return 'large'
  // Heuristic: many pages / features → bump medium toward large
  const pages = plan?.pages?.length ?? 0
  const features = plan?.coreFeatures?.length ?? 0
  if (pages >= 6 || features >= 8) return 'large'
  if (c === 'medium') return 'medium'
  return 'medium'
}

export function resolveGenerationMaxTokens(
  plan?: ApplicationPlan | null,
  opts?: { userMaxTokens?: number | null; concurrentJobs?: number },
): number {
  const tier = resolveGenerationBudgetTier(plan)
  const concurrent = (opts?.concurrentJobs ?? 1) >= 2
  const budget = concurrent
    ? CONCURRENT_GENERATION_MAX_TOKENS[tier]
    : GENERATION_MAX_TOKENS[tier]
  const user = opts?.userMaxTokens
  if (typeof user === 'number' && Number.isFinite(user) && user > 0) {
    return Math.min(Math.floor(user), budget)
  }
  return budget
}

/** Merge into AI SDK model params. concurrentJobs >= 2 uses the parallel cap. */
export function withGenerationTokenBudget(
  modelParams: Record<string, unknown>,
  plan?: ApplicationPlan | null,
  opts?: { concurrentJobs?: number },
): Record<string, unknown> {
  const userMax =
    typeof modelParams.maxTokens === 'number'
      ? (modelParams.maxTokens as number)
      : null
  return {
    ...modelParams,
    maxTokens: resolveGenerationMaxTokens(plan, {
      userMaxTokens: userMax,
      concurrentJobs: opts?.concurrentJobs,
    }),
  }
}

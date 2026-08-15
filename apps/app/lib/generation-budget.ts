/**
 * Controlled generation output budgets — avoid TPM blowups.
 * ZERO network / LLM calls.
 */
import type { ApplicationPlan } from '@/lib/plan'

export type GenerationBudgetTier = 'small' | 'medium' | 'large'

/**
 * Soft caps for streamObject maxTokens.
 *
 * Historical TPM blowups came from THREE concurrent generations.
 * Tournament generation is sequential now, so each candidate can use a
 * full multi-file budget without tripling TPM. Caps still prevent runaway
 * 47k requests.
 */
export const GENERATION_MAX_TOKENS = {
  small: 8000,
  medium: 14000,
  large: 20000,
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
  opts?: { userMaxTokens?: number | null },
): number {
  const tier = resolveGenerationBudgetTier(plan)
  const budget = GENERATION_MAX_TOKENS[tier]
  const user = opts?.userMaxTokens
  if (typeof user === 'number' && Number.isFinite(user) && user > 0) {
    return Math.min(Math.floor(user), budget)
  }
  return budget
}

/** Merge into AI SDK model params without inventing concurrent generations. */
export function withGenerationTokenBudget(
  modelParams: Record<string, unknown>,
  plan?: ApplicationPlan | null,
): Record<string, unknown> {
  const userMax =
    typeof modelParams.maxTokens === 'number'
      ? (modelParams.maxTokens as number)
      : null
  return {
    ...modelParams,
    maxTokens: resolveGenerationMaxTokens(plan, { userMaxTokens: userMax }),
  }
}

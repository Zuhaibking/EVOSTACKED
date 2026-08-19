/**
 * Per-role model routing.
 *
 * The pipeline runs four different jobs against an LLM, and they do not need
 * the same model. Planning and repair are small structured edits; generation is
 * the quality-critical one the user actually looks at. Routing the cheap roles
 * to cheap models is where the budget goes.
 *
 * Rules that are not negotiable:
 * - BYOK (config.apiKey) disables routing. That key belongs to the provider the
 *   user chose; sending it anywhere else would leak it and fail auth.
 * - A preferred model is only used when it is in the catalog, its provider has a
 *   server key, and it supports structured output (every role uses generateObject
 *   or streamObject).
 * - Anything unresolvable falls back to the user's selected model, so a missing
 *   key degrades cost, never correctness.
 *
 * ZERO network / LLM calls. Defaults are benchmark-tunable — see lib/benchmark.ts.
 */
import {
  LLMModel,
  LLMModelConfig,
  findCatalogModel,
  resolveProviderApiKey,
} from '@/lib/model-catalog'

export type ModelRole = 'plan' | 'generate' | 'repair' | 'morph'

/**
 * economy  — cheap models everywhere, for sweeps and experiments.
 * balanced — spend on generation, save on plan/repair/morph. Default.
 * quality  — the user's selected model for every role (pre-router behavior).
 */
export type BudgetMode = 'economy' | 'balanced' | 'quality'

export const BUDGET_MODES: readonly BudgetMode[] = [
  'economy',
  'balanced',
  'quality',
] as const

/** null = use the user's selected model for this role. */
type RoleTable = Record<ModelRole, string | null>

/**
 * Single-provider defaults: OpenAI is the only credential we trust in this
 * deployment, so the cheap roles use gpt-4.1-mini rather than another provider.
 * Generation stays on the user's model — it is the only output users see.
 * Rates: gpt-4.1 $2/$8 per M vs gpt-4.1-mini $0.40/$1.60 per M.
 * Re-measure with `pnpm --filter @evostack/app bench`.
 */
export const ROUTING_TABLE: Record<BudgetMode, RoleTable> = {
  economy: {
    plan: 'gpt-4.1-mini',
    generate: 'gpt-4.1-mini',
    repair: 'gpt-4.1-mini',
    morph: 'gpt-4.1-mini',
  },
  balanced: {
    // Plan stays on the user's model. Measured 2026-08-19: gpt-4.1-mini failed
    // applicationPlanSchema validation (emitted role "combobox", not in the
    // enum) — a plan retry costs more than the mini saves. repair/morph use
    // 4-field schemas, which the mini handles fine.
    plan: null,
    generate: null,
    repair: 'gpt-4.1-mini',
    morph: 'gpt-4.1-mini',
  },
  quality: {
    plan: null,
    generate: null,
    repair: null,
    morph: null,
  },
}

export function resolveBudgetMode(
  raw: string | null | undefined = process.env.EVOSTACK_MODEL_MODE,
): BudgetMode {
  const value = (raw || '').trim().toLowerCase()
  return (BUDGET_MODES as readonly string[]).includes(value)
    ? (value as BudgetMode)
    : 'balanced'
}

/**
 * Usable for a routed role: in catalog, structured output, server key present,
 * and not a local-only model (never auto-route to something that needs Ollama).
 */
export function isRoutableModel(modelId: string): boolean {
  const model = findCatalogModel(modelId)
  if (!model) return false
  if (model.localOnly) return false
  if (model.capabilities?.structuredOutput === false) return false
  // No BYOK key here on purpose — routing may only use server-side credentials.
  return !!resolveProviderApiKey(model.providerId)
}

export type RoutedModel = {
  model: LLMModel
  role: ModelRole
  mode: BudgetMode
  /** False when the role fell back to the user's model. */
  routed: boolean
  reason: 'routed' | 'byok' | 'quality_mode' | 'unavailable' | 'same_model'
}

/**
 * Pick the model for one role. Always returns a usable model — the user's
 * selection is the floor.
 */
export function routeModel(opts: {
  role: ModelRole
  userModel: LLMModel
  config?: LLMModelConfig
  mode?: BudgetMode
}): RoutedModel {
  const mode = opts.mode ?? resolveBudgetMode()
  const base = {
    model: opts.userModel,
    role: opts.role,
    mode,
  }

  if (opts.config?.apiKey?.trim()) {
    return { ...base, routed: false, reason: 'byok' }
  }

  const preferredId = ROUTING_TABLE[mode][opts.role]
  if (!preferredId) {
    return { ...base, routed: false, reason: 'quality_mode' }
  }
  if (preferredId === opts.userModel.id) {
    return { ...base, routed: false, reason: 'same_model' }
  }
  if (!isRoutableModel(preferredId)) {
    return { ...base, routed: false, reason: 'unavailable' }
  }

  const model = findCatalogModel(preferredId)
  if (!model) {
    return { ...base, routed: false, reason: 'unavailable' }
  }
  return { ...base, model, routed: true, reason: 'routed' }
}

/**
 * Config for a routed role. Drops the user's `model` string so the AI SDK client
 * is built from the routed model id, and never forwards a BYOK key to a
 * different provider (routeModel already refuses to route in that case).
 */
export function routedConfig(
  config: LLMModelConfig,
  routed: RoutedModel,
): LLMModelConfig {
  if (!routed.routed) return config
  const { model: _userModelId, apiKey: _byok, baseURL: _baseURL, ...rest } = config
  return { ...rest, model: routed.model.id }
}

export function describeRoute(routed: RoutedModel): string {
  return `${routed.role}=${routed.model.id}${routed.routed ? '' : ` (${routed.reason})`}`
}

/**
 * OpenAI / provider quota classification — deterministic, zero extra LLM calls.
 * Extends rate-limit helpers without provider fallback.
 */
export {
  PROVIDER_RETRY_COUNT,
  PROVIDER_MAX_ATTEMPTS,
  PROVIDER_MAX_BACKOFF_MS,
  PROVIDER_BASE_BACKOFF_MS,
  isProviderRateLimitError,
  parseRetryAfterMs,
  computeBackoffMs,
  withProviderRetry,
  sanitizeProviderErrorMessage,
} from './provider-retry'

import {
  isProviderRateLimitError,
  isDailyRequestLimitError,
  parseRetryAfterMs,
  sanitizeProviderErrorMessage,
} from './provider-retry'

/** UI / preflight provider capacity. */
export type ProviderBudgetState =
  | 'ready'
  | 'rate_limited'
  | 'daily_limit_reached'
  | 'temporarily_rate_limited'

/** Machine classification of a 429 / rate-limit error. */
export type ProviderQuotaKind =
  | 'daily_limit'
  | 'tpm'
  | 'temporary'
  | 'none'

export type ProviderQuotaClassification = {
  kind: ProviderQuotaKind
  budgetState: ProviderBudgetState
  /** True when bounded retries may help (TPM / temporary). Never for daily RPD. */
  retryable: boolean
  /** Abort remaining tournament candidates immediately. */
  abortTournament: boolean
  message: string
  retryAfterMs: number | null
  /** Short label for chips / diagnostics. */
  label: string
}

export const PROVIDER_BUDGET_LABELS: Record<ProviderBudgetState, string> = {
  ready: 'READY',
  rate_limited: 'RATE LIMITED',
  daily_limit_reached: 'DAILY LIMIT REACHED',
  temporarily_rate_limited: 'TEMPORARILY RATE LIMITED',
}

export const DAILY_LIMIT_USER_MESSAGE =
  'OpenAI daily request limit reached. No generation was attempted for the remaining candidates.'

export const TPM_LIMIT_USER_MESSAGE =
  'OpenAI tokens-per-minute (TPM) limit reached. Wait for the window to reset, then retry. Candidates are generated one at a time.'

export const TEMPORARY_RATE_LIMIT_USER_MESSAGE =
  'OpenAI is temporarily rate limiting requests. Please try again shortly.'

function errorText(error: unknown): string {
  if (!error || typeof error !== 'object') return String(error || '')
  const e = error as Record<string, any>
  return [
    e.message,
    e.error?.message,
    e.data?.error?.message,
    e.cause?.message,
    typeof e.error === 'string' ? e.error : '',
  ]
    .filter(Boolean)
    .join(' ')
}

/**
 * Classify OpenAI 429 / rate-limit payloads into RPD vs TPM vs temporary.
 * Deterministic — no network.
 */
export function classifyProviderQuotaError(
  error: unknown,
): ProviderQuotaClassification {
  const retryAfterMs = parseRetryAfterMs(error)
  if (!isProviderRateLimitError(error)) {
    return {
      kind: 'none',
      budgetState: 'ready',
      retryable: false,
      abortTournament: false,
      message: sanitizeProviderErrorMessage(error),
      retryAfterMs,
      label: PROVIDER_BUDGET_LABELS.ready,
    }
  }

  // Requests per day (RPD) — do not retry; abort remaining candidates.
  if (isDailyRequestLimitError(error)) {
    return {
      kind: 'daily_limit',
      budgetState: 'daily_limit_reached',
      retryable: false,
      abortTournament: true,
      message: DAILY_LIMIT_USER_MESSAGE,
      retryAfterMs,
      label: PROVIDER_BUDGET_LABELS.daily_limit_reached,
    }
  }

  const msg = errorText(error).toLowerCase()

  // Tokens per minute (TPM)
  if (
    /\btpm\b/.test(msg) ||
    /tokens?\s+per\s+min/.test(msg) ||
    /tokens?\s+per\s+minute/.test(msg)
  ) {
    return {
      kind: 'tpm',
      budgetState: 'rate_limited',
      retryable: true,
      abortTournament: false,
      message: TPM_LIMIT_USER_MESSAGE,
      retryAfterMs,
      label: PROVIDER_BUDGET_LABELS.rate_limited,
    }
  }

  // Requests per minute / generic temporary 429
  return {
    kind: 'temporary',
    budgetState: 'temporarily_rate_limited',
    retryable: true,
    abortTournament: false,
    message: TEMPORARY_RATE_LIMIT_USER_MESSAGE,
    retryAfterMs,
    label: PROVIDER_BUDGET_LABELS.temporarily_rate_limited,
  }
}

/** Map budget state for UI chips. */
export function providerBudgetLabel(state: ProviderBudgetState): string {
  return PROVIDER_BUDGET_LABELS[state]
}

/**
 * Pure planner: after a generation failure, which remaining slots to skip?
 * Does not mutate candidates — tournament route applies the plan.
 */
export function planQuotaAbortForRemaining(opts: {
  classification: ProviderQuotaClassification
  failedId: string
  remainingIds: string[]
}): {
  abort: boolean
  skipIds: string[]
  message: string
  budgetState: ProviderBudgetState
} {
  if (!opts.classification.abortTournament) {
    return {
      abort: false,
      skipIds: [],
      message: opts.classification.message,
      budgetState: opts.classification.budgetState,
    }
  }
  return {
    abort: true,
    skipIds: opts.remainingIds.filter((id) => id !== opts.failedId),
    message: opts.classification.message,
    budgetState: 'daily_limit_reached',
  }
}

/**
 * True when a failed OpenAI call must not wipe prior session artifacts.
 * Always true for quota errors — callers must preserve brain/vault/preview.
 */
export function quotaFailurePreservesSession(error: unknown): boolean {
  const kind = classifyProviderQuotaError(error).kind
  return kind === 'daily_limit' || kind === 'tpm' || kind === 'temporary'
}

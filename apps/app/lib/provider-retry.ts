/**
 * Provider rate-limit handling for OpenAI generation.
 *
 * Deterministic helpers + bounded retry. No provider fallback.
 * Never logs or returns API keys.
 */
export const PROVIDER_RETRY_COUNT = 3
/** Initial attempt + PROVIDER_RETRY_COUNT retries. */
export const PROVIDER_MAX_ATTEMPTS = PROVIDER_RETRY_COUNT + 1

/** Cap so we never sleep endlessly on a bad Retry-After. */
export const PROVIDER_MAX_BACKOFF_MS = 90_000
export const PROVIDER_BASE_BACKOFF_MS = 15_000

export type ProviderRetryOptions = {
  maxAttempts?: number
  /** Injected for tests — defaults to real setTimeout sleep. */
  sleep?: (ms: number) => Promise<void>
  /** Optional observer (tests / telemetry). Never receives secrets. */
  onRetry?: (info: {
    attempt: number
    maxAttempts: number
    delayMs: number
    reason: string
  }) => void
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Detect OpenAI / provider TPM / rate-limit errors without treating
 * unrelated "limit" strings (e.g. schema) as rate limits when no status.
 */
export function isProviderRateLimitError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const e = error as Record<string, any>
  const status =
    e.statusCode ??
    e.status ??
    e.response?.status ??
    e.data?.status ??
    e.cause?.statusCode ??
    e.cause?.status

  if (status === 429) return true

  const msg = String(e.message || e.error?.message || '').toLowerCase()
  if (!msg) return false

  if (
    msg.includes('rate limit') ||
    msg.includes('rate_limit') ||
    msg.includes('too many requests') ||
    msg.includes('tpm') ||
    msg.includes('tokens per min') ||
    msg.includes('requests per min') ||
    msg.includes('429')
  ) {
    return true
  }

  // AI SDK often wraps: "Retrying..." / "Rate limit reached for gpt-4.1"
  if (msg.includes('limit reached') && msg.includes('gpt')) return true

  return false
}

/**
 * Daily request quota (RPD) will not recover via short backoff — never retry.
 */
export function isDailyRequestLimitError(error: unknown): boolean {
  if (!isProviderRateLimitError(error)) return false
  const e = error as Record<string, any>
  const msg = [
    e.message,
    e.error?.message,
    e.data?.error?.message,
    e.cause?.message,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  return (
    /\brpd\b/.test(msg) ||
    /requests?\s+per\s+day/.test(msg) ||
    /daily\s+(request|quota|limit)/.test(msg) ||
    (/limit\s+\d+/.test(msg) && /used\s+\d+/.test(msg) && /per\s+day/.test(msg))
  )
}

/**
 * Parse Retry-After from error payload or header value.
 * Supports seconds (number/string) and HTTP-date (ignored → null).
 */
export function parseRetryAfterMs(
  error?: unknown,
  retryAfterHeader?: string | null,
): number | null {
  const header = retryAfterHeader?.trim()
  if (header) {
    const asNum = Number(header)
    if (Number.isFinite(asNum) && asNum >= 0) {
      return Math.min(Math.round(asNum * 1000), PROVIDER_MAX_BACKOFF_MS)
    }
  }

  if (!error || typeof error !== 'object') return null
  const e = error as Record<string, any>
  const raw =
    e.retryAfter ??
    e.retry_after ??
    e.responseHeaders?.['retry-after'] ??
    e.response?.headers?.['retry-after'] ??
    e.cause?.responseHeaders?.['retry-after']

  if (raw == null) {
    // Sometimes embedded in message: "Please try again in 20s"
    const msg = String(e.message || '')
    const m = msg.match(/try again in\s+(\d+(?:\.\d+)?)\s*s/i)
    if (m) {
      return Math.min(
        Math.round(parseFloat(m[1]) * 1000),
        PROVIDER_MAX_BACKOFF_MS,
      )
    }
    return null
  }

  const n = Number(raw)
  if (Number.isFinite(n) && n >= 0) {
    // Heuristic: values <= 180 are seconds; larger look like ms.
    const ms = n <= 180 ? n * 1000 : n
    return Math.min(Math.round(ms), PROVIDER_MAX_BACKOFF_MS)
  }
  return null
}

/**
 * Exponential backoff, preferring Retry-After when present.
 * attempt is 0-based index of the failure that triggered the wait.
 */
export function computeBackoffMs(
  attempt: number,
  retryAfterMs?: number | null,
): number {
  if (retryAfterMs != null && retryAfterMs > 0) {
    return Math.min(retryAfterMs, PROVIDER_MAX_BACKOFF_MS)
  }
  const exp = Math.min(
    PROVIDER_BASE_BACKOFF_MS * Math.pow(2, Math.max(0, attempt)),
    PROVIDER_MAX_BACKOFF_MS,
  )
  return Math.round(exp)
}

/**
 * Run an async provider call with bounded retries on rate limits only.
 * Non-rate-limit errors fail immediately (no endless loop).
 */
export async function withProviderRetry<T>(
  fn: (attempt: number) => Promise<T>,
  opts: ProviderRetryOptions = {},
): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? PROVIDER_MAX_ATTEMPTS
  const sleep = opts.sleep ?? sleepMs
  let lastError: unknown

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn(attempt)
    } catch (error) {
      lastError = error
      const isRate = isProviderRateLimitError(error)
      // RPD / daily quota will not recover within tournament — fail fast.
      if (isDailyRequestLimitError(error)) {
        throw error
      }
      const hasRetryLeft = attempt < maxAttempts
      if (!isRate || !hasRetryLeft) {
        throw error
      }
      const retryAfterMs = parseRetryAfterMs(error)
      const delayMs = computeBackoffMs(attempt - 1, retryAfterMs)
      opts.onRetry?.({
        attempt,
        maxAttempts,
        delayMs,
        reason: 'rate_limit',
      })
      await sleep(delayMs)
    }
  }

  throw lastError
}

/** Sanitize error messages so API keys never appear in UI/events. */
export function sanitizeProviderErrorMessage(error: unknown): string {
  let msg =
    error && typeof error === 'object' && 'message' in error
      ? String((error as any).message || 'Generation failed')
      : String(error || 'Generation failed')

  msg = msg
    .replace(/sk-[a-zA-Z0-9]{10,}/g, '[redacted]')
    .replace(/Bearer\s+[A-Za-z0-9._-]{10,}/gi, 'Bearer [redacted]')
    .replace(/api[_-]?key["']?\s*[:=]\s*["']?[^"'\s]+/gi, 'api_key=[redacted]')
    .replace(/OPENAI_API_KEY\s*=\s*\S+/gi, 'OPENAI_API_KEY=[redacted]')

  return msg.slice(0, 400)
}

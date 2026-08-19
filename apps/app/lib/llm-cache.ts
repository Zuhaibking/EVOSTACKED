import { createHash } from 'node:crypto'

export type LlmCacheLookup = {
  get: (args: { promptHash: string }) => Promise<unknown | null>
  set: (args: { promptHash: string; payload: unknown }) => Promise<void>
}

/**
 * Stable hash for LLM cache keys. Include model, temperature, and the
 * relevant input (plan brief / repair evidence) in `value`.
 */
export function stablePromptHash(value: unknown): string {
  const text =
    typeof value === 'string' ? value : JSON.stringify(value ?? null)
  return createHash('sha256').update(text).digest('hex').slice(0, 32)
}

export function llmModelCacheId(model: {
  id?: string
  providerId?: string
}): string {
  const id = (model.id || 'unknown').trim()
  const provider = (model.providerId || 'unknown').trim()
  return `${provider}:${id}`
}

/** Best-effort cache wrap — never fail the caller if the cache is down. */
export async function readLlmCache(
  cache: LlmCacheLookup | undefined,
  promptHash: string,
): Promise<unknown | null> {
  if (!cache) return null
  try {
    return await cache.get({ promptHash })
  } catch (err) {
    console.warn(
      '[evostack:llm-cache] get failed',
      err instanceof Error ? err.message : err,
    )
    return null
  }
}

export async function writeLlmCache(
  cache: LlmCacheLookup | undefined,
  promptHash: string,
  payload: unknown,
): Promise<void> {
  if (!cache) return
  try {
    await cache.set({ promptHash, payload })
  } catch (err) {
    console.warn(
      '[evostack:llm-cache] set failed',
      err instanceof Error ? err.message : err,
    )
  }
}

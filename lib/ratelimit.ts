import { Duration, ms } from './duration'
import { Ratelimit } from '@upstash/ratelimit'
import { kv } from '@vercel/kv'

export type RateLimitResult = { amount: number; reset: number; remaining: number }

/** A caller paying with their own provider key gets a higher ceiling, in a separate bucket. */
export const OWN_KEY_LIMIT_MULTIPLIER = 10

// Survives dev hot reloads. ponytail: per-instance only; multi-instance deploys need KV.
const memory: Map<string, number[]> = ((globalThis as { __evoRateLimit?: Map<string, number[]> }).__evoRateLimit ??= new Map())
const MEMORY_KEYS = 10_000

export function clientIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  return forwarded || req.headers.get('x-real-ip')?.trim() || 'unknown'
}

/** Per-user bucket when signed in, otherwise per client IP. */
export function rateLimitKey(req: Request, userId?: string | null, ownKey = false): string {
  return `${userId ? `user:${userId}` : `ip:${clientIp(req)}`}${ownKey ? ':own-key' : ''}`
}

// Legacy callers pass a raw x-forwarded-for value (possibly null or a proxy list).
function bucketFor(key: string | null): string {
  if (key && /^(user|ip):/.test(key)) return key
  return `ip:${key?.split(',')[0]?.trim() || 'unknown'}`
}

function memoryLimit(bucket: string, max: number, windowMs: number): RateLimitResult | undefined {
  const now = Date.now()
  const hits = (memory.get(bucket) ?? []).filter((t) => t > now - windowMs)
  memory.delete(bucket)
  if (hits.length >= max) {
    memory.set(bucket, hits)
    return { amount: max, remaining: 0, reset: hits[0] + windowMs }
  }
  hits.push(now)
  memory.set(bucket, hits)
  if (memory.size > MEMORY_KEYS) memory.delete(memory.keys().next().value!)
  return undefined
}

/** Returns the limit details when the caller is over the limit; always enforced (KV, else in-memory). */
export default async function ratelimit(
  key: string | null,
  maxRequests: number,
  window: Duration,
): Promise<RateLimitResult | undefined> {
  const bucket = bucketFor(key)
  // The shared dev server serves a whole team from one IP: keep a limit, but a roomy one.
  const max =
    process.env.NODE_ENV === 'development' && !process.env.RATE_LIMIT_MAX_REQUESTS
      ? Math.max(maxRequests, 1000)
      : Math.max(1, maxRequests)

  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    try {
      const limiter = new Ratelimit({ redis: kv, limiter: Ratelimit.slidingWindow(max, window) })
      const { success, limit, reset, remaining } = await limiter.limit(`ratelimit_${bucket}`)
      return success ? undefined : { amount: limit, reset, remaining }
    } catch (error) {
      console.warn('[ratelimit] KV unavailable, using in-memory limiter', error instanceof Error ? error.name : error)
    }
  }
  return memoryLimit(bucket, max, ms(window))
}

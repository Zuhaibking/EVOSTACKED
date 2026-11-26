/**
 * Shared helpers for the per-project platform REST API (`/api/p/[projectId]/…`).
 * `_lib` is a private folder → never routable.
 */
import { getUserId } from '@/lib/server-auth'
import { getCollection, getMeta, isValidProjectId, PlatformError } from '@/lib/platform/db'
import type { Collection, PlatformMeta } from '@/lib/platform/types'

export const PUBLIC_BODY_LIMIT = 32 * 1024
export const OWNER_BODY_LIMIT = 512 * 1024
/** Per client IP + project, per minute (reads and creates combined). */
const RATE_LIMIT = 30
/** Per project, per minute, all IPs combined: spoofed / rotating IPs can never exceed these. */
const PROJECT_CEILING = { read: 300, create: 60 } as const
const RATE_WINDOW_MS = 60_000
const MAX_BUCKETS = 10_000
const SWEEP_EVERY_MS = 15_000

export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Evo-Source',
  'Access-Control-Allow-Private-Network': 'true',
  'Access-Control-Max-Age': '86400',
}

export function json(data: unknown, init: { status?: number; cors?: boolean; headers?: Record<string, string> } = {}): Response {
  return Response.json(data, {
    status: init.status ?? 200,
    headers: { 'Cache-Control': 'no-store', ...(init.cors ? CORS_HEADERS : {}), ...(init.headers ?? {}) },
  })
}

export function preflight(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS })
}

export function errorResponse(e: unknown, cors = false): Response {
  if (e instanceof PlatformError) {
    return json({ error: e.code, message: e.message, ...(e.details ? { errors: e.details } : {}) }, { status: e.status, cors })
  }
  console.error('[platform] request failed', e)
  return json({ error: 'internal_error', message: 'Something went wrong' }, { status: 500, cors })
}

/**
 * Website semantics: explicit `x-evo-source: website`, or a browser cross-site fetch
 * (Sec-Fetch-Site is set by the browser, so a generated site can't pose as the dashboard
 * even when the dev auth bypass is on).
 */
export function isWebsiteRequest(req: Request): boolean {
  if ((req.headers.get('x-evo-source') || '').trim().toLowerCase() === 'website') return true
  const site = req.headers.get('sec-fetch-site')
  return site === 'cross-site' || site === 'same-site'
}

export type ProjectAccess = { meta: PlatformMeta; userId: string | null; owner: boolean; website: boolean }

/** Resolve project + caller. Returns a Response for invalid id / not provisioned. */
export async function access(req: Request, projectId: string, cors = false): Promise<ProjectAccess | Response> {
  if (!isValidProjectId(projectId)) return json({ error: 'invalid_project_id' }, { status: 400, cors })
  const website = isWebsiteRequest(req)
  const userId = website ? null : await getUserId()
  const meta = getMeta(projectId)
  if (!meta) return json({ error: 'not_provisioned' }, { status: 404, cors })
  return { meta, userId, website, owner: !!userId && userId === meta.ownerId }
}

/** Owner-only guard: 401 signed out, 403 not the owner (or website semantics), 404 not provisioned. */
export async function requireOwner(req: Request, projectId: string): Promise<ProjectAccess | Response> {
  if (!isValidProjectId(projectId)) return json({ error: 'invalid_project_id' }, { status: 400 })
  if (isWebsiteRequest(req)) return json({ error: 'forbidden', message: 'Owner access required' }, { status: 403 })
  const userId = await getUserId()
  if (!userId) return json({ error: 'unauthorized', message: 'Sign in to continue.' }, { status: 401 })
  const meta = getMeta(projectId)
  if (!meta) return json({ error: 'not_provisioned' }, { status: 404 })
  if (meta.ownerId !== userId) return json({ error: 'forbidden', message: 'Only the project owner can do this' }, { status: 403 })
  return { meta, userId, website: false, owner: true }
}

export function collectionOr404(meta: PlatformMeta, key: string, cors = false): Collection | Response {
  return getCollection(meta, key) ?? json({ error: 'unknown_collection', message: `Unknown collection: ${String(key).slice(0, 60)}` }, { status: 404, cors })
}

/**
 * Non-owner collection gate: rate limit FIRST (probing is throttled too), then one uniform
 * 404 for unknown AND non-public collections, so keys / labels can't be enumerated.
 */
export function publicCollection(req: Request, a: ProjectAccess, key: string, op: RateKind): Collection | Response {
  const limited = rateLimit(req, a.meta.projectId, op)
  if (limited) return limited
  const c = getCollection(a.meta, key)
  if (!c || !(op === 'read' ? c.publicRead : c.publicCreate)) return json({ error: 'not_found' }, { status: 404, cors: true })
  return c
}

// ───────────────────────── in-memory public rate limit (per IP + project, plus a per-project ceiling) ─────────────────────────
type Bucket = { count: number; resetAt: number }
export type RateKind = 'read' | 'create'
const g = globalThis as typeof globalThis & { __evoPlatformRate?: Map<string, Bucket>; __evoPlatformRateProject?: Map<string, Bucket> }
/** Insertion order = least recently used first (touched buckets are re-inserted). */
const buckets: Map<string, Bucket> = g.__evoPlatformRate ?? (g.__evoPlatformRate = new Map())
/** Separate map so a flood of per-IP keys can never evict a project's ceiling. Keys only exist for provisioned projects. */
const projectBuckets: Map<string, Bucket> = g.__evoPlatformRateProject ?? (g.__evoPlatformRateProject = new Map())
let lastSweep = 0

/**
 * Client IP for rate limiting. x-vercel-forwarded-for / x-real-ip are only trusted behind a proxy
 * that sets them (Vercel, or EVOSTACK_TRUSTED_PROXY=1). Otherwise the RIGHT-most x-forwarded-for hop
 * (the one our own proxy appended; Next fills it from the socket when absent) — never the
 * client-controlled left-most one.
 */
export function clientIp(req: Request): string {
  const h = req.headers
  const hops = (v: string | null) => (v || '').split(',').map((s) => s.trim()).filter(Boolean)
  if (process.env.EVOSTACK_TRUSTED_PROXY === '1' || process.env.VERCEL) {
    const trusted = hops(h.get('x-vercel-forwarded-for'))[0] || hops(h.get('x-real-ip'))[0]
    if (trusted) return trusted.slice(0, 64)
  }
  const fwd = hops(h.get('x-forwarded-for'))
  return (fwd[fwd.length - 1] || 'local').slice(0, 64)
}

function take(map: Map<string, Bucket>, key: string, now: number): Bucket {
  let b = map.get(key)
  if (!b || b.resetAt <= now) b = { count: 0, resetAt: now + RATE_WINDOW_MS }
  map.delete(key)
  map.set(key, b)
  b.count++
  return b
}

function limitedResponse(b: Bucket, limit: number, now: number): Response | null {
  if (b.count <= limit) return null
  return json({ error: 'rate_limited', message: 'Too many requests, try again in a minute.' }, {
    status: 429,
    cors: true,
    headers: {
      'X-RateLimit-Limit': String(limit),
      'X-RateLimit-Remaining': '0',
      'X-RateLimit-Reset': String(Math.ceil(b.resetAt / 1000)),
      'Retry-After': String(Math.max(1, Math.ceil((b.resetAt - now) / 1000))),
    },
  })
}

/**
 * Returns a 429 Response when the caller exceeded 30 req/min for this project, or the project
 * as a whole exceeded its per-minute ceiling for `kind` (all IPs combined), else null.
 */
export function rateLimit(req: Request, projectId: string, kind: RateKind = 'read'): Response | null {
  const now = Date.now()
  if (now - lastSweep > SWEEP_EVERY_MS) {
    lastSweep = now
    for (const map of [buckets, projectBuckets]) for (const [k, b] of map) if (b.resetAt <= now) map.delete(k)
  }
  const ip = take(buckets, `${clientIp(req)}|${projectId}`, now)
  while (buckets.size > MAX_BUCKETS) buckets.delete(buckets.keys().next().value!)
  // A single (non-spoofing) client stopped here does not eat into the project's shared ceiling.
  const perIp = limitedResponse(ip, RATE_LIMIT, now)
  if (perIp) return perIp
  return limitedResponse(take(projectBuckets, `${projectId}|${kind}`, now), PROJECT_CEILING[kind], now)
}

// ───────────────────────── bodies ─────────────────────────
/** Reads JSON (or form-encoded) bodies with a hard byte cap. */
export async function readBody(req: Request, maxBytes: number, cors = false): Promise<{ body: unknown } | Response> {
  const declared = Number(req.headers.get('content-length') || 0)
  if (declared > maxBytes) return json({ error: 'payload_too_large', message: `Body exceeds ${Math.round(maxBytes / 1024)} KB` }, { status: 413, cors })
  let text = ''
  if (req.body) {
    const reader = req.body.getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > maxBytes) {
        try { await reader.cancel() } catch { /* ignore */ }
        return json({ error: 'payload_too_large', message: `Body exceeds ${Math.round(maxBytes / 1024)} KB` }, { status: 413, cors })
      }
      chunks.push(value)
    }
    const all = new Uint8Array(size)
    let off = 0
    for (const c of chunks) { all.set(c, off); off += c.byteLength }
    text = new TextDecoder().decode(all)
  }
  if (!text.trim()) return { body: {} }
  const type = (req.headers.get('content-type') || '').toLowerCase()
  if (type.includes('application/x-www-form-urlencoded')) {
    return { body: Object.fromEntries(new URLSearchParams(text)) }
  }
  try {
    return { body: JSON.parse(text) }
  } catch {
    return json({ error: 'invalid_json', message: 'Body must be valid JSON' }, { status: 400, cors })
  }
}

/** `{data: {...}}` per contract; a bare object is accepted too. */
export function dataOf(body: unknown): Record<string, unknown> {
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    const b = body as Record<string, unknown>
    if (b.data && typeof b.data === 'object' && !Array.isArray(b.data)) return b.data as Record<string, unknown>
    return b
  }
  return {}
}

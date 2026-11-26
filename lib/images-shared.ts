export const IMAGE_SCHEME = 'evo-image://'
export const IMAGE_DIR = 'public/evo-images'
export const IMAGE_PUBLIC = '/evo-images'
export const IMAGE_UA =
  'EvoStack/0.1 (website builder; real image resolver; https://github.com/Zuhaibking/EVOSTACKED)'
/** One stock search request; a slow provider must not burn the shared photo budget. */
export const PROVIDER_TIMEOUT_MS = 6_000

const MIN_BYTES = 2048
const MAX_BYTES = 8 * 1024 * 1024

export type ImageAspect = 'landscape' | 'portrait' | 'square'

export type ImageCandidate = {
  title: string
  url: string
  width?: number
  height?: number
  source: string
  sourcePage?: string
  creator?: string
  creatorUrl?: string
  license?: string
  licenseVersion?: string
  licenseUrl?: string
  filesize?: number
  provider: string
  description?: string
  tags?: string[]
  fieldsMatched?: string[]
}

export function isSafeImageUrl(raw: string): boolean {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return false
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
  return !hostBlocked(u.hostname)
}

function hostBlocked(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (
    h === 'localhost' ||
    h.endsWith('.localhost') ||
    h.endsWith('.local') ||
    h === '0.0.0.0' ||
    h === '::1' ||
    h === 'metadata.google.internal'
  ) {
    return true
  }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) {
    const p = h.split('.').map(Number)
    if (p[0] === 10 || p[0] === 127 || p[0] === 0) return true
    if (p[0] === 169 && p[1] === 254) return true
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true
    if (p[0] === 192 && p[1] === 168) return true
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true
  }
  if (h.startsWith('fe80:') || h.startsWith('fc') || h.startsWith('fd')) return true
  return false
}

export function validateImageBytes(
  bytes: Uint8Array,
  contentType: string,
): { mime: string; ext: string } | null {
  if (!bytes || bytes.byteLength < MIN_BYTES || bytes.byteLength > MAX_BYTES) {
    return null
  }
  if (looksLikeHtml(bytes)) return null
  const magic = sniffImage(bytes)
  if (!magic) return null
  const ct = contentType.split(';')[0].trim().toLowerCase()
  if (ct && !ct.startsWith('image/') && ct !== 'application/octet-stream') {
    return null
  }
  if (ct.startsWith('image/') && ct !== 'image/svg+xml') {
    const fromCt = extForMime(ct)
    if (fromCt) return { mime: ct, ext: fromCt }
  }
  return magic
}

export function imageByteLimits() {
  return { min: MIN_BYTES, max: MAX_BYTES }
}

export function sniffImage(bytes: Uint8Array): { mime: string; ext: string } | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { mime: 'image/jpeg', ext: 'jpg' }
  }
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return { mime: 'image/png', ext: 'png' }
  }
  if (
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38
  ) {
    return { mime: 'image/gif', ext: 'gif' }
  }
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return { mime: 'image/webp', ext: 'webp' }
  }
  return null
}

function looksLikeHtml(bytes: Uint8Array): boolean {
  const head = new TextDecoder('utf-8', { fatal: false })
    .decode(bytes.subarray(0, 80))
    .trimStart()
    .toLowerCase()
  return (
    head.startsWith('<!doctype') ||
    head.startsWith('<html') ||
    head.startsWith('<head') ||
    head.startsWith('<?xml')
  )
}

function extForMime(mime: string): string | null {
  if (mime === 'image/jpeg' || mime === 'image/jpg') return 'jpg'
  if (mime === 'image/png') return 'png'
  if (mime === 'image/webp') return 'webp'
  if (mime === 'image/gif') return 'gif'
  return null
}

// ponytail: process-local breaker; multiple hosts each learn a dead provider on their own.
const BREAKER_FAILURES = 3
const BREAKER_COOLDOWN_MS = 5 * 60 * 1000
const breakers = new Map<string, { failures: number; openUntil: number }>()

/** False while a provider's breaker is open (3 consecutive failures → skipped for 5 minutes). */
export function providerAvailable(name: string): boolean {
  const state = breakers.get(name)
  return !state || state.openUntil <= Date.now()
}

/**
 * Records one request outcome. Empty results are a success; HTTP errors,
 * network errors and the provider's own timeout are failures. Callers skip
 * recording when the shared photo budget (not the provider) aborted the request.
 * `cooldownMs` shortens the pause when the tripping failure is transient (HTTP 429).
 */
export function recordProvider(name: string, ok: boolean, cooldownMs = BREAKER_COOLDOWN_MS) {
  if (ok) {
    breakers.delete(name)
    return
  }
  const state = breakers.get(name) || { failures: 0, openUntil: 0 }
  state.failures += 1
  if (state.failures >= BREAKER_FAILURES) {
    state.openUntil = Date.now() + cooldownMs
    state.failures = 0
    console.warn(`[images] ${name} unavailable; skipping it for ${Math.round(cooldownMs / 1000)} s`)
  }
  breakers.set(name, state)
}

export function resetProviderBreakers() {
  breakers.clear()
}

/** Shared provider fetch: short timeout, breaker bookkeeping, never throws. */
export async function providerJson(
  provider: string,
  url: string,
  signal?: AbortSignal,
  { record = true }: { record?: boolean } = {},
): Promise<unknown | null> {
  try {
    signal?.throwIfAborted()
    const res = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': IMAGE_UA,
      },
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(PROVIDER_TIMEOUT_MS)])
        : AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    })
    if (!res.ok) {
      console.warn(`[images] ${provider} http ${res.status}`)
      if (record) recordProvider(provider, false)
      return null
    }
    const data: unknown = await res.json()
    if (record) recordProvider(provider, true)
    return data
  } catch (err) {
    if (!signal?.aborted) {
      console.warn(
        `[images] ${provider} search failed`,
        err instanceof Error ? err.message : err,
      )
      if (record) recordProvider(provider, false)
    }
    return null
  }
}

/** Lowercase file-name stem for an image query. */
export function imageSlug(query: string, max = 48): string {
  return (
    query
      .toLowerCase()
      .replace(/#(landscape|portrait|square)\s*$/, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, max)
      .replace(/-+$/g, '') || 'image'
  )
}

/** "subject, setting #portrait" → { query: "subject, setting", aspect: "portrait" }. */
export function parseImageRef(ref: string): { query: string; aspect?: ImageAspect } {
  const m = /\s*#(landscape|portrait|square)\s*$/i.exec(ref)
  if (!m) return { query: ref.trim() }
  return { query: ref.slice(0, m.index).trim(), aspect: m[1].toLowerCase() as ImageAspect }
}

import { fragmentFiles, type WrittenFile } from './fragment-files'
import { fragmentCodeText } from './schema'

export const IMAGE_VALIDATE_MS = 4_000
export const IMAGE_RESOLVE_MS = 20_000

/** 'unknown' means the probe could not decide — the model's URL is kept. */
export type ImageProbeResult = 'ok' | 'dead' | 'unknown'

export type ImageProbe = (url: string, timeoutMs: number) => Promise<ImageProbeResult>

export type ImageCacheEntry = { verdict: ImageProbeResult; at: number }

export type ImageUrlValidator = {
  validate: (url: string) => Promise<ImageProbeResult>
  cache: Map<string, ImageCacheEntry>
}

/** One image occurrence in a source file, anchored at its exact offset. */
export type ImageSlot = {
  url: string
  index: number
  alt: string
  seed?: string
  width?: number
  height?: number
}

export type ResolvedImage = { from: string; to: string; query: string }

export type ImageResolveOptions = {
  apiKey?: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

const IMAGE_EXT = /\.(?:jpe?g|png|gif|webp|avif|svg)(?:\?|#|$)/i
const STOCK_HOST =
  /(?:unsplash\.com|picsum\.photos|loremflickr\.com|via\.placeholder\.com|placehold\.co|placeholder\.com|dummyimage\.com|placekitten\.com|placeimg\.com|lorem\.space|pixabay\.com|burst\.shopify\.com|pinimg\.com|pinterest\.com|i\.imgur\.com|googleusercontent\.com|images\.pexels\.com)$/i
const IMAGE_KEY =
  /(?:src|srcSet|poster|image|imageUrl|img|photo|thumbnail|cover|avatar|banner|hero|logo|background)\s*[:=]\s*['"`]?$/i
/** The marker A4 teaches the model to emit: picsum.photos/seed/<query>/W/H */
const PICSUM_SEED = /^https?:\/\/picsum\.photos\/seed\/([^/?#]+)(?:\/(\d+))?(?:\/(\d+))?/i

const CACHE_MAX = 2_000
const NEGATIVE_TTL_MS = 5 * 60_000
const RESOLVE_CONCURRENCY = 6

export function placeholderDataUri(purpose = 'image'): string {
  const label = xmlEscape(String(purpose).trim().slice(0, 60) || 'image')
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800">' +
    '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
    '<stop offset="0%" stop-color="#2a2a2a"/><stop offset="100%" stop-color="#111"/>' +
    '</linearGradient></defs><rect width="1200" height="800" fill="url(#g)"/>' +
    `<text x="600" y="400" fill="#8a8a8a" font-family="system-ui,sans-serif" font-size="40" text-anchor="middle">${label}</text>` +
    '<text x="600" y="456" fill="#5a5a5a" font-family="system-ui,sans-serif" font-size="24" text-anchor="middle">image unavailable</text>' +
    '</svg>'
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

export function looksLikeImageBytes(bytes?: Uint8Array | null): boolean {
  if (!bytes || bytes.length < 3) return false
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return true
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e) return true
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return true
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46) return true
  // ISO-BMFF ("....ftyp"): avif/heic — both Unsplash and Pexels serve avif when Accept allows it
  if (bytes.length >= 12) {
    const box = new TextDecoder().decode(bytes.subarray(4, 8))
    if (box === 'ftyp') return true
  }
  const head = new TextDecoder().decode(bytes.subarray(0, 80)).trimStart().toLowerCase()
  return head.startsWith('<svg') || head.startsWith('<?xml')
}

/** Every image URL occurrence, keeping its offset so replacement can splice by index. */
export function findImageSlots(code: string): ImageSlot[] {
  if (!code) return []
  const slots: ImageSlot[] = []
  for (const m of code.matchAll(/https?:\/\/[^\s"'`)<>\\]+/g)) {
    const raw = m[0]
    const url = raw.replace(/[.,;]+$/, '')
    const index = m.index ?? 0
    if (!isRemoteImageUrl(url, code, index)) continue
    const seed = PICSUM_SEED.exec(url)
    slots.push({
      url,
      index,
      alt: nearestAlt(code, index),
      seed: seed ? decodeURIComponent(seed[1]) : undefined,
      width: seed && seed[2] ? Number(seed[2]) : undefined,
      height: seed && seed[3] ? Number(seed[3]) : undefined,
    })
  }
  return slots
}

export async function defaultImageProbe(url: string, timeoutMs: number): Promise<ImageProbeResult> {
  if (!/^https?:\/\//i.test(url)) return 'dead'
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        Accept: 'image/*,*/*;q=0.1',
        Range: 'bytes=0-255',
      },
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (res.status === 403 || res.status === 404 || res.status === 410) {
      await cancelBody(res)
      return 'dead'
    }
    if (!res.ok && res.status !== 206) {
      await cancelBody(res)
      return 'unknown'
    }
    const ct = (res.headers.get('content-type') || '').toLowerCase()
    if (ct.includes('text/html') || ct.includes('application/json')) {
      await cancelBody(res)
      return 'dead'
    }
    if (ct.startsWith('image/')) {
      await cancelBody(res)
      return 'ok'
    }
    const reader = res.body?.getReader()
    if (!reader) return 'unknown'
    const { value } = await reader.read()
    await reader.cancel()
    return looksLikeImageBytes(value) ? 'ok' : 'unknown'
  } catch {
    // timeout / DNS / TLS — a server-side hiccup must never delete the model's URL
    return 'unknown'
  }
}

export function createImageUrlValidator(opts?: {
  probe?: ImageProbe
  timeoutMs?: number
}): ImageUrlValidator {
  const cache = new Map<string, ImageCacheEntry>()
  const inflight = new Map<string, Promise<ImageProbeResult>>()
  const probe = opts?.probe ?? defaultImageProbe
  const timeoutMs = opts?.timeoutMs ?? IMAGE_VALIDATE_MS

  async function validate(url: string): Promise<ImageProbeResult> {
    if (url.startsWith('data:image/')) return 'ok'
    if (!/^https?:\/\//i.test(url)) return 'dead'
    const cached = cache.get(url)
    // positives never expire; a negative is destructive, so retry it after 5 minutes
    if (cached && (cached.verdict === 'ok' || Date.now() - cached.at < NEGATIVE_TTL_MS)) {
      return cached.verdict
    }
    const pending = inflight.get(url)
    if (pending) return pending

    const task = (async () => {
      try {
        const verdict = await probe(url, timeoutMs)
        remember(cache, url, verdict)
        return verdict
      } catch {
        remember(cache, url, 'unknown')
        return 'unknown' as const
      } finally {
        inflight.delete(url)
      }
    })()

    inflight.set(url, task)
    return task
  }

  return { validate, cache }
}

let defaultValidator: ImageUrlValidator | null = null

export function getImageUrlValidator(validator?: ImageUrlValidator) {
  if (validator) return validator
  if (!defaultValidator) defaultValidator = createImageUrlValidator()
  return defaultValidator
}

/**
 * Swap picsum seed markers for real Pexels photos, searching on the seed slug + alt.
 * No PEXELS_API_KEY: the marker stays, and picsum always serves a real photo.
 */
export async function resolveImageSlots(
  code: string,
  brief?: string,
  opts?: ImageResolveOptions,
): Promise<{ text: string; resolved: ResolvedImage[] }> {
  const apiKey = opts?.apiKey ?? process.env.PEXELS_API_KEY
  if (!apiKey || !code) return { text: code, resolved: [] }
  const slots = findImageSlots(code).filter((s) => s.seed)
  if (!slots.length) return { text: code, resolved: [] }

  const groups = new Map<string, { query: string; orientation: string; slots: ImageSlot[] }>()
  for (const slot of slots) {
    const query = imageQuery(slot, brief)
    if (!query) continue
    const orientation = orientationOf(slot)
    const key = `${query}|${orientation}`
    const group = groups.get(key) ?? { query, orientation, slots: [] }
    group.slots.push(slot)
    groups.set(key, group)
  }
  if (!groups.size) return { text: code, resolved: [] }

  const doFetch = opts?.fetchImpl ?? fetch
  const deadline = Date.now() + (opts?.timeoutMs ?? IMAGE_RESOLVE_MS)
  const entries = [...groups.values()]
  const photos = await mapPool(entries, RESOLVE_CONCURRENCY, (group) =>
    searchPexels(doFetch, apiKey, group.query, group.orientation, group.slots.length, deadline),
  )

  const edits: { slot: ImageSlot; to: string; query: string }[] = []
  entries.forEach((group, i) => {
    const found = photos[i]
    if (!found.length) return
    group.slots.forEach((slot, n) => {
      const to = found[n % found.length]
      if (to && to !== slot.url) edits.push({ slot, to, query: group.query })
    })
  })
  // descending index so every earlier offset stays valid; longer URL first on a tie
  edits.sort((a, b) => b.slot.index - a.slot.index || b.slot.url.length - a.slot.url.length)

  let text = code
  const resolved: ResolvedImage[] = []
  for (const edit of edits) {
    text = spliceAt(text, edit.slot, edit.to)
    resolved.push({ from: edit.slot.url, to: edit.to, query: edit.query })
  }
  return { text, resolved }
}

export async function replaceBrokenRemoteImages(
  code: string,
  validator?: ImageUrlValidator,
): Promise<{ text: string; removed: string[] }> {
  const slots = findImageSlots(code)
  if (!slots.length) return { text: code, removed: [] }
  const v = getImageUrlValidator(validator)
  const verdicts = await Promise.all(slots.map((s) => v.validate(s.url)))

  const dead = slots
    .filter((_, i) => verdicts[i] === 'dead')
    .sort((a, b) => b.index - a.index || b.url.length - a.url.length)
  let text = code
  for (const slot of dead) text = spliceAt(text, slot, placeholderDataUri(slot.alt))
  return { text, removed: [...new Set(dead.map((s) => s.url))] }
}

/** The full image pass: resolve seed markers, then drop only provably dead URLs. */
export async function validateImagesInFiles(
  files: WrittenFile[],
  opts?: { validator?: ImageUrlValidator; brief?: string; resolve?: ImageResolveOptions },
): Promise<{ files: WrittenFile[]; removed: string[]; resolved: ResolvedImage[] }> {
  const removed: string[] = []
  const resolved: ResolvedImage[] = []
  const out = await Promise.all(
    files.map(async (file) => {
      try {
        // ponytail: one resolve deadline per file, not per tree — fragments are 1-3 files.
        const step = await resolveImageSlots(file.file_content, opts?.brief, opts?.resolve)
        resolved.push(...step.resolved)
        const swept = await replaceBrokenRemoteImages(step.text, opts?.validator)
        removed.push(...swept.removed)
        return { file_path: file.file_path, file_content: swept.text }
      } catch {
        return file
      }
    }),
  )
  return { files: out, removed: [...new Set(removed)], resolved }
}

export async function replaceBrokenRemoteImagesInFiles(
  files: WrittenFile[],
  validator?: ImageUrlValidator,
): Promise<WrittenFile[]> {
  return (await validateImagesInFiles(files, { validator })).files
}

export async function applyValidatedImagesToFragment<
  T extends { code?: unknown; file_path?: string },
>(
  fragment: T,
  opts?: { validator?: ImageUrlValidator; brief?: string; resolve?: ImageResolveOptions },
): Promise<T> {
  try {
    const { files } = await validateImagesInFiles(fragmentFiles(fragment), opts)
    return {
      ...fragment,
      code: rebuildFragmentCode(fragment.code, fragment.file_path || '', files),
    }
  } catch {
    return fragment
  }
}

function isRemoteImageUrl(url: string, code: string, index: number): boolean {
  try {
    const u = new URL(url)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
    if (IMAGE_EXT.test(`${u.pathname}${u.search}`) || STOCK_HOST.test(u.hostname)) return true
  } catch {
    return false
  }
  const before = code.slice(Math.max(0, index - 96), index)
  return IMAGE_KEY.test(before) || /url\(\s*['"]?$/.test(before)
}

function nearestAlt(code: string, index: number): string {
  const from = Math.max(0, index - 200)
  const window = code.slice(from, index + 200)
  let best = ''
  let bestDist = Infinity
  for (const m of window.matchAll(/alt\s*=\s*["'{`]+([^"'`}<>]{0,120})/g)) {
    const at = from + (m.index ?? 0)
    const dist = Math.abs(at - index)
    if (dist < bestDist) {
      bestDist = dist
      best = m[1]
    }
  }
  return best.trim()
}

function imageQuery(slot: ImageSlot, brief?: string): string {
  const words = keywords(`${(slot.seed || '').replace(/[-_]+/g, ' ')} ${slot.alt}`)
  if (words.length < 2) words.push(...keywords(brief || ''))
  return [...new Set(words)].slice(0, 6).join(' ')
}

const STOP = /^(?:a|an|the|of|for|and|or|to|in|on|with|photo|image|picture|img)$/i

function keywords(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) || []).filter((w) => w.length > 1 && !STOP.test(w))
}

function orientationOf(slot: ImageSlot): string {
  const w = slot.width || 0
  const h = slot.height || 0
  if (!w || !h) return 'landscape'
  if (w / h > 1.2) return 'landscape'
  if (h / w > 1.2) return 'portrait'
  return 'square'
}

async function searchPexels(
  doFetch: typeof fetch,
  apiKey: string,
  query: string,
  orientation: string,
  count: number,
  deadline: number,
): Promise<string[]> {
  const remaining = deadline - Date.now()
  if (remaining <= 0) return []
  const url =
    'https://api.pexels.com/v1/search?query=' +
    encodeURIComponent(query) +
    `&per_page=${Math.min(Math.max(count, 1), 15)}&orientation=${orientation}`
  try {
    const res = await doFetch(url, {
      headers: { Authorization: apiKey },
      signal: AbortSignal.timeout(remaining),
    })
    if (!res.ok) return []
    const body = (await res.json()) as { photos?: { src?: Record<string, string> }[] }
    return (body.photos || [])
      .map((p) => p.src?.large2x || p.src?.large || p.src?.original || p.src?.medium || '')
      .filter(Boolean)
  } catch {
    return []
  }
}

async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const at = next++
      out[at] = await fn(items[at])
    }
  })
  await Promise.all(workers)
  return out
}

/** Index-anchored splice — never split/join, which rewrites a live URL's prefix. */
function spliceAt(text: string, slot: ImageSlot, replacement: string): string {
  if (text.slice(slot.index, slot.index + slot.url.length) !== slot.url) return text
  return text.slice(0, slot.index) + replacement + text.slice(slot.index + slot.url.length)
}

function remember(cache: Map<string, ImageCacheEntry>, url: string, verdict: ImageProbeResult) {
  if (verdict === 'unknown') return
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next()
    if (!oldest.done) cache.delete(oldest.value)
  }
  cache.set(url, { verdict, at: Date.now() })
}

function xmlEscape(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

async function cancelBody(res: Response) {
  try {
    await res.body?.cancel()
  } catch {
    /* ignore */
  }
}

function rebuildFragmentCode(
  original: unknown,
  filePath: string,
  files: WrittenFile[],
): unknown {
  if (Array.isArray(original)) {
    return original.map((f) => {
      if (!f || typeof f !== 'object') return f
      const rec = f as Record<string, unknown>
      const path =
        (typeof rec.file_path === 'string' && rec.file_path) ||
        (typeof rec.file_name === 'string' && rec.file_name) ||
        ''
      const match = files.find((x) => x.file_path === path.replace(/\\/g, '/'))
      if (!match) return f
      if ('file_content' in rec) return { ...rec, file_content: match.file_content }
      if ('content' in rec) return { ...rec, content: match.file_content }
      return f
    })
  }
  return (
    files.find((f) => f.file_path === filePath)?.file_content ??
    files[0]?.file_content ??
    fragmentCodeText(original)
  )
}

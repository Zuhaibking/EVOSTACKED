import { createHash } from 'node:crypto'
import type { WrittenFile } from './fragment-files'
import { searchOpenverse } from './images-openverse'
import { searchWikimedia } from './images-wikimedia'
import {
  IMAGE_DIR,
  IMAGE_PUBLIC,
  IMAGE_SCHEME,
  IMAGE_UA,
  isSafeImageUrl,
  type ImageCandidate,
} from './images-shared'

export {
  IMAGE_DIR,
  IMAGE_PUBLIC,
  IMAGE_SCHEME,
  IMAGE_UA,
  isSafeImageUrl,
  type ImageCandidate,
} from './images-shared'

const REF_RE = /evo-image:\/\/([^"'`\r\n)]+)/gi
const MIN_BYTES = 2048
const MAX_BYTES = 8 * 1024 * 1024
const MAX_REDIRECTS = 5
const DOWNLOAD_TRIES = 5

export type ImageAsset = {
  query: string
  file: string
  path: string
  publicPath: string
  bytes: Uint8Array
  mime: string
  source: string
  sourcePage?: string
  creator?: string
  creatorUrl?: string
  license?: string
  licenseVersion?: string
  licenseUrl?: string
}

export type ImageManifestEntry = {
  query: string
  file: string
  source: string
  sourcePage?: string
  creator?: string
  creatorUrl?: string
  license?: string
  licenseVersion?: string
  licenseUrl?: string
}

export type ImageBinary = {
  file_path: string
  data: ArrayBuffer
}

export type ResolveImagesResult = {
  files: WrittenFile[]
  binaries: ImageBinary[]
  assets: ImageAsset[]
  manifest: ImageManifestEntry[]
}

export function extractImageQueries(code: string): string[] {
  if (!code || !code.includes(IMAGE_SCHEME)) return []
  const found: string[] = []
  const seen = new Set<string>()
  REF_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = REF_RE.exec(code))) {
    const query = normalizeQuery(m[1])
    if (!query || seen.has(query)) continue
    seen.add(query)
    found.push(query)
  }
  return found
}

export function normalizeQuery(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim()
}

export function rewriteImageRefs(
  code: string,
  resolved: Map<string, string>,
): string {
  if (!code || !code.includes(IMAGE_SCHEME)) return code
  const next = code.replace(REF_RE, (full, raw: string) => {
    const query = normalizeQuery(raw)
    return resolved.get(query) || full
  })
  if (!next.includes(IMAGE_SCHEME)) return next
  return omitUnresolvedImageRefs(next)
}

function omitUnresolvedImageRefs(code: string): string {
  let out = code.replace(
    /url\(\s*(?:evo-image:\/\/[^)]+|['"]evo-image:\/\/[^'"]*['"])\s*\)/gi,
    'none',
  )
  out = out.replace(
    /<(img|Image)\b[^>]*\bsrc\s*=\s*(?:\{\s*)?(['"`])evo-image:\/\/[^'"`]*\2(?:\s*\})?[^>]*\/?>/gi,
    '',
  )
  REF_RE.lastIndex = 0
  return out.replace(REF_RE, '')
}

export function rankCandidates(
  query: string,
  candidates: ImageCandidate[],
): ImageCandidate[] {
  const words = queryWords(query)
  const scored = candidates
    .filter((c) => c.url && isSafeImageUrl(c.url))
    .map((c) => ({
      c,
      score: scoreCandidate(c, words),
      hits: words.filter((w) => (c.title || '').toLowerCase().includes(w))
        .length,
    }))
    .sort((a, b) => b.score - a.score || b.hits - a.hits)
  const matched = scored.filter((x) => x.hits > 0)
  return (matched.length ? matched : scored).map((x) => x.c)
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

export async function resolveImages(
  files: WrittenFile[],
): Promise<ResolveImagesResult> {
  const queries = Array.from(
    new Set(files.flatMap((f) => extractImageQueries(f.file_content))),
  )
  if (!queries.length) {
    return { files, binaries: [], assets: [], manifest: [] }
  }

  const byQuery = new Map<string, ImageAsset>()
  const byUrl = new Map<string, ImageAsset>()

  for (const query of queries) {
    try {
      const asset = await resolveOne(query, byUrl)
      if (asset) {
        byQuery.set(query, asset)
        byUrl.set(asset.source, asset)
      } else {
        console.warn(`[images] omitted: no real image for "${query}"`)
      }
    } catch (err) {
      console.warn(`[images] omitted: no real image for "${query}"`)
      console.warn('[images] failed', err instanceof Error ? err.message : err)
    }
  }

  const publicByQuery = new Map<string, string>()
  Array.from(byQuery.entries()).forEach(([query, asset]) => {
    publicByQuery.set(query, asset.publicPath)
  })

  const rewritten = files.map((f) => ({
    ...f,
    file_content: rewriteImageRefs(f.file_content, publicByQuery),
  }))

  const assets = uniqueAssets(Array.from(byQuery.values()))
  const manifest: ImageManifestEntry[] = Array.from(byQuery.values()).map((a) => ({
    query: a.query,
    file: a.file,
    source: a.source,
    sourcePage: a.sourcePage,
    creator: a.creator,
    creatorUrl: a.creatorUrl,
    license: a.license,
    licenseVersion: a.licenseVersion,
    licenseUrl: a.licenseUrl,
  }))

  if (manifest.length) {
    rewritten.push({
      file_path: `${IMAGE_DIR}/manifest.json`,
      file_content: `${JSON.stringify(manifest, null, 2)}\n`,
    })
  }

  return {
    files: rewritten,
    binaries: assets.map((a) => ({
      file_path: a.path,
      data: toArrayBuffer(a.bytes),
    })),
    assets,
    manifest,
  }
}

async function resolveOne(
  query: string,
  byUrl: Map<string, ImageAsset>,
): Promise<ImageAsset | null> {
  console.log(`[images] query: ${query}`)
  const attempts = searchQueries(query)

  for (const q of attempts) {
    const openverse = rankCandidates(query, await searchOpenverse(q))
    const fromOpen = await pickDownload(query, 'openverse', openverse, byUrl)
    if (fromOpen) return fromOpen
  }

  console.log('[images] fallback: wikimedia')
  for (const q of attempts) {
    const wiki = rankCandidates(query, await searchWikimedia(q))
    const fromWiki = await pickDownload(query, 'wikimedia', wiki, byUrl)
    if (fromWiki) return fromWiki
  }
  return null
}

function searchQueries(query: string): string[] {
  const q = query.trim()
  const out: string[] = []
  const add = (s: string) => {
    const n = s.replace(/\s+/g, ' ').trim()
    if (n && !out.some((x) => x.toLowerCase() === n.toLowerCase())) out.push(n)
  }
  add(q)
  add(
    q.replace(
      /\b(product photograph|photograph|photo|image|picture|real)\b/gi,
      ' ',
    ),
  )
  const words = queryWords(q)
  if (words.length >= 2) add(words.slice(0, 3).join(' '))
  if (words.length >= 2) add(words.slice(0, 2).join(' '))
  return out
}

async function pickDownload(
  query: string,
  provider: string,
  candidates: ImageCandidate[],
  byUrl: Map<string, ImageAsset>,
): Promise<ImageAsset | null> {
  if (!candidates.length) return null
  console.log(`[images] provider: ${provider}`)

  for (const cand of candidates.slice(0, DOWNLOAD_TRIES)) {
    const reused = byUrl.get(cand.url)
    if (reused) {
      console.log(`[images] selected: ${cand.title || cand.url}`)
      console.log(`[images] downloaded: ${reused.path} (reused)`)
      return { ...reused, query }
    }
    const got = await downloadImage(cand.url)
    if (!got) continue
    const file = safeFilename(query, cand.url, got.ext)
    const path = `${IMAGE_DIR}/${file}`
    const asset: ImageAsset = {
      query,
      file,
      path,
      publicPath: `${IMAGE_PUBLIC}/${file}`,
      bytes: got.bytes,
      mime: got.mime,
      source: cand.url,
      sourcePage: cand.sourcePage,
      creator: cand.creator,
      creatorUrl: cand.creatorUrl,
      license: cand.license,
      licenseVersion: cand.licenseVersion,
      licenseUrl: cand.licenseUrl,
    }
    console.log(`[images] selected: ${cand.title || cand.url}`)
    console.log(`[images] downloaded: ${path}`)
    if (cand.license) {
      console.log(
        `[images] license: ${[cand.license, cand.licenseVersion].filter(Boolean).join(' ')}`,
      )
    }
    return asset
  }
  return null
}

export async function downloadImage(
  url: string,
): Promise<{ bytes: Uint8Array; mime: string; ext: string } | null> {
  if (!isSafeImageUrl(url)) return null
  try {
    const res = await fetchSafe(url, {
      headers: {
        Accept: 'image/*,application/octet-stream;q=0.9',
        'User-Agent': IMAGE_UA,
      },
    })
    if (!res.ok) return null
    const ct = res.headers.get('content-type') || ''
    const length = Number(res.headers.get('content-length') || 0)
    if (length && (length < MIN_BYTES || length > MAX_BYTES)) return null
    const bytes = new Uint8Array(await res.arrayBuffer())
    const ok = validateImageBytes(bytes, ct)
    return ok ? { bytes, ...ok } : null
  } catch {
    return null
  }
}

export async function fetchSafe(
  url: string,
  init: RequestInit = {},
  hops = 0,
): Promise<Response> {
  if (hops > MAX_REDIRECTS) throw new Error('too many redirects')
  if (!isSafeImageUrl(url)) throw new Error('blocked url')
  const res = await fetch(url, {
    ...init,
    redirect: 'manual',
    signal: init.signal ?? AbortSignal.timeout(15_000),
    headers: {
      'User-Agent': IMAGE_UA,
      ...(init.headers || {}),
    },
  })
  if (res.status >= 300 && res.status < 400) {
    const loc = res.headers.get('location')
    if (!loc) throw new Error('redirect without location')
    const next = new URL(loc, url).toString()
    return fetchSafe(next, init, hops + 1)
  }
  return res
}

export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer
}

function scoreCandidate(c: ImageCandidate, words: string[]): number {
  const title = (c.title || '').toLowerCase()
  let score = 0
  for (const w of words) {
    if (title.includes(w)) score += 8
  }
  const w = c.width || 0
  const h = c.height || 0
  const min = Math.min(w, h)
  const max = Math.max(w, h)
  if (min >= 1200) score += 24
  else if (min >= 800) score += 18
  else if (min >= 400) score += 8
  else if (max > 0 && max < 400) score -= 20
  if (w * h >= 1_000_000) score += 6
  if (c.license) score += 5
  if (c.licenseUrl) score += 2
  if (c.creator) score += 1
  if (c.filesize && c.filesize > 0 && c.filesize < 20_000) score -= 10
  return score
}

function queryWords(query: string): string[] {
  const stop = new Set([
    'a',
    'an',
    'the',
    'of',
    'and',
    'or',
    'for',
    'to',
    'in',
    'on',
    'photo',
    'photograph',
    'image',
    'picture',
    'real',
    'product',
  ])
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !stop.has(w))
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

function safeFilename(query: string, url: string, ext: string): string {
  const base =
    query
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'image'
  const hash = createHash('sha1').update(url).digest('hex').slice(0, 8)
  const e = ext.replace(/[^a-z0-9]/g, '') || 'jpg'
  return `${base}-${hash}.${e}`
}

function uniqueAssets(assets: ImageAsset[]): ImageAsset[] {
  const seen = new Set<string>()
  const out: ImageAsset[] = []
  for (const a of assets) {
    if (seen.has(a.path)) continue
    seen.add(a.path)
    out.push(a)
  }
  return out
}


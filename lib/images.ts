import type { WrittenFile } from './fragment-files'
import {
  AI_IMAGE_TIMEOUT_MS,
  AI_PROVIDER,
  aiImagesConfigured,
  defaultImageAspect,
  generateAiImageResult,
  planAiImage,
  subjectPhrase,
  type AiFailure,
  type ImageContext,
} from './images-ai'
import {
  findCachedImage,
  imageCacheKey,
  readCachedImage,
  recallPlaceholder,
  rememberPlaceholder,
  writeCachedImage,
  type CachedImage,
  type CachedImageMeta,
} from './images-cache'
import { searchCleveland } from './images-cleveland'
import { searchMet } from './images-met'
import { searchOpenverse } from './images-openverse'
import {
  parsePlaceholderFile,
  placeholderBytes,
  placeholderFileName,
} from './images-placeholder'
import { searchWikimedia } from './images-wikimedia'
import {
  IMAGE_DIR,
  IMAGE_PUBLIC,
  IMAGE_SCHEME,
  IMAGE_UA,
  imageByteLimits,
  imageSlug,
  isSafeImageUrl,
  parseImageRef,
  providerAvailable,
  validateImageBytes,
  type ImageAspect,
  type ImageCandidate,
} from './images-shared'
import ratelimit from './ratelimit'

export {
  IMAGE_DIR,
  IMAGE_PUBLIC,
  IMAGE_SCHEME,
  IMAGE_UA,
  isSafeImageUrl,
  parseImageRef,
  sniffImage,
  validateImageBytes,
  type ImageAspect,
  type ImageCandidate,
} from './images-shared'
export type { ImageContext } from './images-ai'

/** A reference up to its closing quote/paren; `${…}` interpolations count as one unit. */
const REF_RE = /evo-image:\/\/((?:\$\{[^{}`]*\}|[^"'`\r\n)])+)/gi
/**
 * A quoted reference, optionally inside a CSS url( ), one alternative per
 * quote style: [prefix, query] pairs. Each character has one way to match
 * (no backtracking blow-up), and the quote must open the reference, so an
 * apostrophe in JSX text ("Don't") can never start a match.
 */
const LITERAL_RE = /'((?:url\(\s*"?)?)evo-image:\/\/([^'\r\n]*)'|"((?:url\(\s*'?)?)evo-image:\/\/([^"\r\n]*)"|`((?:url\(\s*["']?)?)evo-image:\/\/((?:\$\{[^{}`]*\}|\$(?!\{)|[^`$\r\n])*)`/gi
/** Something is appended to the literal at runtime. */
const APPENDED_RE = /^\s*(?:\+|\.concat\s*\()/
/** Local photo references already in source (chat/inspector edits keep these, not evo-image:// queries). */
const LOCAL_RE = /\/evo-images\/([A-Za-z0-9][\w.-]{0,200}\.(?:webp|jpe?g|png|gif|svg))(?![\w.-])/g
const CACHED_FILE_RE = /-([0-9a-f]{12})\.(webp|jpg|png|gif)$/
const MAX_REDIRECTS = 5
const DOWNLOAD_TRIES = 5
const IMAGE_QUERY_CONCURRENCY = 3
const AI_CONCURRENCY = 5
/** New AI generations per sandbox; further queries use stock or a placeholder. */
const AI_MAX_IMAGES = 12
/** Paid AI images per user and for the whole server, per hour (EVOSTACK_IMAGE_USER_HOURLY / EVOSTACK_IMAGE_GLOBAL_HOURLY). */
const AI_USER_HOURLY = 120
const AI_GLOBAL_HOURLY = 1500
const STOCK_BUDGET_MS = 30_000
/** With ~16-18 s of sandbox work after photos, the preview call stays under ~80 s. */
const AI_BUDGET_MS = 60_000
/** Budget tail that AI attempts never use, so stock can still fill a photo. */
const STOCK_RESERVE_MS = 15_000
/** An AI window shorter than this is not worth starting. */
const AI_MIN_WINDOW_MS = 6_000
const STOCK_VARIANTS = 4

export type ImageMode = 'ai' | 'stock' | 'hybrid'

export type ImageAsset = {
  query: string
  file: string
  path: string
  publicPath: string
  bytes: Uint8Array
  mime: string
  /** 'ai', the stock provider name, or 'placeholder'. */
  source: string
  /** No evo-image:// query to convert back to: built at runtime ('evo-image://' + slug) or unknown. */
  portable?: false
  /** Remote original for stock photos. */
  url?: string
  model?: string
  prompt?: string
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
  /** "AI-generated …", the stock license + creator + URL, or the placeholder note. */
  note: string
  /** Never convert this file back to evo-image://<query>: the reference was built at runtime, or its query is unknown. */
  portable?: false
  model?: string
  prompt?: string
  url?: string
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

export type ImageTiming = {
  /** The whole photo phase. */
  budgetMs: number
  /** One AI image, model chain included. */
  aiTimeoutMs: number
  /** Budget tail kept for stock after an AI attempt. */
  stockReserveMs: number
  /** Shorter AI windows are not started. */
  minAiWindowMs: number
}

export type ResolveImagesOptions = {
  /** Site title/description steer AI prompts. */
  context?: ImageContext
  mode?: ImageMode
  /** The verified owner: paid AI images count against this user's hourly quota. */
  userId?: string
  /** Checks shrink the clock; production uses the defaults. */
  timing?: Partial<ImageTiming>
}

/** EVOSTACK_IMAGE_MODE; defaults to AI when the server OpenAI key is set. */
export function imageMode(): ImageMode {
  const raw = (process.env.EVOSTACK_IMAGE_MODE || '').trim().toLowerCase()
  if (raw === 'stock' || !aiImagesConfigured()) return 'stock'
  return raw === 'hybrid' ? 'hybrid' : 'ai'
}

function imageBudgetMs(mode: ImageMode): number {
  if (mode === 'stock') return STOCK_BUDGET_MS
  const raw = Number(process.env.EVOSTACK_IMAGE_BUDGET_MS)
  return Number.isFinite(raw) && raw > 0 ? Math.min(Math.max(raw, 5_000), 240_000) : AI_BUDGET_MS
}

/** EVOSTACK_IMAGE_TIMEOUT_MS: one AI image (default 20 s; slower models in EVOSTACK_IMAGE_MODELS need more). */
function aiTimeoutMs(): number {
  const raw = Number(process.env.EVOSTACK_IMAGE_TIMEOUT_MS)
  return Number.isFinite(raw) && raw > 0 ? Math.min(Math.max(raw, 5_000), 60_000) : AI_IMAGE_TIMEOUT_MS
}

function imageTiming(mode: ImageMode, override: Partial<ImageTiming> = {}): ImageTiming {
  return {
    budgetMs: imageBudgetMs(mode),
    aiTimeoutMs: aiTimeoutMs(),
    stockReserveMs: STOCK_RESERVE_MS,
    minAiWindowMs: AI_MIN_WINDOW_MS,
    ...override,
  }
}

function envCount(name: string, fallback: number): number {
  const raw = Number(process.env[name])
  return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : fallback
}

/** Queries in source order. References built at runtime ('evo-image://' + slug) are skipped: nothing to search for. */
export function extractImageQueries(code: string): string[] {
  if (!code || !code.includes(IMAGE_SCHEME)) return []
  const scrubbed = replaceAppendedRefs(code, (open, _text, close) => open + close)
  const found: string[] = []
  const seen = new Set<string>()
  REF_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = REF_RE.exec(scrubbed))) {
    const query = normalizeQuery(m[1])
    if (!query || seen.has(query)) continue
    seen.add(query)
    found.push(query)
  }
  return found
}

/** File names under /evo-images/ that the source already references. */
export function extractLocalImages(code: string): string[] {
  if (!code || !code.includes(`${IMAGE_PUBLIC}/`)) return []
  const found = new Set<string>()
  LOCAL_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = LOCAL_RE.exec(code))) found.add(m[1])
  return Array.from(found)
}

export function normalizeQuery(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim()
}

/** Public path of the deterministic SVG placeholder for a reference. */
export function placeholderPath(ref: string): string {
  return `${IMAGE_PUBLIC}/${placeholderFor(ref)}`
}

function placeholderFor(ref: string, ext: 'svg' | 'png' = 'svg'): string {
  const { query, aspect } = parseImageRef(ref)
  const subject = query || 'image'
  return placeholderFileName(subject, aspect || defaultImageAspect(subject), ext)
}

/**
 * Quoted references completed at runtime: 'evo-image://' + slug,
 * "evo-image://luxury " + name, `evo-image://${a}`.concat(b),
 * 'url(evo-image://' + slug + ')', or a bare quoted scheme (`src += slug`
 * later). Each gets a PNG placeholder path
 * ending in "?", so whatever is appended becomes a query string on a file
 * that exists. PNG, because Next 14's next/image only serves SVG as-is when
 * the src ends in ".svg".
 */
function replaceAppendedRefs(code: string, replace: (open: string, text: string, close: string) => string): string {
  if (!code.includes(IMAGE_SCHEME)) return code
  LITERAL_RE.lastIndex = 0
  return code.replace(LITERAL_RE, (full: string, ...args: unknown[]) => {
    const groups = args.slice(0, 6) as (string | undefined)[]
    const offset = args[6] as number
    const all = args[7] as string
    const at = groups[1] !== undefined ? 0 : groups[3] !== undefined ? 2 : 4
    const text = groups[at + 1] ?? ''
    const end = offset + full.length
    if (text.trim() && !APPENDED_RE.test(all.slice(end, end + 200))) return full
    return replace(full[0] + (groups[at] ?? ''), text, full[0])
  })
}

/**
 * Replaces every evo-image:// reference. Unresolved references point at their
 * placeholder (resolveImages writes it), so a reference is never left empty,
 * deleted, turned into `none`, or extended into a missing file.
 */
export function rewriteImageRefs(
  code: string,
  resolved: Map<string, string>,
): string {
  if (!code || !code.includes(IMAGE_SCHEME)) return code
  let next = replaceAppendedRefs(code, (open, text, close) =>
    `${open}${IMAGE_PUBLIC}/${placeholderFor(normalizeQuery(text.replace(/\$\{[^{}`]*\}/g, ' ')), 'png')}?${close}`)
  REF_RE.lastIndex = 0
  next = next.replace(REF_RE, (_full, raw: string) => {
    const query = normalizeQuery(raw)
    return resolved.get(query) || placeholderPath(query)
  })
  // An unquoted bare scheme (CSS url(evo-image://)) still needs a real file.
  return next.replace(/evo-image:\/\//gi, placeholderPath('image'))
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

type ImageJob = {
  /** Normalized reference as written in source (manifest query; may carry #aspect). */
  ref: string
  query: string
  aspect?: ImageAspect
  /** A referenced /evo-images/ file that could not be restored. */
  lostFile?: string
}

type AiQuota = { take: () => Promise<boolean> }

type JobContext = {
  mode: ImageMode
  context: ImageContext
  timing: ImageTiming
  /** Milliseconds left in the photo budget. */
  timeLeft: () => number
  signal: AbortSignal
  quota: AiQuota
  /** Stock photos already chosen by earlier queries (shared files). */
  byUrl: Map<string, ImageAsset>
}

export async function resolveImages(
  files: WrittenFile[],
  parentSignal?: AbortSignal,
  options: ResolveImagesOptions = {},
): Promise<ResolveImagesResult> {
  const refs = Array.from(
    new Set(files.flatMap((f) => extractImageQueries(f.file_content))),
  )
  const localFiles = Array.from(
    new Set(files.flatMap((f) => extractLocalImages(f.file_content))),
  )
  const appended = files.some((f) => replaceAppendedRefs(f.file_content, () => '') !== f.file_content)
  if (!refs.length && !localFiles.length && !appended) {
    return { files, binaries: [], assets: [], manifest: [] }
  }

  const mode = options.mode || imageMode()
  const context = options.context || {}
  const timing = imageTiming(mode, options.timing)
  const deadline = Date.now() + timing.budgetMs
  // Photos are optional; their shared budget cannot postpone a working preview.
  const photoDeadline = AbortSignal.timeout(timing.budgetMs)
  const signal = parentSignal ? AbortSignal.any([parentSignal, photoDeadline]) : photoDeadline
  let onAbort = () => {}
  const stopped = new Promise<null>(resolve => {
    onAbort = () => resolve(null)
    signal.addEventListener('abort', onAbort, { once: true })
  })

  // 1. Files already referenced (edits and rebuilds never re-send the image map):
  // placeholders regenerate from their name, photos restore by their embedded cache hash.
  const kept = new Map<string, ImageAsset>()
  const jobs: ImageJob[] = refs.map((ref) => ({ ref, ...parseImageRef(ref) }))
  await Promise.all(localFiles.map(async (file) => {
    const asset = await restoreLocalImage(file)
    if (asset) kept.set(file, asset)
  }))
  for (const file of localFiles) {
    if (kept.has(file)) continue
    const ref = queryFromFileName(file)
    console.warn(`[images] missing ${IMAGE_PUBLIC}/${file}; re-resolving "${ref}"`)
    jobs.push({ ref, ...parseImageRef(ref), lostFile: file })
  }

  // 2. One resolution per (query, aspect); cache hits first, free and instant.
  const groups = new Map<string, ImageJob[]>()
  for (const job of jobs) {
    const id = `${job.query.toLowerCase()}#${job.aspect || ''}`
    groups.set(id, [...(groups.get(id) || []), job])
  }
  const groupList = Array.from(groups.values())
  const outcomes: (ImageAsset | null)[] = await Promise.all(groupList.map((group) => cachedAsset(group[0], context, mode)))
  let aiSlots = mode === 'stock' ? 0 : AI_MAX_IMAGES
  const aiAllowed = groupList.map((group, index) =>
    !outcomes[index] && !isDynamicQuery(group[0].query) && aiSlots-- > 0)

  const byUrl = new Map<string, ImageAsset>()
  for (const asset of outcomes) if (asset?.url) byUrl.set(asset.url, asset)
  const quota = aiQuota(options.userId)
  let nextGroup = 0
  const runGroup = async () => {
    while (!signal.aborted) {
      const index = nextGroup++
      if (index >= groupList.length) return
      if (outcomes[index]) continue
      const job = groupList[index][0]
      try {
        // Snapshot so in-flight queries keep today's provider order and cannot
        // steal a photo another query has not finished selecting.
        const ctx: JobContext = { mode, context, timing, timeLeft: () => deadline - Date.now(), signal, quota, byUrl: new Map(byUrl) }
        const asset = await Promise.race([resolveJob(job, aiAllowed[index], ctx), stopped])
        if (signal.aborted) return
        outcomes[index] = asset
        if (asset?.url) byUrl.set(asset.url, asset)
        if (!asset) console.warn(`[images] placeholder: no photo for "${job.query}"`)
      } catch (err) {
        if (signal.aborted) return
        outcomes[index] = null
        console.warn(`[images] placeholder: no photo for "${job.query}"`)
        console.warn('[images] failed', err instanceof Error ? err.message : err)
      }
    }
  }

  const concurrency = mode === 'stock' ? IMAGE_QUERY_CONCURRENCY : AI_CONCURRENCY
  try {
    await Promise.all(Array.from({ length: Math.min(concurrency, groupList.length) }, () => runGroup()))
  } finally { signal.removeEventListener('abort', onAbort) }
  if (signal.aborted && outcomes.some((o, i) => !o && !isDynamicQuery(groupList[i][0].query))) {
    console.warn('[images] photo budget ended; remaining images use placeholders')
  }

  // 3. Same dedup as before: the earliest query keeps a shared stock file.
  const seenUrl = new Map<string, ImageAsset>()
  const publicByRef = new Map<string, string>()
  const renamed = new Map<string, string>()
  const written = new Map<string, ImageAsset>()
  const manifest: ImageManifestEntry[] = []
  const remembered: Promise<void>[] = []
  const record = (asset: ImageAsset, query: string) => {
    if (!written.has(asset.path)) written.set(asset.path, asset)
    manifest.push(manifestEntry({ ...asset, query }))
  }
  groupList.forEach((group, index) => {
    let asset = outcomes[index]
    if (asset?.url) {
      const earlier = seenUrl.get(asset.url)
      if (earlier) asset = earlier
      else seenUrl.set(asset.url, asset)
    }
    for (const job of group) {
      const chosen = asset || placeholderAsset(placeholderFor(job.ref))
      if (job.lostFile) renamed.set(job.lostFile, chosen.publicPath)
      else publicByRef.set(job.ref, chosen.publicPath)
      // A lost file's ref is a guess from its name; only exact references are remembered.
      if (!asset && !job.lostFile) remembered.push(rememberPlaceholder(chosen.file, job.ref))
      record(chosen, job.ref)
    }
  })
  kept.forEach((asset) => record(asset, asset.query))
  await Promise.all(remembered)

  const rewritten = files.map((f) => {
    let code = f.file_content
    if (renamed.size) {
      LOCAL_RE.lastIndex = 0
      code = code.replace(LOCAL_RE, (full, file: string) => renamed.get(file) || full)
    }
    return { ...f, file_content: rewriteImageRefs(code, publicByRef) }
  })
  // Anything still pointing at a placeholder name (runtime-built references included) gets its bytes too.
  for (const f of rewritten) {
    for (const file of extractLocalImages(f.file_content)) {
      const path = `${IMAGE_DIR}/${file}`
      if (written.has(path) || !parsePlaceholderFile(file)) continue
      const asset = placeholderAsset(file, null)
      record(asset, asset.query)
    }
  }

  const assets = Array.from(written.values())
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

/** Template-literal fragments (`${item.photo}`) are not searchable queries. */
function isDynamicQuery(query: string): boolean {
  return !query || /\$\{|\{\{/.test(query)
}

function stockCacheKey(query: string): string {
  return imageCacheKey('stock', query.toLowerCase())
}

function cachedFileName(query: string, key: string, ext: string): string {
  return `${imageSlug(query)}-${key.slice(0, 12)}.${ext}`
}

/**
 * Free cache hits before any network call. In AI mode a cached stock photo
 * only counts when AI refused that subject; a stock photo cached during an
 * outage is skipped so the subject gets an AI photo once AI answers again.
 */
async function cachedAsset(job: ImageJob, context: ImageContext, mode: ImageMode): Promise<ImageAsset | null> {
  if (isDynamicQuery(job.query)) return null
  const aiKey = planAiImage(job.query, context, job.aspect).key
  const stockKey = stockCacheKey(job.query)
  const keys = mode === 'hybrid' ? [stockKey, aiKey] : [aiKey, stockKey]
  for (const key of keys) {
    const accept = mode === 'ai' && key === stockKey ? (meta: CachedImageMeta) => meta.aiFallback === 'refused' : undefined
    const hit = await readCachedImage(key, accept)
    if (hit) {
      console.log(`[images] cache hit (${hit.meta.source}): ${job.query}`)
      return assetFromCache(hit, cachedFileName(job.query, key, hit.meta.ext), job.ref)
    }
  }
  return null
}

async function resolveJob(job: ImageJob, aiAllowed: boolean, ctx: JobContext): Promise<ImageAsset | null> {
  if (isDynamicQuery(job.query)) return null
  console.log(`[images] query: ${job.query}`)
  if (ctx.mode === 'stock') return stockAsset(job, ctx)
  if (ctx.mode === 'hybrid') {
    return (await stockAsset(job, ctx)) || (aiAllowed ? (await aiAsset(job, ctx, 0)).asset : null)
  }
  const ai = aiAllowed ? await aiAsset(job, ctx, ctx.timing.stockReserveMs) : { asset: null, reason: 'unavailable' as const }
  if (ai.asset || ai.reason === 'aborted') return ai.asset
  return stockAsset(job, ctx, ai.reason === 'refused' ? 'refused' : 'unavailable')
}

/**
 * One AI image within the budget: never past `reserveMs` before the deadline
 * (stock still needs that time), never with the AI breaker open, never past
 * the hourly quota.
 */
async function aiAsset(
  job: ImageJob,
  ctx: JobContext,
  reserveMs: number,
): Promise<{ asset: ImageAsset | null; reason?: AiFailure }> {
  const window = Math.min(ctx.timing.aiTimeoutMs, ctx.timeLeft() - reserveMs)
  if (window < ctx.timing.minAiWindowMs || !providerAvailable(AI_PROVIDER)) return { asset: null, reason: 'unavailable' }
  if (!(await ctx.quota.take())) return { asset: null, reason: 'unavailable' }
  const result = await generateAiImageResult({
    query: job.query,
    context: ctx.context,
    aspect: job.aspect,
    signal: ctx.signal,
    timeoutMs: window,
    shortened: window < ctx.timing.aiTimeoutMs,
  })
  if (!result.image) return { asset: null, reason: result.reason }
  const image = result.image
  const file = cachedFileName(job.query, image.key, image.ext)
  await writeCachedImage({
    key: image.key, query: job.ref, ext: image.ext, mime: image.mime, source: 'ai',
    model: image.model, prompt: image.prompt, size: image.size,
  }, image.bytes)
  return {
    asset: localAsset(file, image.bytes, image.mime, {
      query: job.ref, source: 'ai', model: image.model, prompt: image.prompt,
    }),
  }
}

/**
 * Stock photo: the cached pick for this query first, then a live search.
 * `aiFallback` records why AI was not used, so AI mode can tell a refusal
 * (reuse) from an outage (retry AI next time).
 */
async function stockAsset(
  job: ImageJob,
  ctx: JobContext,
  aiFallback?: 'refused' | 'unavailable',
): Promise<ImageAsset | null> {
  const key = stockCacheKey(job.query)
  const hit = await readCachedImage(key)
  if (hit) {
    console.log(`[images] cache hit (${hit.meta.source}): ${job.query}`)
    if (aiFallback === 'refused' && hit.meta.aiFallback !== 'refused') {
      await writeCachedImage({ ...hit.meta, aiFallback }, hit.bytes)
    }
    return assetFromCache(hit, cachedFileName(job.query, key, hit.meta.ext), job.ref)
  }
  const asset = await resolveStock(job.query, ctx.byUrl, ctx.signal)
  const ext = asset?.file.split('.').pop() || ''
  // A photo reused from an earlier query keeps that query's file and cache entry.
  if (asset && asset.file === cachedFileName(job.query, key, ext)) {
    await writeCachedImage({
      key, query: job.ref, ext, mime: asset.mime, source: asset.source, aiFallback,
      url: asset.url, sourcePage: asset.sourcePage, creator: asset.creator, creatorUrl: asset.creatorUrl,
      license: asset.license, licenseVersion: asset.licenseVersion, licenseUrl: asset.licenseUrl,
    }, asset.bytes)
  }
  return asset
}

/**
 * Per-user and server-wide hourly ceilings on paid AI images (lib/ratelimit:
 * KV when configured, else in-memory). Once either is reached, the rest of
 * this batch uses stock photos or placeholders.
 */
function aiQuota(userId?: string): AiQuota {
  let exhausted = false
  return {
    async take() {
      if (exhausted) return false
      const user = userId ? `user:${userId}:ai-images` : ''
      try {
        const limited = (user && await ratelimit(user, envCount('EVOSTACK_IMAGE_USER_HOURLY', AI_USER_HOURLY), '1h')) ||
          await ratelimit('global:ai-images', envCount('EVOSTACK_IMAGE_GLOBAL_HOURLY', AI_GLOBAL_HOURLY), '1h')
        if (!limited) return true
        console.warn('[images] hourly AI image quota reached; using stock photos')
      } catch (err) {
        // No paid image without a working quota; stock still fills the photo.
        console.warn('[images] AI image quota unavailable; using stock photos', err instanceof Error ? err.message : err)
      }
      exhausted = true
      return false
    },
  }
}

const STOCK_PROVIDERS = [
  ['openverse', searchOpenverse],
  ['wikimedia', searchWikimedia],
  ['met', searchMet],
  ['cleveland', searchCleveland],
] as const

const MUSEUMS = new Set(['met', 'cleveland'])

/** Museum collections only suit art and heritage subjects, never a modern car, person or product. */
const ART_RE = /\b(fine art|artworks?|paintings?|painted|sculptures?|statues?|busts?|antiques?|ancient|antiquity|historic(?:al)?|museums?|heritage|ceramics?|pottery|porcelain|vases?|amphoras?|tapestr(?:y|ies)|textiles?|manuscripts?|calligraphy|woodblock|woodcuts?|engravings?|etchings?|lithographs?|drawings?|sketch(?:es)?|mosaics?|frescos?|frescoes|murals?|armou?r|relics?|artifacts?|artefacts?|renaissance|baroque|medieval|still life|botanical illustration)\b/i
/** Wording that asks for something old; otherwise dated titles ("1913 Silver Ghost") rank last. */
const VINTAGE_RE = /\b(vintage|classic|antiques?|retro|historic(?:al)?|heritage|old|ancient|century|victorian|edwardian|art deco|1[0-9]{3}s?)\b/i
const OLD_YEAR_RE = /\b(1[5-8][0-9]{2}|19[0-6][0-9])\b/

/** Providers search in parallel; the first relevant, downloadable photo wins. */
async function resolveStock(
  query: string,
  byUrl: Map<string, ImageAsset>,
  signal: AbortSignal,
): Promise<ImageAsset | null> {
  const relevant = stockRelevance(query)
  const museums = ART_RE.test(query)
  const modern = !VINTAGE_RE.test(query)
  const dated = (c: ImageCandidate) => OLD_YEAR_RE.test(`${c.title} ${c.description || ''}`)
  for (const q of stockSearchQueries(query)) {
    signal.throwIfAborted()
    const live = STOCK_PROVIDERS.filter(([name]) => providerAvailable(name) && (museums || !MUSEUMS.has(name)))
    if (!live.length) return null
    const found = await firstAsset(live.map(([name, search]) => async (sig: AbortSignal) => {
      let ranked = rankCandidates(query, await search(q, sig)).filter(relevant)
      if (modern) ranked = [...ranked.filter((c) => !dated(c)), ...ranked.filter(dated)]
      return pickDownload(query, name, ranked, byUrl, sig)
    }), signal)
    if (found) return found
  }
  return null
}

const NUMBER_WORDS = new Set(['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'dozen', 'single', 'double', 'pair', 'couple'])
/** Framing words describe the shot, not the subject. */
const SHOT_WORDS = new Set([
  'portrait', 'portraits', 'headshot', 'headshots', 'shot', 'shots', 'closeup', 'close', 'view', 'views', 'aerial',
  'overhead', 'profile', 'side', 'front', 'rear', 'top', 'angle', 'detail', 'details', 'macro', 'wide', 'candid',
  'editorial', 'lifestyle', 'hero', 'banner', 'scene', 'photography', 'lighting', 'light', 'style',
])

/**
 * Whole-word relevance for a stock candidate (title, description, tags): it
 * names the subject's head noun ("mechanic" in "senior male mechanic"), or
 * at least two of its proper names ("Rolls", "Royce", "Ghost"). Setting and
 * style words, colors, numbers and framing words never count on their own.
 */
export function stockRelevance(query: string): (c: ImageCandidate) => boolean {
  const subject = subjectPhrase(parseImageRef(query).query)
  const isSubjectWord = (w: string) => w.length > 2 && !/^\d+$/.test(w) && !isStopWord(w) && !isPhotoWord(w) &&
    !isWeakWord(w) && !isFillerWord(w) && !NUMBER_WORDS.has(w) && !SHOT_WORDS.has(w)
  const words = (text: string) => text.split(/[^A-Za-z0-9]+/).filter(Boolean)
  // One head per conjunct ("croissants and coffee"); participles ("parked", "working") trail their noun.
  const heads = subject.split(/\s+(?:and|&|or|plus)\s+/i).map((part) =>
    words(part).map((t) => t.toLowerCase()).filter(isSubjectWord).reverse().find((w) => w.length <= 4 || !/(?:ing|ed)$/.test(w)))
    .filter((w): w is string => Boolean(w))
  const proper = Array.from(new Set(words(subject).filter((t, i) => i > 0 && /^[A-Z]/.test(t)).map((t) => t.toLowerCase()).filter(isSubjectWord)))
  return (c) => {
    const tokens = new Set(textTokens([c.title, c.description || '', ...(c.tags || [])].join(' ')))
    const has = (w: string) => tokens.has(w) || tokens.has(`${w}s`) || tokens.has(`${w}es`) ||
      (w.length > 3 && w.endsWith('s') && tokens.has(w.slice(0, -1)))
    if (heads.some(has)) return true
    if (proper.length && proper.filter(has).length >= Math.min(2, proper.length)) return true
    return !heads.length && !proper.length
  }
}

async function firstAsset(
  tasks: ((signal: AbortSignal) => Promise<ImageAsset | null>)[],
  parent: AbortSignal,
): Promise<ImageAsset | null> {
  const race = new AbortController()
  const signal = AbortSignal.any([parent, race.signal])
  try {
    return await new Promise<ImageAsset | null>((resolve) => {
      let pending = tasks.length
      const settle = (asset: ImageAsset | null) => {
        if (asset) resolve(asset)
        else if (--pending === 0) resolve(null)
      }
      for (const task of tasks) task(signal).then(settle, () => settle(null))
    })
  } finally {
    race.abort()
  }
}

/** Stock search terms: the photo's subject first ("black sedan" from "black sedan in a showroom, studio lighting"). */
export function stockSearchQueries(query: string): string[] {
  const head = query.split(/[,;|]/)[0]
  const cut = head.search(/\s(?:in|on|at|inside|against|with|near|under|over|by|from|during)\s/i)
  const subject = (cut > 0 ? head.slice(0, cut) : head).trim()
  const out: string[] = []
  const take = (list: string[], n: number) => {
    for (const v of list.slice(0, n)) {
      if (out.length < STOCK_VARIANTS && !out.some((x) => x.toLowerCase() === v.toLowerCase())) out.push(v)
    }
  }
  if (subject && subject.toLowerCase() !== query.toLowerCase()) take(searchQueries(subject), 3)
  take(searchQueries(query), STOCK_VARIANTS)
  return out
}

async function restoreLocalImage(file: string): Promise<ImageAsset | null> {
  const placeholder = parsePlaceholderFile(file)
  if (placeholder) return placeholderAsset(file, placeholder.ext === 'png' ? null : await recallPlaceholder(file))
  const m = CACHED_FILE_RE.exec(file)
  if (!m) return null
  const hit = await findCachedImage(m[1])
  if (!hit || hit.meta.ext !== m[2]) return null
  console.log(`[images] restored ${IMAGE_PUBLIC}/${file} from cache`)
  return assetFromCache(hit, file, hit.meta.query)
}

/** Best-effort query for a file whose bytes are gone: its slug, without hash or extension. */
function queryFromFileName(file: string): string {
  const placeholder = parsePlaceholderFile(file)
  if (placeholder) {
    const suffix = `-${placeholder.aspect}-${placeholder.seed}.${placeholder.ext}`
    const words = file.slice(0, file.length - suffix.length).replace(/[-_.]+/g, ' ').trim()
    return `${words || 'image'}#${placeholder.aspect}`
  }
  const stem = file
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/-[0-9a-f]{8,12}$/i, '')
    .replace(/[-_.]+/g, ' ')
    .trim()
  return stem || 'image'
}

function localAsset(
  file: string,
  bytes: Uint8Array,
  mime: string,
  meta: Omit<ImageAsset, 'file' | 'path' | 'publicPath' | 'bytes' | 'mime'>,
): ImageAsset {
  return { ...meta, file, path: `${IMAGE_DIR}/${file}`, publicPath: `${IMAGE_PUBLIC}/${file}`, bytes, mime }
}

function assetFromCache(hit: CachedImage, file: string, query: string): ImageAsset {
  const m = hit.meta
  return localAsset(file, hit.bytes, m.mime, {
    query, source: m.source, url: m.url, model: m.model, prompt: m.prompt,
    sourcePage: m.sourcePage, creator: m.creator, creatorUrl: m.creatorUrl,
    license: m.license, licenseVersion: m.licenseVersion, licenseUrl: m.licenseUrl,
  })
}

/**
 * `ref` is the exact reference behind the placeholder; null means unknown
 * (a restore without a record, or a runtime-built PNG): never portable, so a
 * later edit cannot turn a guessed query from the file name into a paid photo.
 */
function placeholderAsset(file: string, ref?: string | null): ImageAsset {
  const { bytes, mime } = placeholderBytes(file)
  const portable = ref !== null && parsePlaceholderFile(file)?.ext !== 'png'
  return localAsset(file, bytes, mime, {
    query: ref || queryFromFileName(file), source: 'placeholder', ...(portable ? {} : { portable: false as const }),
  })
}

function manifestEntry(a: ImageAsset): ImageManifestEntry {
  const entry: ImageManifestEntry = { query: a.query, file: a.file, source: a.source, note: licenseNote(a) }
  if (a.portable === false) entry.portable = false
  for (const key of ['model', 'prompt', 'url', 'sourcePage', 'creator', 'creatorUrl', 'license', 'licenseVersion', 'licenseUrl'] as const) {
    if (a[key]) entry[key] = a[key]
  }
  return entry
}

function licenseNote(a: ImageAsset): string {
  if (a.source === 'ai') return `AI-generated${a.model ? ` (${a.model})` : ''}`
  if (a.source === 'placeholder') {
    return a.file.endsWith('.png') ? 'Generated placeholder (image reference built at runtime)' : 'Generated placeholder (no photo available)'
  }
  const lic = (a.license || '').trim()
  const label = !lic
    ? 'License unknown'
    : /^by(-nc)?(-sa|-nd)?$/i.test(lic)
      ? `CC ${lic.toUpperCase()}`
      : /^cc0$/i.test(lic)
        ? 'CC0'
        : /^pdm$/i.test(lic)
          ? 'Public Domain Mark'
          : lic
  return [
    `${label}${a.licenseVersion && !label.includes(a.licenseVersion) ? ` ${a.licenseVersion}` : ''}`,
    a.creator ? `by ${a.creator}` : '',
    a.sourcePage || a.url || '',
  ].filter(Boolean).join(' — ')
}

const MAX_SEARCH_VARIANTS = 8

const PHOTO_WORDS = new Set([
  'photo',
  'photograph',
  'image',
  'picture',
  'real',
])
const FILLER_WORDS = new Set(['product', 'products'])
const STOP_WORDS = new Set([
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
])
const WEAK_WORDS = new Set([
  'luxury',
  'modern',
  'beautiful',
  'premium',
  'black',
  'white',
  'red',
  'blue',
  'green',
  'gold',
  'silver',
  'yellow',
  'orange',
  'pink',
  'purple',
  'grey',
  'gray',
  'brown',
  'beige',
  'navy',
  'dark',
  'light',
  'bright',
  'soft',
  'clean',
  'simple',
  'abstract',
  'colorful',
  'colourful',
  'minimalist',
  'elegant',
  'professional',
  'vintage',
  'rustic',
  'sleek',
  'stylish',
  'trendy',
  'cute',
  'cool',
  'nice',
  'new',
  'old',
  'best',
  'top',
  'empty',
  'blank',
  'isolated',
  'stunning',
  'gorgeous',
  'amazing',
  'high',
  'quality',
  'studio',
  'commercial',
  'closeup',
  'shot',
  'view',
  'background',
  'backdrop',
  'mockup',
  'template',
  'aesthetic',
  'wallpaper',
  'stock',
])

export function searchQueries(query: string): string[] {
  const q = query.trim()
  const out: string[] = []
  const add = (s: string) => {
    const n = s.replace(/\s+/g, ' ').trim()
    if (!n || out.length >= MAX_SEARCH_VARIANTS) return
    if (out.some((x) => x.toLowerCase() === n.toLowerCase())) return
    out.push(n)
  }
  const addTokens = (tokens: string[], kind: 'any' | 'bigram' = 'any') => {
    if (kind === 'bigram' ? !isUsefulBigram(tokens) : !isUsefulVariant(tokens)) {
      return
    }
    add(tokens.join(' '))
  }

  add(q)

  const raw = query.split(/[^a-zA-Z0-9]+/).filter(Boolean)
  const core = raw.filter((t) => !isStopWord(t) && !isPhotoWord(t))
  addTokens(core)

  const tight = core.filter((t) => !isFillerWord(t))
  addTokens(tight)

  peelLeading(tight, addTokens)
  for (let i = 0; i + 2 <= core.length; i++) {
    addTokens(core.slice(i, i + 2), 'bigram')
  }
  peelTrailing(tight, addTokens)
  peelTrailing(core, addTokens)
  peelLeading(core, addTokens)
  for (let n = 3; n >= 2; n--) {
    for (let i = 0; i + n <= tight.length; i++) {
      addTokens(tight.slice(i, i + n), n === 2 ? 'bigram' : 'any')
    }
  }
  const anchors = tight.filter(isAnchorWord)
  if (anchors.length >= 2) {
    addTokens([anchors[0], anchors[anchors.length - 1]], 'bigram')
  }
  return out
}

function peelLeading(
  tokens: string[],
  addTokens: (tokens: string[], kind?: 'any' | 'bigram') => void,
) {
  let next = tokens.slice()
  while (next.length > 2 && isWeakWord(next[0])) {
    next = next.slice(1)
    addTokens(next)
  }
}

function peelTrailing(
  tokens: string[],
  addTokens: (tokens: string[], kind?: 'any' | 'bigram') => void,
) {
  let next = tokens.slice()
  while (next.length > 2) {
    next = next.slice(0, -1)
    addTokens(next)
  }
}

function isPhotoWord(t: string): boolean {
  return PHOTO_WORDS.has(t.toLowerCase())
}

function isFillerWord(t: string): boolean {
  return FILLER_WORDS.has(t.toLowerCase())
}

function isStopWord(t: string): boolean {
  return STOP_WORDS.has(t.toLowerCase())
}

function isWeakWord(t: string): boolean {
  return WEAK_WORDS.has(t.toLowerCase())
}

function isAnchorWord(t: string): boolean {
  if (/\d/.test(t)) return true
  return !isStopWord(t) && !isPhotoWord(t) && !isFillerWord(t) && !isWeakWord(t)
}

function isUsefulVariant(tokens: string[]): boolean {
  return tokens.length >= 2 && tokens.some(isAnchorWord)
}

function isUsefulBigram(tokens: string[]): boolean {
  return isUsefulVariant(tokens) && !isFillerWord(tokens[0])
}

async function pickDownload(
  query: string,
  provider: string,
  candidates: ImageCandidate[],
  byUrl: Map<string, ImageAsset>,
  signal: AbortSignal,
): Promise<ImageAsset | null> {
  signal.throwIfAborted()
  if (!candidates.length) return null
  console.log(`[images] provider: ${provider}`)

  for (const cand of candidates.slice(0, DOWNLOAD_TRIES)) {
    signal.throwIfAborted()
    const reused = byUrl.get(cand.url)
    if (reused) {
      console.log(`[images] selected: ${cand.title || cand.url}`)
      console.log(`[images] downloaded: ${reused.path} (reused)`)
      return { ...reused, query }
    }
    const got = await downloadImage(cand.url, signal)
    signal.throwIfAborted()
    if (!got) continue
    const file = cachedFileName(query, stockCacheKey(query), got.ext)
    const path = `${IMAGE_DIR}/${file}`
    const asset: ImageAsset = {
      query,
      file,
      path,
      publicPath: `${IMAGE_PUBLIC}/${file}`,
      bytes: got.bytes,
      mime: got.mime,
      source: provider,
      url: cand.url,
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
  signal?: AbortSignal,
): Promise<{ bytes: Uint8Array; mime: string; ext: string } | null> {
  if (!isSafeImageUrl(url)) return null
  try {
    signal?.throwIfAborted()
    const res = await fetchSafe(url, {
      signal,
      headers: {
        Accept: 'image/*,application/octet-stream;q=0.9',
        'User-Agent': IMAGE_UA,
      },
    })
    if (!res.ok) return null
    const ct = res.headers.get('content-type') || ''
    const length = Number(res.headers.get('content-length') || 0)
    const limits = imageByteLimits()
    if (length && (length < limits.min || length > limits.max)) return null
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
  init.signal?.throwIfAborted()
  const res = await fetch(url, {
    ...init,
    redirect: 'manual',
    signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000),
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

export function scoreCandidate(c: ImageCandidate, words: string[]): number {
  const titleToks = textTokens(c.title || '')
  const tagToks = (c.tags || []).map((t) => textTokens(t))
  const descToks = textTokens(c.description || '')
  const covered = new Set<string>()
  let titleHit = false
  let tagHit = false
  let descHit = false
  let score = 0

  for (const word of words) {
    if (exactIn(titleToks, word)) {
      score += 16
      titleHit = true
      covered.add(word)
    } else if (weakIn(titleToks, word)) {
      score += 4
      titleHit = true
      covered.add(word)
    }

    let exactTags = 0
    let weakTags = 0
    for (const tag of tagToks) {
      if (exactIn(tag, word)) exactTags += 1
      else if (weakIn(tag, word)) weakTags += 1
    }
    if (exactTags) {
      score += 14 + Math.min(exactTags - 1, 3) * 5
      tagHit = true
      covered.add(word)
    } else if (weakTags) {
      score += 4
      tagHit = true
      covered.add(word)
    }

    if (exactIn(descToks, word)) {
      score += 5
      descHit = true
      covered.add(word)
    } else if (weakIn(descToks, word)) {
      score += 2
      descHit = true
      covered.add(word)
    }
  }

  score += covered.size * 10
  if (covered.size >= 2) score += (covered.size - 1) * 6

  const fm = c.fieldsMatched || []
  if (titleHit && fm.includes('title')) score += 2
  if (tagHit && fm.includes('tags')) score += 2
  if (descHit && fm.includes('description')) score += 1

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

function textTokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1)
}

function exactIn(tokens: string[], word: string): boolean {
  return tokens.includes(word)
}

function weakIn(tokens: string[], word: string): boolean {
  if (word.length < 5) return false
  return tokens.some(
    (t) => t !== word && t.length >= 5 && (t.startsWith(word) || word.startsWith(t)),
  )
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

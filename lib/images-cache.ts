import { createHash, randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { sniffImage } from './images-shared'

/** Entries kept on disk (an image is <key>.<ext> + <key>.json; a placeholder record is <key>.json); oldest are evicted first. */
export const IMAGE_CACHE_MAX_ENTRIES = 2000
const EVICT_EVERY_WRITES = 25

export type CachedImageMeta = {
  key: string
  /** The full evo-image reference (including any #aspect hint) that produced this image. */
  query: string
  ext: string
  mime: string
  /** 'ai' or the stock provider name. */
  source: string
  /**
   * Set on stock photos used because AI did not answer: 'refused' (content
   * policy; reused while AI works) or 'unavailable' (outage, quota, budget;
   * ignored in AI mode so the subject gets an AI photo once AI is back).
   */
  aiFallback?: 'refused' | 'unavailable'
  model?: string
  prompt?: string
  size?: string
  url?: string
  sourcePage?: string
  creator?: string
  creatorUrl?: string
  license?: string
  licenseVersion?: string
  licenseUrl?: string
  createdAt: string
}

export type CachedImage = { bytes: Uint8Array; meta: CachedImageMeta }

export function imageCacheDir(): string {
  return process.env.EVOSTACK_IMAGE_CACHE_DIR || path.join(process.cwd(), '.data', 'image-cache')
}

export function imageCacheKey(...parts: string[]): string {
  return createHash('sha256').update(parts.join('\n')).digest('hex')
}

const KEY_RE = /^[0-9a-f]{64}$/
const PREFIX_RE = /^[0-9a-f]{12,64}$/
const EXT_RE = /^(webp|jpg|png|gif)$/

/**
 * Exact lookup by full key; refreshes the entry's age so hot images survive
 * eviction. `accept` can reject an entry by its metadata before the bytes are
 * read, and a rejected entry keeps its age.
 */
export async function readCachedImage(
  key: string,
  accept?: (meta: CachedImageMeta) => boolean,
): Promise<CachedImage | null> {
  if (!KEY_RE.test(key)) return null
  return readEntry(key, accept)
}

/** Restore lookup by the hash prefix embedded in a sandbox file name. */
export async function findCachedImage(prefix: string): Promise<CachedImage | null> {
  if (!PREFIX_RE.test(prefix)) return null
  let names: string[]
  try {
    names = await fs.readdir(imageCacheDir())
  } catch {
    return null
  }
  const match = names.find((name) => name.startsWith(prefix) && name.endsWith('.json'))
  return match ? readEntry(match.slice(0, -'.json'.length)) : null
}

export async function writeCachedImage(
  meta: Omit<CachedImageMeta, 'createdAt'>,
  bytes: Uint8Array,
): Promise<void> {
  if (!KEY_RE.test(meta.key) || !EXT_RE.test(meta.ext)) return
  const dir = imageCacheDir()
  try {
    await fs.mkdir(dir, { recursive: true })
    const tmp = `.${randomBytes(6).toString('hex')}.tmp`
    // Bytes land before the JSON sidecar, so a sidecar always means a complete entry.
    await fs.writeFile(path.join(dir, meta.key + tmp), bytes)
    await fs.rename(path.join(dir, meta.key + tmp), path.join(dir, `${meta.key}.${meta.ext}`))
    const record: CachedImageMeta = { ...meta, createdAt: new Date().toISOString() }
    await fs.writeFile(path.join(dir, `${meta.key}.json${tmp}`), JSON.stringify(record, null, 2))
    await fs.rename(path.join(dir, `${meta.key}.json${tmp}`), path.join(dir, `${meta.key}.json`))
    if (++writes % EVICT_EVERY_WRITES === 1) void evictImageCache().catch(() => {})
  } catch (err) {
    console.warn('[images] cache write failed', err instanceof Error ? err.message : err)
  }
}

let writes = 0

/**
 * The evo-image reference behind a placeholder file. Placeholder names are
 * lossy (slugged, truncated); a restore reads this back so the placeholder
 * converts to its exact query, not a guess like "item photo".
 */
export async function rememberPlaceholder(file: string, query: string): Promise<void> {
  const key = imageCacheKey('placeholder', file)
  const target = path.join(imageCacheDir(), `${key}.json`)
  try {
    await fs.access(target)
    return
  } catch { /* not recorded yet */ }
  try {
    await fs.mkdir(imageCacheDir(), { recursive: true })
    const tmp = `${target}.${randomBytes(6).toString('hex')}.tmp`
    await fs.writeFile(tmp, JSON.stringify({ key, file, query, createdAt: new Date().toISOString() }))
    await fs.rename(tmp, target)
    if (++writes % EVICT_EVERY_WRITES === 1) void evictImageCache().catch(() => {})
  } catch (err) {
    console.warn('[images] placeholder record failed', err instanceof Error ? err.message : err)
  }
}

export async function recallPlaceholder(file: string): Promise<string | null> {
  const key = imageCacheKey('placeholder', file)
  try {
    const record = JSON.parse(await fs.readFile(path.join(imageCacheDir(), `${key}.json`), 'utf8')) as { key?: unknown; file?: unknown; query?: unknown }
    return record.key === key && record.file === file && typeof record.query === 'string' && record.query.trim() ? record.query : null
  } catch {
    return null
  }
}

/** Removes the least recently used entries beyond the cap. */
export async function evictImageCache(max = IMAGE_CACHE_MAX_ENTRIES): Promise<number> {
  const dir = imageCacheDir()
  let names: string[]
  try {
    names = await fs.readdir(dir)
  } catch {
    return 0
  }
  const keys = names.filter((n) => n.endsWith('.json')).map((n) => n.slice(0, -5)).filter((k) => KEY_RE.test(k))
  if (keys.length <= max) return 0
  const aged = await Promise.all(keys.map(async (key) => {
    try {
      return { key, at: (await fs.stat(path.join(dir, `${key}.json`))).mtimeMs }
    } catch {
      return { key, at: 0 }
    }
  }))
  aged.sort((a, b) => a.at - b.at)
  const doomed = aged.slice(0, keys.length - max)
  const doomedKeys = new Set(doomed.map((d) => d.key))
  await Promise.all(names
    .filter((name) => doomedKeys.has(name.split('.')[0]))
    .map((name) => fs.rm(path.join(dir, name), { force: true }).catch(() => {})))
  return doomed.length
}

async function readEntry(key: string, accept?: (meta: CachedImageMeta) => boolean): Promise<CachedImage | null> {
  const dir = imageCacheDir()
  try {
    const meta = JSON.parse(await fs.readFile(path.join(dir, `${key}.json`), 'utf8')) as CachedImageMeta
    if (!meta || meta.key !== key || !EXT_RE.test(meta.ext)) return null
    if (accept && !accept(meta)) return null
    const bytes = new Uint8Array(await fs.readFile(path.join(dir, `${key}.${meta.ext}`)))
    if (!sniffImage(bytes)) return null
    const now = new Date()
    void fs.utimes(path.join(dir, `${key}.json`), now, now).catch(() => {})
    return { bytes, meta }
  } catch {
    return null
  }
}

import { fragmentFiles, type WrittenFile } from './fragment-files'
import { fragmentCodeText } from './schema'

export const IMAGE_VALIDATE_MS = 4_000

export type ImageProbe = (url: string, timeoutMs: number) => Promise<boolean>

export type ImageUrlValidator = {
  validate: (url: string) => Promise<boolean>
  cache: Map<string, boolean>
}

const IMAGE_EXT = /\.(?:jpe?g|png|gif|webp|avif|svg)(?:\?|#|$)/i
const STOCK_HOST =
  /(?:unsplash\.com|picsum\.photos|loremflickr\.com|via\.placeholder\.com|placehold\.co|placeholder\.com|dummyimage\.com|placekitten\.com|placeimg\.com|lorem\.space|pixabay\.com|burst\.shopify\.com|pinimg\.com|pinterest\.com|i\.imgur\.com|googleusercontent\.com|images\.pexels\.com)$/i

export function placeholderDataUri(_purpose = 'card'): string {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#2a2a2a"/><stop offset="100%" stop-color="#111"/></linearGradient></defs><rect width="1200" height="800" fill="url(#g)"/></svg>'
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

export function looksLikeImageBytes(bytes?: Uint8Array | null): boolean {
  if (!bytes || bytes.length < 3) return false
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return true
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e) return true
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return true
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46) return true
  const head = new TextDecoder().decode(bytes.subarray(0, 80)).trimStart().toLowerCase()
  return head.startsWith('<svg') || head.startsWith('<?xml')
}

export function findRemoteImageUrls(code: string): string[] {
  if (!code) return []
  const found: string[] = []
  for (const m of code.matchAll(/https?:\/\/[^\s"'`)]+/g)) {
    const url = m[0].replace(/[.,;]+$/, '')
    if (/^(data:|blob:)/i.test(url)) continue
    if (isRemoteImageUrl(url, code, m.index ?? 0)) found.push(url)
  }
  return [...new Set(found)]
}

export async function defaultImageProbe(url: string, timeoutMs: number): Promise<boolean> {
  if (!/^https?:\/\//i.test(url)) return false
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
    if (!res.ok && res.status !== 206) {
      await cancelBody(res)
      return false
    }
    const ct = (res.headers.get('content-type') || '').toLowerCase()
    if (ct.includes('text/html') || ct.includes('application/json')) {
      await cancelBody(res)
      return false
    }
    if (ct.startsWith('image/')) {
      await cancelBody(res)
      return true
    }
    const reader = res.body?.getReader()
    if (!reader) return false
    const { value } = await reader.read()
    await reader.cancel()
    return looksLikeImageBytes(value)
  } catch {
    return false
  }
}

export function createImageUrlValidator(opts?: {
  probe?: ImageProbe
  timeoutMs?: number
}): ImageUrlValidator {
  const cache = new Map<string, boolean>()
  const inflight = new Map<string, Promise<boolean>>()
  const probe = opts?.probe ?? defaultImageProbe
  const timeoutMs = opts?.timeoutMs ?? IMAGE_VALIDATE_MS

  async function validate(url: string): Promise<boolean> {
    if (url.startsWith('data:image/')) return true
    if (!/^https?:\/\//i.test(url)) return false
    const cached = cache.get(url)
    if (cached !== undefined) return cached
    const pending = inflight.get(url)
    if (pending) return pending

    const task = (async () => {
      try {
        const ok = await probe(url, timeoutMs)
        cache.set(url, ok)
        return ok
      } catch {
        cache.set(url, false)
        return false
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

export async function replaceBrokenRemoteImages(
  code: string,
  validator?: ImageUrlValidator,
): Promise<{ text: string; removed: string[] }> {
  const urls = findRemoteImageUrls(code)
  if (!urls.length) return { text: code, removed: [] }
  const v = getImageUrlValidator(validator)
  const removed: string[] = []
  let next = code
  for (const url of urls) {
    const ok = await v.validate(url)
    if (ok) continue
    next = next.split(url).join(placeholderDataUri())
    removed.push(url)
  }
  return { text: next, removed }
}

export async function replaceBrokenRemoteImagesInFiles(
  files: WrittenFile[],
  validator?: ImageUrlValidator,
): Promise<WrittenFile[]> {
  const out: WrittenFile[] = []
  for (const file of files) {
    try {
      const { text } = await replaceBrokenRemoteImages(file.file_content, validator)
      out.push({ file_path: file.file_path, file_content: text })
    } catch {
      out.push(file)
    }
  }
  return out
}

export async function applyValidatedImagesToFragment<
  T extends { code?: unknown; file_path?: string },
>(fragment: T, validator?: ImageUrlValidator): Promise<T> {
  try {
    const files = await replaceBrokenRemoteImagesInFiles(fragmentFiles(fragment), validator)
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
  return /(?:src|srcSet|poster)\s*[:=]\s*['"`]?$/.test(before) || /url\(\s*['"]?$/.test(before)
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

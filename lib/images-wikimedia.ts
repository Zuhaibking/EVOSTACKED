import { IMAGE_UA, isSafeImageUrl, type ImageCandidate } from './images-shared'

const WIKI = 'https://commons.wikimedia.org/w/api.php'

export async function searchWikimedia(query: string): Promise<ImageCandidate[]> {
  const q = query.trim()
  if (!q) return []
  const url = `${WIKI}?${new URLSearchParams({
    action: 'query',
    format: 'json',
    origin: '*',
    generator: 'search',
    gsrsearch: q,
    gsrnamespace: '6',
    gsrlimit: '15',
    prop: 'imageinfo',
    iiprop: 'url|size|mime|extmetadata',
    iiurlwidth: '1600',
  }).toString()}`
  try {
    const res = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': IMAGE_UA,
      },
      signal: AbortSignal.timeout(12_000),
    })
    if (!res.ok) {
      console.warn(`[images] wikimedia http ${res.status}`)
      return []
    }
    const data: unknown = await res.json()
    return parseWikimedia(data)
  } catch (err) {
    console.warn(
      '[images] wikimedia search failed',
      err instanceof Error ? err.message : err,
    )
    return []
  }
}

export function parseWikimedia(data: unknown): ImageCandidate[] {
  if (!data || typeof data !== 'object') return []
  const pages = (data as { query?: { pages?: unknown } }).query?.pages
  if (!pages || typeof pages !== 'object') return []
  const out: ImageCandidate[] = []
  for (const page of Object.values(pages as Record<string, unknown>)) {
    if (!page || typeof page !== 'object') continue
    const p = page as Record<string, unknown>
    const infos = p.imageinfo
    if (!Array.isArray(infos) || !infos[0] || typeof infos[0] !== 'object') continue
    const info = infos[0] as Record<string, unknown>
    const mime = str(info.mime)
    if (mime && !mime.startsWith('image/')) continue
    const original = str(info.url)
    const thumb = str(info.thumburl)
    const size = num(info.size)
    const url =
      size && size > 3_500_000 && thumb && isSafeImageUrl(thumb)
        ? thumb
        : original
    if (!url || !isSafeImageUrl(url)) continue
    const ext = asRecord(info.extmetadata)
    const objectName = stripHtml(meta(ext, 'ObjectName'))
    const description = stripHtml(meta(ext, 'ImageDescription'))
    const tags = wikiTags(meta(ext, 'Categories'))
    out.push({
      title: objectName || stripHtml(str(p.title)).replace(/^File:/, ''),
      url,
      width: num(info.thumbwidth) || num(info.width),
      height: num(info.thumbheight) || num(info.height),
      source: 'wikimedia',
      sourcePage: str(info.descriptionurl),
      creator: stripHtml(meta(ext, 'Artist') || meta(ext, 'Attribution')).slice(
        0,
        200,
      ),
      creatorUrl: '',
      license: meta(ext, 'LicenseShortName') || meta(ext, 'License'),
      licenseVersion: '',
      licenseUrl: meta(ext, 'LicenseUrl'),
      filesize: size,
      provider: 'wikimedia',
      ...(description ? { description } : {}),
      ...(tags ? { tags } : {}),
    })
  }
  return out
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
}

function meta(ext: Record<string, unknown>, key: string): string {
  const row = ext[key]
  if (!row || typeof row !== 'object') return ''
  return str((row as { value?: unknown }).value)
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

function wikiTags(raw: string): string[] | undefined {
  const tags = raw
    .split('|')
    .map((t) => t.trim())
    .filter((t) => t && !isWikiProcessCategory(t))
  return tags.length ? tags : undefined
}

function isWikiProcessCategory(t: string): boolean {
  if (/^CC[- ]/i.test(t) || /^CC0$/i.test(t)) return true
  if (/^self-published work$/i.test(t)) return true
  if (/reviewed by/i.test(t)) return true
  if (/^flickr images reviewed/i.test(t)) return true
  if (/^uploaded (with|via) /i.test(t)) return true
  if (/^(files|media) from /i.test(t)) return true
  if (/^taken with /i.test(t)) return true
  if (/^photographs? taken on /i.test(t)) return true
  if (/^pd-/i.test(t) || /^public domain$/i.test(t)) return true
  return false
}

function stripHtml(s: string): string {
  return s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

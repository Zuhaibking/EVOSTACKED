import { isSafeImageUrl, providerJson, type ImageCandidate } from './images-shared'

const CMA = 'https://openaccess-api.clevelandart.org/api/artworks/'
const CC0_URL = 'https://creativecommons.org/publicdomain/zero/1.0/'

export async function searchCleveland(query: string, signal?: AbortSignal): Promise<ImageCandidate[]> {
  const q = query.trim()
  if (!q) return []
  const url = `${CMA}?${new URLSearchParams({
    q,
    cc0: '',
    has_image: '1',
    limit: '20',
  }).toString()}`
  const data = await providerJson('cleveland', url, signal)
  return data ? parseCleveland(data) : []
}

export function parseCleveland(data: unknown): ImageCandidate[] {
  if (!data || typeof data !== 'object') return []
  const rows = (data as { data?: unknown }).data
  if (!Array.isArray(rows)) return []
  const out: ImageCandidate[] = []
  for (const row of rows) {
    const cand = parseClevelandRow(row)
    if (cand) out.push(cand)
  }
  return out
}

function parseClevelandRow(row: unknown): ImageCandidate | null {
  if (!row || typeof row !== 'object') return null
  const r = row as Record<string, unknown>
  if (str(r.share_license_status).toUpperCase() !== 'CC0') return null
  const title = str(r.title)
  if (!title && !str(r.type)) return null
  const img = pickClevelandImage(r.images)
  if (!img) return null
  const description = str(r.description)
  const tags = clevelandTags(r)
  return {
    title: title || str(r.type),
    url: img.url,
    width: img.width,
    height: img.height,
    source: 'Cleveland Museum of Art',
    sourcePage: str(r.url),
    creator: clevelandCreator(r.creators),
    creatorUrl: '',
    license: 'CC0',
    licenseVersion: '1.0',
    licenseUrl: CC0_URL,
    filesize: img.filesize,
    provider: 'cleveland',
    ...(description ? { description } : {}),
    ...(tags ? { tags } : {}),
  }
}

function pickClevelandImage(images: unknown): {
  url: string
  width?: number
  height?: number
  filesize?: number
} | null {
  if (!images || typeof images !== 'object') return null
  const rec = images as Record<string, unknown>
  // ponytail: CMA `full` is uncompressed TIFF; download validator is jpeg/png/gif/webp only. Prefer print, then web. Upgrade: decode TIFF.
  const slots = [rec.print, rec.web, rec.full]
  for (const slot of slots) {
    const picked = imageSlot(slot)
    if (picked) return picked
  }
  return null
}

function imageSlot(slot: unknown): {
  url: string
  width?: number
  height?: number
  filesize?: number
} | null {
  if (!slot || typeof slot !== 'object') return null
  const s = slot as Record<string, unknown>
  const url = str(s.url)
  if (!url || !isSafeImageUrl(url)) return null
  if (/\.tiff?(\?|$)/i.test(url)) return null
  return {
    url,
    width: num(s.width),
    height: num(s.height),
    filesize: num(s.filesize),
  }
}

function clevelandCreator(v: unknown): string {
  if (!Array.isArray(v) || !v[0] || typeof v[0] !== 'object') return ''
  return str((v[0] as { description?: unknown }).description)
}

function clevelandTags(r: Record<string, unknown>): string[] | undefined {
  const tags: string[] = []
  const add = (v: string) => {
    if (v && !tags.includes(v)) tags.push(v)
  }
  add(str(r.type))
  add(str(r.technique))
  add(str(r.department))
  addList(r.culture, add)
  addList(r.artists_tags, add)
  addList(r.artist_tags, add)
  return tags.length ? tags : undefined
}

function addList(v: unknown, add: (s: string) => void) {
  if (typeof v === 'string') {
    add(v)
    return
  }
  if (!Array.isArray(v)) return
  for (const item of v) {
    if (typeof item === 'string') add(item.trim())
  }
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

function num(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) {
    return Number(v)
  }
  return undefined
}

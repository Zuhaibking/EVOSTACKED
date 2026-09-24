import { IMAGE_UA, isSafeImageUrl, type ImageCandidate } from './images-shared'

const OPENVERSE = 'https://api.openverse.org/v1/images/'

export async function searchOpenverse(query: string): Promise<ImageCandidate[]> {
  const q = query.trim()
  if (!q) return []
  const url = `${OPENVERSE}?${new URLSearchParams({
    q,
    page_size: '20',
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
      console.warn(`[images] openverse http ${res.status}`)
      return []
    }
    const data: unknown = await res.json()
    return parseOpenverse(data)
  } catch (err) {
    console.warn(
      '[images] openverse search failed',
      err instanceof Error ? err.message : err,
    )
    return []
  }
}

function parseOpenverse(data: unknown): ImageCandidate[] {
  if (!data || typeof data !== 'object') return []
  const results = (data as { results?: unknown }).results
  if (!Array.isArray(results)) return []
  const out: ImageCandidate[] = []
  for (const row of results) {
    if (!row || typeof row !== 'object') continue
    const r = row as Record<string, unknown>
    if (r.mature === true) continue
    const imageUrl = str(r.url)
    if (!imageUrl || !isSafeImageUrl(imageUrl)) continue
    out.push({
      title: str(r.title),
      url: imageUrl,
      width: num(r.width),
      height: num(r.height),
      source: str(r.source) || str(r.provider) || 'openverse',
      sourcePage: str(r.foreign_landing_url),
      creator: str(r.creator),
      creatorUrl: str(r.creator_url),
      license: str(r.license),
      licenseVersion: str(r.license_version),
      licenseUrl: str(r.license_url),
      filesize: num(r.filesize),
      provider: 'openverse',
    })
  }
  return out
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

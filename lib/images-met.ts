import { IMAGE_UA, isSafeImageUrl, type ImageCandidate } from './images-shared'

const MET_SEARCH = 'https://collectionapi.metmuseum.org/public/collection/v1.1'
const MET_OBJECT = 'https://collectionapi.metmuseum.org/public/collection/v1'
const CC0_URL = 'https://creativecommons.org/publicdomain/zero/1.0/'
const SEARCH_LIMIT = 20
const OBJECT_FETCH_CAP = 6

export async function searchMet(query: string, signal?: AbortSignal): Promise<ImageCandidate[]> {
  const q = query.trim()
  if (!q) return []
  const url = `${MET_SEARCH}/search?${new URLSearchParams({
    q,
    hasImages: 'true',
    isPublicDomain: 'true',
    offset: '0',
    limit: String(SEARCH_LIMIT),
  }).toString()}`
  try {
    signal?.throwIfAborted()
    const res = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': IMAGE_UA,
      },
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(12_000)]) : AbortSignal.timeout(12_000),
    })
    if (!res.ok) {
      console.warn(`[images] met http ${res.status}`)
      return []
    }
    const ids = parseMetSearch(await res.json()).slice(0, OBJECT_FETCH_CAP)
    const out: ImageCandidate[] = []
    for (const id of ids) {
      signal?.throwIfAborted()
      const row = await fetchMetObject(id, signal)
      const cand = parseMetObject(row)
      if (cand) out.push(cand)
    }
    return out
  } catch (err) {
    console.warn(
      '[images] met search failed',
      err instanceof Error ? err.message : err,
    )
    return []
  }
}

export function parseMetSearch(data: unknown): number[] {
  if (!data || typeof data !== 'object') return []
  const ids = (data as { objectIDs?: unknown }).objectIDs
  if (!Array.isArray(ids)) return []
  const out: number[] = []
  for (const id of ids) {
    if (typeof id === 'number' && Number.isFinite(id) && id > 0) out.push(id)
  }
  return out
}

export function parseMetObject(data: unknown): ImageCandidate | null {
  if (!data || typeof data !== 'object') return null
  const r = data as Record<string, unknown>
  if (r.isPublicDomain !== true) return null
  const imageUrl = str(r.primaryImage)
  if (!imageUrl || !isSafeImageUrl(imageUrl)) return null
  const title = str(r.title) || str(r.objectName)
  const description = str(r.medium) || str(r.creditLine)
  const tags = metTags(r)
  const objectId = typeof r.objectID === 'number' ? r.objectID : undefined
  const sourcePage =
    str(r.objectURL) ||
    (objectId ? `https://www.metmuseum.org/art/collection/search/${objectId}` : '')
  return {
    title,
    url: imageUrl,
    source: 'The Met',
    sourcePage,
    creator: str(r.artistDisplayName),
    creatorUrl: '',
    license: 'CC0',
    licenseVersion: '1.0',
    licenseUrl: CC0_URL,
    provider: 'met',
    ...(description ? { description } : {}),
    ...(tags ? { tags } : {}),
  }
}

async function fetchMetObject(id: number, signal?: AbortSignal): Promise<unknown> {
  try {
    signal?.throwIfAborted()
    const res = await fetch(`${MET_OBJECT}/objects/${id}`, {
      headers: {
        Accept: 'application/json',
        'User-Agent': IMAGE_UA,
      },
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(12_000)]) : AbortSignal.timeout(12_000),
    })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

function metTags(r: Record<string, unknown>): string[] | undefined {
  const tags: string[] = []
  const add = (v: string) => {
    if (v && !tags.includes(v)) tags.push(v)
  }
  add(str(r.classification))
  add(str(r.culture))
  add(str(r.period))
  add(str(r.department))
  if (Array.isArray(r.tags)) {
    for (const t of r.tags) {
      if (t && typeof t === 'object') add(str((t as { term?: unknown }).term))
    }
  }
  return tags.length ? tags : undefined
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

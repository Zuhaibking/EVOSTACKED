import { isSafeImageUrl, providerJson, type ImageCandidate } from './images-shared'

const OPENVERSE = 'https://api.openverse.org/v1/images/'

export async function searchOpenverse(query: string, signal?: AbortSignal): Promise<ImageCandidate[]> {
  const q = query.trim()
  if (!q) return []
  const url = `${OPENVERSE}?${new URLSearchParams({
    q,
    page_size: '20',
  }).toString()}`
  const data = await providerJson('openverse', url, signal)
  return data ? parseOpenverse(data) : []
}

export function parseOpenverse(data: unknown): ImageCandidate[] {
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
    const description = str(r.description)
    const tags = openverseTags(r.tags)
    const fieldsMatched = openverseFieldsMatched(r.fields_matched)
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
      ...(description ? { description } : {}),
      ...(tags ? { tags } : {}),
      ...(fieldsMatched ? { fieldsMatched } : {}),
    })
  }
  return out
}

function openverseTags(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined
  const tags: string[] = []
  for (const t of v) {
    if (typeof t === 'string') {
      if (t.trim()) tags.push(t.trim())
      continue
    }
    if (t && typeof t === 'object' && 'name' in t) {
      const name = str((t as { name?: unknown }).name)
      if (name) tags.push(name)
    }
  }
  return tags.length ? tags : undefined
}

function openverseFieldsMatched(v: unknown): string[] | undefined {
  if (!Array.isArray(v) || !v.length) return undefined
  const fields = v.filter((x): x is string => typeof x === 'string')
  return fields.length ? fields : undefined
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

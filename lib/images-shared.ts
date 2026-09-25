export const IMAGE_SCHEME = 'evo-image://'
export const IMAGE_DIR = 'public/evo-images'
export const IMAGE_PUBLIC = '/evo-images'
export const IMAGE_UA =
  'EvoStack/0.1 (website builder; real image resolver; https://github.com/Zuhaibking/EVOSTACKED)'

export type ImageCandidate = {
  title: string
  url: string
  width?: number
  height?: number
  source: string
  sourcePage?: string
  creator?: string
  creatorUrl?: string
  license?: string
  licenseVersion?: string
  licenseUrl?: string
  filesize?: number
  provider: string
  description?: string
  tags?: string[]
  fieldsMatched?: string[]
}

export function isSafeImageUrl(raw: string): boolean {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return false
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
  return !hostBlocked(u.hostname)
}

function hostBlocked(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (
    h === 'localhost' ||
    h.endsWith('.localhost') ||
    h.endsWith('.local') ||
    h === '0.0.0.0' ||
    h === '::1' ||
    h === 'metadata.google.internal'
  ) {
    return true
  }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) {
    const p = h.split('.').map(Number)
    if (p[0] === 10 || p[0] === 127 || p[0] === 0) return true
    if (p[0] === 169 && p[1] === 254) return true
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true
    if (p[0] === 192 && p[1] === 168) return true
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true
  }
  if (h.startsWith('fe80:') || h.startsWith('fc') || h.startsWith('fd')) return true
  return false
}

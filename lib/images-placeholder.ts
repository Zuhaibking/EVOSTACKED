import { createHash } from 'node:crypto'
import { deflateSync } from 'node:zlib'
import { imageSlug, type ImageAspect } from './images-shared'

/** Soft neutral palettes: [light, mid, accent]. */
const PALETTES = [
  ['#f4efe8', '#ddd2c3', '#b5a085'], // sand
  ['#eef2f5', '#d2dbe5', '#93a6bc'], // mist
  ['#eef2eb', '#d0dbc9', '#98ad8d'], // sage
  ['#f3edf0', '#ddcfd7', '#ad97a8'], // mauve
  ['#f0eeeb', '#d9d4cc', '#a2998b'], // stone
  ['#ebf1f2', '#cddbde', '#87a3aa'], // sea
  ['#f5efe9', '#e3cfc2', '#bf9a84'], // clay
] as const

const DIMENSIONS: Record<ImageAspect, [number, number]> = {
  landscape: [1536, 1024],
  portrait: [1024, 1536],
  square: [1024, 1024],
}

/** Raster placeholders stay tiny; the browser scales the soft gradient up smoothly. */
const PNG_DIMENSIONS: Record<ImageAspect, [number, number]> = {
  landscape: [240, 160],
  portrait: [160, 240],
  square: [192, 192],
}

export type PlaceholderExt = 'svg' | 'png'

/**
 * `<slug>-<aspect>-<seed10>.svg|png`: the name alone regenerates identical bytes.
 * PNG is used where a suffix may be appended at runtime ('evo-image://' + slug):
 * Next 14's next/image only serves SVG as-is when the src ends in .svg.
 */
export const PLACEHOLDER_FILE_RE = /-(landscape|portrait|square)-([0-9a-f]{10})\.(svg|png)$/

export function placeholderFileName(query: string, aspect: ImageAspect, ext: PlaceholderExt = 'svg'): string {
  const seed = createHash('sha256').update(`${aspect}\n${query.toLowerCase()}`).digest('hex').slice(0, 10)
  return `${imageSlug(query, 40)}-${aspect}-${seed}.${ext}`
}

/** Parses a placeholder file name back into its generator inputs. */
export function parsePlaceholderFile(file: string): { seed: string; aspect: ImageAspect; ext: PlaceholderExt } | null {
  const m = PLACEHOLDER_FILE_RE.exec(file)
  return m ? { aspect: m[1] as ImageAspect, seed: m[2], ext: m[3] as PlaceholderExt } : null
}

/** Bytes and mime type for a placeholder file name (or a raw seed). */
export function placeholderBytes(file: string): { bytes: Uint8Array; mime: string } {
  const parsed = parsePlaceholderFile(file)
  const seed = parsed?.seed || file
  const aspect = parsed?.aspect || 'landscape'
  return parsed?.ext === 'png'
    ? { bytes: placeholderPng(seed, aspect), mime: 'image/png' }
    : { bytes: new TextEncoder().encode(placeholderSvg(seed, aspect)), mime: 'image/svg+xml' }
}

type Shape = {
  w: number
  h: number
  light: string
  mid: string
  accent: string
  angle: number
  c1: { x: number; y: number; r: number }
  c2: { x: number; y: number; r: number }
  ring: { x: number; y: number; r: number }
  glow: { x: number; y: number }
  n: (i: number) => number
}

function shape(seed: string, [w, h]: [number, number]): Shape {
  const hex = createHash('sha256').update(seed).digest()
  const n = (i: number) => hex[i % hex.length] / 255
  const [light, mid, accent] = PALETTES[hex[0] % PALETTES.length]
  const m = Math.min(w, h)
  const r = (v: number) => Math.round(v)
  return {
    w, h, light, mid, accent, n,
    angle: r(n(1) * 360),
    c1: { x: r(w * (0.62 + n(3) * 0.3)), y: r(h * (0.08 + n(4) * 0.3)), r: r(m * (0.42 + n(5) * 0.18)) },
    c2: { x: r(w * (0.05 + n(6) * 0.3)), y: r(h * (0.62 + n(7) * 0.3)), r: r(m * (0.3 + n(8) * 0.16)) },
    ring: { x: r(w * (0.3 + n(9) * 0.4)), y: r(h * (0.3 + n(10) * 0.4)), r: r(m * (0.22 + n(11) * 0.14)) },
    glow: { x: 0.2 + n(12) * 0.3, y: 0.15 + n(13) * 0.25 },
  }
}

/** A quiet gradient with soft geometry and a fine dot texture. No text, no logos. */
export function placeholderSvg(seed: string, aspect: ImageAspect): string {
  const s = shape(seed, DIMENSIONS[aspect] || DIMENSIONS.landscape)
  const { w, h, light, mid, accent, c1, c2, ring, n } = s
  const dot = Math.round(22 + n(2) * 14)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid slice">
<defs>
<linearGradient id="g" x1="0" y1="0" x2="1" y2="1" gradientTransform="rotate(${s.angle} .5 .5)"><stop offset="0" stop-color="${light}"/><stop offset="1" stop-color="${mid}"/></linearGradient>
<radialGradient id="l" cx="${s.glow.x.toFixed(2)}" cy="${s.glow.y.toFixed(2)}" r="0.8"><stop offset="0" stop-color="#fff" stop-opacity=".6"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
<pattern id="d" width="${dot}" height="${dot}" patternUnits="userSpaceOnUse" patternTransform="rotate(${Math.round(n(14) * 45)})"><circle cx="2" cy="2" r="1.4" fill="${accent}" fill-opacity=".18"/></pattern>
</defs>
<rect width="${w}" height="${h}" fill="url(#g)"/>
<circle cx="${c1.x}" cy="${c1.y}" r="${c1.r}" fill="${accent}" fill-opacity=".14"/>
<circle cx="${c2.x}" cy="${c2.y}" r="${c2.r}" fill="${light}" fill-opacity=".55"/>
<circle cx="${ring.x}" cy="${ring.y}" r="${ring.r}" fill="none" stroke="${accent}" stroke-opacity=".22" stroke-width="2"/>
<circle cx="${ring.x}" cy="${ring.y}" r="${Math.round(ring.r * 0.62)}" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="1.5"/>
<rect width="${w}" height="${h}" fill="url(#d)"/>
<rect width="${w}" height="${h}" fill="url(#l)"/>
</svg>
`
}

/**
 * The same composition as a small RGB PNG (gradient, soft discs, highlight;
 * the hairline ring and dot texture are omitted because they would alias).
 */
export function placeholderPng(seed: string, aspect: ImageAspect): Uint8Array {
  const s = shape(seed, PNG_DIMENSIONS[aspect] || PNG_DIMENSIONS.landscape)
  const { w, h } = s
  const light = rgb(s.light)
  const mid = rgb(s.mid)
  const accent = rgb(s.accent)
  // SVG rotates the (0,0)→(1,1) gradient about the centre; project onto that axis.
  const theta = (s.angle * Math.PI) / 180
  const dx = Math.cos(theta) - Math.sin(theta)
  const dy = Math.sin(theta) + Math.cos(theta)
  const norm = dx * dx + dy * dy
  const glowR = 0.8 * Math.hypot(w, h) / Math.SQRT2
  const rows = new Uint8Array(h * (1 + w * 3))
  const px = [0, 0, 0]
  for (let y = 0; y < h; y++) {
    const row = y * (1 + w * 3)
    for (let x = 0; x < w; x++) {
      const u = (x + 0.5) / w - 0.5
      const v = (y + 0.5) / h - 0.5
      const t = Math.min(1, Math.max(0, (u * dx + v * dy) / norm + 0.5))
      for (let c = 0; c < 3; c++) px[c] = light[c] + (mid[c] - light[c]) * t
      blend(px, accent, 0.14 * disc(x, y, s.c1))
      blend(px, light, 0.55 * disc(x, y, s.c2))
      const g = Math.hypot(x - s.glow.x * w, y - s.glow.y * h) / glowR
      blend(px, [255, 255, 255], 0.6 * Math.max(0, 1 - g))
      for (let c = 0; c < 3; c++) rows[row + 1 + x * 3 + c] = Math.round(px[c])
    }
  }
  // Filter 2 ("Up") per row: smooth gradients become runs of tiny deltas that deflate well.
  const filtered = new Uint8Array(rows.length)
  const stride = 1 + w * 3
  for (let y = 0; y < h; y++) {
    filtered[y * stride] = 2
    for (let i = 1; i < stride; i++) {
      const above = y ? rows[(y - 1) * stride + i] : 0
      filtered[y * stride + i] = (rows[y * stride + i] - above) & 0xff
    }
  }
  const header = new Uint8Array(13)
  const view = new DataView(header.buffer)
  view.setUint32(0, w)
  view.setUint32(4, h)
  header.set([8, 2, 0, 0, 0], 8) // 8-bit RGB, deflate, adaptive filtering, no interlace
  return concat([
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', new Uint8Array(deflateSync(filtered, { level: 9 }))),
    pngChunk('IEND', new Uint8Array()),
  ])
}

function rgb(hex: string): [number, number, number] {
  const v = parseInt(hex.slice(1), 16)
  return [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff]
}

function blend(px: number[], color: readonly number[], alpha: number) {
  if (alpha <= 0) return
  for (let c = 0; c < 3; c++) px[c] += (color[c] - px[c]) * alpha
}

/** Coverage of an anti-aliased disc at a pixel centre. */
function disc(x: number, y: number, c: { x: number; y: number; r: number }): number {
  const d = Math.hypot(x + 0.5 - c.x, y + 0.5 - c.y) - c.r
  return Math.min(1, Math.max(0, 0.5 - d))
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.length)
  out.set(new TextEncoder().encode(type), 4)
  out.set(data, 8)
  let crc = 0xffffffff
  for (const byte of out.subarray(4, 8 + data.length)) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  view.setUint32(8 + data.length, (crc ^ 0xffffffff) >>> 0)
  return out
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0))
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

'use client'

import { cn } from '@/lib/utils'
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'

/* ───────────────────────── Palette ─────────────────────────
 * Categorical slots validated with the dataviz six-checks validator
 * (dark: all PASS on #1c1a17 · light: PASS, contrast WARN → every breakdown ships a
 * labelled legend with values). Slot 1 is the EvoStack brand indigo. Scoped to `.cc-root`
 * so the dashboard is theme-aware without touching global tokens.
 */
export const CHART_PALETTE_CSS = `
.cc-root{--cc-1:#3442d8;--cc-2:#eb6834;--cc-3:#1baf7a;--cc-4:#eda100;--cc-5:#e87ba4;--cc-6:#008300;--cc-other:#a8a29a;--cc-surface:hsl(var(--card))}
.dark .cc-root{--cc-1:#6b74ee;--cc-2:#d95926;--cc-3:#199e70;--cc-4:#c98500;--cc-5:#d55181;--cc-6:#0ca30c;--cc-other:#57534e}
@keyframes cc-draw{from{stroke-dashoffset:var(--cc-len,2000)}to{stroke-dashoffset:0}}
@keyframes cc-fade{from{opacity:0}to{opacity:1}}
@keyframes cc-pulse{0%{transform:scale(1);opacity:.55}100%{transform:scale(2.6);opacity:0}}
@keyframes cc-toast-in{from{opacity:0;transform:translate3d(24px,8px,0) scale(.98)}to{opacity:1;transform:none}}
@keyframes cc-row-in{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}
@keyframes cc-flash{0%{background:hsl(var(--brand-accent)/.22)}100%{background:transparent}}
@keyframes cc-shimmer{0%{background-position:-200% 0}100%{background-position:200% 0}}
.cc-live-ring{animation:cc-pulse 1.8s cubic-bezier(.2,.8,.2,1) infinite;transform-origin:center}
.cc-toast-in{animation:cc-toast-in .42s cubic-bezier(.2,.9,.25,1) both}
.cc-row-in{animation:cc-row-in .4s cubic-bezier(.2,.8,.2,1) both}
.cc-flash{animation:cc-flash 2.4s ease-out both}
.cc-fade{animation:cc-fade .5s ease-out both}
.cc-scroll{scrollbar-width:thin;scrollbar-color:hsl(var(--foreground)/.14) transparent}
.cc-scroll::-webkit-scrollbar{width:6px;height:6px}
.cc-scroll::-webkit-scrollbar-thumb{background:hsl(var(--foreground)/.14);border-radius:8px}
`

export function ChartPalette() {
  return <style dangerouslySetInnerHTML={{ __html: CHART_PALETTE_CSS }} />
}

export const seriesColor = (i: number) => (i >= 0 && i < 6 ? `var(--cc-${i + 1})` : 'var(--cc-other)')

/* ───────────────────────── Formatting ───────────────────────── */
export type ValueFormat = 'number' | 'money' | 'percent'

let CURRENCY = 'USD'
export function setPlatformCurrency(code: string | null | undefined) {
  const c = String(code ?? '').trim().toUpperCase()
  if (/^[A-Z]{3}$/.test(c)) CURRENCY = c
}

export function formatValue(value: number, format: ValueFormat = 'number', opts: { compact?: boolean } = {}) {
  const v = Number.isFinite(value) ? value : 0
  try {
    if (format === 'money') {
      const big = Math.abs(v) >= 10_000
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: CURRENCY,
        notation: opts.compact && big ? 'compact' : 'standard',
        maximumFractionDigits: opts.compact ? (big ? 1 : 0) : Math.abs(v) >= 1000 ? 0 : 2,
        minimumFractionDigits: opts.compact || Math.abs(v) >= 1000 ? 0 : 2,
      }).format(v)
    }
    if (format === 'percent') {
      // Server convention (lib/platform/metrics.ts): percent metrics are already 0–100.
      return `${v.toFixed(Math.abs(v) >= 10 || Number.isInteger(v) ? 0 : 1)}%`
    }
    return new Intl.NumberFormat('en-US', {
      notation: opts.compact && Math.abs(v) >= 10_000 ? 'compact' : 'standard',
      maximumFractionDigits: Math.abs(v) >= 100 ? 0 : 1,
    }).format(v)
  } catch {
    return String(Math.round(v * 100) / 100)
  }
}

export function formatAxisDate(x: string, style: 'short' | 'long' = 'short') {
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(x) ? `${x}T00:00:00` : x
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return x
  return d.toLocaleDateString('en-US', style === 'short' ? { month: 'short', day: 'numeric' } : { weekday: 'short', month: 'short', day: 'numeric' })
}

/* ───────────────────────── Geometry helpers ───────────────────────── */
type Pt = [number, number]

/** Monotone cubic (Fritsch–Carlson): smooth, never overshoots the data. */
function monotonePath(pts: Pt[]) {
  const n = pts.length
  if (!n) return ''
  if (n === 1) return `M${pts[0][0]},${pts[0][1]}`
  if (n === 2) return `M${pts[0][0]},${pts[0][1]}L${pts[1][0]},${pts[1][1]}`
  const dx: number[] = [], m: number[] = []
  for (let i = 0; i < n - 1; i++) {
    dx[i] = pts[i + 1][0] - pts[i][0]
    m[i] = dx[i] ? (pts[i + 1][1] - pts[i][1]) / dx[i] : 0
  }
  const t: number[] = new Array(n)
  t[0] = m[0]
  t[n - 1] = m[n - 2]
  for (let i = 1; i < n - 1; i++) {
    t[i] = m[i - 1] * m[i] <= 0 ? 0 : (3 * (dx[i - 1] + dx[i])) / ((2 * dx[i] + dx[i - 1]) / m[i - 1] + (dx[i] + 2 * dx[i - 1]) / m[i])
  }
  let d = `M${pts[0][0]},${pts[0][1]}`
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3
    d += `C${pts[i][0] + h},${pts[i][1] + h * t[i]} ${pts[i + 1][0] - h},${pts[i + 1][1] - h * t[i + 1]} ${pts[i + 1][0]},${pts[i + 1][1]}`
  }
  return d
}

function niceTicks(max: number, count = 4) {
  if (!(max > 0)) return [0, 1]
  const raw = max / count
  const exp = Math.pow(10, Math.floor(Math.log10(raw)))
  const f = raw / exp
  const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * exp
  const top = Math.max(step, Math.ceil(max / step) * step)
  const ticks: number[] = []
  for (let v = 0; v <= top + step / 2; v += step) ticks.push(Math.round(v * 1e6) / 1e6)
  return ticks
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    setWidth(el.clientWidth)
    const ro = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, width] as const
}

/* ───────────────────────── Time series: area (dense) or columns (sparse) ───────────────────────── */
export type SeriesPoint = { x: string; y: number }

/** Daily buckets with many empty days read as zig-zags when smoothed — draw columns instead. */
export function isSparse(values: number[]) {
  if (values.length < 3) return true
  const zeros = values.filter((v) => !(v > 0)).length
  return zeros / values.length >= 0.3
}

/** Column with a 4px rounded data-end, square at the baseline. */
function columnPath(x: number, w: number, yTop: number, yBase: number, r = 4) {
  const h = yBase - yTop
  if (h <= 0.5) return ''
  const rr = Math.min(r, w / 2, h)
  return `M${x},${yBase}V${yTop + rr}Q${x},${yTop} ${x + rr},${yTop}H${x + w - rr}Q${x + w},${yTop} ${x + w},${yTop + rr}V${yBase}Z`
}

export function AreaChart({
  points,
  format = 'number',
  height = 220,
  colorIndex = 0,
  label,
  variant = 'auto',
  className,
}: {
  points: SeriesPoint[]
  format?: ValueFormat
  height?: number
  colorIndex?: number
  label?: string
  variant?: 'auto' | 'area' | 'columns'
  className?: string
}) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const gid = useId().replace(/:/g, '')
  const [hover, setHover] = useState<number | null>(null)
  const color = seriesColor(colorIndex)
  const n = points.length
  const columns = variant === 'columns' || (variant === 'auto' && isSparse(points.map((p) => p.y)))

  const M = { top: 12, right: 8, bottom: 26, left: 46 }
  const plotW = Math.max(0, width - M.left - M.right)
  const plotH = Math.max(0, height - M.top - M.bottom)
  const max = Math.max(0, ...points.map((p) => p.y))
  const ticks = niceTicks(max)
  const top = ticks[ticks.length - 1] || 1
  const empty = n === 0 || max === 0
  const slot = n ? plotW / n : plotW
  const barW = Math.min(24, Math.max(3, slot * 0.58))

  const xAt = (i: number) => (columns ? M.left + slot * (i + 0.5) : M.left + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW))
  const yAt = (v: number) => M.top + plotH - (Math.max(0, v) / top) * plotH
  const coords: Pt[] = points.map((p, i) => [xAt(i), yAt(p.y)])
  const line = columns ? '' : monotonePath(coords)
  const area = !columns && coords.length > 1 ? `${line}L${coords[coords.length - 1][0]},${M.top + plotH}L${coords[0][0]},${M.top + plotH}Z` : ''

  const labelIdx = useMemo(() => {
    const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(plotW / 84))))
    const out: number[] = []
    for (let i = 0; i < n; i += every) out.push(i)
    if (n > 1 && out[out.length - 1] !== n - 1) {
      if (n - 1 - out[out.length - 1] >= every * 0.6) out.push(n - 1)
      else out[out.length - 1] = n - 1
    }
    return out
  }, [n, plotW])

  const onMove = (clientX: number, rect: DOMRect) => {
    if (!n) return
    const x = clientX - rect.left - M.left
    const i = columns ? Math.floor(x / Math.max(1, slot)) : n <= 1 ? 0 : Math.round((x / Math.max(1, plotW)) * (n - 1))
    setHover(Math.min(n - 1, Math.max(0, i)))
  }
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!n) return
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault()
      setHover((h) => {
        const cur = h ?? (e.key === 'ArrowRight' ? -1 : n)
        return Math.min(n - 1, Math.max(0, cur + (e.key === 'ArrowRight' ? 1 : -1)))
      })
    }
    if (e.key === 'Escape') setHover(null)
  }

  const hp = hover != null ? coords[hover] : null
  const total = points.reduce((s, p) => s + p.y, 0)
  const textAnchor = (i: number) => (columns || n <= 1 ? 'middle' : i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle')

  return (
    <div
      ref={ref}
      className={cn('relative w-full select-none rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring', className)}
      style={{ height }}
      tabIndex={n ? 0 : -1}
      role="img"
      aria-label={`${label ?? 'Series'}: ${n} days, total ${formatValue(total, format)}. Use arrow keys to inspect.`}
      onKeyDown={onKey}
      onBlur={() => setHover(null)}
    >
      {width > 0 && (
        <svg width={width} height={height} className="block overflow-visible">
          <defs>
            <linearGradient id={`g${gid}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.24} />
              <stop offset="70%" stopColor={color} stopOpacity={0.05} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          {ticks.map((t) => {
            const y = yAt(t)
            return (
              <g key={t}>
                <line x1={M.left} x2={M.left + plotW} y1={y} y2={y} stroke="hsl(var(--border))" strokeWidth={1} opacity={t === 0 ? 1 : 0.55} />
                <text x={M.left - 8} y={y} dy="0.32em" textAnchor="end" className="fill-muted-foreground font-mono text-[10px] tabular">
                  {formatValue(t, format, { compact: true })}
                </text>
              </g>
            )
          })}
          {labelIdx.map((i) => (
            <text key={`${points[i].x}-${i}`} x={xAt(i)} y={height - 6} textAnchor={textAnchor(i)} className="fill-muted-foreground font-mono text-[10px]">
              {formatAxisDate(points[i].x)}
            </text>
          ))}
          {!empty && columns && (
            <g>
              {hover != null && <rect x={xAt(hover) - slot / 2 + 1} y={M.top} width={Math.max(0, slot - 2)} height={plotH} rx={4} fill="hsl(var(--foreground))" opacity={0.04} />}
              {points.map((p, i) => (
                <path
                  key={`${p.x}-${i}`}
                  d={columnPath(xAt(i) - barW / 2, barW, yAt(p.y), M.top + plotH)}
                  fill={color}
                  opacity={hover == null || hover === i ? 1 : 0.45}
                  className="cc-fade transition-opacity duration-150"
                  style={{ animationDelay: `${i * 18}ms` }}
                />
              ))}
            </g>
          )}
          {!empty && !columns && (
            <>
              <path d={area} fill={`url(#g${gid})`} className="cc-fade" />
              <path
                d={line}
                fill="none"
                stroke={color}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
                style={{ strokeDasharray: 4000, ['--cc-len' as string]: 4000, animation: 'cc-draw 1.1s cubic-bezier(.2,.8,.2,1) both' }}
              />
              {hp == null && coords.length > 0 && (
                <circle cx={coords[coords.length - 1][0]} cy={coords[coords.length - 1][1]} r={4} fill={color} stroke="var(--cc-surface)" strokeWidth={2} />
              )}
            </>
          )}
          {hp && !columns && (
            <g pointerEvents="none">
              <line x1={hp[0]} x2={hp[0]} y1={M.top} y2={M.top + plotH} stroke="hsl(var(--foreground))" strokeOpacity={0.22} strokeWidth={1} />
              <circle cx={hp[0]} cy={hp[1]} r={4.5} fill={color} stroke="var(--cc-surface)" strokeWidth={2} />
            </g>
          )}
          <rect
            x={M.left}
            y={M.top}
            width={plotW}
            height={plotH}
            fill="transparent"
            onPointerMove={(e) => onMove(e.clientX, (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect())}
            onPointerLeave={() => setHover(null)}
          />
        </svg>
      )}
      {empty && width > 0 && (
        <div className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-xs text-muted-foreground">
          No data yet — new records will chart here automatically
        </div>
      )}
      {hp && hover != null && points[hover] && (
        <div
          className="pointer-events-none absolute z-10 min-w-[120px] rounded-md border border-border bg-popover/95 px-2.5 py-1.5 text-xs shadow-xl shadow-black/20 backdrop-blur"
          style={{ left: Math.min(Math.max(hp[0], 70), width - 70), top: Math.max(0, Math.min(hp[1], M.top + plotH - 10) - 62), transform: 'translateX(-50%)' }}
        >
          <div className="text-[11px] text-muted-foreground">{formatAxisDate(points[hover].x, 'long')}</div>
          <div className="mt-0.5 flex items-center gap-1.5 font-medium text-foreground">
            <span className="h-2 w-2 rounded-full" style={{ background: color }} />
            <span className="tabular">{formatValue(points[hover].y, format)}</span>
            {label && <span className="truncate font-normal text-muted-foreground">{label}</span>}
          </div>
        </div>
      )}
    </div>
  )
}

/* ───────────────────────── Sparkline (line when dense, micro-columns when sparse) ───────────────────────── */
export function Sparkline({ points, colorIndex = 0, height = 36, className }: { points: number[]; colorIndex?: number; height?: number; className?: string }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const gid = useId().replace(/:/g, '')
  const color = seriesColor(colorIndex)
  const max = Math.max(1e-9, ...points)
  const n = points.length
  const sparse = isSparse(points)
  const pad = 3
  let body: React.ReactNode = null
  if (width > 0 && n > 1 && sparse) {
    const slot = width / n
    const bw = Math.max(2, Math.min(8, slot * 0.6))
    body = points.map((v, i) => {
      const h = Math.max(v > 0 ? 2 : 0, (Math.max(0, v) / max) * (height - 2))
      return (
        <path
          key={i}
          d={columnPath(slot * (i + 0.5) - bw / 2, bw, height - h, height, 1.5) || `M${slot * (i + 0.5) - bw / 2},${height - 1}h${bw}v1h${-bw}Z`}
          fill={color}
          opacity={v > 0 ? (i === n - 1 ? 1 : 0.75) : 0.18}
        />
      )
    })
  } else if (width > 0 && n > 1) {
    const coords: Pt[] = points.map((v, i) => [pad + (i / (n - 1)) * (width - pad * 2), pad + (height - pad * 2) - (Math.max(0, v) / max) * (height - pad * 2)])
    const line = monotonePath(coords)
    const area = `${line}L${coords[n - 1][0]},${height}L${coords[0][0]},${height}Z`
    body = (
      <>
        <defs>
          <linearGradient id={`s${gid}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.22} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#s${gid})`} />
        <path d={line} fill="none" stroke={color} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" />
        <circle cx={coords[n - 1][0]} cy={coords[n - 1][1]} r={3} fill={color} stroke="var(--cc-surface)" strokeWidth={2} />
      </>
    )
  }
  return (
    <div ref={ref} className={cn('w-full', className)} style={{ height }} aria-hidden>
      {body && (
        <svg width={width} height={height} className="block overflow-visible">
          {body}
        </svg>
      )}
    </div>
  )
}

/* ───────────────────────── Breakdown: fold + donut + ranked bars ───────────────────────── */
export type Slice = { label: string; value: number; color: string; share: number }

export function foldBreakdown(points: SeriesPoint[], maxSlots = 6): Slice[] {
  const clean = points.filter((p) => Number.isFinite(p.y) && p.y > 0)
  // Colour follows the entity (stable order from the server), not its rank.
  const ranked = [...clean].sort((a, b) => b.y - a.y)
  const keep = new Set(ranked.slice(0, ranked.length > maxSlots ? maxSlots - 1 : maxSlots).map((p) => p.x))
  const total = clean.reduce((s, p) => s + p.y, 0) || 1
  const slices: Slice[] = []
  let other = 0
  let slot = 0
  for (const p of clean) {
    if (keep.has(p.x)) slices.push({ label: p.x || '—', value: p.y, color: seriesColor(slot++), share: p.y / total })
    else other += p.y
  }
  if (other > 0) slices.push({ label: 'Other', value: other, color: 'var(--cc-other)', share: other / total })
  return slices
}

export function DonutChart({
  points,
  format = 'number',
  size = 168,
  centerLabel = 'Total',
  className,
}: {
  points: SeriesPoint[]
  format?: ValueFormat
  size?: number
  centerLabel?: string
  className?: string
}) {
  const slices = useMemo(() => foldBreakdown(points), [points])
  const [active, setActive] = useState<number | null>(null)
  const total = slices.reduce((s, x) => s + x.value, 0)
  const stroke = 18
  const r = (size - stroke) / 2
  const C = 2 * Math.PI * r
  const gap = slices.length > 1 ? 2.5 : 0 // 2px surface gap between segments
  let offset = 0
  const cur = active != null ? slices[active] : null

  return (
    <div className={cn('flex flex-col items-center gap-4 sm:flex-row sm:items-center', className)}>
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" role="img" aria-label={slices.map((s) => `${s.label} ${formatValue(s.value, format)}`).join(', ') || 'No data'}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="hsl(var(--muted))" strokeWidth={stroke} />
          {slices.map((s, i) => {
            const len = Math.max(0, s.share * C - gap)
            const el = (
              <circle
                key={s.label}
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={s.color}
                strokeWidth={active === i ? stroke + 4 : stroke}
                strokeDasharray={`${len} ${C - len}`}
                strokeDashoffset={-offset}
                className="cursor-pointer transition-[stroke-width,opacity] duration-200"
                opacity={active == null || active === i ? 1 : 0.35}
                onPointerEnter={() => setActive(i)}
                onPointerLeave={() => setActive(null)}
              />
            )
            offset += s.share * C
            return el
          })}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <div className="max-w-[70%] truncate text-[11px] text-muted-foreground">{cur ? cur.label : centerLabel}</div>
          <div className="text-xl font-semibold tracking-tight text-foreground">{formatValue(cur ? cur.value : total, format, { compact: true })}</div>
          {cur && <div className="font-mono text-[10px] text-muted-foreground tabular">{(cur.share * 100).toFixed(1)}%</div>}
        </div>
      </div>
      <ul className="w-full min-w-0 flex-1 space-y-1">
        {slices.length === 0 && <li className="text-xs text-muted-foreground">No data yet</li>}
        {slices.map((s, i) => (
          <li
            key={s.label}
            onPointerEnter={() => setActive(i)}
            onPointerLeave={() => setActive(null)}
            className={cn('flex items-center gap-2 rounded-md px-2 py-1 text-xs transition-colors', active === i && 'bg-muted/60')}
          >
            <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: s.color }} />
            <span className="min-w-0 flex-1 truncate capitalize text-foreground/90">{s.label.replace(/_/g, ' ')}</span>
            <span className="shrink-0 text-right font-medium tabular text-foreground">{formatValue(s.value, format, { compact: true })}</span>
            <span className="w-8 shrink-0 text-right font-mono text-[10px] text-muted-foreground tabular">{(s.share * 100).toFixed(0)}%</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function BarList({ points, format = 'number', className }: { points: SeriesPoint[]; format?: ValueFormat; className?: string }) {
  const slices = useMemo(() => foldBreakdown(points, 8), [points])
  const max = Math.max(1e-9, ...slices.map((s) => s.value))
  if (!slices.length) return <div className={cn('py-6 text-center text-xs text-muted-foreground', className)}>No data yet</div>
  return (
    <ul className={cn('space-y-2.5', className)}>
      {[...slices].sort((a, b) => b.value - a.value).map((s) => (
        <li key={s.label} className="group" title={`${s.label}: ${formatValue(s.value, format)} (${(s.share * 100).toFixed(1)}%)`}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-xs">
            <span className="flex min-w-0 items-center gap-2">
              <span className="h-2 w-2 shrink-0 rounded-[3px]" style={{ background: s.color }} />
              <span className="truncate capitalize text-foreground/90">{s.label.replace(/_/g, ' ')}</span>
            </span>
            <span className="shrink-0 font-medium tabular text-foreground">
              {formatValue(s.value, format, { compact: true })}
              <span className="ml-1.5 font-mono text-[10px] font-normal text-muted-foreground">{(s.share * 100).toFixed(0)}%</span>
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-r-[4px] bg-muted/70">
            <div
              className="h-full rounded-r-[4px] transition-[width] duration-700 ease-out group-hover:brightness-110"
              style={{ width: `${Math.max(2, (s.value / max) * 100)}%`, background: s.color }}
            />
          </div>
        </li>
      ))}
    </ul>
  )
}

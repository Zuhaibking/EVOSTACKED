'use client'

import { ActivityList } from './activity-feed'
import { AreaChart, DonutChart, Sparkline, formatValue, type ValueFormat } from './charts'
import { PlatformIcon } from './platform-icon'
import { Skeleton } from '@/components/ui/skeleton'
import type { Blueprint, ChartSeries, Collection, MetricValue, MetricsResponse, PlatformEvent } from '@/lib/platform/types'
import { cn } from '@/lib/utils'
import { ArrowDownRight, ArrowRight, ArrowUpRight, Globe, Loader2, Minus, Plus, Sparkles } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

/* ───────────────────────── metrics fetching (shared with analytics) ───────────────────────── */
export function useMetrics(projectId: string, refreshKey: number) {
  const [data, setData] = useState<MetricsResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    const t = setTimeout(
      async () => {
        try {
          const res = await fetch(`/api/p/${encodeURIComponent(projectId)}/metrics`, { cache: 'no-store' })
          if (!res.ok) throw new Error(`Metrics unavailable (${res.status})`)
          const body = (await res.json()) as MetricsResponse
          if (alive) {
            setData({ metrics: Array.isArray(body.metrics) ? body.metrics : [], charts: Array.isArray(body.charts) ? body.charts : [] })
            setError(null)
          }
        } catch (e) {
          if (alive) setError(e instanceof Error ? e.message : 'Metrics unavailable')
        }
      },
      refreshKey === 0 ? 0 : 450, // debounce bursts of realtime events
    )
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [projectId, refreshKey])
  return { data, error, loading: !data && !error }
}

/** What a KPI tile can honestly show besides its value. */
export type KpiContext =
  | { kind: 'trend'; spark: number[]; delta: number | null; isNew: boolean; window: number }
  | { kind: 'share'; part: number; whole: number; label: string }
  | { kind: 'caption'; text: string }
  | null

const sumOf = (ys: number[]) => ys.reduce((a, b) => a + b, 0)

/**
 * Pair a KPI with data that really explains it — never borrow an unrelated series:
 * count → same-collection count series · sum → same-field sum series · avg → sum ÷ count per day ·
 * filtered count → share of the collection (meter).
 */
export function kpiContext(metric: MetricValue, blueprint: Blueprint, charts: ChartSeries[], counts: Record<string, number>): KpiContext {
  const bm = blueprint.metrics.find((m) => m.key === metric.key)
  if (!bm) return null
  const col = blueprint.collections.find((c) => c.key === bm.collection)
  if (bm.filter) {
    const whole = counts[bm.collection] ?? 0
    if (metric.format === 'percent') return { kind: 'share', part: metric.value, whole: 100, label: `of ${col?.label.toLowerCase() ?? 'records'}` }
    if (bm.op === 'count' && whole > 0) return { kind: 'share', part: metric.value, whole, label: col?.label.toLowerCase() ?? 'records' }
    const f = col?.fields.find((x) => x.key === bm.filter!.field)
    return { kind: 'caption', text: `${f?.label ?? bm.filter.field.replace(/_/g, ' ')} · ${bm.filter.equals.replace(/_/g, ' ')}` }
  }
  const series = (op: 'count' | 'sum', field: string | null) => {
    const def = blueprint.charts.find((c) => c.kind === 'timeseries' && c.collection === bm.collection && c.op === op && (op === 'count' || c.field === field))
    const s = def ? charts.find((x) => x.key === def.key) : undefined
    return s && s.points.length >= 4 ? s.points.map((p) => p.y) : null
  }
  let ys: number[] | null = null
  let window = 7
  let cur = 0
  let prev = 0
  if (bm.op === 'avg') {
    const sums = series('sum', bm.field)
    const cnts = series('count', null)
    if (!sums || !cnts || sums.length !== cnts.length) return null
    window = sums.length >= 14 ? 7 : Math.floor(sums.length / 2)
    ys = sums.map((s, i) => (cnts[i] ? s / cnts[i] : 0))
    const avg = (a: number[], b: number[]) => (sumOf(b) ? sumOf(a) / sumOf(b) : 0)
    cur = avg(sums.slice(-window), cnts.slice(-window))
    prev = avg(sums.slice(-window * 2, -window), cnts.slice(-window * 2, -window))
  } else {
    ys = series(bm.op === 'sum' ? 'sum' : 'count', bm.field)
    if (!ys) return null
    window = ys.length >= 14 ? 7 : Math.floor(ys.length / 2)
    cur = sumOf(ys.slice(-window))
    prev = sumOf(ys.slice(-window * 2, -window))
  }
  return { kind: 'trend', spark: ys.slice(-14), delta: prev > 0 ? (cur - prev) / prev : cur > 0 ? null : 0, isNew: prev === 0 && cur > 0, window }
}

/* ───────────────────────── KPI card ───────────────────────── */
export function KpiCard({ metric, context, index = 0 }: { metric: MetricValue; context: KpiContext; index?: number }) {
  const d = context?.kind === 'trend' ? context.delta : null
  const up = typeof d === 'number' && d > 0.0005
  const down = typeof d === 'number' && d < -0.0005
  return (
    <div
      className="group relative overflow-hidden rounded-xl border border-border bg-card p-4 transition-colors hover:border-foreground/15"
      style={{ animationDelay: `${index * 60}ms` }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[13px] text-muted-foreground">{metric.label}</span>
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border bg-background/60 text-muted-foreground transition-colors group-hover:text-foreground">
          <PlatformIcon name={metric.icon} hint={metric.key} className="h-3.5 w-3.5" />
        </span>
      </div>
      <div className="mt-2 text-[26px] font-semibold leading-none tracking-tight text-foreground">
        {formatValue(metric.value, metric.format as ValueFormat)}
      </div>
      <div className="mt-3 flex min-h-[28px] items-end justify-between gap-3">
        {context?.kind === 'trend' ? (
          <>
            <span className="inline-flex items-center gap-1 pb-0.5 text-[11px]">
              <span
                className={cn(
                  'inline-flex items-center gap-0.5 rounded px-1 py-px font-medium tabular',
                  context.isNew || up ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : down ? 'bg-red-500/10 text-red-600 dark:text-red-400' : 'bg-muted text-muted-foreground',
                )}
              >
                {context.isNew || up ? <ArrowUpRight className="h-3 w-3" /> : down ? <ArrowDownRight className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
                {context.isNew ? 'New' : `${up ? '+' : ''}${((d ?? 0) * 100).toFixed(Math.abs(d ?? 0) >= 0.1 ? 0 : 1)}%`}
              </span>
              <span className="text-muted-foreground">vs prior {context.window}d</span>
            </span>
            <Sparkline points={context.spark} colorIndex={0} height={28} className="w-24 shrink-0" />
          </>
        ) : context?.kind === 'share' ? (
          <div className="w-full pb-0.5">
            <div className="mb-1.5 flex items-center justify-between text-[11px] text-muted-foreground">
              <span>
                {context.whole === 100 && metric.format === 'percent' ? 'Share' : `of ${context.whole.toLocaleString()} ${context.label}`}
              </span>
              <span className="font-mono tabular">{context.whole ? Math.round((context.part / context.whole) * 100) : 0}%</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-brand/15">
              <div className="h-full rounded-full bg-brand transition-[width] duration-700" style={{ width: `${Math.min(100, context.whole ? (context.part / context.whole) * 100 : 0)}%` }} />
            </div>
          </div>
        ) : (
          <span className="inline-flex items-center gap-1.5 pb-0.5 text-[11px] text-muted-foreground/80">
            {context?.kind === 'caption' && <span className="h-1.5 w-1.5 rounded-full bg-brand/70" aria-hidden />}
            {context?.kind === 'caption' ? context.text : 'All time'}
          </span>
        )}
      </div>
    </div>
  )
}

export function KpiSkeleton() {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <Skeleton className="h-3.5 w-24 bg-muted" />
        <Skeleton className="h-7 w-7 bg-muted" />
      </div>
      <Skeleton className="mt-3 h-7 w-28 bg-muted" />
      <Skeleton className="mt-4 h-4 w-full bg-muted/70" />
    </div>
  )
}

export function Panel({
  title,
  subtitle,
  action,
  className,
  children,
}: {
  title: string
  subtitle?: string
  action?: React.ReactNode
  className?: string
  children: React.ReactNode
}) {
  return (
    <section className={cn('flex min-w-0 flex-col rounded-xl border border-border bg-card', className)}>
      <header className="flex items-start justify-between gap-3 px-4 pb-2 pt-4">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-medium text-foreground">{title}</h3>
          {subtitle && <p className="mt-0.5 truncate text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        {action}
      </header>
      <div className="min-w-0 flex-1 px-4 pb-4">{children}</div>
    </section>
  )
}

/* ───────────────────────── sample submission (demo the live pipeline) ───────────────────────── */
const NAMES = ['Maya Chen', 'Leo Martins', 'Ava Patel', 'Noah Kim', 'Zoe Laurent', 'Omar Haddad', 'Iris Novak', 'Kai Tanaka']
export function sampleRecord(col: Collection): Record<string, unknown> {
  const name = NAMES[Math.floor(Math.random() * NAMES.length)]
  const day = (offset: number) => new Date(Date.now() + offset * 86_400_000)
  const out: Record<string, unknown> = {}
  const writable = col.fields.filter((f) => f.publicWritable)
  for (const f of writable.length ? writable : col.fields) {
    const k = f.key
    switch (f.type) {
      case 'text':
        out[k] = /^size$|_size$/.test(k) ? `US ${8 + Math.floor(Math.random() * 5)}` : /city/.test(k) ? 'Brooklyn' : /name|customer|guest|client|contact|full/.test(k) ? name : /title|subject/.test(k) ? `${col.singular} from website` : /company|org/.test(k) ? 'Northwind Studio' : `${name.split(' ')[0]}'s ${col.singular.toLowerCase()}`
        break
      case 'longtext':
        out[k] = /address/.test(k) ? '221 Kent Ave, Brooklyn, NY 11249' : /note|message|comment/.test(k) ? 'Submitted from the live website preview.' : ''
        break
      case 'email':
        out[k] = `${name.split(' ')[0].toLowerCase()}@example.com`
        break
      case 'phone':
        out[k] = '+1 415 555 0142'
        break
      case 'url':
        out[k] = 'https://example.com'
        break
      case 'number':
        out[k] = /guest|party|people|seat|qty|quantity/.test(k) ? 2 + Math.floor(Math.random() * 4) : 1 + Math.floor(Math.random() * 3)
        break
      case 'money':
        out[k] = Math.round((24 + Math.random() * 180) * 100) / 100
        break
      case 'boolean':
        out[k] = false
        break
      case 'date':
        out[k] = day(1 + Math.floor(Math.random() * 6)).toISOString().slice(0, 10)
        break
      case 'datetime': {
        const d = day(1 + Math.floor(Math.random() * 6))
        d.setHours(18 + Math.floor(Math.random() * 3), 0, 0, 0)
        out[k] = d.toISOString()
        break
      }
      case 'enum':
        if (f.options.length) out[k] = f.options[0]
        break
      case 'tags':
        out[k] = ['website']
        break
      default:
        break // relation / image: leave to server defaults
    }
  }
  return out
}

/* ───────────────────────── Overview ───────────────────────── */
export function Overview({
  projectId,
  blueprint,
  counts,
  events,
  freshIds,
  refreshKey,
  onOpenCollection,
  onOpenModule,
  onQuickCreate,
  notify,
}: {
  projectId: string
  blueprint: Blueprint
  counts: Record<string, number>
  events: PlatformEvent[]
  freshIds?: Set<number>
  refreshKey: number
  onOpenCollection: (collection: string) => void
  onOpenModule: (kind: 'activity' | 'analytics') => void
  onQuickCreate: (collection: string) => void
  notify: (t: { title: string; description?: string; tone?: 'success' | 'error' | 'info' }) => void
}) {
  const { data, error, loading } = useMetrics(projectId, refreshKey)
  const [simulating, setSimulating] = useState<string | null>(null)

  const timeseries = useMemo(() => {
    const ts = data?.charts.filter((c) => c.kind === 'timeseries') ?? []
    // Prefer a revenue-like (sum) series as the hero chart.
    const sumKeys = new Set(blueprint.charts.filter((c) => c.op === 'sum').map((c) => c.key))
    return [...ts].sort((a, b) => Number(sumKeys.has(b.key)) - Number(sumKeys.has(a.key)))[0]
  }, [data, blueprint.charts])
  const breakdown = data?.charts.find((c) => c.kind === 'breakdown')
  const heroDef = timeseries ? blueprint.charts.find((c) => c.key === timeseries.key) : undefined
  const heroFormat: ValueFormat =
    heroDef?.op === 'sum' && heroDef.field && blueprint.collections.find((c) => c.key === heroDef.collection)?.fields.find((f) => f.key === heroDef.field)?.type === 'money'
      ? 'money'
      : 'number'
  const heroTotal = timeseries?.points.reduce((s, p) => s + p.y, 0) ?? 0

  const publicCols = blueprint.collections.filter((c) => c.publicCreate)
  const quickCols = (publicCols.length ? publicCols : blueprint.collections).slice(0, 4)
  const metrics = (data?.metrics ?? []).slice(0, 4)

  const simulate = async (col: Collection) => {
    setSimulating(col.key)
    try {
      const data = sampleRecord(col)
      // Reference real related records (e.g. an order → an existing product) so workflows that
      // adjust stock or look up prices behave exactly as they would for a real website order.
      for (const f of col.fields.filter((x) => x.type === 'relation' && x.relation && (x.publicWritable || x.required))) {
        const target = blueprint.collections.find((c) => c.key === f.relation)
        if (!target) continue
        const r = await fetch(`/api/p/${encodeURIComponent(projectId)}/records/${encodeURIComponent(target.key)}?limit=25`, { cache: 'no-store' })
        const rows = r.ok ? (((await r.json()) as { rows?: Record<string, unknown>[] }).rows ?? []) : []
        const pick = rows[Math.floor(Math.random() * rows.length)]
        if (!pick) continue
        data[f.key] = pick.id
        const priceField = target.fields.find((x) => x.type === 'money' && /price|amount|rate|fee|cost/.test(x.key)) ?? target.fields.find((x) => x.type === 'money')
        const price = priceField ? Number(pick[priceField.key]) : NaN
        const qtyKey = col.fields.find((x) => x.type === 'number' && /qty|quantity/.test(x.key))?.key
        const qty = 1
        if (qtyKey) data[qtyKey] = qty
        const totalKey = col.fields.find((x) => x.type === 'money' && /total|amount|price|value/.test(x.key))?.key
        if (totalKey && Number.isFinite(price) && price > 0) data[totalKey] = Math.round(price * qty * 100) / 100
        const itemsKey = col.fields.find((x) => x.type === 'longtext' && /item|line|product/.test(x.key))?.key
        const name = pick[target.titleField]
        if (itemsKey && typeof name === 'string') data[itemsKey] = `${qty} × ${name}`
      }
      const res = await fetch(`/api/p/${encodeURIComponent(projectId)}/records/${encodeURIComponent(col.key)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-evo-source': 'website' },
        body: JSON.stringify({ data }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string }
        throw new Error(body.message || body.error || `Request failed (${res.status})`)
      }
    } catch (e) {
      notify({ tone: 'error', title: `Couldn't send test ${col.singular.toLowerCase()}`, description: e instanceof Error ? e.message : undefined })
    } finally {
      setSimulating(null)
    }
  }

  return (
    <div className="mx-auto w-full max-w-[1400px] space-y-4">
      {/* KPIs */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {loading
          ? Array.from({ length: 4 }).map((_, i) => <KpiSkeleton key={i} />)
          : metrics.length
            ? metrics.map((m, i) => <KpiCard key={m.key} metric={m} index={i} context={kpiContext(m, blueprint, data?.charts ?? [], counts)} />)
            : blueprint.collections.slice(0, 4).map((c, i) => (
                <KpiCard
                  key={c.key}
                  index={i}
                  context={null}
                  metric={{ key: c.key, label: `Total ${c.label.toLowerCase()}`, value: counts[c.key] ?? 0, format: 'number', icon: c.icon }}
                />
              ))}
      </div>
      {error && !data && (
        <p className="rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
          Live metrics are warming up ({error}). Counts below are still accurate.
        </p>
      )}

      {/* Charts */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <Panel
          className="lg:col-span-2"
          title={timeseries?.label ?? 'Activity over time'}
          subtitle={timeseries ? `${formatValue(heroTotal, heroFormat)} across the last ${timeseries.points.length} days` : 'Daily volume'}
          action={
            <button
              type="button"
              onClick={() => onOpenModule('analytics')}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Analytics <ArrowRight className="h-3 w-3" />
            </button>
          }
        >
          {loading ? <Skeleton className="h-[232px] w-full bg-muted/60" /> : <AreaChart points={timeseries?.points ?? []} format={heroFormat} height={232} label={timeseries?.label} />}
        </Panel>
        <Panel title={breakdown?.label ?? 'Breakdown'} subtitle={breakdown ? 'Share of total' : 'By status'}>
          {loading ? (
            <div className="flex items-center gap-5 pt-2">
              <Skeleton className="h-[150px] w-[150px] rounded-full bg-muted/60" />
              <div className="flex-1 space-y-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-4 w-full bg-muted/60" />
                ))}
              </div>
            </div>
          ) : (
            <DonutChart
              className="h-full pt-1 sm:flex-col sm:items-center xl:flex-row"
              points={breakdown?.points ?? blueprint.collections.map((c) => ({ x: c.label, y: counts[c.key] ?? 0 }))}
              size={136}
              centerLabel={breakdown ? 'Total' : 'Records'}
            />
          )}
        </Panel>
      </div>

      {/* Activity + quick actions */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <Panel
          className="lg:col-span-2"
          title="Recent activity"
          subtitle="Website submissions, edits and automations"
          action={
            <button
              type="button"
              onClick={() => onOpenModule('activity')}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              View all <ArrowRight className="h-3 w-3" />
            </button>
          }
        >
          <ActivityList events={events} blueprint={blueprint} limit={7} onOpenCollection={onOpenCollection} freshIds={freshIds} />
        </Panel>

        <div className="flex min-w-0 flex-col gap-3">
          <Panel title="Quick create" subtitle="Add records straight into your database">
            <div className="grid grid-cols-1 gap-1.5">
              {quickCols.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => onQuickCreate(c.key)}
                  className="group flex items-center gap-3 rounded-lg border border-border bg-background/40 px-3 py-2 text-left transition-colors hover:border-foreground/20 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground group-hover:text-foreground">
                    <PlatformIcon name={c.icon} hint={c.key} className="h-3.5 w-3.5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-foreground">New {c.singular.toLowerCase()}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {(counts[c.key] ?? 0).toLocaleString()} in {c.label.toLowerCase()}
                    </span>
                  </span>
                  <Plus className="h-3.5 w-3.5 text-muted-foreground group-hover:text-foreground" aria-hidden />
                </button>
              ))}
            </div>
          </Panel>

          {publicCols.length > 0 && (
            <section className="relative overflow-hidden rounded-xl border border-brand-accent/25 bg-gradient-to-br from-brand-accent/[0.08] via-card to-card p-4">
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-md bg-brand-accent/15 text-brand-accent">
                  <Globe className="h-3.5 w-3.5" aria-hidden />
                </span>
                <h3 className="text-sm font-medium text-foreground">Test the live pipeline</h3>
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                Send a submission exactly as your website would. It lands in the database, runs workflows and streams back here.
              </p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {publicCols.slice(0, 3).map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    disabled={simulating !== null}
                    onClick={() => simulate(c)}
                    className="inline-flex h-7 items-center gap-1.5 rounded-md border border-brand-accent/30 bg-background/60 px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-brand-accent/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                  >
                    {simulating === c.key ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3 text-brand-accent" />}
                    Website {c.singular.toLowerCase()}
                  </button>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  )
}

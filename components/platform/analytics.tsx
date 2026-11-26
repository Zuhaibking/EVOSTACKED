'use client'

import { AreaChart, BarList, formatAxisDate, formatValue, type ValueFormat } from './charts'
import { KpiCard, KpiSkeleton, Panel, kpiContext, useMetrics } from './overview'
import { Skeleton } from '@/components/ui/skeleton'
import type { Blueprint, ChartSeries } from '@/lib/platform/types'
import { cn } from '@/lib/utils'
import { ChartColumn, Table2 } from 'lucide-react'
import { useState } from 'react'

function chartFormat(series: ChartSeries, blueprint: Blueprint): ValueFormat {
  const def = blueprint.charts.find((c) => c.key === series.key)
  if (!def || def.op !== 'sum' || !def.field) return 'number'
  const field = blueprint.collections.find((c) => c.key === def.collection)?.fields.find((f) => f.key === def.field)
  return field?.type === 'money' ? 'money' : 'number'
}

function DataTable({ series, format }: { series: ChartSeries; format: ValueFormat }) {
  return (
    <div className="cc-scroll max-h-56 overflow-auto rounded-lg border border-border">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-card">
          <tr className="border-b border-border text-left text-muted-foreground">
            <th className="px-3 py-1.5 font-medium">{series.kind === 'timeseries' ? 'Date' : 'Group'}</th>
            <th className="px-3 py-1.5 text-right font-medium">Value</th>
          </tr>
        </thead>
        <tbody>
          {series.points.map((p, i) => (
            <tr key={`${p.x}-${i}`} className="border-b border-border/50 last:border-0">
              <td className="px-3 py-1.5 capitalize text-foreground/90">{series.kind === 'timeseries' ? formatAxisDate(p.x, 'long') : p.x.replace(/_/g, ' ')}</td>
              <td className="px-3 py-1.5 text-right font-mono tabular text-foreground">{formatValue(p.y, format)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ChartCard({ series, blueprint }: { series: ChartSeries; blueprint: Blueprint }) {
  const [table, setTable] = useState(false)
  const format = chartFormat(series, blueprint)
  const total = series.points.reduce((s, p) => s + p.y, 0)
  const peak = series.points.reduce<{ x: string; y: number } | null>((m, p) => (!m || p.y > m.y ? p : m), null)
  const days = Math.max(1, series.points.length)
  const subtitle =
    series.kind === 'timeseries'
      ? `${formatValue(total, format)} total · ${formatValue(total / days, format)} / day${peak && peak.y > 0 ? ` · peak ${formatAxisDate(peak.x)}` : ''}`
      : `${series.points.length} groups · ${formatValue(total, format)} total`
  return (
    <Panel
      title={series.label}
      subtitle={subtitle}
      className={series.kind === 'timeseries' ? 'xl:col-span-2' : undefined}
      action={
        <button
          type="button"
          onClick={() => setTable((t) => !t)}
          aria-pressed={table}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {table ? <ChartColumn className="h-3 w-3" /> : <Table2 className="h-3 w-3" />}
          {table ? 'Chart' : 'Table'}
        </button>
      }
    >
      {table ? (
        <DataTable series={series} format={format} />
      ) : series.kind === 'timeseries' ? (
        <AreaChart points={series.points} format={format} height={240} label={series.label} />
      ) : (
        <BarList points={series.points} format={format} className="pt-2" />
      )}
    </Panel>
  )
}

export function Analytics({ projectId, blueprint, counts, refreshKey }: { projectId: string; blueprint: Blueprint; counts: Record<string, number>; refreshKey: number }) {
  const { data, error, loading } = useMetrics(projectId, refreshKey)
  const charts = data?.charts ?? []
  const totalRecords = Object.values(counts).reduce((a, b) => a + b, 0)

  return (
    <div className="mx-auto w-full max-w-[1400px] space-y-4">
      <div className={cn('grid grid-cols-1 gap-3 sm:grid-cols-2', [3, 5, 6, 9].includes(data?.metrics.length ?? 4) ? 'xl:grid-cols-3' : 'xl:grid-cols-4')}>
        {loading
          ? Array.from({ length: 4 }).map((_, i) => <KpiSkeleton key={i} />)
          : (data?.metrics ?? []).map((m, i) => <KpiCard key={m.key} metric={m} index={i} context={kpiContext(m, blueprint, charts, counts)} />)}
      </div>
      {error && !data && <p className="rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">Metrics unavailable: {error}</p>}

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        {loading
          ? Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="rounded-xl border border-border bg-card p-4 xl:col-span-2">
                <Skeleton className="h-4 w-40 bg-muted" />
                <Skeleton className="mt-4 h-[220px] w-full bg-muted/60" />
              </div>
            ))
          : charts.map((s) => <ChartCard key={s.key} series={s} blueprint={blueprint} />)}

        <Panel title="Records by collection" subtitle={`${totalRecords.toLocaleString()} records in this project's isolated database`}>
          <BarList points={blueprint.collections.map((c) => ({ x: c.label, y: counts[c.key] ?? 0 }))} className="pt-2" />
        </Panel>
      </div>
    </div>
  )
}

/**
 * Blueprint metrics + charts computed straight from the project's SQLite tables.
 * - metrics: count / sum / avg with an optional `{field, equals}` filter
 *   (count + format "percent" → share of rows matching the filter)
 * - charts: timeseries = last 14 days by created_at (count or sum); breakdown = group by an enum field
 */
import { dbFor, getMeta, quoteIdent } from './db'
import type { Chart, ChartSeries, Collection, Field, Metric, MetricValue, MetricsResponse } from './types'

const DAYS = 14
const NUMERIC = new Set(['number', 'money'])
type Db = NonNullable<ReturnType<typeof dbFor>>

function round(n: number) {
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0
}

function fieldOf(c: Collection | undefined, key: string | null | undefined): Field | undefined {
  return c && key ? c.fields.find((f) => f.key === key) : undefined
}

/** WHERE clause for a metric filter; boolean / numeric / case-insensitive text compare. */
function filterSql(c: Collection, filter: Metric['filter']): { sql: string; params: (string | number)[] } | null {
  if (!filter) return null
  const f = fieldOf(c, filter.field)
  if (!f) return null
  const col = quoteIdent(f.key)
  const raw = String(filter.equals ?? '').trim()
  if (f.type === 'boolean') return { sql: `COALESCE(${col}, 0) = ?`, params: [/^(true|yes|1|on)$/i.test(raw) ? 1 : 0] }
  if (NUMERIC.has(f.type) && Number.isFinite(Number(raw)) && raw !== '') return { sql: `${col} = ?`, params: [Number(raw)] }
  return { sql: `lower(${col}) = lower(?)`, params: [raw] }
}

function metricValue(db: Db, c: Collection, m: Metric): number {
  const table = quoteIdent(c.key)
  const where = filterSql(c, m.filter)
  const whereSql = where ? ` WHERE ${where.sql}` : ''
  const params = where?.params ?? []
  const field = fieldOf(c, m.field)
  if (m.op === 'count' || !field || !NUMERIC.has(field.type)) {
    const n = Number(db.get(`SELECT COUNT(*) AS v FROM ${table}${whereSql}`, params)?.v ?? 0)
    if (m.format === 'percent' && where) {
      const total = Number(db.get(`SELECT COUNT(*) AS v FROM ${table}`)?.v ?? 0)
      return total ? round((n / total) * 100) : 0
    }
    return n
  }
  const fn = m.op === 'avg' ? 'AVG' : 'SUM'
  return round(Number(db.get(`SELECT ${fn}(${quoteIdent(field.key)}) AS v FROM ${table}${whereSql}`, params)?.v ?? 0))
}

function dayKeys(now = new Date()): string[] {
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  return Array.from({ length: DAYS }, (_, i) => new Date(end - (DAYS - 1 - i) * 86_400_000).toISOString().slice(0, 10))
}

function timeseries(db: Db, c: Collection, ch: Chart): ChartSeries['points'] {
  const days = dayKeys()
  const field = fieldOf(c, ch.field)
  const agg = ch.op === 'sum' && field && NUMERIC.has(field.type) ? `SUM(${quoteIdent(field.key)})` : 'COUNT(*)'
  const rows = db.all(`SELECT substr("created_at", 1, 10) AS d, ${agg} AS v FROM ${quoteIdent(c.key)} WHERE "created_at" >= ? GROUP BY d`, [`${days[0]}T00:00:00.000Z`])
  const byDay = new Map(rows.map((r) => [String(r.d), Number(r.v ?? 0)]))
  return days.map((d) => ({ x: d, y: round(byDay.get(d) ?? 0) }))
}

function breakdown(db: Db, c: Collection, ch: Chart): ChartSeries['points'] {
  const group = fieldOf(c, ch.groupBy) ?? fieldOf(c, c.statusField) ?? c.fields.find((f) => f.type === 'enum')
  if (!group) return []
  const field = fieldOf(c, ch.field)
  const sum = ch.op === 'sum' && field && NUMERIC.has(field.type)
  const table = quoteIdent(c.key)
  const totals = new Map<string, number>()
  const bump = (k: string, v: number) => totals.set(k, (totals.get(k) ?? 0) + v)

  if (group.type === 'tags') {
    const rows = db.all(`SELECT ${quoteIdent(group.key)} AS k${sum ? `, ${quoteIdent(field!.key)} AS v` : ''} FROM ${table}`)
    for (const r of rows) {
      let tags: unknown = []
      try { tags = JSON.parse(String(r.k ?? '[]')) } catch { tags = [] }
      for (const t of Array.isArray(tags) ? tags : []) bump(String(t), sum ? Number(r.v ?? 0) : 1)
    }
  } else {
    const agg = sum ? `SUM(${quoteIdent(field!.key)})` : 'COUNT(*)'
    const rows = db.all(`SELECT ${quoteIdent(group.key)} AS k, ${agg} AS v FROM ${table} GROUP BY k`)
    for (const r of rows) {
      const k = r.k === null || r.k === undefined || r.k === ''
        ? 'Unspecified'
        : group.type === 'boolean' ? (Number(r.k) ? 'Yes' : 'No') : String(r.k)
      bump(k, Number(r.v ?? 0))
    }
  }

  const ordered: { x: string; y: number }[] = []
  if (group.type === 'enum') {
    for (const o of group.options) { ordered.push({ x: o, y: round(totals.get(o) ?? 0) }); totals.delete(o) }
  }
  const rest = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([x, y]) => ({ x, y: round(y) }))
  return [...ordered, ...rest].slice(0, 12)
}

export function computeMetrics(projectId: string): MetricsResponse {
  const meta = getMeta(projectId)
  const db = dbFor(projectId)
  if (!meta || !db) return { metrics: [], charts: [] }
  const collections = new Map(meta.blueprint.collections.map((c) => [c.key, c]))

  const metrics: MetricValue[] = (meta.blueprint.metrics || []).map((m) => {
    const c = collections.get(m.collection)
    let value = 0
    if (c) {
      try { value = metricValue(db, c, m) } catch (e) { console.error('[platform] metric failed', m.key, e) }
    }
    return { key: m.key, label: m.label, value, format: m.format, icon: m.icon }
  })

  const charts: ChartSeries[] = (meta.blueprint.charts || []).map((ch) => {
    const c = collections.get(ch.collection)
    let points: ChartSeries['points'] = []
    if (c) {
      try { points = ch.kind === 'breakdown' ? breakdown(db, c, ch) : timeseries(db, c, ch) } catch (e) { console.error('[platform] chart failed', ch.key, e) }
    }
    return { key: ch.key, label: ch.label, kind: ch.kind, points }
  })

  return { metrics, charts }
}

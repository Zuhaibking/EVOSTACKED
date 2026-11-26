'use client'

/**
 * CalendarModule — records placed on the collection's dateField.
 * Week view (default, 8:00–20:00 time grid; day lanes for date-only fields) and month view,
 * Today / prev / next, status-toned event chips, click event → drawer, click empty slot → create
 * with that date/time prefilled. Falls back to TableModule when there is no date field.
 */
import { RecordDrawer } from './record-drawer'
import {
  apiFetch,
  currencyOf,
  ErrorState,
  formatTime,
  humanize,
  type ListResponse,
  type Loaded,
  ModuleHeader,
  type ModuleProps,
  ModuleStyles,
  parseDate,
  plainValue,
  recordsUrl,
  statusFieldOf,
  subtitleFieldOf,
  titleOf,
  toDateKey,
  toFailed,
  toLoaded,
  toNumber,
  toneFor,
  ToneDot,
  useFreshness,
  useMounted,
  useNow,
  useRelationLabels,
  dateFieldOf,
} from './shared'
import { TableModule } from './table-module'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { Collection, Field, RecordRow } from '@/lib/platform/types'
import { cn } from '@/lib/utils'
import { ChevronLeft, ChevronRight, LoaderCircle, Plus } from 'lucide-react'
import * as React from 'react'

/** Base visible hours; the week grid widens to fit that week's events (e.g. late dinner bookings). */
const HOUR_START = 8
const HOUR_END = 20
const HOUR_H = 52 // px per hour
const MIN_EVENT_H = 22
const LIMIT = 1000

type View = 'week' | 'month'
type CalEvent = { row: RecordRow; start: Date; end: Date; title: string; sub: string; tone: string }
type Placed = CalEvent & { lane: number; lanes: number }

/* ───────────────────────── date math (local time, Monday-first weeks) ───────────────────────── */
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
const startOfWeek = (d: Date) => addDays(startOfDay(d), -((d.getDay() + 6) % 7))
const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1)
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
const hourLabel = (h: number) => new Date(2000, 0, 1, h).toLocaleTimeString(undefined, { hour: 'numeric' })

function rangeTitle(view: View, anchor: Date) {
  if (view === 'month') return anchor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
  const s = startOfWeek(anchor)
  const e = addDays(s, 6)
  const sameYear = s.getFullYear() === e.getFullYear()
  const sameMonth = sameYear && s.getMonth() === e.getMonth()
  const left = s.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) })
  const right = sameMonth ? String(e.getDate()) : e.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  return `${left} – ${right}, ${e.getFullYear()}`
}

/** Optional duration / end fields make blocks the right height; default 1 h. */
function durationMs(collection: Collection, dateField: Field, row: RecordRow, start: Date): number {
  const endField = collection.fields.find((f) => f.key !== dateField.key && (f.type === 'datetime' || f.type === 'date') && /(^|_)(end|ends|until|finish|checkout|check_out|to)(_|$)/.test(f.key))
  const end = endField ? parseDate(row[endField.key]) : null
  if (end && end.getTime() > start.getTime()) return Math.min(end.getTime() - start.getTime(), 12 * 3_600_000)
  const durField = collection.fields.find((f) => f.type === 'number' && /duration|minutes|length/.test(f.key))
  const mins = durField ? toNumber(row[durField.key]) : null
  if (mins && mins > 0) return Math.min(Math.max(mins, 15), 8 * 60) * 60_000
  return 60 * 60_000
}

/** Greedy lane packing for overlapping blocks within one day. */
function layoutDay(events: CalEvent[]): Placed[] {
  const sorted = [...events].sort((a, b) => a.start.getTime() - b.start.getTime() || b.end.getTime() - a.end.getTime())
  const out: Placed[] = []
  let cluster: Placed[] = []
  let laneEnds: number[] = []
  let clusterEnd = -Infinity
  const flush = () => {
    for (const e of cluster) e.lanes = Math.max(1, laneEnds.length)
    out.push(...cluster)
    cluster = []
    laneEnds = []
    clusterEnd = -Infinity
  }
  for (const ev of sorted) {
    const s = ev.start.getTime()
    const e = Math.max(ev.end.getTime(), s + 30 * 60_000)
    if (cluster.length && s >= clusterEnd) flush()
    let lane = laneEnds.findIndex((end) => end <= s)
    if (lane === -1) {
      lane = laneEnds.length
      laneEnds.push(e)
    } else laneEnds[lane] = e
    cluster.push({ ...ev, lane, lanes: 1 })
    clusterEnd = Math.max(clusterEnd, e)
  }
  flush()
  return out
}

/* ───────────────────────── module ───────────────────────── */
export function CalendarModule(props: ModuleProps) {
  const dateField = dateFieldOf(props.collection)
  if (!dateField) return <TableModule {...props} />
  return <CalendarBoard {...props} dateField={dateField} />
}

function CalendarBoard({ projectId, collection, blueprint, refreshKey, dateField }: ModuleProps & { dateField: Field }) {
  const dateOnly = dateField.type === 'date'
  const statusField = statusFieldOf(collection)
  const subField = subtitleFieldOf(collection)
  const currency = React.useMemo(() => currencyOf(blueprint), [blueprint])
  const relationLabels = useRelationLabels(projectId, blueprint, subField ? [subField] : [], refreshKey)
  const now = useNow()
  const mounted = useMounted()
  const { mark, isFresh } = useFreshness()

  const [view, setView] = React.useState<View>('week')
  const [pinned, setPinned] = React.useState<Date | null>(null) // null → follow today (client timezone, after mount)
  const [result, setResult] = React.useState<Loaded | null>(null)
  const [tick, setTick] = React.useState(0)
  const [drawer, setDrawer] = React.useState<{ open: boolean; record: RecordRow | null; defaults?: Record<string, unknown> }>({ open: false, record: null })

  const anchor = mounted && now ? (pinned ?? startOfDay(new Date(now))) : null
  const anchorMs = anchor?.getTime() ?? null
  const range = React.useMemo(() => {
    if (anchorMs === null) return null
    const a = new Date(anchorMs)
    const start = view === 'week' ? startOfWeek(a) : startOfWeek(startOfMonth(a))
    return { start, end: addDays(start, view === 'week' ? 7 : 42) }
  }, [anchorMs, view])
  const rangeKey = range ? `${range.start.getTime()}-${range.end.getTime()}` : ''
  const reqKey = range ? `${projectId}|${collection.key}|${dateField.key}|${rangeKey}|${refreshKey}|${tick}` : ''

  React.useEffect(() => {
    if (!range) return
    const ctrl = new AbortController()
    const params = new URLSearchParams({ limit: String(LIMIT), sort: dateField.key, dir: 'asc' })
    // The API's from/to applies to the collection's declared dateField only.
    const ranged = collection.dateField === dateField.key
    if (ranged) {
      if (dateOnly) {
        params.set('from', toDateKey(range.start))
        params.set('to', toDateKey(addDays(range.end, -1)))
      } else {
        params.set('from', addDays(range.start, -1).toISOString())
        params.set('to', addDays(range.end, 1).toISOString())
      }
    }
    const url = recordsUrl(projectId, collection.key)
    Promise.all([
      apiFetch<ListResponse>(`${url}?${params}`, { signal: ctrl.signal }),
      // Header shows the collection total (like table/kanban), not just the visible range.
      ranged ? apiFetch<ListResponse>(`${url}?limit=1`, { signal: ctrl.signal }).catch(() => null) : null,
    ])
      .then(([r, all]) => {
        const loaded = toLoaded(reqKey, r)
        const t = Number(all?.total)
        if (Number.isFinite(t)) loaded.total = t
        setResult(loaded)
      })
      .catch((e) => {
        if (!ctrl.signal.aborted) setResult((prev) => toFailed(reqKey, prev, e, 'Something went wrong loading the calendar.'))
      })
    return () => ctrl.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reqKey captures range/refresh/tick
  }, [reqKey, projectId, collection.key, collection.dateField, dateField.key, dateOnly])

  const rows = result?.rows ?? null
  const total = result?.total ?? null
  const error = result?.error ?? null
  const loading = !!range && result?.key !== reqKey
  const setRows = (fn: (rs: RecordRow[]) => RecordRow[]) => setResult((r) => (r?.rows ? { ...r, rows: fn(r.rows) } : r))

  const byDay = React.useMemo(() => {
    const map = new Map<string, CalEvent[]>()
    for (const row of rows ?? []) {
      const start = parseDate(row[dateField.key])
      if (!start) continue
      const sub = subField ? (relationLabels[subField.key]?.[String(row[subField.key])] ?? plainValue(subField, row[subField.key], currency)) : ''
      const ev: CalEvent = {
        row,
        start,
        end: new Date(start.getTime() + durationMs(collection, dateField, row, start)),
        title: titleOf(collection, row),
        sub,
        tone: statusField ? toneFor(row[statusField.key]) : 'blue',
      }
      const k = toDateKey(start)
      const list = map.get(k)
      if (list) list.push(ev)
      else map.set(k, [ev])
    }
    for (const list of map.values()) list.sort((a, b) => a.start.getTime() - b.start.getTime())
    return map
  }, [rows, dateField, subField, relationLabels, currency, collection, statusField])

  const shift = (dir: -1 | 1) =>
    setPinned((p) => {
      const a = p ?? anchor ?? startOfDay(new Date())
      return view === 'week' ? addDays(a, dir * 7) : new Date(a.getFullYear(), a.getMonth() + dir, 1)
    })
  const goToday = () => setPinned(null)

  const openEdit = (r: RecordRow) => setDrawer({ open: true, record: r })
  const createAt = (day: Date, hour?: number, minute = 0) => {
    const value = dateOnly ? toDateKey(day) : new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour ?? 12, minute).toISOString()
    setDrawer({ open: true, record: null, defaults: { [dateField.key]: value } })
  }
  const onSaved = (r: RecordRow) => {
    mark(r.id)
    setRows((rs) => (rs ? (rs.some((x) => x.id === r.id) ? rs.map((x) => (x.id === r.id ? r : x)) : [...rs, r]) : rs))
    setTick((t) => t + 1)
  }
  const onDeleted = (id: string) => {
    setRows((rs) => rs?.filter((x) => x.id !== id) ?? rs)
    setTick((t) => t + 1)
  }

  const days = range ? Array.from({ length: view === 'week' ? 7 : 42 }, (_, i) => addDays(range.start, i)) : []
  const today = new Date(now)
  const visibleCount = days.reduce((n, d) => n + (byDay.get(toDateKey(d))?.length ?? 0), 0)

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <ModuleStyles />
      <ModuleHeader collection={collection} count={total} busy={loading && !!rows} onCreate={() => createAt(anchor && !sameDay(anchor, today) ? anchor : today, today.getHours() + 1)} />

      {/* toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Button variant="outline" size="sm" className="h-8 bg-card" onClick={goToday}>
            Today
          </Button>
          <div className="flex h-8 items-center rounded-lg border bg-card shadow-sm">
            <button type="button" onClick={() => shift(-1)} className="grid h-full w-8 place-items-center rounded-l-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" aria-label={`Previous ${view}`}>
              <ChevronLeft className="size-4" />
            </button>
            <span className="h-4 w-px bg-border" />
            <button type="button" onClick={() => shift(1)} className="grid h-full w-8 place-items-center rounded-r-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" aria-label={`Next ${view}`}>
              <ChevronRight className="size-4" />
            </button>
          </div>
          <h3 className="ml-1 truncate text-[15px] font-semibold tracking-tight tabular text-foreground" aria-live="polite">
            {anchor ? rangeTitle(view, anchor) : ' '}
          </h3>
          {rows && (
            <span className="hidden text-xs text-muted-foreground sm:inline">
              · {visibleCount} this {view}
            </span>
          )}
          {loading && rows && <LoaderCircle className="size-3.5 animate-spin text-muted-foreground" />}
        </div>
        <div className="flex items-center gap-4">
          {statusField && (
            <div className="hidden items-center gap-3 xl:flex">
              {statusField.options.slice(0, 6).map((o) => (
                <span key={o} className="inline-flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
                  <ToneDot value={o} className="size-1.5" />
                  {humanize(o)}
                </span>
              ))}
            </div>
          )}
          <Tabs value={view} onValueChange={(v) => setView(v as View)}>
            <TabsList className="h-8 border bg-muted/60 p-0.5">
              <TabsTrigger value="week" className="h-6 px-3 text-xs">
                Week
              </TabsTrigger>
              <TabsTrigger value="month" className="h-6 px-3 text-xs">
                Month
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>

      <div className="relative overflow-hidden rounded-xl border bg-card shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
        {error && !rows ? (
          <ErrorState error={error} label={collection.label.toLowerCase()} onRetry={() => setTick((t) => t + 1)} />
        ) : !range ? (
          <Skeleton className="m-4 h-[28rem] bg-muted/60" />
        ) : view === 'month' ? (
          <MonthGrid
            days={days}
            anchor={anchor!}
            today={today}
            byDay={byDay}
            dateOnly={dateOnly}
            isFresh={isFresh}
            onOpen={openEdit}
            onCreate={(d) => createAt(d, 12)}
            onMore={(d) => {
              setPinned(d)
              setView('week')
            }}
          />
        ) : dateOnly ? (
          <WeekLanes days={days} today={today} byDay={byDay} isFresh={isFresh} onOpen={openEdit} onCreate={(d) => createAt(d)} label={lowerSingular(collection)} />
        ) : (
          <WeekGrid days={days} now={now} byDay={byDay} ready={!!rows} isFresh={isFresh} onOpen={openEdit} onCreate={createAt} label={lowerSingular(collection)} />
        )}
      </div>

      <RecordDrawer
        projectId={projectId}
        collection={collection}
        blueprint={blueprint}
        record={drawer.record}
        defaults={drawer.defaults}
        open={drawer.open}
        onClose={() => setDrawer((d) => ({ ...d, open: false }))}
        onSaved={onSaved}
        onDeleted={onDeleted}
      />
    </div>
  )
}

const lowerSingular = (c: Collection) => (c.singular || 'record').toLowerCase()

/* ───────────────────────── week · time grid ───────────────────────── */
function DayHeader({ days, today, byDay, gutter }: { days: Date[]; today: Date; byDay: Map<string, CalEvent[]>; gutter: boolean }) {
  return (
    <div className={cn('grid border-b bg-muted/20', gutter ? 'grid-cols-[3.75rem_repeat(7,minmax(0,1fr))]' : 'grid-cols-7')}>
      {gutter && <div className="border-r" />}
      {days.map((d) => {
        const isToday = sameDay(d, today)
        const n = byDay.get(toDateKey(d))?.length ?? 0
        return (
          <div key={d.getTime()} className="flex items-center gap-1.5 border-r px-2.5 py-2 last:border-r-0">
            <span className={cn('font-mono text-[10.5px] uppercase tracking-[0.08em]', isToday ? 'text-foreground' : 'text-muted-foreground')}>
              {d.toLocaleDateString(undefined, { weekday: 'short' })}
            </span>
            <span className={cn('grid h-6 min-w-6 place-items-center rounded-full px-1.5 text-[13px] font-semibold tabular', isToday ? 'bg-brand text-brand-foreground' : 'text-foreground')}>
              {d.getDate()}
            </span>
            {n > 0 && <span className="ml-auto rounded bg-muted px-1 font-mono text-[10px] tabular text-muted-foreground">{n}</span>}
          </div>
        )
      })}
    </div>
  )
}

function WeekGrid({
  days,
  now,
  byDay,
  ready,
  isFresh,
  onOpen,
  onCreate,
  label,
}: {
  days: Date[]
  now: number
  byDay: Map<string, CalEvent[]>
  ready: boolean
  isFresh: (r: RecordRow) => boolean
  onOpen: (r: RecordRow) => void
  onCreate: (d: Date, hour: number, minute: number) => void
  label: string
}) {
  const today = new Date(now)
  const weekEvents = days.flatMap((d) => byDay.get(toDateKey(d)) ?? [])
  // 8–20 by default, widened to whole hours covering this week's events.
  let startHour = HOUR_START
  let endHour = HOUR_END
  for (const ev of weekEvents) {
    const s = ev.start.getHours() + ev.start.getMinutes() / 60
    startHour = Math.min(startHour, Math.floor(s))
    endHour = Math.max(endHour, Math.min(24, Math.ceil(s + (ev.end.getTime() - ev.start.getTime()) / 3_600_000)))
  }
  const HOURS = endHour - startHour
  const GRID_H = HOURS * HOUR_H
  const nowMin = today.getHours() * 60 + today.getMinutes()
  const nowTop = ((nowMin - startHour * 60) / 60) * HOUR_H
  const slots = Array.from({ length: HOURS * 2 }, (_, i) => ({ hour: startHour + Math.floor(i / 2), minute: (i % 2) * 30 }))

  // Once per week: scroll so the first booking (or "now") is in view.
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const scrolledFor = React.useRef<string | null>(null)
  const weekKey = `${days[0]?.getTime()}:${startHour}`
  const firstMin = weekEvents.length ? Math.min(...weekEvents.map((e) => e.start.getHours() * 60 + e.start.getMinutes())) : null
  React.useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el || !ready || scrolledFor.current === weekKey) return
    scrolledFor.current = weekKey
    const inWeek = days.some((d) => sameDay(d, today))
    const target = firstMin ?? (inWeek ? nowMin : 9 * 60)
    el.scrollTop = Math.max(0, ((target - startHour * 60) / 60) * HOUR_H - HOUR_H * 0.6)
  })

  return (
    <div>
      <DayHeader days={days} today={today} byDay={byDay} gutter />
      <div ref={scrollRef} className="evo-scroll max-h-[calc(100dvh-16rem)] min-h-[20rem] overflow-y-auto">
        <div className="grid grid-cols-[3.75rem_repeat(7,minmax(0,1fr))]" style={{ height: GRID_H }}>
          <div className="relative border-r">
            {Array.from({ length: HOURS }, (_, i) => (
              <span key={i} className="absolute right-2 font-mono text-[10px] tabular text-muted-foreground" style={{ top: i * HOUR_H + 4 }}>
                {hourLabel((startHour + i) % 24)}
              </span>
            ))}
          </div>
          {days.map((d) => {
            const isToday = sameDay(d, today)
            const placed = layoutDay(byDay.get(toDateKey(d)) ?? [])
            return (
              <div key={d.getTime()} className={cn('relative border-r last:border-r-0', isToday && 'bg-brand/[0.03]')}>
                {slots.map((s) => {
                  const at = new Date(d.getFullYear(), d.getMonth(), d.getDate(), s.hour, s.minute)
                  return (
                    <button
                      key={`${s.hour}:${s.minute}`}
                      type="button"
                      tabIndex={-1}
                      onClick={() => onCreate(d, s.hour, s.minute)}
                      aria-label={`New ${label} ${at.toLocaleString(undefined, { weekday: 'long', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`}
                      className={cn(
                        'evo-slot absolute inset-x-0 text-left transition-colors hover:bg-muted/50',
                        s.minute === 0 ? 'border-b border-dashed border-border/35' : 'border-b border-border/70',
                      )}
                      style={{ top: ((s.hour - startHour) * 2 + s.minute / 30) * (HOUR_H / 2), height: HOUR_H / 2 }}
                    >
                      <span className="evo-slot-hint pointer-events-none absolute left-1.5 top-1/2 inline-flex -translate-y-1/2 items-center gap-1 text-[10.5px] font-medium tabular text-muted-foreground">
                        <Plus className="size-3" />
                        {formatTime(at)}
                      </span>
                    </button>
                  )
                })}

                {placed.map((ev) => {
                  const startMin = ev.start.getHours() * 60 + ev.start.getMinutes()
                  const endMin = startMin + Math.max(15, (ev.end.getTime() - ev.start.getTime()) / 60_000)
                  const visStart = Math.min(Math.max(startMin, startHour * 60), endHour * 60)
                  const visEnd = Math.min(Math.max(endMin, startHour * 60), endHour * 60)
                  let top = ((visStart - startHour * 60) / 60) * HOUR_H
                  let height = Math.max(MIN_EVENT_H, ((visEnd - visStart) / 60) * HOUR_H - 2)
                  if (top + height > GRID_H) top = GRID_H - height
                  if (top < 0) {
                    top = 0
                    height = MIN_EVENT_H
                  }
                  const outside = startMin < startHour * 60 ? 'early' : startMin >= endHour * 60 ? 'late' : null
                  const roomy = height >= 40
                  return (
                    <button
                      key={ev.row.id}
                      type="button"
                      data-tone={ev.tone}
                      onClick={() => onOpen(ev.row)}
                      title={`${ev.title} · ${ev.start.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}${ev.sub ? ` · ${ev.sub}` : ''}`}
                      className={cn(
                        'evo-tone evo-event absolute z-10 overflow-hidden rounded-md pl-2 pr-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        roomy ? 'py-1' : 'flex items-center py-0',
                        isFresh(ev.row) && 'evo-card-flash',
                      )}
                      style={{
                        top: top + 1,
                        height,
                        left: `calc(${(ev.lane / ev.lanes) * 100}% + 2px)`,
                        width: `calc(${100 / ev.lanes}% - 4px)`,
                      }}
                    >
                      <span className={cn('block truncate text-[11.5px] font-medium leading-tight text-foreground', !roomy && 'min-w-0')}>{ev.title}</span>
                      <span className={cn('evo-tone-fg truncate text-[10.5px] leading-tight tabular', roomy ? 'mt-0.5 block' : 'ml-1 shrink-0')}>
                        {outside === 'early' ? '↑ ' : outside === 'late' ? '↓ ' : ''}
                        {formatTime(ev.start)}
                        {roomy && ev.sub ? <span className="text-muted-foreground"> · {ev.sub}</span> : null}
                      </span>
                    </button>
                  )
                })}

                {isToday && nowTop >= 0 && nowTop <= GRID_H && (
                  <div className="pointer-events-none absolute inset-x-0 z-20 flex items-center" style={{ top: nowTop }} aria-hidden>
                    <span className="-ml-[3px] size-1.5 rounded-full bg-brand-danger" />
                    <span className="h-px flex-1 bg-brand-danger/80" />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/* ───────────────────────── week · date-only lanes ───────────────────────── */
function WeekLanes({
  days,
  today,
  byDay,
  isFresh,
  onOpen,
  onCreate,
  label,
}: {
  days: Date[]
  today: Date
  byDay: Map<string, CalEvent[]>
  isFresh: (r: RecordRow) => boolean
  onOpen: (r: RecordRow) => void
  onCreate: (d: Date) => void
  label: string
}) {
  return (
    <div>
      <DayHeader days={days} today={today} byDay={byDay} gutter={false} />
      <div className="grid min-h-[24rem] grid-cols-7">
        {days.map((d) => (
          <div key={d.getTime()} onClick={() => onCreate(d)} className={cn('group relative flex cursor-pointer flex-col gap-1 border-r p-1.5 transition-colors last:border-r-0 hover:bg-muted/30', sameDay(d, today) && 'bg-brand/[0.03]')}>
            {(byDay.get(toDateKey(d)) ?? []).map((ev) => (
              <EventChip key={ev.row.id} ev={ev} fresh={isFresh(ev.row)} onOpen={onOpen} showTime={false} roomy />
            ))}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onCreate(d)
              }}
              className="mt-auto inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-[11px] text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
            >
              <Plus className="size-3" /> New {label}
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

function EventChip({ ev, fresh, onOpen, showTime, roomy }: { ev: CalEvent; fresh: boolean; onOpen: (r: RecordRow) => void; showTime: boolean; roomy?: boolean }) {
  return (
    <button
      type="button"
      data-tone={ev.tone}
      onClick={(e) => {
        e.stopPropagation()
        onOpen(ev.row)
      }}
      title={`${ev.title}${showTime ? ` · ${formatTime(ev.start)}` : ''}${ev.sub ? ` · ${ev.sub}` : ''}`}
      className={cn(
        'evo-tone evo-event flex w-full min-w-0 items-center gap-1 rounded py-[3px] pl-2 pr-1 text-left text-[11px] leading-tight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        roomy && 'flex-col items-start gap-0.5 rounded-md py-1.5',
        fresh && 'evo-card-flash',
      )}
    >
      <span className="flex w-full min-w-0 items-center gap-1">
        {showTime && <span className="evo-tone-fg shrink-0 tabular">{formatTime(ev.start).replace(/:00(?=\s|$)/, '')}</span>}
        <span className="truncate font-medium text-foreground">{ev.title}</span>
      </span>
      {roomy && ev.sub && <span className="w-full truncate text-[10.5px] text-muted-foreground">{ev.sub}</span>}
    </button>
  )
}

/* ───────────────────────── month ───────────────────────── */
function MonthGrid({
  days,
  anchor,
  today,
  byDay,
  dateOnly,
  isFresh,
  onOpen,
  onCreate,
  onMore,
}: {
  days: Date[]
  anchor: Date
  today: Date
  byDay: Map<string, CalEvent[]>
  dateOnly: boolean
  isFresh: (r: RecordRow) => boolean
  onOpen: (r: RecordRow) => void
  onCreate: (d: Date) => void
  onMore: (d: Date) => void
}) {
  const MAX = 3
  return (
    <div>
      <div className="grid grid-cols-7 border-b bg-muted/20">
        {days.slice(0, 7).map((d) => (
          <div key={d.getDay()} className="border-r px-2.5 py-2 font-mono text-[10.5px] uppercase tracking-[0.08em] text-muted-foreground last:border-r-0">
            {d.toLocaleDateString(undefined, { weekday: 'short' })}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((d) => {
          const inMonth = d.getMonth() === anchor.getMonth()
          const isToday = sameDay(d, today)
          const evs = byDay.get(toDateKey(d)) ?? []
          return (
            <div
              key={d.getTime()}
              onClick={() => onCreate(d)}
              className={cn(
                'group relative min-h-[7.25rem] cursor-pointer border-b border-r p-1.5 transition-colors hover:bg-muted/30 [&:nth-child(7n)]:border-r-0 [&:nth-last-child(-n+7)]:border-b-0',
                !inMonth && 'bg-muted/25',
              )}
            >
              <div className="mb-1 flex items-center justify-between">
                <span
                  className={cn(
                    'grid size-6 place-items-center rounded-full text-[12px] tabular',
                    isToday ? 'bg-brand font-semibold text-brand-foreground' : inMonth ? 'font-medium text-foreground' : 'text-muted-foreground/60',
                  )}
                >
                  {d.getDate()}
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onCreate(d)
                  }}
                  className="grid size-5 place-items-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
                  aria-label={`New on ${d.toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}`}
                >
                  <Plus className="size-3.5" />
                </button>
              </div>
              <div className="space-y-0.5">
                {evs.slice(0, MAX).map((ev) => (
                  <EventChip key={ev.row.id} ev={ev} fresh={isFresh(ev.row)} onOpen={onOpen} showTime={!dateOnly} />
                ))}
                {evs.length > MAX && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      onMore(d)
                    }}
                    className="w-full rounded px-2 py-0.5 text-left text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    +{evs.length - MAX} more
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

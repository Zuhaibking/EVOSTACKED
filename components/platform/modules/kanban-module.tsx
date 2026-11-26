'use client'

/**
 * KanbanModule — columns are the statusField options (count + money sum per column).
 * Native HTML5 drag-and-drop moves a card → optimistic PATCH of the statusField, reverted on error.
 * Falls back to TableModule when the collection has no usable status field.
 */
import { RecordDrawer } from './record-drawer'
import {
  ApiError,
  apiFetch,
  currencyOf,
  ErrorState,
  fieldByKey,
  formatMoney,
  formatRelative,
  humanize,
  isDateOnlyValue,
  type ListResponse,
  type Loaded,
  lowerNoun,
  ModuleHeader,
  type ModuleProps,
  ModuleStyles,
  moneyFieldOf,
  parseDate,
  plainValue,
  recordsUrl,
  statusFieldOf,
  subtitleFieldOf,
  titleOf,
  toFailed,
  toLoaded,
  toNumber,
  toneFor,
  useFreshness,
  useNow,
  useRelationLabels,
} from './shared'
import { TableModule } from './table-module'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from '@/components/ui/use-toast'
import type { Field, RecordRow } from '@/lib/platform/types'
import { cn } from '@/lib/utils'
import { CalendarDays, Clock, GripVertical, LoaderCircle, Plus } from 'lucide-react'
import * as React from 'react'

const LIMIT = 500
const MIME = 'application/x-evo-record'
const ORPHAN = '__evo_unassigned__'

export function KanbanModule(props: ModuleProps) {
  const statusField = statusFieldOf(props.collection)
  if (!statusField) return <TableModule {...props} />
  return <KanbanBoard {...props} statusField={statusField} />
}

function KanbanBoard({ projectId, collection, blueprint, refreshKey, statusField }: ModuleProps & { statusField: Field }) {
  const currency = React.useMemo(() => currencyOf(blueprint), [blueprint])
  const moneyField = moneyFieldOf(collection)
  const subField = subtitleFieldOf(collection)
  const dateField = fieldByKey(collection, collection.dateField)
  const relationLabels = useRelationLabels(projectId, blueprint, subField ? [subField] : [], refreshKey)
  const now = useNow()
  const sKey = statusField.key

  const [result, setResult] = React.useState<Loaded | null>(null)
  const [tick, setTick] = React.useState(0)
  const [dragId, setDragId] = React.useState<string | null>(null)
  const [overCol, setOverCol] = React.useState<string | null>(null)
  const [pending, setPending] = React.useState<ReadonlySet<string>>(new Set())
  const [drawer, setDrawer] = React.useState<{ open: boolean; record: RecordRow | null; defaults?: Record<string, unknown> }>({ open: false, record: null })
  const inflight = React.useRef(new Map<string, unknown>()) // id → optimistic status (survives refetches)
  const { mark, isFresh } = useFreshness()

  const reqKey = `${projectId}|${collection.key}|${sKey}|${refreshKey}|${tick}`
  React.useEffect(() => {
    const ctrl = new AbortController()
    apiFetch<ListResponse>(`${recordsUrl(projectId, collection.key)}?limit=${LIMIT}&sort=updated_at&dir=desc`, { signal: ctrl.signal })
      .then((r) => {
        const loaded = toLoaded(reqKey, r)
        // Keep optimistic moves that are still in flight.
        if (inflight.current.size && loaded.rows) loaded.rows = loaded.rows.map((x) => (inflight.current.has(x.id) ? { ...x, [sKey]: inflight.current.get(x.id) } : x))
        setResult(loaded)
      })
      .catch((e) => {
        if (!ctrl.signal.aborted) setResult((prev) => toFailed(reqKey, prev, e, 'Something went wrong loading this board.'))
      })
    return () => ctrl.abort()
  }, [reqKey, projectId, collection.key, sKey])

  const rows = result?.rows ?? null
  const total = result?.total ?? null
  const error = result?.error ?? null
  const loading = result?.key !== reqKey
  const setRows = (fn: (rs: RecordRow[]) => RecordRow[]) => setResult((r) => (r?.rows ? { ...r, rows: fn(r.rows) } : r))

  const columns = React.useMemo(() => {
    const byCol = new Map<string, RecordRow[]>(statusField.options.map((o) => [o, []]))
    const lower = new Map(statusField.options.map((o) => [o.toLowerCase(), o]))
    const orphans: RecordRow[] = []
    for (const r of rows ?? []) {
      const v = String(r[sKey] ?? '')
      const col = byCol.has(v) ? v : lower.get(v.toLowerCase())
      if (col) byCol.get(col)!.push(r)
      else orphans.push(r)
    }
    const stamp = (r: RecordRow) => parseDate(r.updated_at)?.getTime() ?? 0
    const list = statusField.options.map((o) => ({ key: o, rows: byCol.get(o)!.sort((a, b) => stamp(b) - stamp(a)) }))
    if (orphans.length) list.push({ key: ORPHAN, rows: orphans })
    return list
  }, [rows, statusField.options, sKey])

  async function move(id: string, to: string) {
    const row = rows?.find((r) => r.id === id)
    if (!row || to === ORPHAN || String(row[sKey] ?? '') === to) return
    const prev = { status: row[sKey], updated_at: row.updated_at }
    inflight.current.set(id, to)
    setPending((p) => new Set(p).add(id))
    setRows((rs) => rs?.map((r) => (r.id === id ? { ...r, [sKey]: to, updated_at: new Date().toISOString() } : r)) ?? rs)
    try {
      const res = await apiFetch<{ record: RecordRow }>(recordsUrl(projectId, collection.key, id), { method: 'PATCH', json: { data: { [sKey]: to } } })
      inflight.current.delete(id)
      if (res?.record) setRows((rs) => rs?.map((r) => (r.id === id ? res.record : r)) ?? rs)
    } catch (e) {
      inflight.current.delete(id)
      setRows((rs) => rs?.map((r) => (r.id === id ? { ...r, [sKey]: prev.status, updated_at: prev.updated_at } : r)) ?? rs)
      const msg = e instanceof ApiError ? (e.fieldErrors[sKey] ?? e.message) : 'Network error — the change was reverted.'
      toast({ variant: 'destructive', title: `Couldn't move “${titleOf(collection, row)}” to ${humanize(to)}`, description: msg })
    } finally {
      setPending((p) => {
        const n = new Set(p)
        n.delete(id)
        return n
      })
    }
  }

  const openCreate = (status?: string) => setDrawer({ open: true, record: null, defaults: status ? { [sKey]: status } : undefined })
  const openEdit = (r: RecordRow) => setDrawer({ open: true, record: r })
  const onSaved = (r: RecordRow) => {
    mark(r.id)
    setRows((rs) => (rs ? (rs.some((x) => x.id === r.id) ? rs.map((x) => (x.id === r.id ? r : x)) : [r, ...rs]) : rs))
    setTick((t) => t + 1)
  }
  const onDeleted = (id: string) => {
    setRows((rs) => rs?.filter((x) => x.id !== id) ?? rs)
    setTick((t) => t + 1)
  }

  const truncated = rows && total !== null && total > rows.length

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <ModuleStyles />
      <ModuleHeader collection={collection} count={total} busy={loading && !!rows} onCreate={() => openCreate()}>
        <span className="hidden items-center gap-1.5 text-xs text-muted-foreground lg:inline-flex">
          <GripVertical className="size-3.5" />
          Drag cards to change {statusField.label.toLowerCase()}
        </span>
      </ModuleHeader>

      {truncated && (
        <p className="-mt-1 text-xs text-muted-foreground">
          Showing the {rows!.length.toLocaleString()} most recently updated of {total!.toLocaleString()} {collection.label.toLowerCase()}.
        </p>
      )}

      {error && !rows ? (
        <div className="rounded-xl border bg-card">
          <ErrorState error={error} label={collection.label.toLowerCase()} onRetry={() => setTick((t) => t + 1)} />
        </div>
      ) : (
        <div className="evo-scroll -mx-1 flex items-start gap-3 overflow-x-auto px-1 pb-3" role="list" aria-label={`${collection.label} board`}>
          {columns.map((col) => {
            const isOrphan = col.key === ORPHAN
            const sum = moneyField ? col.rows.reduce((acc, r) => acc + (toNumber(r[moneyField.key]) ?? 0), 0) : 0
            const over = overCol === col.key && !!dragId
            return (
              <section
                key={col.key}
                role="listitem"
                aria-label={isOrphan ? `No ${statusField.label}` : humanize(col.key)}
                onDragOver={(e) => {
                  if (isOrphan || !e.dataTransfer.types.includes(MIME)) return
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                  if (overCol !== col.key) setOverCol(col.key)
                }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOverCol((c) => (c === col.key ? null : c))
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  const id = e.dataTransfer.getData(MIME) || dragId
                  setOverCol(null)
                  setDragId(null)
                  if (id) void move(id, col.key)
                }}
                className={cn(
                  'flex max-h-[calc(100dvh-14rem)] min-h-[14rem] w-[18.5rem] shrink-0 flex-col rounded-xl border bg-muted/25 transition-[background-color,border-color,box-shadow] duration-150',
                  over ? 'border-brand/50 bg-brand/[0.05] shadow-[0_0_0_3px_hsl(var(--brand)/0.12)]' : 'border-border/70',
                  isOrphan && 'border-dashed',
                )}
              >
                <header className="flex items-center justify-between gap-2 px-3 pb-2 pt-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <span data-tone={isOrphan ? 'slate' : toneFor(col.key)} className="evo-tone evo-dot size-2 shrink-0 rounded-full" aria-hidden />
                    <h3 className="truncate text-[13px] font-semibold text-foreground">{isOrphan ? `No ${statusField.label.toLowerCase()}` : humanize(col.key)}</h3>
                    <span className="font-mono text-[11px] tabular text-muted-foreground">{rows ? col.rows.length : '–'}</span>
                  </div>
                  {moneyField && rows && col.rows.length > 0 && (
                    <span data-tone={isOrphan ? 'slate' : toneFor(col.key)} className="evo-tone evo-col-sum rounded-md px-1.5 py-0.5 font-mono text-[11px] tabular text-foreground/80">
                      {formatMoney(sum, currency, { compact: true })}
                    </span>
                  )}
                </header>

                <div className="evo-scroll flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
                  {!rows &&
                    Array.from({ length: 3 - (statusField.options.indexOf(col.key) % 2) }, (_, i) => (
                      <div key={i} className="rounded-lg border bg-card p-3">
                        <Skeleton className="h-3.5 w-3/4 bg-muted" />
                        <Skeleton className="mt-2 h-3 w-1/2 bg-muted/70" />
                        <div className="mt-3 flex justify-between">
                          <Skeleton className="h-3 w-12 bg-muted/70" />
                          <Skeleton className="h-3 w-10 bg-muted/70" />
                        </div>
                      </div>
                    ))}
                  {rows &&
                    col.rows.map((r) => {
                      const dateVal = dateField ? r[dateField.key] : null
                      const when = parseDate(dateVal) ?? parseDate(r.created_at)
                      const usesDate = !!parseDate(dateVal)
                      const sub = subField ? (relationLabels[subField.key]?.[String(r[subField.key])] ?? plainValue(subField, r[subField.key], currency)) : ''
                      const busy = pending.has(r.id)
                      return (
                        <article
                          key={r.id}
                          draggable={!busy}
                          tabIndex={0}
                          role="button"
                          aria-label={`${titleOf(collection, r)} — open`}
                          onDragStart={(e) => {
                            e.dataTransfer.setData(MIME, r.id)
                            e.dataTransfer.setData('text/plain', titleOf(collection, r))
                            e.dataTransfer.effectAllowed = 'move'
                            setDragId(r.id)
                          }}
                          onDragEnd={() => {
                            setDragId(null)
                            setOverCol(null)
                          }}
                          onClick={() => openEdit(r)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault()
                              openEdit(r)
                            }
                          }}
                          className={cn(
                            'group relative cursor-grab select-none rounded-lg border bg-card p-3 text-left shadow-[0_1px_2px_rgba(0,0,0,0.05)] outline-none transition-[border-color,box-shadow,opacity,transform] duration-150 hover:border-foreground/20 hover:shadow-[0_4px_14px_-6px_rgba(0,0,0,0.25)] focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing',
                            dragId === r.id && 'scale-[0.98] opacity-40',
                            busy && 'opacity-70',
                            isFresh(r) && 'evo-card-flash',
                          )}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <p className="line-clamp-2 text-[13px] font-medium leading-snug text-foreground">{titleOf(collection, r)}</p>
                            {busy ? (
                              <LoaderCircle className="mt-0.5 size-3.5 shrink-0 animate-spin text-muted-foreground" />
                            ) : (
                              <GripVertical className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/0 transition-colors group-hover:text-muted-foreground/60" />
                            )}
                          </div>
                          {sub && <p className="mt-1 truncate text-xs text-muted-foreground">{sub}</p>}
                          <div className="mt-2.5 flex items-center justify-between gap-2">
                            {moneyField && toNumber(r[moneyField.key]) !== null ? (
                              <span className="text-[12.5px] font-semibold tabular text-foreground">{formatMoney(r[moneyField.key], currency)}</span>
                            ) : (
                              <span />
                            )}
                            {when && (
                              <span className="inline-flex items-center gap-1 whitespace-nowrap text-[11px] tabular text-muted-foreground" title={when.toLocaleString()}>
                                {usesDate ? <CalendarDays className="size-3" /> : <Clock className="size-3" />}
                                {formatRelative(when, now, usesDate && (dateField?.type === 'date' || isDateOnlyValue(dateVal)))}
                              </span>
                            )}
                          </div>
                        </article>
                      )
                    })}
                  {rows && col.rows.length === 0 && (
                    <div
                      className={cn(
                        'grid min-h-[5.5rem] place-items-center rounded-lg border border-dashed text-xs transition-colors',
                        over ? 'border-brand/50 text-foreground' : 'border-border/70 text-muted-foreground/80',
                      )}
                    >
                      {over ? 'Drop to move here' : `No ${collection.label.toLowerCase()}`}
                    </div>
                  )}
                </div>

                {!isOrphan && (
                  <button
                    type="button"
                    onClick={() => openCreate(col.key)}
                    className="mx-2 mb-2 flex h-8 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-background/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <Plus className="size-3.5" />
                    Add {lowerNoun(collection.singular || 'record')}
                  </button>
                )}
              </section>
            )
          })}
        </div>
      )}

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

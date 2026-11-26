'use client'

/**
 * TableModule — schema-driven list for any collection: debounced search, status chips, click-to-sort
 * columns, pagination, sticky header, skeleton/empty/error states, live-row flash, drawer editing.
 */
import { DateValue, FieldValue } from './field-value'
import { RecordDrawer } from './record-drawer'
import {
  apiFetch,
  currencyOf,
  ErrorState,
  humanize,
  type ListResponse,
  type Loaded,
  lowerNoun,
  ModuleHeader,
  type ModuleProps,
  ModuleStyles,
  recordsUrl,
  statusFieldOf,
  tableFieldsOf,
  toFailed,
  toLoaded,
  toneFor,
  useDebounced,
  useFreshness,
  useRelationLabels,
} from './shared'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import type { Field, RecordRow } from '@/lib/platform/types'
import { cn } from '@/lib/utils'
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronsUpDown, Inbox, Plus, Search, SearchX, X } from 'lucide-react'
import * as React from 'react'

const PAGE = 25
type Sort = { key: string; dir: 'asc' | 'desc' } | null

const NUMERIC = new Set<Field['type']>(['money', 'number'])
const DESC_FIRST = new Set<Field['type']>(['money', 'number', 'date', 'datetime'])

export function TableModule({ projectId, collection, blueprint, refreshKey }: ModuleProps) {
  const currency = React.useMemo(() => currencyOf(blueprint), [blueprint])
  const statusField = statusFieldOf(collection)
  const statusKey = statusField?.key ?? null
  const columns = React.useMemo(() => tableFieldsOf(collection), [collection])
  const relationLabels = useRelationLabels(projectId, blueprint, columns, refreshKey)

  const [q, setQ] = React.useState('')
  const dq = useDebounced(q.trim(), 250)
  const [status, setStatus] = React.useState<string | null>(null)
  const [sort, setSort] = React.useState<Sort>(null)
  const [page, setPage] = React.useState(0)
  const [result, setResult] = React.useState<Loaded | null>(null)
  const [localTick, setLocalTick] = React.useState(0)
  const [drawer, setDrawer] = React.useState<{ open: boolean; record: RecordRow | null }>({ open: false, record: null })
  const { mark, isFresh } = useFreshness()

  // Reset view state when the shell swaps collections on the same instance.
  const [viewKey, setViewKey] = React.useState(`${projectId}/${collection.key}`)
  if (viewKey !== `${projectId}/${collection.key}`) {
    setViewKey(`${projectId}/${collection.key}`)
    setQ('')
    setStatus(null)
    setSort(null)
    setPage(0)
    setResult(null)
  }
  // New search term → back to the first page.
  const [lastQ, setLastQ] = React.useState(dq)
  if (lastQ !== dq) {
    setLastQ(dq)
    setPage(0)
  }

  const reqKey = [projectId, collection.key, statusKey, dq, status, sort?.key, sort?.dir, page, refreshKey, localTick].join('|')
  React.useEffect(() => {
    const ctrl = new AbortController()
    const params = new URLSearchParams({ limit: String(PAGE), offset: String(page * PAGE) })
    if (dq) params.set('q', dq)
    if (status && statusKey) params.set('status', status)
    if (sort) {
      params.set('sort', sort.key)
      params.set('dir', sort.dir)
    }
    apiFetch<ListResponse>(`${recordsUrl(projectId, collection.key)}?${params}`, { signal: ctrl.signal })
      .then((r) => setResult(toLoaded(reqKey, r)))
      .catch((e) => {
        if (!ctrl.signal.aborted) setResult((prev) => toFailed(reqKey, prev, e, 'Something went wrong loading this data.'))
      })
    return () => ctrl.abort()
  }, [reqKey, projectId, collection.key, statusKey, dq, status, sort, page])

  const loading = result?.key !== reqKey
  const data: ListResponse | null = result?.rows ? { rows: result.rows, total: result.total ?? result.rows.length } : null
  const error = result?.error ?? null

  const rows = data?.rows ?? []
  const total = data?.total ?? null
  const filtered = Boolean(dq || status)
  const pageCount = total ? Math.max(1, Math.ceil(total / PAGE)) : 1
  const from = total ? page * PAGE + 1 : 0
  const to = total ? Math.min(total, page * PAGE + rows.length) : 0

  const openCreate = () => setDrawer({ open: true, record: null })
  const openEdit = (r: RecordRow) => setDrawer({ open: true, record: r })
  const toggleSort = (f: Field | 'created_at') => {
    const key = f === 'created_at' ? f : f.key
    const first: 'asc' | 'desc' = f === 'created_at' || DESC_FIRST.has(f.type) ? 'desc' : 'asc'
    setSort((s) => (s?.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: first }))
    setPage(0)
  }
  const clearFilters = () => {
    setQ('')
    setStatus(null)
    setPage(0)
  }

  const onSaved = (r: RecordRow) => {
    mark(r.id)
    setResult((d) => (d?.rows ? { ...d, rows: d.rows.map((x) => (x.id === r.id ? r : x)) } : d))
    setLocalTick((t) => t + 1)
  }
  const onDeleted = (id: string) => {
    setResult((d) => (d?.rows ? { ...d, rows: d.rows.filter((x) => x.id !== id), total: Math.max(0, (d.total ?? 1) - 1) } : d))
    setLocalTick((t) => t + 1)
  }

  const showSkeleton = !data && !error

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <ModuleStyles />
      <ModuleHeader collection={collection} count={total} busy={loading && !!data} onCreate={openCreate} />

      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setQ('')}
            placeholder={`Search ${collection.label.toLowerCase()}…`}
            aria-label={`Search ${collection.label}`}
            className="h-8 bg-card pl-8 pr-8 text-[13px]"
          />
          {q && (
            <button
              type="button"
              onClick={() => setQ('')}
              className="absolute right-1.5 top-1/2 grid size-5 -translate-y-1/2 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="Clear search"
            >
              <X className="size-3" />
            </button>
          )}
        </div>
        {statusField && (
          <div className="evo-scroll -my-1 flex max-w-full items-center gap-1 overflow-x-auto py-1" role="group" aria-label={`Filter by ${statusField.label}`}>
            <FilterChip active={!status} onClick={() => (setStatus(null), setPage(0))}>
              All
            </FilterChip>
            {statusField.options.map((o) => (
              <FilterChip key={o} active={status === o} tone={toneFor(o)} onClick={() => (setStatus((s) => (s === o ? null : o)), setPage(0))}>
                {humanize(o)}
              </FilterChip>
            ))}
          </div>
        )}
      </div>

      {/* table card */}
      <div className="relative overflow-hidden rounded-xl border bg-card shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
        {loading && data && (
          <div className="absolute inset-x-0 top-0 z-30 h-[2px] overflow-hidden" aria-hidden>
            <div className="evo-progress h-full w-1/3 rounded-full bg-brand/70" />
          </div>
        )}
        {error && !data ? (
          <ErrorState error={error} label={collection.label.toLowerCase()} onRetry={() => setLocalTick((t) => t + 1)} />
        ) : (
          <div className="evo-scroll max-h-[calc(100dvh-15rem)] min-h-[12rem] overflow-auto">
            <table className="w-full border-separate border-spacing-0 text-[13px]">
              <thead>
                <tr>
                  {columns.map((f, i) => (
                    <HeaderCell key={f.key} label={f.label} align={NUMERIC.has(f.type) ? 'right' : 'left'} active={sort?.key === f.key ? sort.dir : null} first={i === 0} onClick={() => toggleSort(f)} />
                  ))}
                  <HeaderCell label="Created" align="right" active={sort?.key === 'created_at' ? sort.dir : null} onClick={() => toggleSort('created_at')} last />
                </tr>
              </thead>
              <tbody>
                {showSkeleton &&
                  Array.from({ length: 8 }, (_, r) => (
                    <tr key={r}>
                      {columns.map((f, c) => (
                        <td key={f.key} className={cn('h-11 border-b border-border/60 px-3', c === 0 && 'pl-4')}>
                          <Skeleton className={cn('h-3 bg-muted', NUMERIC.has(f.type) && 'ml-auto')} style={{ width: `${c === 0 ? 55 + ((r * 13) % 30) : 35 + ((r * 7 + c * 11) % 40)}%` }} />
                        </td>
                      ))}
                      <td className="h-11 border-b border-border/60 px-3 pr-4">
                        <Skeleton className="ml-auto h-3 w-12 bg-muted" />
                      </td>
                    </tr>
                  ))}
                {!showSkeleton &&
                  rows.map((r) => (
                    <tr
                      key={r.id}
                      tabIndex={0}
                      onClick={() => openEdit(r)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          openEdit(r)
                        }
                      }}
                      className={cn(
                        'group cursor-pointer outline-none transition-colors hover:bg-muted/45 focus-visible:bg-muted/60',
                        isFresh(r) && 'evo-flash',
                      )}
                    >
                      {columns.map((f, c) => (
                        <td
                          key={f.key}
                          className={cn(
                            'h-11 border-b border-border/60 px-3 align-middle group-last:border-b-0',
                            c === 0 && 'pl-4 font-medium text-foreground',
                            c !== 0 && 'text-foreground/85',
                            NUMERIC.has(f.type) && 'text-right',
                          )}
                        >
                          <div className={cn('max-w-[22rem] truncate', c === 0 && 'max-w-[18rem]')}>
                            <FieldValue field={f} value={r[f.key]} currency={currency} relationLabel={relationLabels[f.key]?.[String(r[f.key])]} />
                          </div>
                        </td>
                      ))}
                      <td className="h-11 whitespace-nowrap border-b border-border/60 px-3 pr-4 text-right text-xs text-muted-foreground group-last:border-b-0">
                        <DateValue value={r.created_at} />
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>

            {!showSkeleton && rows.length === 0 && (
              <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
                <div className="mb-3 grid size-11 place-items-center rounded-xl border bg-muted/40 text-muted-foreground">
                  {filtered ? <SearchX className="size-5" /> : <Inbox className="size-5" />}
                </div>
                <h3 className="text-sm font-semibold text-foreground">
                  {filtered ? 'No matching results' : `No ${collection.label.toLowerCase()} yet`}
                </h3>
                <p className="mt-1 max-w-sm text-[13px] text-muted-foreground">
                  {filtered
                    ? `Nothing matches${dq ? ` “${dq}”` : ''}${status ? ` in ${humanize(status)}` : ''}. Try a different search or filter.`
                    : collection.publicCreate
                      ? `${collection.label} submitted from your website appear here in real time. You can also add one manually.`
                      : `Create your first ${lowerNoun(collection.singular || 'record')} to get started.`}
                </p>
                {filtered ? (
                  <Button variant="outline" size="sm" className="mt-4" onClick={clearFilters}>
                    Clear filters
                  </Button>
                ) : (
                  <Button size="sm" className="mt-4 gap-1.5" onClick={openCreate}>
                    <Plus className="size-3.5" />
                    New {lowerNoun(collection.singular || 'record')}
                  </Button>
                )}
              </div>
            )}
          </div>
        )}

        {/* footer / pagination */}
        {data && rows.length > 0 && (
          <div className="flex h-11 items-center justify-between gap-3 border-t bg-muted/20 px-4 text-xs text-muted-foreground">
            <span className="tabular">
              {from.toLocaleString()}–{to.toLocaleString()} of {(total ?? 0).toLocaleString()}
              {error && <span className="ml-2 text-destructive">· {error.message}</span>}
            </span>
            <div className="flex items-center gap-1">
              <span className="mr-2 tabular">
                Page {page + 1} of {pageCount}
              </span>
              <Button variant="outline" size="icon" className="size-7" disabled={page === 0 || loading} onClick={() => setPage((p) => Math.max(0, p - 1))} aria-label="Previous page">
                <ChevronLeft className="size-3.5" />
              </Button>
              <Button variant="outline" size="icon" className="size-7" disabled={page + 1 >= pageCount || loading} onClick={() => setPage((p) => p + 1)} aria-label="Next page">
                <ChevronRight className="size-3.5" />
              </Button>
            </div>
          </div>
        )}
      </div>

      <RecordDrawer
        projectId={projectId}
        collection={collection}
        blueprint={blueprint}
        record={drawer.record}
        open={drawer.open}
        onClose={() => setDrawer((d) => ({ ...d, open: false }))}
        onSaved={onSaved}
        onDeleted={onDeleted}
      />
    </div>
  )
}

function HeaderCell({
  label,
  align,
  active,
  onClick,
  first,
  last,
}: {
  label: string
  align: 'left' | 'right'
  active: 'asc' | 'desc' | null
  onClick: () => void
  first?: boolean
  last?: boolean
}) {
  const Icon = active === 'asc' ? ArrowUp : active === 'desc' ? ArrowDown : ChevronsUpDown
  return (
    <th
      scope="col"
      aria-sort={active === 'asc' ? 'ascending' : active === 'desc' ? 'descending' : 'none'}
      className={cn(
        'sticky top-0 z-20 h-9 whitespace-nowrap border-b bg-card/95 px-3 font-normal backdrop-blur supports-[backdrop-filter]:bg-card/80',
        first && 'pl-4',
        last && 'pr-4',
        align === 'right' ? 'text-right' : 'text-left',
      )}
    >
      <button
        type="button"
        onClick={onClick}
        className={cn(
          'group/sort inline-flex items-center gap-1 rounded align-middle font-mono text-[10.5px] uppercase tracking-[0.08em] transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
          active ? 'text-foreground' : 'text-muted-foreground',
          align === 'right' && 'flex-row-reverse',
        )}
      >
        {label}
        <Icon className={cn('size-3 transition-opacity', active ? 'opacity-100' : 'opacity-0 group-hover/sort:opacity-60')} />
      </button>
    </th>
  )
}

function FilterChip({ active, tone, onClick, children }: { active: boolean; tone?: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        active
          ? 'evo-chip-active border-foreground/15 bg-foreground text-background'
          : 'border-border bg-card text-muted-foreground hover:border-foreground/20 hover:text-foreground',
      )}
    >
      {tone && <span data-tone={tone} className="evo-tone evo-dot size-1.5 rounded-full" aria-hidden />}
      {children}
    </button>
  )
}

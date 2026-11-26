'use client'

import { PlatformIcon } from './platform-icon'
import type { RealtimeMode } from './use-platform-events'
import type { Blueprint, EventSource, PlatformEvent } from '@/lib/platform/types'
import { cn } from '@/lib/utils'
import {
  Bell,
  Cpu,
  Globe,
  LayoutDashboard,
  Pencil,
  Plus,
  Radio,
  Rocket,
  Settings,
  Trash2,
  Workflow,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

/* ───────────────────────── shared bits ───────────────────────── */
export function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(t)
  }, [intervalMs])
  return now
}

export function timeAgo(ts: string, now = Date.now()) {
  const t = new Date(ts).getTime()
  if (!Number.isFinite(t)) return ''
  const s = Math.max(0, Math.round((now - t) / 1000))
  if (s < 10) return 'just now'
  if (s < 60) return `${s}s ago`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  if (d < 7) return `${d}d ago`
  return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

const SOURCE_META: Record<EventSource, { label: string; icon: LucideIcon; cls: string; dot: string }> = {
  website: {
    label: 'Website',
    icon: Globe,
    cls: 'border-brand-accent/30 bg-brand-accent/10 text-foreground',
    dot: 'bg-brand-accent',
  },
  dashboard: {
    label: 'Dashboard',
    icon: LayoutDashboard,
    cls: 'border-brand/30 bg-brand/10 text-foreground',
    dot: 'bg-brand',
  },
  workflow: {
    label: 'Workflow',
    icon: Workflow,
    cls: 'border-amber-500/30 bg-amber-500/10 text-foreground',
    dot: 'bg-amber-500',
  },
  system: {
    label: 'System',
    icon: Cpu,
    cls: 'border-border bg-muted/60 text-muted-foreground',
    dot: 'bg-muted-foreground',
  },
}

export function SourceBadge({ source, className }: { source: EventSource; className?: string }) {
  const m = SOURCE_META[source] ?? SOURCE_META.system
  const Icon = m.icon
  return (
    <span className={cn('inline-flex h-5 shrink-0 items-center gap-1 rounded-full border px-1.5 text-[10px] font-medium', m.cls, className)}>
      <Icon className="h-3 w-3 opacity-80" aria-hidden />
      {m.label}
    </span>
  )
}

const TYPE_ICON: Record<PlatformEvent['type'], LucideIcon> = {
  'record.created': Plus,
  'record.updated': Pencil,
  'record.deleted': Trash2,
  'workflow.ran': Zap,
  notify: Bell,
  provisioned: Rocket,
  'settings.updated': Settings,
}

const TYPE_LABEL: Record<PlatformEvent['type'], string> = {
  'record.created': 'Created',
  'record.updated': 'Updated',
  'record.deleted': 'Deleted',
  'workflow.ran': 'Automation',
  notify: 'Notification',
  provisioned: 'Provisioned',
  'settings.updated': 'Settings',
}

function dayLabel(ts: string, now: number) {
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return 'Earlier'
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diff = Math.round((start(new Date(now)) - start(d)) / 86_400_000)
  if (diff <= 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
}

/* ───────────────────────── Row ───────────────────────── */
function EventRow({
  e,
  blueprint,
  now,
  fresh,
  onOpenCollection,
  dense,
}: {
  e: PlatformEvent
  blueprint: Blueprint
  now: number
  fresh: boolean
  onOpenCollection?: (collection: string) => void
  dense?: boolean
}) {
  const col = e.collection ? blueprint.collections.find((c) => c.key === e.collection) : undefined
  const TypeIcon = TYPE_ICON[e.type] ?? Radio
  const website = e.source === 'website'
  const recent = now - new Date(e.ts).getTime() < 120_000
  return (
    <li
      className={cn(
        'group relative flex items-start gap-3 rounded-lg px-3 transition-colors hover:bg-muted/40',
        dense ? 'py-2' : 'py-2.5',
        fresh && 'cc-row-in',
        website && recent && 'bg-brand-accent/[0.06] hover:bg-brand-accent/10',
      )}
    >
      {website && recent && <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-brand-accent" aria-hidden />}
      <span
        className={cn(
          'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border bg-card',
          website ? 'border-brand-accent/30 text-brand-accent' : 'border-border text-muted-foreground',
        )}
        aria-hidden
      >
        {col && e.type.startsWith('record.') ? <PlatformIcon name={col.icon} hint={col.key} className="h-3.5 w-3.5" /> : <TypeIcon className="h-3.5 w-3.5" />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <p className="min-w-0 text-[13px] leading-5 text-foreground">{e.summary || TYPE_LABEL[e.type]}</p>
          {website && recent && (
            <span className="inline-flex items-center gap-1 rounded-full bg-brand-accent px-1.5 py-px text-[9px] font-semibold uppercase tracking-wider text-black">
              <span className="h-1 w-1 rounded-full bg-black/70" /> Live from website
            </span>
          )}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
          <SourceBadge source={e.source} />
          <span className="text-muted-foreground/70">{TYPE_LABEL[e.type]}</span>
          {col && (
            <>
              <span aria-hidden className="text-muted-foreground/40">·</span>
              {onOpenCollection ? (
                <button
                  type="button"
                  onClick={() => onOpenCollection(col.key)}
                  className="rounded underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {col.label}
                </button>
              ) : (
                <span>{col.label}</span>
              )}
            </>
          )}
        </div>
      </div>
      <time dateTime={e.ts} title={new Date(e.ts).toLocaleString()} className="shrink-0 pt-0.5 font-mono text-[10.5px] text-muted-foreground tabular">
        {timeAgo(e.ts, now)}
      </time>
    </li>
  )
}

/* ───────────────────────── Compact list (overview) ───────────────────────── */
export function ActivityList({
  events,
  blueprint,
  limit = 8,
  onOpenCollection,
  freshIds,
}: {
  events: PlatformEvent[]
  blueprint: Blueprint
  limit?: number
  onOpenCollection?: (collection: string) => void
  freshIds?: Set<number>
}) {
  const now = useNow()
  const items = useMemo(() => [...events].reverse().slice(0, limit), [events, limit])
  if (!items.length) return <EmptyActivity compact />
  return (
    <ul className="-mx-1 space-y-0.5">
      {items.map((e) => (
        <EventRow key={e.id} e={e} blueprint={blueprint} now={now} fresh={!!freshIds?.has(e.id)} onOpenCollection={onOpenCollection} dense />
      ))}
    </ul>
  )
}

function EmptyActivity({ compact }: { compact?: boolean }) {
  return (
    <div className={cn('flex flex-col items-center justify-center text-center', compact ? 'py-8' : 'py-20')}>
      <div className="relative mb-4 flex h-11 w-11 items-center justify-center rounded-xl border border-border bg-card">
        <Radio className="h-5 w-5 text-muted-foreground" aria-hidden />
        <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-brand-accent">
          <span className="cc-live-ring absolute inset-0 rounded-full bg-brand-accent" />
        </span>
      </div>
      <p className="text-sm font-medium text-foreground">Listening for activity</p>
      <p className="mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">
        Website submissions, edits made here and workflow runs stream into this feed in real time.
      </p>
    </div>
  )
}

/* ───────────────────────── Full feed (activity module) ───────────────────────── */
const FILTERS: ('all' | EventSource)[] = ['all', 'website', 'dashboard', 'workflow', 'system']

export function ActivityFeed({
  events,
  blueprint,
  mode,
  onOpenCollection,
  freshIds,
}: {
  events: PlatformEvent[]
  blueprint: Blueprint
  mode: RealtimeMode
  onOpenCollection?: (collection: string) => void
  freshIds?: Set<number>
}) {
  const now = useNow(15_000)
  const [filter, setFilter] = useState<'all' | EventSource>('all')
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: events.length }
    for (const e of events) c[e.source] = (c[e.source] ?? 0) + 1
    return c
  }, [events])
  const groups = useMemo(() => {
    const list = [...events].reverse().filter((e) => filter === 'all' || e.source === filter)
    const out: { day: string; items: PlatformEvent[] }[] = []
    for (const e of list) {
      const day = dayLabel(e.ts, now)
      const g = out[out.length - 1]
      if (g && g.day === day) g.items.push(e)
      else out.push({ day, items: [e] })
    }
    return out
  }, [events, filter, now])

  return (
    <div className="mx-auto w-full max-w-4xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1 rounded-lg border border-border bg-card p-1" role="tablist" aria-label="Filter by source">
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              role="tab"
              aria-selected={filter === f}
              onClick={() => setFilter(f)}
              className={cn(
                'inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium capitalize transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                filter === f ? 'bg-muted text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {f !== 'all' && <span className={cn('h-1.5 w-1.5 rounded-full', SOURCE_META[f].dot)} aria-hidden />}
              {f === 'all' ? 'All' : SOURCE_META[f].label}
              <span className="font-mono text-[10px] text-muted-foreground tabular">{counts[f] ?? 0}</span>
            </button>
          ))}
        </div>
        <div className="inline-flex items-center gap-2 text-xs text-muted-foreground">
          <span className="relative flex h-2 w-2">
            {mode === 'live' && <span className="cc-live-ring absolute inset-0 rounded-full bg-emerald-500" />}
            <span className={cn('relative h-2 w-2 rounded-full', mode === 'live' ? 'bg-emerald-500' : mode === 'polling' ? 'bg-amber-500' : 'bg-muted-foreground')} />
          </span>
          {mode === 'live' ? 'Streaming live' : mode === 'polling' ? 'Polling every 3s' : mode === 'offline' ? 'Offline — retrying' : 'Connecting…'}
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card">
        {groups.length === 0 ? (
          <EmptyActivity />
        ) : (
          groups.map((g) => (
            <section key={g.day} className="border-b border-border/70 px-2 pb-2 pt-3 last:border-b-0">
              <h3 className="label-caps px-3 pb-1.5">{g.day}</h3>
              <ul className="space-y-0.5">
                {g.items.map((e) => (
                  <EventRow key={e.id} e={e} blueprint={blueprint} now={now} fresh={!!freshIds?.has(e.id)} onOpenCollection={onOpenCollection} />
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    </div>
  )
}

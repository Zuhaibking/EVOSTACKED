'use client'

import { ActivityFeed } from './activity-feed'
import { Analytics } from './analytics'
import { ChartPalette, formatValue, setPlatformCurrency } from './charts'
import { CalendarModule } from './modules/calendar-module'
import { KanbanModule } from './modules/kanban-module'
import { RecordDrawer } from './modules/record-drawer'
import { TableModule } from './modules/table-module'
import { Overview } from './overview'
import { PlatformIcon } from './platform-icon'
import { SettingsPanel } from './settings-panel'
import { usePlatformEvents, type RealtimeMode } from './use-platform-events'
import { WorkflowsPanel } from './workflows-panel'
import type { Blueprint, Collection, Module, PlatformEvent, PlatformMeta, RecordRow } from '@/lib/platform/types'
import { cn } from '@/lib/utils'
import {
  ArrowLeft,
  CircleAlert,
  CircleCheck,
  CornerDownLeft,
  Database,
  Globe,
  PanelLeftClose,
  PanelLeftOpen,
  RotateCw,
  Search,
  X,
  Zap,
} from 'lucide-react'
import Link from 'next/link'
import { Component, useCallback, useEffect, useMemo, useRef, useState, type ErrorInfo, type ReactNode } from 'react'

/* ───────────────────────── helpers ───────────────────────── */
const TYPE_LABEL: Record<string, string> = { saas: 'SaaS', ecommerce: 'E-commerce' }
const typeLabel = (t: string) => TYPE_LABEL[t] ?? t.charAt(0).toUpperCase() + t.slice(1)

function monogram(name: string) {
  const words = name.replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/).filter(Boolean)
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase()
  return (words[0] ?? 'App').slice(0, 2).toUpperCase()
}

const SYSTEM_MODULES: Record<'overview' | 'analytics' | 'activity' | 'workflows' | 'settings', Omit<Module, 'key' | 'kind'>> = {
  overview: { label: 'Overview', icon: 'LayoutDashboard', collection: null, group: 'Overview', description: 'Live pulse of your business' },
  analytics: { label: 'Analytics', icon: 'ChartColumn', collection: null, group: 'Insights', description: 'Every metric and chart, computed from your data' },
  activity: { label: 'Activity', icon: 'Activity', collection: null, group: 'Insights', description: 'Real-time feed from your website, dashboard and workflows' },
  workflows: { label: 'Workflows', icon: 'Workflow', collection: null, group: 'System', description: 'Automations that run on every matching event' },
  settings: { label: 'Settings', icon: 'Settings', collection: null, group: 'System', description: 'Configuration for your backend' },
}

/** Blueprint modules, sanitized; platform modules the generator forgot are appended. */
function resolveModules(bp: Blueprint): Module[] {
  const cols = new Set(bp.collections.map((c) => c.key))
  const seen = new Set<string>()
  const mods = (bp.modules ?? []).filter((m) => {
    if (!m?.key || seen.has(m.key)) return false
    if ((m.kind === 'table' || m.kind === 'kanban' || m.kind === 'calendar') && !(m.collection && cols.has(m.collection))) return false
    seen.add(m.key)
    return true
  })
  const has = (k: Module['kind']) => mods.some((m) => m.kind === k)
  const add = (kind: keyof typeof SYSTEM_MODULES, front = false) => {
    let key = kind as string
    while (seen.has(key)) key = `${key}_`
    seen.add(key)
    const m: Module = { key, kind, ...SYSTEM_MODULES[kind] }
    if (front) mods.unshift(m)
    else mods.push(m)
  }
  if (!has('overview')) add('overview', true)
  if (!mods.some((m) => m.collection)) {
    for (const c of bp.collections) {
      const key = seen.has(c.key) ? `${c.key}_table` : c.key
      seen.add(key)
      mods.push({ key, kind: 'table', collection: c.key, label: c.label, icon: c.icon, group: 'Data', description: c.description })
    }
  }
  if (!has('analytics') && bp.charts.length) add('analytics')
  if (!has('activity')) add('activity')
  if (!has('workflows') && bp.workflows.length) add('workflows')
  if (!has('settings') && bp.settings.length) add('settings')
  return mods
}

function moneyFromPayload(payload: unknown, col?: Collection) {
  if (!col || !payload || typeof payload !== 'object') return null
  const p = payload as Record<string, unknown>
  const rec = (p.record && typeof p.record === 'object' ? p.record : p.data && typeof p.data === 'object' ? p.data : p) as Record<string, unknown>
  const money = col.fields.filter((f) => f.type === 'money')
  const pref = [...money].sort((a, b) => Number(/total|amount|price|value/.test(b.key)) - Number(/total|amount|price|value/.test(a.key)))
  for (const f of pref) {
    const v = Number(rec[f.key])
    if (rec[f.key] !== null && rec[f.key] !== '' && Number.isFinite(v)) return formatValue(v, 'money')
  }
  return null
}

/* ───────────────────────── toasts ───────────────────────── */
type ToastTone = 'website' | 'success' | 'error' | 'info' | 'workflow'
type ShellToast = { id: number; tone: ToastTone; title: string; description?: string; collection?: string; duration: number }
export type NotifyInput = { title: string; description?: string; tone?: 'success' | 'error' | 'info' }

function toastForEvent(e: PlatformEvent, bp: Blueprint): Omit<ShellToast, 'id' | 'duration'> | null {
  const col = e.collection ? bp.collections.find((c) => c.key === e.collection) : undefined
  const noun = (col?.singular ?? 'submission').toLowerCase()
  if (e.source === 'website') {
    if (e.type === 'record.created') {
      const amount = moneyFromPayload(e.payload, col)
      return { tone: 'website', title: `New ${noun} from your website${amount ? ` · ${amount}` : ''}`, description: e.summary, collection: col?.key }
    }
    return { tone: 'website', title: e.summary || `Website updated a ${noun}`, collection: col?.key }
  }
  // Automation runs live in the feed; surface only their human-facing notifications.
  if (e.type === 'notify') return { tone: 'workflow', title: e.summary || 'Notification', description: 'Workflow notification', collection: col?.key }
  return null // dashboard/system events: the actor already sees the change
}

function ToastStack({ toasts, onClose, onOpen }: { toasts: ShellToast[]; onClose: (id: number) => void; onOpen: (collection: string) => void }) {
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[90] flex w-[380px] max-w-[calc(100vw-2rem)] flex-col gap-2" aria-live="polite" role="status">
      {toasts.map((t) => {
        const website = t.tone === 'website'
        const Icon = website ? Globe : t.tone === 'success' ? CircleCheck : t.tone === 'error' ? CircleAlert : Zap
        return (
          <div
            key={t.id}
            className={cn(
              'cc-toast-in pointer-events-auto relative overflow-hidden rounded-xl border bg-popover/95 p-3 pr-9 shadow-2xl shadow-black/40 backdrop-blur-md',
              website ? 'border-brand-accent/40' : t.tone === 'error' ? 'border-red-500/40' : 'border-border',
            )}
          >
            {website && <span className="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-brand-accent to-brand" aria-hidden />}
            <div className="flex gap-3">
              <span
                className={cn(
                  'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
                  website
                    ? 'bg-brand-accent/15 text-brand-accent'
                    : t.tone === 'success'
                      ? 'bg-emerald-500/10 text-emerald-500'
                      : t.tone === 'error'
                        ? 'bg-red-500/10 text-red-500'
                        : 'bg-brand/10 text-brand',
                )}
              >
                <Icon className="h-4 w-4" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                {website && (
                  <div className="mb-0.5 flex items-center gap-1.5">
                    <span className="relative flex h-1.5 w-1.5">
                      <span className="cc-live-ring absolute inset-0 rounded-full bg-brand-accent" />
                      <span className="relative h-1.5 w-1.5 rounded-full bg-brand-accent" />
                    </span>
                    <span className="font-mono text-[9.5px] font-semibold uppercase tracking-[0.14em] text-brand-accent">Live from website</span>
                  </div>
                )}
                <p className="text-[13px] font-medium leading-snug text-foreground">{t.title}</p>
                {t.description && t.description !== t.title && <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{t.description}</p>}
                {t.collection && (
                  <button
                    type="button"
                    onClick={() => {
                      onOpen(t.collection!)
                      onClose(t.id)
                    }}
                    className="mt-1.5 rounded text-xs font-medium text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    View →
                  </button>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => onClose(t.id)}
              aria-label="Dismiss notification"
              className="absolute right-2 top-2 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="h-3.5 w-3.5" />
            </button>
            <span
              className={cn('absolute bottom-0 left-0 h-0.5', website ? 'bg-brand-accent/70' : 'bg-foreground/15')}
              style={{ animation: `cc-shrink ${t.duration}ms linear both` }}
              aria-hidden
            />
          </div>
        )
      })}
      <style>{'@keyframes cc-shrink{from{width:100%}to{width:0}}'}</style>
    </div>
  )
}

/* ───────────────────────── error boundary for generated modules ───────────────────────── */
class ModuleBoundary extends Component<{ children: ReactNode; label: string }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[control-center] module crashed', error, info.componentStack)
  }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="mx-auto flex max-w-md flex-col items-center py-24 text-center">
        <span className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl border border-red-500/30 bg-red-500/10 text-red-500">
          <CircleAlert className="h-5 w-5" />
        </span>
        <p className="text-sm font-medium">{this.props.label} couldn’t render</p>
        <p className="mt-1 max-w-sm text-xs text-muted-foreground">{this.state.error.message}</p>
        <button
          type="button"
          onClick={() => this.setState({ error: null })}
          className="mt-4 inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-xs font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <RotateCw className="h-3.5 w-3.5" /> Try again
        </button>
      </div>
    )
  }
}

/* ───────────────────────── live / env pills ───────────────────────── */
function LivePill({ mode, ticker }: { mode: RealtimeMode; ticker: string | null }) {
  const live = mode === 'live'
  const label = live ? 'Live' : mode === 'polling' ? 'Polling' : mode === 'offline' ? 'Offline' : 'Connecting'
  return (
    <span
      className={cn(
        'inline-flex h-7 max-w-[260px] items-center gap-2 rounded-full border px-2.5 text-[11px] font-medium transition-all duration-300',
        ticker ? 'border-brand-accent/40 bg-brand-accent/10 text-foreground' : 'border-border bg-card text-foreground',
      )}
      title={live ? 'Realtime stream connected (SSE)' : mode === 'polling' ? 'Stream unavailable — polling every 3 s' : 'Reconnecting to realtime stream'}
    >
      <span className="relative flex h-2 w-2 shrink-0">
        {live && <span className={cn('cc-live-ring absolute inset-0 rounded-full', ticker ? 'bg-brand-accent' : 'bg-emerald-500')} />}
        <span
          className={cn(
            'relative h-2 w-2 rounded-full',
            ticker ? 'bg-brand-accent' : live ? 'bg-emerald-500' : mode === 'polling' ? 'bg-amber-500' : mode === 'offline' ? 'bg-red-500' : 'bg-muted-foreground animate-pulse',
          )}
        />
      </span>
      <span className="truncate">{ticker ?? label}</span>
    </span>
  )
}

/* ───────────────────────── command palette ───────────────────────── */
function CommandPalette({ open, onClose, modules, onPick, counts }: { open: boolean; onClose: () => void; modules: Module[]; onPick: (key: string) => void; counts: Record<string, number> }) {
  const [q, setQ] = useState('')
  const [idx, setIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const list = useMemo(() => {
    const s = q.trim().toLowerCase()
    return s ? modules.filter((m) => `${m.label} ${m.group} ${m.description} ${m.kind}`.toLowerCase().includes(s)) : modules
  }, [q, modules])
  useEffect(() => {
    if (open) {
      setQ('')
      setIdx(0)
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])
  if (!open) return null
  const pick = (m?: Module) => {
    if (!m) return
    onPick(m.key)
    onClose()
  }
  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center bg-black/50 px-4 pt-[14vh] backdrop-blur-sm" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Jump to module"
        className="cc-toast-in w-full max-w-lg overflow-hidden rounded-xl border border-border bg-popover shadow-2xl shadow-black/50"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border px-3">
          <Search className="h-4 w-4 text-muted-foreground" aria-hidden />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              setIdx(0)
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setIdx((i) => Math.min(list.length - 1, i + 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setIdx((i) => Math.max(0, i - 1))
              } else if (e.key === 'Enter') {
                e.preventDefault()
                pick(list[idx])
              } else if (e.key === 'Escape') onClose()
            }}
            placeholder="Jump to a module…"
            className="h-12 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:outline-none"
            aria-label="Search modules"
          />
          <kbd className="rounded border border-border px-1.5 font-mono text-[10px] text-muted-foreground">ESC</kbd>
        </div>
        <ul className="cc-scroll max-h-80 overflow-y-auto p-1.5" role="listbox">
          {list.length === 0 && <li className="px-3 py-6 text-center text-xs text-muted-foreground">No modules match “{q}”</li>}
          {list.map((m, i) => (
            <li key={m.key} role="option" aria-selected={i === idx}>
              <button
                type="button"
                onMouseEnter={() => setIdx(i)}
                onClick={() => pick(m)}
                className={cn('flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left', i === idx ? 'bg-muted text-foreground' : 'text-muted-foreground')}
              >
                <PlatformIcon name={m.icon} hint={`${m.key} ${m.kind}`} className="h-4 w-4 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] text-foreground">{m.label}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">{m.description || m.group}</span>
                </span>
                {m.collection && counts[m.collection] !== undefined && <span className="font-mono text-[10px] tabular">{counts[m.collection]}</span>}
                {i === idx && <CornerDownLeft className="h-3.5 w-3.5" aria-hidden />}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

/* ───────────────────────── Control Center ───────────────────────── */
export function ControlCenter({ meta, counts: initialCounts }: { meta: PlatformMeta; counts: Record<string, number> }) {
  const projectId = meta.projectId
  const blueprint = useMemo<Blueprint>(() => {
    const b = meta.blueprint
    return {
      ...b,
      collections: b?.collections ?? [],
      modules: b?.modules ?? [],
      metrics: b?.metrics ?? [],
      charts: b?.charts ?? [],
      workflows: b?.workflows ?? [],
      settings: b?.settings ?? [],
    }
  }, [meta.blueprint])
  setPlatformCurrency(blueprint.settings.find((s) => /currency/i.test(s.key))?.value)
  const appName = meta.appName || blueprint.appName || 'Your app'

  const modules = useMemo(() => resolveModules(blueprint), [blueprint])
  const groups = useMemo(() => {
    const out: { name: string; items: Module[] }[] = []
    for (const m of modules) {
      const name = m.group?.trim() || 'General'
      const g = out.find((x) => x.name === name)
      if (g) g.items.push(m)
      else out.push({ name, items: [m] })
    }
    return out
  }, [modules])

  const [activeKey, setActiveKey] = useState(() => modules[0]?.key ?? 'overview')
  const [collapsed, setCollapsed] = useState(false)
  const [counts, setCounts] = useState(initialCounts)
  const [refreshKeys, setRefreshKeys] = useState<Record<string, number>>({})
  const [tick, setTick] = useState(0)
  const [flash, setFlash] = useState<Record<string, number>>({})
  const [toasts, setToasts] = useState<ShellToast[]>([])
  const [freshIds, setFreshIds] = useState<Set<number>>(() => new Set())
  const [ticker, setTicker] = useState<string | null>(null)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [createFor, setCreateFor] = useState<string | null>(null)
  const [drawerKey, setDrawerKey] = useState<string | null>(null) // stays set while the drawer animates out
  const toastSeq = useRef(0)
  const countsTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tickerTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastWebsiteToast = useRef(0)

  // Hash routing (#orders) so refresh / share keeps the module.
  useEffect(() => {
    const fromHash = decodeURIComponent(window.location.hash.slice(1))
    if (fromHash && modules.some((m) => m.key === fromHash)) setActiveKey(fromHash)
  }, [modules])
  const go = useCallback((key: string) => {
    setActiveKey(key)
    try {
      window.history.replaceState(null, '', `#${encodeURIComponent(key)}`)
    } catch {
      /* ignore */
    }
  }, [])
  const openCollection = useCallback(
    (collection: string) => {
      const m = modules.find((x) => x.collection === collection && x.kind === 'table') ?? modules.find((x) => x.collection === collection)
      if (m) go(m.key)
    },
    [modules, go],
  )
  const openKind = useCallback(
    (kind: Module['kind']) => {
      const m = modules.find((x) => x.kind === kind)
      if (m) go(m.key)
    },
    [modules, go],
  )

  const dismiss = useCallback((id: number) => setToasts((ts) => ts.filter((t) => t.id !== id)), [])
  const pushToast = useCallback(
    (t: Omit<ShellToast, 'id' | 'duration'>) => {
      const id = ++toastSeq.current
      const duration = t.tone === 'website' ? 7000 : t.tone === 'error' ? 6500 : 4200
      setToasts((ts) => [...ts, { ...t, id, duration }].slice(-4))
      setTimeout(() => dismiss(id), duration)
    },
    [dismiss],
  )
  const notify = useCallback((t: NotifyInput) => pushToast({ tone: t.tone ?? 'info', title: t.title, description: t.description }), [pushToast])

  const refreshCounts = useCallback(() => {
    if (countsTimer.current) clearTimeout(countsTimer.current)
    countsTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/p/${encodeURIComponent(projectId)}`, { cache: 'no-store' })
        if (!res.ok) return
        const body = (await res.json()) as { counts?: Record<string, number> }
        if (body.counts) setCounts(body.counts)
      } catch {
        /* keep last known counts */
      }
    }, 500)
  }, [projectId])

  const bump = useCallback(
    (collection: string | null) => {
      if (collection) setRefreshKeys((r) => ({ ...r, [collection]: (r[collection] ?? 0) + 1 }))
      setTick((t) => t + 1)
      refreshCounts()
    },
    [refreshCounts],
  )

  const onEvent = useCallback(
    (e: PlatformEvent) => {
      setFreshIds((s) => new Set(s).add(e.id))
      if (e.type.startsWith('record.') || e.type === 'workflow.ran') bump(e.collection)
      if (e.collection) {
        const now = Date.now()
        const keys = modules.filter((m) => m.collection === e.collection).map((m) => m.key)
        if (keys.length) setFlash((f) => ({ ...f, ...Object.fromEntries(keys.map((k) => [k, now])) }))
      }
      const t = toastForEvent(e, blueprint)
      // A website order already toasted; its follow-up workflow notification would just repeat it.
      if (t && !(t.tone !== 'website' && Date.now() - lastWebsiteToast.current < 6000)) {
        if (t.tone === 'website') lastWebsiteToast.current = Date.now()
        pushToast(t)
      }
      if (e.source === 'website' && e.type === 'record.created') {
        const col = blueprint.collections.find((c) => c.key === e.collection)
        setTicker(`New ${(col?.singular ?? 'submission').toLowerCase()} · website`)
        if (tickerTimer.current) clearTimeout(tickerTimer.current)
        tickerTimer.current = setTimeout(() => setTicker(null), 5000)
      }
    },
    [blueprint, modules, bump, pushToast],
  )

  const { mode, events } = usePlatformEvents(projectId, { onEvent })

  // ⌘K / Ctrl+K command palette
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((o) => !o)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(
    () => () => {
      if (countsTimer.current) clearTimeout(countsTimer.current)
      if (tickerTimer.current) clearTimeout(tickerTimer.current)
    },
    [],
  )

  const active = modules.find((m) => m.key === activeKey) ?? modules[0]
  const activeCol = active?.collection ? blueprint.collections.find((c) => c.key === active.collection) : undefined
  const createCol = drawerKey ? blueprint.collections.find((c) => c.key === drawerKey) : undefined
  const quickCreate = useCallback((key: string) => {
    setDrawerKey(key)
    setCreateFor(key)
  }, [])
  const env = process.env.NODE_ENV === 'production' ? 'Production' : 'Development'

  const vis = {
    block: collapsed ? 'hidden' : 'hidden lg:block',
    flex: collapsed ? 'hidden' : 'hidden lg:flex',
    inline: collapsed ? 'hidden' : 'hidden lg:inline-flex',
  }

  const renderModule = () => {
    if (!active) return null
    const rk = (c: string) => refreshKeys[c] ?? 0
    switch (active.kind) {
      case 'overview':
        return (
          <Overview
            projectId={projectId}
            blueprint={blueprint}
            counts={counts}
            events={events}
            freshIds={freshIds}
            refreshKey={tick}
            onOpenCollection={openCollection}
            onOpenModule={openKind}
            onQuickCreate={quickCreate}
            notify={notify}
          />
        )
      case 'table':
      case 'kanban':
      case 'calendar': {
        if (!activeCol) return null
        const props = { projectId, collection: activeCol, blueprint, refreshKey: rk(activeCol.key) }
        if (active.kind === 'kanban' && activeCol.statusField) return <KanbanModule {...props} />
        if (active.kind === 'calendar' && activeCol.dateField) return <CalendarModule {...props} />
        return <TableModule {...props} />
      }
      case 'analytics':
        return <Analytics projectId={projectId} blueprint={blueprint} counts={counts} refreshKey={tick} />
      case 'activity':
        return <ActivityFeed events={events} blueprint={blueprint} mode={mode} onOpenCollection={openCollection} freshIds={freshIds} />
      case 'workflows':
        return <WorkflowsPanel projectId={projectId} blueprint={blueprint} events={events} notify={notify} />
      case 'settings':
        return <SettingsPanel projectId={projectId} blueprint={blueprint} notify={notify} />
      default:
        return null
    }
  }

  return (
    <div className="cc-root flex h-dvh w-full overflow-hidden bg-background text-foreground">
      <ChartPalette />

      {/* ───────── Sidebar ───────── */}
      <aside
        className={cn(
          'relative z-20 flex h-full shrink-0 flex-col border-r border-border bg-card/50 transition-[width] duration-200 ease-out',
          collapsed ? 'w-[60px]' : 'w-[60px] lg:w-[252px]',
        )}
        aria-label="Control Center navigation"
      >
        <div className={cn('flex h-14 shrink-0 items-center gap-2.5 border-b border-border px-3', collapsed ? 'justify-center' : 'justify-center lg:justify-start')}>
          <div
            className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[linear-gradient(140deg,hsl(var(--brand)),hsl(var(--brand)/0.55))] text-[12px] font-semibold tracking-tight text-white shadow-[inset_0_1px_0_rgba(255,255,255,.25),0_6px_16px_-6px_hsl(var(--brand)/.7)]"
            aria-hidden
          >
            {monogram(appName)}
            {mode === 'live' && <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-card bg-emerald-500" />}
          </div>
          <div className={cn('min-w-0 flex-1', vis.block)}>
            <div className="flex items-center gap-1.5">
              <span className="truncate text-[13px] font-semibold leading-tight text-foreground" title={appName}>
                {appName}
              </span>
              <span className="shrink-0 rounded border border-border bg-background/60 px-1 py-px text-[9.5px] font-medium leading-tight text-muted-foreground">
                {typeLabel(meta.projectType || blueprint.projectType)}
              </span>
            </div>
            <div className="mt-0.5 flex items-center gap-1 text-[10.5px] text-muted-foreground">
              <Database className="h-3 w-3 shrink-0" aria-hidden />
              <span className="truncate">Isolated database · SQLite</span>
            </div>
          </div>
        </div>

        <nav className="cc-scroll flex-1 overflow-y-auto overflow-x-hidden px-2 py-3">
          {groups.map((g, gi) => (
            <div key={g.name} className={cn(gi > 0 && 'mt-4')}>
              <div className={cn('px-2 pb-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground/80', vis.block)}>{g.name}</div>
              {gi > 0 && <div className={cn('mx-2 mb-2 h-px bg-border', collapsed ? 'block' : 'lg:hidden')} aria-hidden />}
              <ul className="space-y-px">
                {g.items.map((m) => {
                  const isActive = m.key === active?.key
                  const count = m.collection ? counts[m.collection] : undefined
                  const flashTs = flash[m.key]
                  return (
                    <li key={m.key}>
                      <button
                        type="button"
                        onClick={() => go(m.key)}
                        aria-current={isActive ? 'page' : undefined}
                        title={m.label}
                        className={cn(
                          'group relative flex h-8 w-full items-center gap-2.5 overflow-hidden rounded-md px-2 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                          collapsed ? 'justify-center' : 'justify-center lg:justify-start',
                          isActive ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
                        )}
                      >
                        {flashTs && <span key={flashTs} className="cc-flash pointer-events-none absolute inset-0 rounded-md" aria-hidden />}
                        {isActive && <span className="absolute inset-y-1.5 left-0 w-[3px] rounded-r bg-brand" aria-hidden />}
                        <PlatformIcon name={m.icon} hint={`${m.key} ${m.collection ?? m.kind}`} className={cn('relative h-4 w-4 shrink-0', isActive && 'text-brand')} />
                        <span className={cn('relative min-w-0 flex-1 truncate text-left', vis.block)}>{m.label}</span>
                        {count !== undefined && (
                          <span
                            className={cn(
                              'relative h-[18px] items-center rounded px-1.5 font-mono text-[10px] tabular',
                              vis.inline,
                              isActive ? 'bg-background text-foreground' : 'bg-muted/70 text-muted-foreground',
                            )}
                          >
                            {count.toLocaleString()}
                          </span>
                        )}
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="shrink-0 space-y-1 border-t border-border p-2">
          <Link
            href={`/app/${encodeURIComponent(projectId)}`}
            title="Back to builder"
            className={cn(
              'flex h-8 items-center gap-2.5 rounded-md px-2 text-[13px] text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              collapsed ? 'justify-center' : 'justify-center lg:justify-start',
            )}
          >
            <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden />
            <span className={vis.block}>Back to builder</span>
          </Link>
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            className="hidden h-8 w-full items-center gap-2.5 rounded-md px-2 text-[13px] text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:flex"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <PanelLeftOpen className="mx-auto h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
            {!collapsed && <span>Collapse</span>}
          </button>
        </div>
      </aside>

      {/* ───────── Main ───────── */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-background/80 px-4 backdrop-blur sm:px-6">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-card text-foreground">
              <PlatformIcon name={active?.icon} hint={`${active?.key} ${active?.collection ?? active?.kind}`} className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <h1 className="truncate text-sm font-semibold leading-tight text-foreground">{active?.label ?? 'Control Center'}</h1>
              <p className="hidden truncate text-xs leading-tight text-muted-foreground md:block">
                {active?.description || activeCol?.description || `${appName} Control Center`}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="hidden h-8 w-56 items-center gap-2 rounded-lg border border-border bg-card/60 px-2.5 text-xs text-muted-foreground transition-colors hover:border-foreground/20 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring xl:flex 2xl:w-72"
          >
            <Search className="h-3.5 w-3.5" aria-hidden />
            <span className="flex-1 truncate text-left">Search {appName}…</span>
            <kbd className="rounded border border-border bg-background px-1 font-mono text-[10px]">⌘K</kbd>
          </button>
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            aria-label="Search"
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-card/60 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring xl:hidden"
          >
            <Search className="h-3.5 w-3.5" />
          </button>

          <LivePill mode={mode} ticker={ticker} />
          <span
            className="hidden h-7 items-center gap-1.5 rounded-full border border-border px-2.5 font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground md:inline-flex"
            title={`Environment: ${env}`}
          >
            <span className={cn('h-1.5 w-1.5 rounded-full', env === 'Production' ? 'bg-emerald-500' : 'bg-amber-500')} />
            {env}
          </span>
          <Link
            href={`/app/${encodeURIComponent(projectId)}`}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
            <span className="hidden sm:inline">Back to builder</span>
          </Link>
        </header>

        <main className="cc-scroll relative flex-1 overflow-y-auto">
          <div key={active?.key} className="cc-fade px-4 py-5 sm:px-6 lg:px-8 lg:py-6">
            {active ? <ModuleBoundary label={active.label}>{renderModule()}</ModuleBoundary> : null}
          </div>
        </main>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} modules={modules} onPick={go} counts={counts} />
      <ToastStack toasts={toasts} onClose={dismiss} onOpen={openCollection} />

      {createCol && (
        <RecordDrawer
          projectId={projectId}
          collection={createCol}
          blueprint={blueprint}
          record={null}
          open={!!createFor}
          onClose={() => setCreateFor(null)}
          onSaved={(r: RecordRow) => {
            setCreateFor(null)
            const title = r?.[createCol.titleField]
            notify({ tone: 'success', title: `${createCol.singular} created`, description: typeof title === 'string' && title ? title : undefined })
            bump(createCol.key)
          }}
        />
      )}
    </div>
  )
}

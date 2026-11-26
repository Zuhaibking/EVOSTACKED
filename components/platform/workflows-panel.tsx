'use client'

import { timeAgo, useNow } from './activity-feed'
import { PlatformIcon } from './platform-icon'
import { Switch } from '@/components/ui/switch'
import type { Blueprint, PlatformEvent, Workflow } from '@/lib/platform/types'
import { cn } from '@/lib/utils'
import { ArrowRight, Bell, CirclePlus, Hash, PencilLine, Workflow as WorkflowIcon, Zap, type LucideIcon } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'

type Notify = (t: { title: string; description?: string; tone?: 'success' | 'error' | 'info' }) => void

const ACTION_META: Record<Workflow['actions'][number]['type'], { label: string; icon: LucideIcon }> = {
  set_field: { label: 'Update field', icon: PencilLine },
  create_record: { label: 'Create record', icon: CirclePlus },
  notify: { label: 'Notify', icon: Bell },
  adjust_number: { label: 'Adjust number', icon: Hash },
}

function useDescribers(blueprint: Blueprint) {
  return useMemo(() => {
    const col = (key: string | null | undefined) => blueprint.collections.find((c) => c.key === key)
    const fieldLabel = (colKey: string | null | undefined, fieldKey: string | null | undefined) =>
      col(colKey)?.fields.find((f) => f.key === fieldKey)?.label ?? (fieldKey ? fieldKey.replace(/_/g, ' ') : 'a field')
    const trigger = (w: Workflow) => {
      const c = col(w.trigger.collection)
      const noun = (c?.singular ?? w.trigger.collection).toLowerCase()
      const article = /^[aeiou]/.test(noun) ? 'an' : 'a'
      if (w.trigger.event === 'created') return `When ${article} ${noun} is created`
      if (w.trigger.event === 'status_changed') return w.trigger.toStatus ? `When ${article} ${noun} moves to “${w.trigger.toStatus}”` : `When ${article} ${noun} changes status`
      return `When ${article} ${noun} is updated`
    }
    const action = (w: Workflow, a: Workflow['actions'][number]) => {
      const target = a.collection ?? w.trigger.collection
      const c = col(target)
      switch (a.type) {
        case 'set_field':
          return `Set ${fieldLabel(target, a.field)} to “${a.value ?? ''}”`
        case 'create_record':
          return `Create ${c ? `a ${c.singular.toLowerCase()}` : 'a record'}${a.message ? ` — ${a.message}` : ''}`
        case 'notify':
          return a.message ? renderTemplate(a.message, col(w.trigger.collection)?.fields ?? []) : 'Notify the team'
        case 'adjust_number': {
          const v = String(a.value ?? '')
          const signed = /^[+-]/.test(v) ? v : v ? `+${v}` : 'a value'
          return `Adjust ${c?.label ?? target} · ${fieldLabel(target, a.field)} by ${signed}`
        }
        default:
          return 'Run action'
      }
    }
    return { col, trigger, action }
  }, [blueprint])
}

/** "New order from {{customer_name}}" → text with field-label chips for the template tokens. */
function renderTemplate(message: string, fields: Blueprint['collections'][number]['fields']): ReactNode {
  const parts = message.split(/(\{\{\s*[\w.]+\s*\}\})/g).filter(Boolean)
  return (
    <>
      {parts.map((part, i) => {
        const m = part.match(/^\{\{\s*([\w.]+)\s*\}\}$/)
        if (!m) return <span key={i}>{part}</span>
        const label = fields.find((f) => f.key === m[1])?.label ?? m[1].replace(/_/g, ' ')
        return (
          <span key={i} className="mx-0.5 inline-flex items-center rounded border border-brand/25 bg-brand/10 px-1 py-px align-baseline font-mono text-[11px] leading-tight text-foreground">
            {label}
          </span>
        )
      })}
    </>
  )
}

function runsFor(w: Workflow, events: PlatformEvent[]) {
  const runs = events.filter((e) => {
    if (e.type !== 'workflow.ran') return false
    const p = (e.payload ?? {}) as Record<string, unknown>
    return p.key === w.key || p.workflow === w.key || p.workflowKey === w.key || (typeof e.summary === 'string' && e.summary.includes(w.name))
  })
  return { count: runs.length, last: runs[runs.length - 1] }
}

function Node({ kind, icon: Icon, title, children, accent }: { kind: string; icon: LucideIcon; title: ReactNode; children?: ReactNode; accent?: boolean }) {
  return (
    <div
      className={cn(
        'relative min-w-0 flex-1 rounded-lg border bg-background/50 px-3 py-2.5',
        accent ? 'border-brand/40 shadow-[0_0_0_3px_hsl(var(--brand)/0.08)]' : 'border-border',
      )}
    >
      <div className="flex items-center gap-1.5">
        <Icon className={cn('h-3.5 w-3.5', accent ? 'text-brand' : 'text-muted-foreground')} aria-hidden />
        <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">{kind}</span>
      </div>
      <p className="mt-1 text-[13px] leading-snug text-foreground">{title}</p>
      {children}
    </div>
  )
}

export function WorkflowsPanel({ projectId, blueprint, events, notify }: { projectId: string; blueprint: Blueprint; events: PlatformEvent[]; notify: Notify }) {
  const [workflows, setWorkflows] = useState<Workflow[]>(blueprint.workflows)
  const [pending, setPending] = useState<string | null>(null)
  const d = useDescribers(blueprint)
  const now = useNow()
  const active = workflows.filter((w) => w.enabled).length

  const toggle = async (w: Workflow, enabled: boolean) => {
    const prev = workflows
    setPending(w.key)
    setWorkflows((ws) => ws.map((x) => (x.key === w.key ? { ...x, enabled } : x)))
    try {
      const res = await fetch(`/api/p/${encodeURIComponent(projectId)}/workflows`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key: w.key, enabled }),
      })
      if (!res.ok) throw new Error(`Request failed (${res.status})`)
      const body = (await res.json().catch(() => ({}))) as { workflows?: Workflow[] }
      if (Array.isArray(body.workflows)) setWorkflows(body.workflows)
      notify({ tone: 'success', title: enabled ? `“${w.name}” is active` : `“${w.name}” paused`, description: enabled ? 'It will run on the next matching event.' : 'No actions will run until you turn it back on.' })
    } catch (e) {
      setWorkflows(prev)
      notify({ tone: 'error', title: 'Couldn’t update workflow', description: e instanceof Error ? e.message : undefined })
    } finally {
      setPending(null)
    }
  }

  if (!workflows.length) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center py-24 text-center">
        <span className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl border border-border bg-card">
          <WorkflowIcon className="h-5 w-5 text-muted-foreground" />
        </span>
        <p className="text-sm font-medium">No automations yet</p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">This blueprint didn’t define workflows. Re-provision the backend to generate automations for your app.</p>
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand/10 text-brand">
            <Zap className="h-4 w-4" aria-hidden />
          </span>
          <div>
            <p className="text-sm font-medium text-foreground">
              {active} of {workflows.length} automations active
            </p>
            <p className="text-xs text-muted-foreground">Run server-side on every matching record event — website, dashboard or other workflows.</p>
          </div>
        </div>
      </div>

      <ul className="space-y-3">
        {workflows.map((w) => {
          const c = d.col(w.trigger.collection)
          const { count, last } = runsFor(w, events)
          return (
            <li key={w.key} className={cn('rounded-xl border border-border bg-card transition-opacity', !w.enabled && 'opacity-70')}>
              <div className="flex items-start justify-between gap-4 border-b border-border/70 px-4 py-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="truncate text-sm font-medium text-foreground">{w.name}</h3>
                    <span
                      className={cn(
                        'inline-flex h-5 items-center gap-1 rounded-full px-1.5 text-[10px] font-medium',
                        w.enabled ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-muted text-muted-foreground',
                      )}
                    >
                      <span className={cn('h-1.5 w-1.5 rounded-full', w.enabled ? 'bg-emerald-500' : 'bg-muted-foreground')} />
                      {w.enabled ? 'Active' : 'Paused'}
                    </span>
                  </div>
                  {w.description && <p className="mt-0.5 text-xs text-muted-foreground">{w.description}</p>}
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="hidden text-right text-[11px] text-muted-foreground sm:block">
                    {count > 0 ? (
                      <>
                        <span className="tabular text-foreground">{count}</span> run{count === 1 ? '' : 's'} · last {timeAgo(last!.ts, now)}
                      </>
                    ) : (
                      'No runs yet'
                    )}
                  </span>
                  <Switch
                    checked={w.enabled}
                    disabled={pending === w.key}
                    onCheckedChange={(v) => toggle(w, v)}
                    aria-label={`${w.enabled ? 'Pause' : 'Activate'} ${w.name}`}
                    className="data-[state=checked]:bg-emerald-500"
                  />
                </div>
              </div>
              <div className="flex flex-col items-stretch gap-2 p-4 md:flex-row md:items-center">
                <Node kind="Trigger" icon={Zap} title={d.trigger(w)} accent>
                  {c && (
                    <span className="mt-1.5 inline-flex items-center gap-1 rounded border border-border bg-card px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      <PlatformIcon name={c.icon} hint={c.key} className="h-3 w-3" /> {c.label}
                    </span>
                  )}
                </Node>
                {w.actions.map((a, i) => {
                  const meta = ACTION_META[a.type] ?? ACTION_META.notify
                  return (
                    <div key={i} className="flex min-w-0 flex-1 flex-col items-stretch gap-2 md:flex-row md:items-center">
                      <ArrowRight className="mx-auto h-4 w-4 shrink-0 rotate-90 text-muted-foreground/60 md:mx-0 md:rotate-0" aria-hidden />
                      <Node kind={`Then · ${meta.label}`} icon={meta.icon} title={d.action(w, a)} />
                    </div>
                  )
                })}
                {w.actions.length === 0 && (
                  <>
                    <ArrowRight className="mx-auto h-4 w-4 shrink-0 rotate-90 text-muted-foreground/60 md:mx-0 md:rotate-0" aria-hidden />
                    <Node kind="Then" icon={Bell} title="Log to activity feed" />
                  </>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

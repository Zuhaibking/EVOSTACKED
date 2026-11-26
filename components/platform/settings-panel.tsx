'use client'

import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import type { Blueprint, Setting } from '@/lib/platform/types'
import { cn } from '@/lib/utils'
import { Loader2, Settings2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'

type Notify = (t: { title: string; description?: string; tone?: 'success' | 'error' | 'info' }) => void

function FieldControl({ s, value, onChange }: { s: Setting; value: string; onChange: (v: string) => void }) {
  const id = `setting-${s.key}`
  if (s.type === 'boolean') {
    return <Switch id={id} checked={value === 'true'} onCheckedChange={(v) => onChange(v ? 'true' : 'false')} aria-label={s.label} />
  }
  if (s.type === 'select') {
    return (
      <Select value={value || undefined} onValueChange={onChange}>
        <SelectTrigger id={id} className="h-9 w-full sm:w-64" aria-label={s.label}>
          <SelectValue placeholder="Choose…" />
        </SelectTrigger>
        <SelectContent>
          {(s.options.length ? s.options : [value]).filter(Boolean).map((o) => (
            <SelectItem key={o} value={o}>
              {o}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }
  if (s.type === 'money') {
    return (
      <div className="relative w-full sm:w-64">
        <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted-foreground">$</span>
        <Input id={id} inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} className="h-9 pl-7 tabular" />
      </div>
    )
  }
  return (
    <Input
      id={id}
      type={s.type === 'number' ? 'number' : 'text'}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn('h-9 w-full', s.type === 'number' ? 'sm:w-40 tabular' : 'sm:w-80')}
    />
  )
}

export function SettingsPanel({ projectId, blueprint, notify }: { projectId: string; blueprint: Blueprint; notify: Notify }) {
  const [saved, setSaved] = useState<Setting[] | null>(null)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let alive = true
    fetch(`/api/p/${encodeURIComponent(projectId)}/settings`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((b: { settings?: Setting[] }) => {
        if (alive) setSaved(Array.isArray(b.settings) ? b.settings : blueprint.settings)
      })
      .catch(() => {
        if (alive) setSaved(blueprint.settings)
      })
    return () => {
      alive = false
    }
  }, [projectId, blueprint.settings])

  const dirtyKeys = useMemo(() => (saved ?? []).filter((s) => draft[s.key] !== undefined && draft[s.key] !== s.value).map((s) => s.key), [saved, draft])
  const dirty = dirtyKeys.length > 0

  const groups = useMemo(() => {
    const out: { group: string; items: Setting[] }[] = []
    for (const s of saved ?? []) {
      const g = s.group?.trim() || 'General'
      const found = out.find((x) => x.group === g)
      if (found) found.items.push(s)
      else out.push({ group: g, items: [s] })
    }
    return out
  }, [saved])

  const save = useCallback(async () => {
    if (!saved || !dirty || saving) return
    const next = saved.map((s) => (draft[s.key] !== undefined ? { ...s, value: draft[s.key] } : s))
    const bad = next.find((s) => (s.type === 'number' || s.type === 'money') && s.value.trim() !== '' && !Number.isFinite(Number(s.value)))
    if (bad) {
      notify({ tone: 'error', title: `“${bad.label}” must be a number` })
      return
    }
    setSaving(true)
    try {
      const res = await fetch(`/api/p/${encodeURIComponent(projectId)}/settings`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ settings: next }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string }
        throw new Error(body.message || body.error || `Request failed (${res.status})`)
      }
      const body = (await res.json().catch(() => ({}))) as { settings?: Setting[] }
      setSaved(Array.isArray(body.settings) ? body.settings : next)
      setDraft({})
      notify({ tone: 'success', title: 'Settings saved', description: `${dirtyKeys.length} change${dirtyKeys.length === 1 ? '' : 's'} applied to your backend.` })
    } catch (e) {
      notify({ tone: 'error', title: 'Couldn’t save settings', description: e instanceof Error ? e.message : undefined })
    } finally {
      setSaving(false)
    }
  }, [saved, dirty, saving, draft, projectId, notify, dirtyKeys.length])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void save()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [save])

  if (!saved) {
    return (
      <div className="mx-auto w-full max-w-4xl space-y-4">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-border bg-card p-5">
            <Skeleton className="h-4 w-32 bg-muted" />
            <div className="mt-5 space-y-4">
              {Array.from({ length: 3 }).map((__, j) => (
                <Skeleton key={j} className="h-9 w-full bg-muted/60" />
              ))}
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (!saved.length) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center py-24 text-center">
        <span className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl border border-border bg-card">
          <Settings2 className="h-5 w-5 text-muted-foreground" />
        </span>
        <p className="text-sm font-medium">No settings defined</p>
        <p className="mt-1 text-xs text-muted-foreground">This blueprint has no configurable settings.</p>
      </div>
    )
  }

  return (
    <form
      className="mx-auto w-full max-w-4xl space-y-4 pb-24"
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
    >
      {groups.map((g) => (
        <section key={g.group} className="rounded-xl border border-border bg-card">
          <header className="border-b border-border/70 px-5 py-3.5">
            <h3 className="text-sm font-medium text-foreground">{g.group}</h3>
          </header>
          <div className="divide-y divide-border/60">
            {g.items.map((s) => {
              const value = draft[s.key] ?? s.value
              const changed = dirtyKeys.includes(s.key)
              return (
                <div key={s.key} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-8">
                  <label htmlFor={`setting-${s.key}`} className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 text-[13px] font-medium text-foreground">
                      {s.label}
                      {changed && <span className="h-1.5 w-1.5 rounded-full bg-brand" aria-label="modified" />}
                    </span>
                    {s.description && <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">{s.description}</span>}
                  </label>
                  <div className="shrink-0">
                    <FieldControl s={s} value={value} onChange={(v) => setDraft((d) => ({ ...d, [s.key]: v }))} />
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      ))}

      <div
        className={cn(
          'sticky bottom-4 z-10 mx-auto flex max-w-xl items-center justify-between gap-3 rounded-xl border border-border bg-popover/95 px-4 py-2.5 shadow-2xl shadow-black/30 backdrop-blur transition-all duration-300',
          dirty ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-4 opacity-0',
        )}
        aria-hidden={!dirty}
      >
        <span className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{dirtyKeys.length}</span> unsaved change{dirtyKeys.length === 1 ? '' : 's'}
          <kbd className="ml-2 hidden rounded border border-border px-1 font-mono text-[10px] sm:inline">⌘S</kbd>
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            tabIndex={dirty ? 0 : -1}
            onClick={() => setDraft({})}
            className="h-8 rounded-md px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Discard
          </button>
          <button
            type="submit"
            tabIndex={dirty ? 0 : -1}
            disabled={saving}
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-foreground px-3 text-xs font-medium text-background transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
          >
            {saving && <Loader2 className="h-3 w-3 animate-spin" />}
            Save changes
          </button>
        </div>
      </div>
    </form>
  )
}

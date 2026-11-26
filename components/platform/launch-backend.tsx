'use client'

import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/use-toast'
import type { ProjectPlatform } from '@/lib/projects'
import type { PlatformMeta, ProjectSpec } from '@/lib/platform/types'
import {
  ArrowRight,
  Check,
  CircleAlert,
  Copy,
  DatabaseZap,
  ExternalLink,
  LayoutDashboard,
  Loader2,
  RotateCcw,
  ServerCog,
  Workflow,
  X,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

export type LaunchFile = { file_path: string; file_content: string }

/** Generated Control Center for a provisioned project (DASHBOARD-SHELL route). */
export function controlCenterPath(projectId: string): string {
  return `/app/${encodeURIComponent(projectId)}/dashboard`
}

export function apiEndpoint(projectId: string): string {
  const origin = typeof window === 'undefined' ? '' : window.location.origin
  return `${origin}/api/p/${encodeURIComponent(projectId)}`
}

const STEPS = [
  { key: 'design', label: 'Designing data model' },
  { key: 'database', label: 'Creating isolated database' },
  { key: 'connect', label: 'Connecting your website' },
  { key: 'ready', label: 'Ready' },
] as const

type Stage = 'idle' | 'running' | 'error' | 'ready'

const MAX_FILE_CHARS = 40_000
const MAX_TOTAL_CHARS = 160_000
const SKIP_FILE = /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$|\.(png|jpe?g|gif|webp|ico|svg|woff2?|ttf|map)$/i

/** The blueprint generator only needs the source shape, not every byte. */
function capFiles(files: LaunchFile[]): LaunchFile[] {
  const out: LaunchFile[] = []
  let total = 0
  for (const file of files) {
    if (!file?.file_path || typeof file.file_content !== 'string' || SKIP_FILE.test(file.file_path)) continue
    const content = file.file_content.slice(0, MAX_FILE_CHARS)
    if (total + content.length > MAX_TOTAL_CHARS) break
    total += content.length
    out.push({ file_path: file.file_path, file_content: content })
  }
  return out
}

async function readError(res: Response, fallback: string): Promise<string> {
  const payload = (await res.json().catch(() => null)) as { error?: string; message?: string } | null
  if (res.status === 401) return 'Sign in to launch a backend for this project.'
  if (res.status === 429) return 'Too many requests. Wait a moment and retry.'
  if (res.status === 404 && !payload?.error) return 'The platform API is not available yet.'
  return payload?.message || payload?.error || `${fallback} (${res.status}).`
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

class StepError extends Error {
  constructor(public step: number, message: string) {
    super(message)
  }
}

export function LaunchBackend({
  projectId,
  name,
  spec,
  brief,
  files,
  sbxId,
  platform,
  onProvisioned,
  className = '',
}: {
  projectId: string
  name: string
  spec: ProjectSpec | null
  brief: string
  files: LaunchFile[]
  sbxId?: string | null
  platform: ProjectPlatform | null
  onProvisioned: (platform: ProjectPlatform) => void
  className?: string
}) {
  const [stage, setStage] = useState<Stage>('idle')
  const [current, setCurrent] = useState(0)
  const [detail, setDetail] = useState<Partial<Record<(typeof STEPS)[number]['key'], string>>>({})
  const [error, setError] = useState<{ step: number; message: string } | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const runRef = useRef(0)

  // A different project must never inherit this card's progress.
  useEffect(() => {
    runRef.current += 1
    setStage('idle')
    setCurrent(0)
    setDetail({})
    setError(null)
    setDismissed(false)
    return () => { runRef.current += 1 }
  }, [projectId])

  const projectType = spec?.projectType && spec.projectType !== 'custom' ? spec.projectType : null
  const displayName = (platform?.appName || spec?.name || name || 'your project').trim()

  if (dismissed) return null
  // Already provisioned (earlier session): the preview header shows the Control Center chip instead.
  if (platform?.provisioned && stage === 'idle') return null

  async function launch() {
    const run = ++runRef.current
    const alive = () => runRef.current === run
    const base = `/api/p/${encodeURIComponent(projectId)}`
    let step = 0
    setStage('running')
    setError(null)
    setDetail({})
    setCurrent(0)
    try {
      // 1. Blueprint + provisioning (server designs the schema, creates the DB and seeds it).
      const [res] = await Promise.all([
        fetch(`${base}/provision`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ spec, brief, files: capFiles(files) }),
        }).catch(() => { throw new StepError(0, 'Could not reach the platform API. Check your connection and retry.') }),
        sleep(600),
      ])
      if (!alive()) return
      let meta: PlatformMeta | undefined
      if (res.ok) meta = ((await res.json().catch(() => null)) as { meta?: PlatformMeta } | null)?.meta
      else if (res.status !== 409) throw new StepError(0, await readError(res, 'Provisioning failed'))
      if (!alive()) return
      const collections = meta?.blueprint?.collections?.length
      setDetail((d) => ({ ...d, design: collections ? `${collections} collections · ${meta?.blueprint.modules?.length ?? 0} modules` : 'Blueprint ready' }))

      // 2. Confirm the isolated database exists and report what was seeded.
      step = 1
      setCurrent(1)
      const [info] = await Promise.all([
        fetch(base, { cache: 'no-store' }).catch(() => null),
        sleep(450),
      ])
      if (!alive()) return
      if (!info?.ok) throw new StepError(1, info ? await readError(info, 'The project database did not respond') : 'The project database did not respond.')
      const body = (await info.json().catch(() => null)) as { meta?: PlatformMeta; counts?: Record<string, number> } | null
      meta = meta ?? body?.meta
      const seeded = Object.values(body?.counts ?? {}).reduce((sum, n) => sum + (Number(n) || 0), 0)
      setDetail((d) => ({ ...d, database: 'Seeding data…' }))
      await sleep(350)
      if (!alive()) return
      setDetail((d) => ({ ...d, database: `${seeded} records seeded` }))

      // 3. Point the live website at its new API (best-effort: the dashboard works without it).
      step = 2
      setCurrent(2)
      let connected = false
      if (sbxId) {
        const [conn] = await Promise.all([
          fetch(`${base}/connect`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sbxId }),
          }).catch(() => null),
          sleep(450),
        ])
        connected = Boolean(conn?.ok)
      }
      if (!alive()) return
      setDetail((d) => ({ ...d, connect: connected ? 'Forms now save to your backend' : sbxId ? 'Skipped — preview could not be reached' : 'Skipped — no live preview' }))

      // 4. Ready.
      step = 3
      setCurrent(3)
      setStage('ready')
      onProvisioned({
        provisioned: true,
        provisionedAt: meta?.createdAt ?? new Date().toISOString(),
        appName: meta?.appName || displayName,
      })
    } catch (e) {
      if (!alive()) return
      setError({ step: e instanceof StepError ? e.step : step, message: e instanceof Error ? e.message : 'Launch failed.' })
      setStage('error')
    }
  }

  async function copyEndpoint() {
    try {
      await navigator.clipboard.writeText(apiEndpoint(projectId))
      toast({ title: 'API endpoint copied', description: apiEndpoint(projectId) })
    } catch {
      toast({ title: 'Copy failed', description: apiEndpoint(projectId), variant: 'destructive' })
    }
  }

  return (
    <div className={`shrink-0 border-b border-border/60 bg-background px-4 py-3 ${className}`}>
      <div className="relative overflow-hidden rounded-xl border border-brand/25 bg-gradient-to-r from-brand/[0.06] via-card to-card px-4 py-3.5 sm:px-5">
        {stage === 'idle' && (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-brand/30 bg-brand/10 text-brand">
                <DatabaseZap className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <p className="text-[13px] font-semibold leading-snug text-foreground">
                  Make it real: launch backend &amp; control center for {displayName}
                </p>
                <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
                  Creates an isolated database, a REST API and an admin panel tailored to {projectType ? <span className="font-medium text-foreground">{projectType}</span> : 'your project'}. Website form submissions appear in the dashboard live.
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
                  <span className="inline-flex items-center gap-1 rounded-md border border-border bg-background/70 px-1.5 py-0.5"><DatabaseZap className="h-3 w-3" />Isolated database</span>
                  <span className="inline-flex items-center gap-1 rounded-md border border-border bg-background/70 px-1.5 py-0.5"><ServerCog className="h-3 w-3" />REST API</span>
                  <span className="inline-flex items-center gap-1 rounded-md border border-border bg-background/70 px-1.5 py-0.5"><LayoutDashboard className="h-3 w-3" />Control Center</span>
                  <span className="inline-flex items-center gap-1 rounded-md border border-border bg-background/70 px-1.5 py-0.5"><Workflow className="h-3 w-3" />Workflows</span>
                </div>
              </div>
            </div>
            <Button type="button" onClick={launch} className="shrink-0 gap-1.5 bg-brand text-brand-foreground hover:bg-brand/90">
              Launch backend<ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}

        {stage !== 'idle' && (
          <div>
            <div className="flex items-center justify-between gap-3">
              <p className="flex min-w-0 items-center gap-2 text-[13px] font-semibold text-foreground" role="status" aria-live="polite">
                {stage === 'ready'
                  ? <span className="flex h-5 w-5 items-center justify-center rounded-full bg-brand-accent/15 text-brand-accent"><Check className="h-3 w-3" /></span>
                  : stage === 'error'
                    ? <CircleAlert className="h-4 w-4 text-destructive" />
                    : <Loader2 className="h-4 w-4 animate-spin text-brand" />}
                <span className="truncate">
                  {stage === 'ready' ? `${displayName} has a live backend` : stage === 'error' ? 'Launch paused' : `Launching backend for ${displayName}`}
                </span>
              </p>
              <div className="flex shrink-0 items-center gap-1.5">
                {stage === 'ready' && (
                  <>
                    <Button asChild size="sm" className="gap-1.5 bg-brand text-brand-foreground hover:bg-brand/90">
                      <a href={controlCenterPath(projectId)} target="_blank" rel="noopener noreferrer">
                        Open Control Center<ExternalLink className="h-3 w-3" />
                      </a>
                    </Button>
                    <Button type="button" size="sm" variant="outline" className="gap-1.5" onClick={copyEndpoint}>
                      <Copy className="h-3 w-3" />Copy API endpoint
                    </Button>
                    <Button type="button" size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground" aria-label="Dismiss" onClick={() => setDismissed(true)}>
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </>
                )}
                {stage === 'error' && (
                  <>
                    <Button type="button" size="sm" variant="outline" className="gap-1.5" onClick={launch}>
                      <RotateCcw className="h-3 w-3" />Retry
                    </Button>
                    <Button type="button" size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground" aria-label="Cancel launch" onClick={() => { runRef.current += 1; setStage('idle'); setError(null) }}>
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </>
                )}
              </div>
            </div>
            <ol className="mt-3 grid gap-2 sm:grid-cols-4">
              {STEPS.map((s, index) => {
                const done = stage === 'ready' || index < current
                const active = stage === 'running' && index === current
                const failed = stage === 'error' && error?.step === index
                const label = s.key === 'database' && active && detail.database ? detail.database : s.label
                return (
                  <li key={s.key} className={`flex min-w-0 items-start gap-2 rounded-lg border px-2.5 py-2 text-[12px] ${failed ? 'border-destructive/40 bg-destructive/5' : active ? 'border-brand/30 bg-brand/[0.05]' : 'border-border/70 bg-background/60'}`}>
                    <span className={`mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${done ? 'border-brand-accent/30 bg-brand-accent/10 text-brand-accent' : failed ? 'border-destructive/40 text-destructive' : active ? 'border-brand/40 text-brand' : 'border-border text-muted-foreground/60'}`}>
                      {done ? <Check className="h-2.5 w-2.5" /> : failed ? <CircleAlert className="h-2.5 w-2.5" /> : active ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <span className="font-mono text-[8px]">{index + 1}</span>}
                    </span>
                    <span className="min-w-0">
                      <span className={`block truncate font-medium ${done || active || failed ? 'text-foreground' : 'text-muted-foreground'}`}>{label}</span>
                      {done && detail[s.key] && <span className="block truncate text-[11px] text-muted-foreground">{detail[s.key]}</span>}
                    </span>
                  </li>
                )
              })}
            </ol>
            {stage === 'error' && error && (
              <p role="alert" className="mt-2 text-[12px] leading-relaxed text-destructive">{error.message}</p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

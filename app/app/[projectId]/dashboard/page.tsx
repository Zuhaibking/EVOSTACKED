'use client'

import { ControlCenter } from '@/components/platform/control-center'
import type { PlatformMeta } from '@/lib/platform/types'
import { cn } from '@/lib/utils'
import { ArrowLeft, Database, LayoutDashboard, Lock, LogIn, RotateCw, Rocket, ServerCrash, Workflow } from 'lucide-react'
import Link from 'next/link'
import { use, useCallback, useEffect, useState } from 'react'

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; meta: PlatformMeta; counts: Record<string, number> }
  | { kind: 'not_provisioned' }
  | { kind: 'unauthorized' }
  | { kind: 'forbidden' }
  | { kind: 'error'; message: string }

export default function DashboardPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = use(params)
  const [state, setState] = useState<LoadState>({ kind: 'loading' })

  const load = useCallback(async () => {
    setState({ kind: 'loading' })
    try {
      const res = await fetch(`/api/p/${encodeURIComponent(projectId)}`, { cache: 'no-store' })
      if (res.status === 401) return setState({ kind: 'unauthorized' })
      if (res.status === 403) return setState({ kind: 'forbidden' })
      if (res.status === 404) return setState({ kind: 'not_provisioned' })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string }
        return setState({ kind: 'error', message: body.message || body.error || `Request failed (${res.status})` })
      }
      const body = (await res.json()) as { meta?: PlatformMeta; counts?: Record<string, number> }
      if (!body.meta?.blueprint) return setState({ kind: 'not_provisioned' })
      setState({ kind: 'ready', meta: body.meta, counts: body.counts ?? {} })
    } catch (e) {
      setState({ kind: 'error', message: e instanceof Error ? e.message : 'Network error' })
    }
  }, [projectId])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (state.kind === 'ready') document.title = `${state.meta.appName || 'App'} · Control Center`
    else document.title = 'Control Center · EvoStack'
  }, [state])

  if (state.kind === 'ready') return <ControlCenter meta={state.meta} counts={state.counts} />
  if (state.kind === 'loading') return <ShellSkeleton />

  const builder = `/app/${encodeURIComponent(projectId)}`
  if (state.kind === 'not_provisioned') {
    return (
      <Centered>
        <div className="relative mx-auto mb-7 h-24 w-40" aria-hidden>
          <div className="absolute left-1/2 top-1/2 h-24 w-24 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand/20 blur-2xl" />
          <IconTile className="absolute left-0 top-6 -rotate-6" icon={<Database className="h-5 w-5" />} />
          <IconTile className="absolute left-1/2 top-0 z-10 h-14 w-14 -translate-x-1/2 border-brand/40 text-brand" icon={<LayoutDashboard className="h-6 w-6" />} />
          <IconTile className="absolute right-0 top-6 rotate-6" icon={<Workflow className="h-5 w-5" />} />
        </div>
        <p className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-muted-foreground">Control Center</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">No backend for this project yet</h1>
        <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
          Your admin panel is generated from your app’s blueprint. Launch a backend from the builder and EvoStack provisions everything in seconds.
        </p>
        <ol className="mx-auto mt-7 grid max-w-lg gap-2 text-left sm:grid-cols-3">
          {[
            { n: '1', t: 'Pick a design', d: 'Choose your winning direction in the builder.' },
            { n: '2', t: 'Launch backend', d: 'Isolated SQLite database, REST API and workflows.' },
            { n: '3', t: 'Run your business', d: 'Website submissions stream in here live.' },
          ].map((s) => (
            <li key={s.n} className="rounded-xl border border-border bg-card/70 p-3">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-muted font-mono text-[10px] text-foreground">{s.n}</span>
              <p className="mt-2 text-[13px] font-medium text-foreground">{s.t}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{s.d}</p>
            </li>
          ))}
        </ol>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-2">
          <Link
            href={builder}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-foreground px-4 text-sm font-medium text-background transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <Rocket className="h-4 w-4" aria-hidden /> Open builder to launch backend
          </Link>
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-card px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <RotateCw className="h-4 w-4" aria-hidden /> Check again
          </button>
        </div>
        <p className="mt-6 font-mono text-[10.5px] text-muted-foreground/70">project · {projectId}</p>
      </Centered>
    )
  }

  if (state.kind === 'unauthorized' || state.kind === 'forbidden') {
    const unauth = state.kind === 'unauthorized'
    return (
      <Centered>
        <IconTile className="mx-auto mb-6 h-14 w-14" icon={unauth ? <LogIn className="h-6 w-6" /> : <Lock className="h-6 w-6" />} />
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{unauth ? 'Sign in to open your Control Center' : 'You don’t have access to this project'}</h1>
        <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
          {unauth
            ? 'Each backend is private to the account that launched it. Sign in from the builder, then come back to manage your data.'
            : 'This backend belongs to another account. Ask the owner to share it, or launch your own from the builder.'}
        </p>
        <div className="mt-8 flex justify-center gap-2">
          <Link
            href={builder}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-foreground px-4 text-sm font-medium text-background transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            {unauth ? <LogIn className="h-4 w-4" aria-hidden /> : <ArrowLeft className="h-4 w-4" aria-hidden />}
            {unauth ? 'Sign in' : 'Back to builder'}
          </Link>
          {unauth && (
            <button
              type="button"
              onClick={() => void load()}
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-card px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <RotateCw className="h-4 w-4" aria-hidden /> Retry
            </button>
          )}
        </div>
      </Centered>
    )
  }

  return (
    <Centered>
      <IconTile className="mx-auto mb-6 h-14 w-14 border-red-500/30 text-red-500" icon={<ServerCrash className="h-6 w-6" />} />
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">Couldn’t reach this backend</h1>
      <p className="mx-auto mt-3 max-w-md text-sm text-muted-foreground">{state.message}</p>
      <div className="mt-8 flex justify-center gap-2">
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex h-10 items-center gap-2 rounded-lg bg-foreground px-4 text-sm font-medium text-background hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <RotateCw className="h-4 w-4" aria-hidden /> Try again
        </button>
        <Link
          href={builder}
          className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-card px-4 text-sm font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden /> Back to builder
        </Link>
      </div>
    </Centered>
  )
}

function IconTile({ icon, className }: { icon: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'flex h-12 w-12 items-center justify-center rounded-2xl border border-border bg-card text-muted-foreground shadow-[0_12px_40px_-12px_rgba(0,0,0,.6)]',
        className,
      )}
    >
      {icon}
    </div>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-background px-6 py-16">
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.35] [background-image:radial-gradient(hsl(var(--border))_1px,transparent_1px)] [background-size:22px_22px] [mask-image:radial-gradient(ellipse_at_center,black_20%,transparent_70%)]"
        aria-hidden
      />
      <div className="relative w-full max-w-2xl text-center">{children}</div>
    </main>
  )
}

function ShellSkeleton() {
  const bar = 'animate-pulse rounded-md bg-muted'
  return (
    <div className="flex h-dvh w-full overflow-hidden bg-background" aria-busy="true" aria-label="Loading Control Center">
      <aside className="flex w-[60px] shrink-0 flex-col border-r border-border bg-card/50 lg:w-[252px]">
        <div className="flex h-14 items-center gap-2.5 border-b border-border px-3">
          <div className={cn(bar, 'h-8 w-8 rounded-lg')} />
          <div className="hidden flex-1 space-y-1.5 lg:block">
            <div className={cn(bar, 'h-3 w-28')} />
            <div className={cn(bar, 'h-2.5 w-36 opacity-60')} />
          </div>
        </div>
        <div className="space-y-2 p-3">
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className={cn(bar, 'h-7 w-full opacity-70')} style={{ animationDelay: `${i * 60}ms` }} />
          ))}
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-14 items-center gap-3 border-b border-border px-6">
          <div className={cn(bar, 'h-8 w-8 rounded-lg')} />
          <div className="space-y-1.5">
            <div className={cn(bar, 'h-3 w-32')} />
            <div className={cn(bar, 'h-2.5 w-52 opacity-60')} />
          </div>
          <div className="flex-1" />
          <div className={cn(bar, 'h-8 w-24 rounded-full')} />
          <div className={cn(bar, 'h-8 w-32 rounded-lg')} />
        </div>
        <div className="space-y-4 p-8">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-[118px] rounded-xl border border-border bg-card p-4">
                <div className={cn(bar, 'h-3 w-24')} />
                <div className={cn(bar, 'mt-4 h-7 w-28')} />
              </div>
            ))}
          </div>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            <div className="h-[300px] rounded-xl border border-border bg-card lg:col-span-2" />
            <div className="h-[300px] rounded-xl border border-border bg-card" />
          </div>
        </div>
      </div>
    </div>
  )
}

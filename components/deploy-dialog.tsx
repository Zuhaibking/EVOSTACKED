'use client'

import Logo from './logo'
import { CopyButton } from './ui/copy-button'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { useEffect, useState } from 'react'

type DeployState = {
  status: 'idle' | 'building' | 'live' | 'failed'
  url: string | null
  error: string | null
}

export function DeployDialog({
  projectId,
  candidateId,
}: {
  projectId: string
  candidateId: string
}) {
  const [state, setState] = useState<DeployState>({
    status: 'idle',
    url: null,
    error: null,
  })
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch(
      `/api/deploy?projectId=${encodeURIComponent(projectId)}&candidateId=${encodeURIComponent(candidateId)}`,
    )
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) {
          setState({
            status: data.status || 'idle',
            url: data.url || null,
            error: data.error || null,
          })
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [projectId, candidateId])

  useEffect(() => {
    if (state.status !== 'building') return
    const t = setInterval(() => {
      fetch(
        `/api/deploy?projectId=${encodeURIComponent(projectId)}&candidateId=${encodeURIComponent(candidateId)}`,
      )
        .then((r) => r.json())
        .then((data) =>
          setState({
            status: data.status || 'idle',
            url: data.url || null,
            error: data.error || null,
          }),
        )
        .catch(() => {})
    }, 2500)
    return () => clearInterval(t)
  }, [state.status, projectId, candidateId])

  async function startDeploy() {
    setBusy(true)
    setState((s) => ({ ...s, status: 'building', error: null }))
    try {
      const res = await fetch('/api/deploy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          candidateId,
          origin: window.location.origin,
        }),
      })
      const data = await res.json()
      setState({
        status: data.status || 'failed',
        url: data.url || null,
        error: data.error || (!res.ok ? 'Deploy failed' : null),
      })
    } catch {
      setState((s) => ({ ...s, status: 'failed', error: 'Deploy failed' }))
    } finally {
      setBusy(false)
    }
  }

  const label =
    state.status === 'building'
      ? 'Building'
      : state.status === 'live'
        ? 'Live'
        : state.status === 'failed'
          ? 'Failed'
          : 'Deploy'

  return (
    <div className="flex items-center gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="default">
            <Logo width={16} height={16} className="mr-2" />
            Deploy
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="p-4 w-80 flex flex-col gap-2">
          <div className="text-sm font-semibold">Publish persisted files</div>
          <div className="text-sm text-muted-foreground">
            Deploys the saved candidate tree, not the live sandbox. Sandbox
            expiry does not take the site down.
          </div>
          <div className="font-mono text-[10px] tracking-[0.22em] uppercase text-muted-foreground">
            {state.status}
          </div>
          {state.url ? (
            <div className="flex items-center gap-2">
              <Input value={state.url} readOnly />
              <CopyButton content={state.url} />
            </div>
          ) : null}
          {state.error ? (
            <div className="text-sm text-destructive">{state.error}</div>
          ) : null}
          <Button
            type="button"
            variant="default"
            disabled={busy || state.status === 'building'}
            onClick={startDeploy}
          >
            {state.status === 'live' ? 'Redeploy' : 'Deploy'}
          </Button>
        </DropdownMenuContent>
      </DropdownMenu>
      {state.status !== 'idle' ? (
        <span className="font-mono text-[9px] tracking-[0.22em] uppercase text-muted-foreground hidden sm:inline">
          {label}
        </span>
      ) : null}
      {state.status === 'live' && state.url ? (
        <a
          href={state.url}
          target="_blank"
          rel="noreferrer"
          className="font-mono text-[10px] text-muted-foreground hover:text-foreground truncate max-w-[140px] hidden md:inline"
        >
          {state.url.replace(/^https?:\/\//, '')}
        </a>
      ) : null}
    </div>
  )
}

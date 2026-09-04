'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

export function ArenaDatabaseTab({
  projectId,
  candidateId,
  revision,
}: {
  projectId?: string
  candidateId?: string
  revision?: string
}) {
  const [requiresDataLayer, setRequiresDataLayer] = useState(false)
  const [count, setCount] = useState(0)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!projectId || !candidateId) {
      setRequiresDataLayer(false)
      setCount(0)
      setLoaded(true)
      return
    }
    let cancelled = false
    fetch(
      `/api/project-files?projectId=${encodeURIComponent(projectId)}&candidateId=${encodeURIComponent(candidateId)}`,
    )
      .then((r) => r.json())
      .then(async (data) => {
        if (cancelled) return
        const on = Boolean(data?.requires_data_layer)
        setRequiresDataLayer(on)
        if (on) {
          const sub = await fetch(
            `/api/evostack/submissions?projectId=${encodeURIComponent(projectId)}`,
          ).then((r) => r.json())
          if (!cancelled) setCount(Number(sub?.count) || 0)
        } else {
          setCount(0)
        }
        setLoaded(true)
      })
      .catch(() => {
        if (cancelled) return
        setRequiresDataLayer(false)
        setCount(0)
        setLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [projectId, candidateId, revision])

  if (!loaded) {
    return (
      <div className="h-full flex items-center justify-center font-mono text-[10px] tracking-[0.22em] uppercase text-muted-foreground">
        Loading
      </div>
    )
  }

  if (!requiresDataLayer) {
    return (
      <div className="h-full flex flex-col items-center justify-center px-8 text-center">
        <p className="font-mono text-[10px] tracking-[0.28em] uppercase text-muted-foreground">
          Database
        </p>
        <h2 className="mt-3 font-display text-2xl font-black tracking-tight">
          No database needed
        </h2>
        <p className="mt-2 max-w-sm text-[13px] leading-relaxed text-muted-foreground">
          This specimen does not collect form data. A data layer is only
          connected when a generated app actually takes submissions.
        </p>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col items-center justify-center px-8 text-center">
      <p className="font-mono text-[10px] tracking-[0.28em] uppercase text-muted-foreground">
        Database
      </p>
      <h2 className="mt-3 font-display text-2xl font-black tracking-tight">
        Data layer connected
      </h2>
      <p className="mt-2 max-w-sm text-[13px] leading-relaxed text-muted-foreground">
        Submissions for this project are stored in the shared capture table.
        {count === 1 ? ' 1 stored.' : ` ${count} stored.`}
      </p>
      {projectId ? (
        <Link
          href={`/projects/${encodeURIComponent(projectId)}/submissions`}
          className="mt-5 font-mono text-[10px] tracking-[0.22em] uppercase text-foreground underline underline-offset-4"
        >
          View submissions
        </Link>
      ) : null}
    </div>
  )
}

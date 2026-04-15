'use client'

import { Loader2 } from 'lucide-react'

/**
 * Lightweight editorial status bar for /app.
 * Not wired to a real run yet — derives state from props.
 */
export function RunStatusBar({
  runId = '0044',
  isLoading,
  hasFragment,
}: {
  runId?: string
  isLoading: boolean
  hasFragment: boolean
}) {
  const phase = isLoading
    ? 'Generating'
    : hasFragment
      ? 'Specimen ready'
      : 'Awaiting brief'

  const dot = isLoading
    ? 'bg-brand'
    : hasFragment
      ? 'bg-brand-accent'
      : 'bg-muted-foreground/60'

  const now = new Date()
  const stamp =
    now.toISOString().slice(0, 10).replace(/-/g, '·') +
    ' ' +
    now.toTimeString().slice(0, 5)

  return (
    <div className="border-b border-border bg-background/80 backdrop-blur-sm">
      <div className="max-w-[1400px] mx-auto px-4 md:px-6 py-2 flex flex-wrap items-center gap-x-6 gap-y-1">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] tracking-[0.24em] uppercase text-muted-foreground">
            Run
          </span>
          <span className="font-mono text-[11px] tabular text-foreground">
            #{runId}
          </span>
        </div>
        <span className="text-muted-foreground/30">·</span>
        <span className="font-mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground tabular">
          {stamp}
        </span>
        <span className="text-muted-foreground/30 hidden sm:inline">·</span>
        <div className="flex items-center gap-2">
          <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
          <span className="font-mono text-[10px] tracking-[0.2em] uppercase text-foreground inline-flex items-center gap-1.5">
            {isLoading && <Loader2 className="h-3 w-3 animate-spin" />}
            {phase}
          </span>
        </div>
        <span className="ml-auto font-mono text-[10px] tracking-[0.22em] uppercase text-muted-foreground hidden md:inline">
          § Single-candidate mode · Population fan-out coming in Phase 1
        </span>
      </div>
    </div>
  )
}

'use client'

import { useEffect, useState } from 'react'

export type LoadingVariant = 'drive' | 'dots' | 'orbit'
export type LoadingSize = 'overlay' | 'compact'

function formatClock(elapsed: number) {
  const minutes = Math.floor(elapsed / 60)
  const seconds = elapsed % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

function ScanRule({ compact }: { compact?: boolean }) {
  return (
    <span
      className={compact ? 'gen-scan gen-scan-compact' : 'gen-scan'}
      aria-hidden
    />
  )
}

export function LoadingState({
  label,
  active = true,
  variant: _variant = 'drive',
  size = 'overlay',
}: {
  label: string
  active?: boolean
  variant?: LoadingVariant
  size?: LoadingSize
}) {
  const [elapsed, setElapsed] = useState(0)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!active || !mounted) return
    const started = Date.now()
    const id = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - started) / 1000))
    }, 250)
    return () => window.clearInterval(id)
  }, [active, mounted, label])

  if (!active) return null

  const clock = mounted ? formatClock(elapsed) : '00:00'

  if (size === 'compact') {
    return (
      <div
        className="flex w-full min-w-0 flex-col items-stretch gap-1"
        role="status"
        aria-live="polite"
        aria-label={label}
      >
        <ScanRule compact />
        <div className="flex items-baseline justify-between gap-2 min-w-0">
          <span className="font-mono text-[11px] tracking-[0.16em] uppercase text-foreground truncate">
            {label}
          </span>
          <span className="font-mono text-[11px] tabular text-muted-foreground shrink-0">
            {clock}
          </span>
        </div>
      </div>
    )
  }

  return (
    <div
      className="absolute inset-0 z-20 flex items-center justify-center bg-background/80"
      role="status"
      aria-live="polite"
      aria-label={label}
    >
      <div className="flex w-full max-w-[22rem] flex-col items-center px-6 text-center">
        <p className="font-mono text-[10px] tracking-[0.32em] uppercase text-muted-foreground">
          Live generation
        </p>
        <ScanRule />
        <p className="mt-4 font-display text-[1.35rem] leading-none tracking-tight">
          {label}
        </p>
        <p className="mt-2 font-mono text-[13px] tabular tracking-[0.18em] text-muted-foreground">
          {clock}
        </p>
      </div>
    </div>
  )
}

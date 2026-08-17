'use client'

import { useEffect, useState } from 'react'

const PIXEL_COUNT = 48

export type LoadingVariant = 'drive' | 'dots' | 'orbit'
export type LoadingSize = 'overlay' | 'compact'

function formatClock(elapsed: number) {
  const minutes = Math.floor(elapsed / 60)
  const seconds = elapsed % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

function DriveMark({ compact }: { compact?: boolean }) {
  const count = compact ? 8 : PIXEL_COUNT
  return (
    <div
      className={compact ? 'grid grid-cols-8 gap-0.5' : 'grid grid-cols-8 gap-1'}
      aria-hidden
    >
      {Array.from({ length: count }, (_, i) => (
        <span
          key={i}
          className={`${compact ? 'h-1 w-1' : 'h-1.5 w-1.5'} bg-brand pixel-on motion-reduce:animate-none`}
          style={{ animationDelay: `${(i % 12) * 80}ms` }}
        />
      ))}
    </div>
  )
}

function DotsMark({ compact }: { compact?: boolean }) {
  const size = compact ? 'h-1 w-1' : 'h-1.5 w-1.5'
  return (
    <div className="flex items-center gap-1" aria-hidden>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className={`${size} rounded-full bg-brand arena-dot motion-reduce:animate-none`}
          style={{ animationDelay: `${i * 160}ms` }}
        />
      ))}
    </div>
  )
}

function OrbitMark({ compact }: { compact?: boolean }) {
  const box = compact ? 'h-3.5 w-3.5' : 'h-8 w-8'
  const dot = compact ? 'h-1 w-1' : 'h-1.5 w-1.5'
  return (
    <div className={`relative ${box}`} aria-hidden>
      <span className="absolute inset-0 rounded-full border border-border" />
      <span className="absolute inset-0 arena-orbit motion-reduce:animate-none">
        <span
          className={`absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand ${dot}`}
        />
      </span>
    </div>
  )
}

function Mark({
  variant,
  compact,
}: {
  variant: LoadingVariant
  compact?: boolean
}) {
  if (variant === 'dots') return <DotsMark compact={compact} />
  if (variant === 'orbit') return <OrbitMark compact={compact} />
  return <DriveMark compact={compact} />
}

export function LoadingState({
  label,
  active = true,
  variant = 'drive',
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
        className="inline-flex items-center gap-1.5 min-w-0"
        role="status"
        aria-live="polite"
        aria-label={label}
      >
        <Mark variant={variant} compact />
        <span className="shimmer-text font-mono text-[9px] tracking-[0.16em] uppercase truncate">
          {label}
        </span>
        <span className="font-mono text-[9px] tabular text-muted-foreground/70">
          {clock}
        </span>
      </div>
    )
  }

  return (
    <div
      className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-5 bg-background/72 backdrop-blur-[2px]"
      role="status"
      aria-live="polite"
      aria-label={label}
    >
      <Mark variant={variant} />
      <div className="flex flex-col items-center gap-1.5">
        <p className="shimmer-text font-mono text-[11px] tracking-[0.28em] uppercase">
          {label}
        </p>
        <p className="font-mono text-[10px] tabular text-muted-foreground/70">
          {clock}
        </p>
      </div>
    </div>
  )
}

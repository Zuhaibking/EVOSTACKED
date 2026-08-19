'use client'

import type { ArenaActivityItem } from '@/lib/arena-activity'
import type { VariantId } from '@/lib/tournament'
import { useState } from 'react'

export function ActivityTimeline({
  items,
  onViewSource,
  onViewDetails,
  detailsFor,
}: {
  items: ArenaActivityItem[]
  onViewSource?: (id: VariantId) => void
  onViewDetails?: (id: VariantId) => void
  detailsFor?: (id: VariantId) => string[]
}) {
  const [openId, setOpenId] = useState<string | null>(null)

  if (items.length === 0) {
    return (
      <p className="font-mono text-[13px] text-muted-foreground">
        Waiting for a run.
      </p>
    )
  }

  return (
    <ol className="space-y-1">
      {items.map((item) => {
        const mark =
          item.tone === 'done' ? '✓' : item.tone === 'fail' ? '✕' : '⟳'
        const tone =
          item.tone === 'done'
            ? 'text-brand-accent'
            : item.tone === 'fail'
              ? 'text-destructive'
              : 'text-brand'
        const detailsOpen = openId === item.id
        const details =
          detailsOpen && item.candidateId && detailsFor
            ? detailsFor(item.candidateId)
            : []

        return (
          <li key={item.id}>
            <div className="flex items-start gap-1.5">
              <span
                className={`font-mono text-[13px] leading-4 ${tone} ${
                  item.tone === 'work' ? 'animate-pulse motion-reduce:animate-none' : ''
                }`}
              >
                {mark}
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-mono text-[13px] leading-4 text-foreground/90 truncate">
                  {item.label}
                </p>
                {item.tone === 'fail' && item.candidateId && (
                  <div className="mt-0.5 flex flex-wrap gap-1.5">
                    {item.allowSource && onViewSource && (
                      <button
                        type="button"
                        className="font-mono text-[10px] tracking-[0.14em] uppercase text-muted-foreground hover:text-foreground"
                        onClick={() => onViewSource(item.candidateId!)}
                      >
                        View source
                      </button>
                    )}
                    {item.allowDetails && (
                      <button
                        type="button"
                        className="font-mono text-[10px] tracking-[0.14em] uppercase text-muted-foreground hover:text-foreground"
                        onClick={() => {
                          setOpenId(detailsOpen ? null : item.id)
                          onViewDetails?.(item.candidateId!)
                        }}
                      >
                        View details
                      </button>
                    )}
                  </div>
                )}
                {detailsOpen && details.length > 0 && (
                  <div className="mt-1 max-h-24 overflow-y-auto space-y-0.5">
                    {details.slice(0, 8).map((line) => (
                      <p
                        key={line}
                        className="font-mono text-[11px] text-muted-foreground break-words"
                      >
                        {line}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </li>
        )
      })}
    </ol>
  )
}

'use client'

import { FragmentPreview } from './fragment-preview'
import { formatPreviewUnavailableTitle } from '@/lib/build-failure-diagnostics'
import { FragmentSchema } from '@/lib/schema'
import type { PreviewViewport } from '@/lib/arena-workspace'
import { ExecutionResult } from '@/lib/types'
import type { DeepPartial } from '@evostack/shared'
import { useState } from 'react'

export function Preview({
  fragment,
  result,
  viewport = 'desktop',
  unavailableReason,
  diagnostics,
  onViewSource,
}: {
  fragment?: DeepPartial<FragmentSchema>
  result?: ExecutionResult
  viewport?: PreviewViewport
  unavailableReason?: string | null
  diagnostics?: string[]
  onViewSource: () => void
}) {
  const [detailsOpen, setDetailsOpen] = useState(false)

  if (!fragment) return null

  if (result) {
    return (
      <FragmentPreview result={result} viewport={viewport} />
    )
  }

  return (
    <div className="h-full flex flex-col items-start justify-center gap-3 px-6 py-8">
      <p className="text-[14px] text-foreground" role="status">
        {formatPreviewUnavailableTitle(unavailableReason)}
      </p>
      {unavailableReason ? (
        <p className="text-[12px] text-muted-foreground max-w-md">
          {unavailableReason}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onViewSource}
          className="font-mono text-[11px] tracking-[0.14em] uppercase px-3 py-1.5 border border-border hover:bg-foreground/[0.03]"
        >
          View Source
        </button>
        {diagnostics && diagnostics.length > 0 && (
          <button
            type="button"
            onClick={() => setDetailsOpen((v) => !v)}
            className="font-mono text-[11px] tracking-[0.14em] uppercase px-3 py-1.5 border border-border hover:bg-foreground/[0.03]"
          >
            View details
          </button>
        )}
      </div>
      {detailsOpen && diagnostics && diagnostics.length > 0 && (
        <div className="max-h-32 overflow-y-auto max-w-md space-y-1">
          {diagnostics.slice(0, 8).map((line) => (
            <p key={line} className="font-mono text-[10px] text-muted-foreground">
              {line}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}

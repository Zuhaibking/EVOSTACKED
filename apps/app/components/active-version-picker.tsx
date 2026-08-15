'use client'

import { hasFragmentCode } from '@/lib/fragment'
import type { Candidate } from '@/lib/tournament-client'
import type { VariantId } from '@/lib/tournament'
import { VARIANTS } from '@/lib/tournament'
import {
  architectureScoreLabel,
  canActivateCandidate,
  resolveCandidateIsolatedPreview,
  retainTournamentCandidates,
  runtimeScoreLabel,
  smokeScoreLabel,
} from '@/lib/tournament-candidates'
import { useState } from 'react'

function formatPct(n?: number) {
  if (n == null || Number.isNaN(n)) return '—'
  return `${Math.round(n * 100)}`
}

/**
 * Post-tournament picker: all 3 candidates remain inspectable.
 * Recommendation is optional — user must Use this version.
 * Preview loads into the existing right-side workspace panel.
 */
export function ActiveVersionPicker({
  candidates,
  selectedId,
  activeId,
  onUseVersion,
  onPreview,
  onViewSource,
  onViewFailure,
}: {
  candidates: Record<VariantId, Candidate>
  /** Currently inspecting (Preview/Source) — not the same as active version. */
  selectedId?: VariantId
  activeId?: VariantId
  onUseVersion: (id: VariantId) => void
  onPreview: (id: VariantId) => void
  onViewSource: (id: VariantId) => void
  onViewFailure?: (id: VariantId) => void
}) {
  const retained = retainTournamentCandidates(candidates)
  const [failureId, setFailureId] = useState<VariantId | null>(null)

  return (
    <section className="mx-3 sm:mx-4 md:mx-6 mb-3 border border-border bg-background/80">
      <div className="px-3 py-2 border-b border-border/70 flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-[10px] tracking-[0.22em] uppercase text-muted-foreground">
          Choose your version
        </span>
        {activeId ? (
          <span className="font-mono text-[10px] text-brand-accent">
            {VARIANTS.find((v) => v.id === activeId)?.label} is active
          </span>
        ) : (
          <span className="font-mono text-[10px] text-muted-foreground">
            Active: none
          </span>
        )}
      </div>

      <p className="px-3 pt-3 text-[12px] text-muted-foreground">
        All 3 candidates were generated. Preview each in the workspace, then
        choose the one you want to continue with.
      </p>

      <div className="grid sm:grid-cols-3 gap-2 p-3">
        {VARIANTS.map((v) => {
          const c = retained[v.id]
          const isActive = activeId === c.id
          const isSelected = selectedId === c.id
          const hasSource = hasFragmentCode(c.fragment)
          const generationFailed =
            c.status === 'error' && !hasSource
          const notAttempted = c.status === 'not_attempted'
          const stillPending = c.status === 'pending' && !hasSource
          const preview = resolveCandidateIsolatedPreview(c)
          const activation = canActivateCandidate(c)
          const showFailure = failureId === c.id
          const title =
            (typeof c.fragment?.title === 'string' && c.fragment.title) ||
            null

          return (
            <div
              key={c.id}
              className={`border p-2.5 space-y-2 ${
                isActive
                  ? 'border-brand-accent bg-brand-accent/5'
                  : isSelected
                    ? 'border-foreground bg-foreground/[0.03]'
                    : c.isWinner
                      ? 'border-brand-accent/50'
                      : 'border-border'
              }`}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-mono text-[11px] tracking-[0.14em] uppercase">
                  {c.label}
                </span>
                {c.isWinner && hasSource && (
                  <span className="font-mono text-[9px] tracking-[0.12em] uppercase text-brand-accent">
                    🏆 Recommended
                  </span>
                )}
              </div>

              {title && (
                <p className="font-display text-[14px] leading-tight truncate">
                  {title}
                </p>
              )}

              {stillPending && (
                <p className="text-[12px] text-muted-foreground" role="status">
                  Waiting to generate…
                </p>
              )}

              {generationFailed && (
                <p className="text-[12px] text-destructive" role="status">
                  Candidate generation failed.
                  {c.error ? ` ${c.error}` : ''}
                </p>
              )}

              {notAttempted && (
                <p className="text-[11px] text-muted-foreground leading-snug" role="status">
                  Not attempted
                  <br />
                  {c.error ||
                    'OpenAI daily request limit reached. No generation was attempted for the remaining candidates.'}
                </p>
              )}

              {hasSource && (
                <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 font-mono text-[10px] text-muted-foreground">
                  <span>Score</span>
                  <span className="text-foreground text-right">
                    {formatPct(c.scoreComposite)}
                  </span>
                  <span>Architecture</span>
                  <span className="text-foreground text-right">
                    {architectureScoreLabel(c)}
                  </span>
                  <span>Runtime</span>
                  <span className="text-foreground text-right">
                    {runtimeScoreLabel(c)}
                  </span>
                  <span>Smoke</span>
                  <span className="text-foreground text-right">
                    {smokeScoreLabel(c.smoke)}
                  </span>
                </div>
              )}

              {hasSource && !preview.available && (
                <p className="text-[11px] text-muted-foreground leading-snug" role="status">
                  Preview unavailable
                  <br />
                  Generation succeeded, but runtime deployment failed.
                </p>
              )}

              {showFailure && (c.error || activation.reason) && (
                <p
                  className="text-[11px] border border-border/70 px-2 py-1.5 bg-background"
                  role="status"
                >
                  {c.error ||
                    c.finalVerification?.errors?.[0] ||
                    c.verification?.errors?.[0] ||
                    c.smoke?.summary ||
                    activation.reason}
                </p>
              )}

              {hasSource && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    onPreview(c.id)
                  }}
                  className={`flex-1 min-w-[4.5rem] font-mono text-[10px] tracking-[0.12em] uppercase px-2 py-1 border ${
                    preview.available
                      ? 'border-border bg-foreground text-background hover:opacity-90'
                      : 'border-border hover:bg-foreground/[0.03]'
                  }`}
                >
                  Preview
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    onViewSource(c.id)
                  }}
                  className="flex-1 min-w-[4.5rem] font-mono text-[10px] tracking-[0.12em] uppercase px-2 py-1 border border-border hover:bg-foreground/[0.03]"
                >
                  Source
                </button>
                {!preview.available && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      setFailureId((id) => (id === c.id ? null : c.id))
                      onViewFailure?.(c.id)
                    }}
                    className="flex-1 min-w-[4.5rem] font-mono text-[10px] tracking-[0.12em] uppercase px-2 py-1 border border-border hover:bg-foreground/[0.03]"
                  >
                    Failure Details
                  </button>
                )}
                <button
                  type="button"
                  disabled={!activation.ok}
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    onUseVersion(c.id)
                  }}
                  title={
                    activation.ok
                      ? undefined
                      : activation.reason || 'Cannot activate'
                  }
                  className={`flex-1 min-w-[5rem] font-mono text-[10px] tracking-[0.12em] uppercase px-2 py-1 border ${
                    isActive
                      ? 'border-brand-accent text-brand-accent'
                      : activation.ok
                        ? 'border-border hover:bg-foreground/[0.03]'
                        : 'border-border opacity-40 cursor-not-allowed'
                  }`}
                >
                  {isActive ? 'Active' : 'Use this version'}
                </button>
              </div>
              )}
            </div>
          )
        })}
      </div>

      {!activeId && (
        <p className="px-3 pb-3 text-[12px] text-muted-foreground">
          Recommended is optional — only your choice becomes the active version.
        </p>
      )}
    </section>
  )
}

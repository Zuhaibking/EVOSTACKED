'use client'

import { EvolutionReportPanel } from '@/components/evolution-report-panel'
import { SourceDiffViewer } from '@/components/source-diff-viewer'
import type { EvolutionRound } from '@/lib/evolution'
import type { EvolutionReport } from '@/lib/evolution-report'
import type { SourceDiff } from '@/lib/source-diff'
import { VARIANTS } from '@/lib/tournament'
import type { Candidate } from '@/lib/tournament-client'
import type { VariantId } from '@/lib/tournament'
import { useState } from 'react'

function phaseLabel(
  phase:
    | 'idle'
    | 'generating'
    | 'architecture'
    | 'verifying'
    | 'repairing'
    | 'testing'
    | 'judging'
    | 'done',
): string {
  switch (phase) {
    case 'generating':
      return 'Generating'
    case 'architecture':
      return 'Architecture check'
    case 'verifying':
      return 'Verifying'
    case 'repairing':
      return 'Repairing'
    case 'testing':
      return 'Smoke testing'
    case 'judging':
      return 'Validating'
    case 'done':
      return 'Complete'
    default:
      return 'Ready'
  }
}

/**
 * Compact Improve progress / result UI.
 * Request entry lives in Ask EvoStack — this panel does not start API calls.
 */
export function ImproveAppPanel({
  enabled,
  busy,
  round,
  candidates,
  phase,
  report,
  sourceDiff,
  onRetry,
  onPreviewWinner,
}: {
  enabled: boolean
  busy: boolean
  round: EvolutionRound | null
  candidates?: Record<VariantId, Candidate>
  phase?:
    | 'idle'
    | 'generating'
    | 'architecture'
    | 'verifying'
    | 'repairing'
    | 'testing'
    | 'judging'
    | 'done'
  report?: EvolutionReport | null
  sourceDiff?: SourceDiff | null
  /** Re-open Ask flow — does not auto-call the API. */
  onRetry?: () => void
  onPreviewWinner?: () => void
}) {
  const [showDiff, setShowDiff] = useState(false)
  const running = round?.status === 'running' || busy
  const showProgress = !!round && round.status !== 'pending'

  if (!enabled && !showProgress) return null
  if (!showProgress) return null

  const newVersion =
    round.status === 'succeeded'
      ? (report?.newVersion ??
        (round.parentVersion != null ? round.parentVersion + 1 : undefined))
      : undefined

  return (
    <section
      className="mx-3 sm:mx-4 md:mx-6 mb-3 border border-border bg-background/80"
      aria-label="Improvement progress"
    >
      <div className="px-3 py-2 border-b border-border/70 flex items-center justify-between gap-2">
        <span className="font-mono text-[13px] tracking-[0.22em] uppercase text-muted-foreground">
          Improvement
        </span>
        {round && (
          <span className="font-mono text-[13px] text-muted-foreground">
            Round {round.roundNumber}
            {running && phase ? ` · ${phaseLabel(phase)}` : ''}
          </span>
        )}
      </div>

      <div className="px-3 py-3 space-y-3">
        <div className="font-mono text-[13px] tracking-[0.16em] uppercase text-muted-foreground">
          Parent v{round.parentVersion}
          {round.previousScore != null ? ` · Score ${round.previousScore}` : ''}
          {round.candidateMode === 'single' ? ' · 1 generation' : ''}
        </div>

        <div
          className={`grid gap-2 ${
            round.candidateMode === 'single' || round.candidates.length === 1
              ? 'grid-cols-1 max-w-sm'
              : 'grid-cols-3'
          }`}
        >
          {(round.candidateMode === 'single' || round.candidates.length === 1
            ? round.candidates
            : VARIANTS.map((v) => ({
                id: v.id,
                label: v.label,
              }))
          ).map((v) => {
            const live = candidates?.[v.id as VariantId]
            const snap = round.candidates.find((c) => c.id === v.id)
            const status = live?.status || 'pending'
            const points =
              snap?.points ??
              (live?.scoreComposite != null
                ? Math.round(live.scoreComposite * 100)
                : undefined)
            const isWinner =
              round.winnerId === v.id || live?.isWinner === true
            return (
              <div
                key={v.id}
                className={`border px-2 py-2 ${
                  isWinner
                    ? 'border-brand-accent bg-brand-accent/5'
                    : 'border-border'
                }`}
              >
                <div className="font-mono text-[13px] tracking-[0.14em] uppercase text-muted-foreground">
                  {v.label}
                  {round.candidateMode === 'single' ? ' · iteration' : ''}
                </div>
                <div className="text-[15px] mt-1 capitalize">
                  {isWinner && round.status === 'succeeded'
                    ? 'Promoted'
                    : status.replace(/_/g, ' ')}
                </div>
                {points != null && (
                  <div className="font-mono text-[15px] mt-1">{points}</div>
                )}
              </div>
            )
          })}
        </div>

        {round.status === 'succeeded' && (
          <div className="space-y-2 border-t border-border/70 pt-3">
            <div className="text-[16px]">
              <span className="font-mono text-brand-accent">
                ✓ Improved successfully
              </span>
            </div>
            <div className="font-mono text-[15px] text-muted-foreground">
              v{round.parentVersion}
              {newVersion != null ? ` → v${newVersion}` : ''}
              <span className="ml-2 text-foreground">+ New version created</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {onPreviewWinner && (
                <button
                  type="button"
                  onClick={onPreviewWinner}
                  className="font-mono text-[13px] tracking-[0.14em] uppercase px-2 py-1 border border-border hover:bg-foreground/[0.03]"
                >
                  Preview
                </button>
              )}
              {sourceDiff && (
                <button
                  type="button"
                  onClick={() => setShowDiff((v) => !v)}
                  className="font-mono text-[13px] tracking-[0.14em] uppercase px-2 py-1 border border-border hover:bg-foreground/[0.03]"
                >
                  {showDiff ? 'Hide changes' : 'View changes'}
                </button>
              )}
            </div>
          </div>
        )}

        {round.status === 'succeeded' && showDiff && (
          <SourceDiffViewer
            diff={sourceDiff || null}
            open={showDiff}
            onClose={() => setShowDiff(false)}
          />
        )}

        {round.status === 'succeeded' && report && (
          <EvolutionReportPanel report={report} />
        )}

        {round.status === 'failed' && (
          <div className="space-y-2 border-t border-border/70 pt-3">
            <p className="text-[16px]" role="status">
              Improvement wasn&apos;t promoted. Your current version is safe.
            </p>
            <p className="text-[14px] text-muted-foreground">
              Kept v{round.parentVersion}
              {round.error ? ` · ${round.error}` : ''}
            </p>
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="font-mono text-[13px] tracking-[0.14em] uppercase px-2 py-1 border border-border hover:bg-foreground/[0.03]"
              >
                Try again
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  )
}

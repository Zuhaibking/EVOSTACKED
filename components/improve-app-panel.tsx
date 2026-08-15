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
      return 'Judging'
    case 'done':
      return 'Complete'
    default:
      return 'Ready'
  }
}

/**
 * Compact Improve-this-app control + evolution round progress + report/diff.
 */
export function ImproveAppPanel({
  enabled,
  busy,
  round,
  candidates,
  phase,
  report,
  sourceDiff,
  onEvolve,
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
  onEvolve: (request: string) => void
  onPreviewWinner?: () => void
}) {
  const [request, setRequest] = useState('')
  const [showDiff, setShowDiff] = useState(false)
  const running = round?.status === 'running' || busy
  const showProgress = !!round && round.status !== 'pending'

  if (!enabled && !showProgress) return null

  return (
    <section className="mx-3 sm:mx-4 md:mx-6 mb-3 border border-border bg-background/80">
      <div className="px-3 py-2 border-b border-border/70 flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] tracking-[0.22em] uppercase text-muted-foreground">
          Improve this app
        </span>
        {round && (
          <span className="font-mono text-[10px] text-muted-foreground">
            Evolution round {round.roundNumber}
          </span>
        )}
      </div>

      {!running && (
        <div className="p-3 space-y-2">
          <textarea
            value={request}
            onChange={(e) => setRequest(e.target.value)}
            disabled={!enabled || running}
            rows={3}
            placeholder="Make the dashboard more modern and add a monthly attendance chart."
            className="w-full resize-none bg-transparent border border-border px-2.5 py-2 text-[13px] leading-snug text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:ring-1 focus:ring-brand/40"
          />
          <div className="flex justify-end">
            <button
              type="button"
              disabled={!enabled || running || request.trim().length < 3}
              onClick={() => {
                const text = request.trim()
                if (!text) return
                onEvolve(text)
                setRequest('')
                setShowDiff(false)
              }}
              className="font-mono text-[11px] tracking-[0.14em] uppercase px-3 py-1.5 border border-border bg-foreground text-background disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90"
            >
              Evolve →
            </button>
          </div>
        </div>
      )}

      {showProgress && (
        <div className="px-3 py-3 space-y-3">
          <div className="font-mono text-[10px] tracking-[0.16em] uppercase text-muted-foreground">
            Parent v{round.parentVersion}
            {round.previousScore != null ? ` · Score ${round.previousScore}` : ''}
            {phase && round.status === 'running' ? ` · ${phaseLabel(phase)}` : ''}
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
                  <div className="font-mono text-[10px] tracking-[0.14em] uppercase text-muted-foreground">
                    {v.label}
                    {round.candidateMode === 'single' ? ' · iteration' : ''}
                  </div>
                  <div className="text-[12px] mt-1 capitalize">
                    {isWinner && round.status === 'succeeded'
                      ? 'Promoted'
                      : status.replace(/_/g, ' ')}
                  </div>
                  {points != null && (
                    <div className="font-mono text-[12px] mt-1">{points}</div>
                  )}
                </div>
              )
            })}
          </div>

          {round.status === 'succeeded' && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/70 pt-2">
              <div className="text-[13px]">
                <span className="font-mono text-brand-accent">
                  {round.winnerLabel || 'Winner'} wins
                </span>
                {round.previousScore != null && round.newScore != null && (
                  <span className="ml-2 text-muted-foreground">
                    {round.previousScore} → {round.newScore}
                    {round.improvementDelta != null && (
                      <span className="ml-1">
                        {round.improvementDelta >= 0 ? '+' : ''}
                        {round.improvementDelta} points
                      </span>
                    )}
                  </span>
                )}
              </div>
              <div className="flex gap-1.5">
                {sourceDiff && (
                  <button
                    type="button"
                    onClick={() => setShowDiff((v) => !v)}
                    className="font-mono text-[10px] tracking-[0.14em] uppercase px-2 py-1 border border-border hover:bg-foreground/[0.03]"
                  >
                    {showDiff ? 'Hide changes' : 'View changes'}
                  </button>
                )}
                {onPreviewWinner && (
                  <button
                    type="button"
                    onClick={onPreviewWinner}
                    className="font-mono text-[10px] tracking-[0.14em] uppercase px-2 py-1 border border-border hover:bg-foreground/[0.03]"
                  >
                    Preview
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
            <div className="text-[12px] text-destructive border-t border-border/70 pt-2">
              Evolution failed — kept v{round.parentVersion}
              {round.error ? `. ${round.error}` : ''}
            </div>
          )}
        </div>
      )}
    </section>
  )
}

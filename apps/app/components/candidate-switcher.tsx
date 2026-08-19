'use client'

import { LoadingState } from '@/components/ui/loading-state'
import { candidateLoadingLabel } from '@/lib/arena-loading'
import { hasFragmentCode } from '@/lib/fragment'
import { stackLabelForTemplate } from '@/lib/templates'
import type { Candidate, CandidateStatus } from '@/lib/tournament-client'
import { VARIANTS, type VariantId } from '@/lib/tournament'
import {
  architectureScoreLabel,
  canActivateCandidate,
  runtimeScoreLabel,
  smokeScoreLabel,
} from '@/lib/tournament-candidates'
import { verificationHasPreviewOverlayFailure } from '@/lib/verification'

function formatPct(n?: number) {
  if (n == null || Number.isNaN(n)) return '—'
  return `${Math.round(n * 100)}`
}

export function specimenStatus(
  c: Candidate,
  earlierStillWorking: boolean,
): { label: string; tone: 'ready' | 'work' | 'queue' | 'fail' | 'idle' } {
  const status: CandidateStatus = c.status
  const overlayBroken = verificationHasPreviewOverlayFailure(
    c.finalVerification || c.verification,
  )
  if (
    status === 'error' ||
    status === 'architecture_failed' ||
    status === 'verify_failed' ||
    status === 'repair_failed' ||
    status === 'smoke_failed' ||
    overlayBroken
  ) {
    return { label: 'Failed', tone: 'fail' }
  }
  if (status === 'generating') return { label: 'Generating', tone: 'work' }
  if (status === 'architecture_checking') return { label: 'Verifying', tone: 'work' }
  if (status === 'verifying') return { label: 'Building', tone: 'work' }
  if (status === 'repairing') return { label: 'Repairing', tone: 'work' }
  if (status === 'testing') return { label: 'Testing', tone: 'work' }
  if (status === 'judging') return { label: 'Judging', tone: 'work' }
  if (
    hasFragmentCode(c.fragment) &&
    (status === 'done' ||
      status === 'verified' ||
      status === 'tested' ||
      status === 'repaired' ||
      status === 'architecture_checked' ||
      status === 'architecture_partial' ||
      status === 'not_testable')
  ) {
    return { label: 'Ready', tone: 'ready' }
  }
  if (status === 'pending' || status === 'not_attempted') {
    if (earlierStillWorking) return { label: 'Queued', tone: 'queue' }
    return { label: 'Waiting', tone: 'idle' }
  }
  if (hasFragmentCode(c.fragment)) return { label: 'Ready', tone: 'ready' }
  return { label: 'Waiting', tone: 'idle' }
}

const WORKING: CandidateStatus[] = [
  'generating',
  'architecture_checking',
  'verifying',
  'repairing',
  'testing',
  'judging',
]

export function CandidateSwitcher({
  candidates,
  selectedId,
  activeId,
  onSelect,
  onPreview,
  onViewSource,
  onUseVersion,
}: {
  candidates: Record<VariantId, Candidate>
  selectedId?: VariantId
  activeId?: VariantId
  onSelect: (id: VariantId) => void
  onPreview: (id: VariantId) => void
  onViewSource: (id: VariantId) => void
  onUseVersion: (id: VariantId) => void
}) {
  return (
    <div className="space-y-1.5">
      {VARIANTS.map((v, index) => {
        const c = candidates[v.id]
        const earlierStillWorking = VARIANTS.slice(0, index).some((prev) =>
          WORKING.includes(candidates[prev.id]?.status),
        )
        const display = specimenStatus(c, earlierStillWorking)
        const isActive = activeId === c.id
        const isSelected = selectedId === c.id
        const activation = canActivateCandidate(c)
        const hasSource = hasFragmentCode(c.fragment)
        const stack =
          c.stackLabel ||
          (c.template ? stackLabelForTemplate(c.template) : '') ||
          (typeof c.fragment?.template === 'string'
            ? stackLabelForTemplate(c.fragment.template)
            : '')
        const showStack = !!stack && stack !== 'Unknown'
        const loading = candidateLoadingLabel(c.status)
        const tone =
          display.tone === 'ready'
            ? 'text-brand-accent'
            : display.tone === 'work'
              ? 'text-brand'
              : display.tone === 'fail'
                ? 'text-destructive'
                : 'text-muted-foreground'

        return (
          <div
            key={c.id}
            className={`border px-2 py-1.5 transition-transform duration-200 motion-reduce:transition-none ${
              isActive
                ? 'border-brand-accent bg-brand-accent/5 arena-selected'
                : isSelected
                  ? 'border-foreground bg-foreground/[0.03] arena-selected'
                  : 'border-border bg-card/40 hover:-translate-y-px'
            }`}
          >
            <button
              type="button"
              onClick={() => {
                onSelect(c.id)
                if (hasSource) onPreview(c.id)
              }}
              className="w-full text-left"
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-mono text-[10px] tracking-[0.16em] uppercase">
                  {c.label}
                  {c.isWinner && hasSource ? ' *' : ''}
                </span>
                <span className="font-mono text-[11px] tabular">
                  {formatPct(c.scoreComposite)}
                </span>
              </div>
              {showStack ? (
                <span className="mt-0.5 inline-flex h-4 items-center px-1 border border-border/70 font-mono text-[8px] tracking-[0.14em] uppercase text-muted-foreground">
                  {stack}
                </span>
              ) : null}
              <div
                className={`mt-0.5 flex items-center gap-1.5 font-mono text-[9px] tracking-[0.16em] uppercase ${tone}`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    display.tone === 'work'
                      ? 'bg-brand animate-pulse motion-reduce:animate-none'
                      : display.tone === 'ready'
                        ? 'bg-brand-accent'
                        : display.tone === 'fail'
                          ? 'bg-destructive'
                          : 'bg-muted-foreground/50'
                  }`}
                />
                {display.label}
              </div>
              {loading ? (
                <div className="mt-1">
                  <LoadingState
                    label={loading}
                    variant={index === 0 ? 'orbit' : 'dots'}
                    size="compact"
                  />
                </div>
              ) : (
                <div className="mt-1 flex gap-2 font-mono text-[9px] text-muted-foreground">
                  <span>A {architectureScoreLabel(c)}</span>
                  <span>R {runtimeScoreLabel(c)}</span>
                  <span>S {smokeScoreLabel(c.smoke)}</span>
                </div>
              )}
            </button>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {hasSource && (
                <button
                  type="button"
                  onClick={() => onViewSource(c.id)}
                  className="h-5 px-1.5 font-mono text-[8px] tracking-[0.14em] uppercase border border-border hover:bg-foreground/[0.04]"
                >
                  Source
                </button>
              )}
              <button
                type="button"
                disabled={!activation.ok || isActive}
                onClick={() => onUseVersion(c.id)}
                className="h-5 px-1.5 font-mono text-[8px] tracking-[0.14em] uppercase border border-foreground disabled:opacity-30 hover:bg-foreground hover:text-background"
              >
                {isActive ? 'Active' : 'Use'}
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

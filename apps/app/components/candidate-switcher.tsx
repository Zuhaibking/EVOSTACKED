'use client'

import { LoadingState } from '@/components/ui/loading-state'
import { candidateLoadingLabel } from '@/lib/arena-loading'
import { hasFragmentCode } from '@/lib/fragment'
import { specimenStatus } from '@/lib/specimen-status'
import { stackLabelForTemplate } from '@/lib/templates'
import type { Candidate, CandidateStatus } from '@/lib/tournament-client'
import { VARIANTS, type VariantId } from '@/lib/tournament'
import { candidatePreviewIsHealthy } from '@/lib/candidate-smoke'
import {
  architectureScoreLabel,
  canActivateCandidate,
  runtimeScoreLabel,
  smokeScoreLabel,
} from '@/lib/tournament-candidates'

export { specimenStatus } from '@/lib/specimen-status'

function formatPct(n?: number) {
  if (n == null || Number.isNaN(n)) return '—'
  return `${Math.round(n * 100)}`
}

const WORKING: CandidateStatus[] = [
  'generating',
  'done',
  'architecture_checking',
  'architecture_checked',
  'architecture_partial',
  'verifying',
  'repairing',
  'testing',
  'judging',
]

export function CandidateSwitcher({
  candidates,
  selectedId,
  activeId,
  deployingId,
  onSelect,
  onPreview,
  onViewSource,
  onUseVersion,
}: {
  candidates: Record<VariantId, Candidate>
  selectedId?: VariantId
  activeId?: VariantId
  deployingId?: VariantId
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
        const display = specimenStatus(c, earlierStillWorking, {
          deploying: deployingId === c.id,
        })
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
        const loading =
          candidateLoadingLabel(c.status) ||
          (deployingId === c.id ? 'Starting' : null)
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
            className={`border px-2 py-1.5 shadow-[0_8px_30px_rgba(0,0,0,0.25)] transition-transform duration-200 motion-reduce:transition-none ${
              isActive
                ? 'border-brand-accent bg-brand-accent/5 arena-selected'
                : isSelected
                  ? 'border-foreground bg-foreground/[0.03] arena-selected'
                  : 'border-[rgba(255,255,255,0.12)] bg-card/40 hover:-translate-y-px'
            }`}
          >
            <button
              type="button"
              onClick={() => {
                onSelect(c.id)
                if (candidatePreviewIsHealthy(c) || hasSource) onPreview(c.id)
              }}
              className="w-full text-left"
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-mono text-[13px] tracking-[0.16em] uppercase">
                  {c.label}
                  {c.isWinner && hasSource ? ' *' : ''}
                </span>
                <span className="font-mono text-[14px] tabular">
                  {formatPct(c.scoreComposite)}
                </span>
              </div>
              {showStack ? (
                <span className="mt-0.5 inline-flex h-4 items-center px-1 border border-border/70 font-mono text-[10px] tracking-[0.14em] uppercase text-muted-foreground">
                  {stack}
                </span>
              ) : null}
              <div
                className={`mt-0.5 flex items-center gap-1.5 font-mono text-[11px] tracking-[0.16em] uppercase ${tone}`}
              >
                <span
                  className={`h-2 w-2 rounded-full ${
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
                <div className="mt-1 flex gap-2 font-mono text-[11px] text-muted-foreground">
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
                  className="h-5 px-1.5 font-mono text-[10px] tracking-[0.14em] uppercase border border-border hover:bg-foreground/[0.04]"
                >
                  Source
                </button>
              )}
              <button
                type="button"
                disabled={!activation.ok || isActive}
                onClick={() => onUseVersion(c.id)}
                className="h-5 px-1.5 font-mono text-[10px] tracking-[0.14em] uppercase border border-foreground disabled:opacity-30 hover:bg-foreground hover:text-background"
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

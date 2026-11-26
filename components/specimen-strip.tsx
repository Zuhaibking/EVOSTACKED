'use client'

import { fragmentCodeText } from '@/lib/schema'
import { Candidate } from '@/lib/tournament-client'
import { candidateHealthLabel } from '@/lib/candidate-health'
import { VariantId } from '@/lib/tournament'
import { rankCandidates, type RankedCandidate } from '@/lib/evidence/score'
import { DEFAULT_WEIGHTS } from '@/lib/evidence/types'
import { Check, ChevronDown, ChevronUp, Loader2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

const STATUS_COPY: Record<Candidate['status'], string> = {
  pending: 'Waiting',
  generating: 'Generating',
  done: 'Code ready',
  error: 'Failed',
  judging: 'Judging',
}

function formatPct(n?: number) {
  if (n == null || Number.isNaN(n)) return '—'
  return `${(n * 100).toFixed(0)}`
}

function statusDot(status: Candidate['status'], sandboxStatus?: Candidate['sandboxStatus']) {
  if (sandboxStatus === 'error') return 'bg-destructive'
  if (sandboxStatus === 'starting') return 'bg-brand animate-pulse'
  if (sandboxStatus === 'ready') return 'bg-brand-accent'
  if (status === 'generating') return 'bg-brand animate-pulse'
  if (status === 'done') return 'bg-brand-accent'
  if (status === 'error') return 'bg-destructive'
  return 'bg-muted-foreground/40'
}

/** Evidence-board view of a tournament candidate (measured metrics + judge + health). */
function evidenceInput(c: Candidate) {
  const failed = !!c.dqReason || c.status === 'error' || c.sandboxStatus === 'error' || c.health?.state === 'FAILED'
  return {
    id: c.id,
    evidence: c.evidence,
    judge: c.scoreClarity != null ? { clarity: c.scoreClarity, fit: c.scoreFit ?? 0, polish: c.scorePolish ?? 0 } : null,
    healthy: failed ? false : c.health?.verified || c.sandboxStatus === 'ready' ? true : null,
  }
}

/**
 * Dual-mode dock:
 *   - During generating/judging: expanded cards with live telemetry (auto-open)
 *   - When done / idle:          slim tab dock with composite scores
 * User can manually toggle once a verdict has landed.
 */
export function SpecimenStrip({
  candidates,
  selectedId,
  onSelect,
  verdictReasoning,
  phase,
  layout = 'dock',
}: {
  candidates: Record<VariantId, Candidate>
  selectedId?: VariantId
  onSelect: (id: VariantId) => void
  verdictReasoning?: string
  phase: 'idle' | 'generating' | 'judging' | 'done'
  layout?: 'dock' | 'rail'
}) {
  const list = Object.values(candidates)
  const winner = list.find((c) => c.isWinner)
  const doneCount = list.filter((c) => c.status === 'done').length
  const isLive = phase === 'generating' || phase === 'judging'
  const evidenceScores = useMemo(() => {
    const ranked = rankCandidates(Object.values(candidates).map(evidenceInput), DEFAULT_WEIGHTS)
    return new Map(ranked.filter((r) => r.measured).map((r) => [r.id, r]))
  }, [candidates])

  // Auto-open while live; collapse on verdict. User can still toggle manually.
  const [open, setOpen] = useState(true)
  useEffect(() => {
    setOpen(isLive)
  }, [isLive])

  const tabs = list.map((c, idx) => (
    <CandidateTab
      key={c.id}
      c={c}
      idx={idx}
      isSelected={selectedId === c.id}
      onSelect={() => onSelect(c.id)}
      evidence={evidenceScores.get(c.id)}
    />
  ))

  if (layout === 'rail') {
    return (
      <section aria-label="Generated versions" className="relative">
        {isLive && (
          <span
            aria-hidden
            className="absolute bottom-0 left-0 h-[2px] bg-brand/70 transition-[width] duration-700 ease-out"
            style={{ width: `${(doneCount / Math.max(list.length, 1)) * 100}%` }}
          />
        )}
        <div className="flex flex-col gap-3">{tabs}</div>
        {phase === 'done' && verdictReasoning && (
          <p className="mt-2.5 font-display italic text-[12px] sm:text-[13px] text-muted-foreground leading-relaxed">
            <span className="font-mono not-italic text-[9px] sm:text-[10px] tracking-[0.22em] uppercase text-foreground mr-2 whitespace-nowrap">
              Why this version ·
            </span>
            {verdictReasoning}
          </p>
        )}
      </section>
    )
  }

  return (
    <section
      aria-label="Generated versions"
      className="rounded-lg border border-border bg-background relative overflow-hidden"
    >
      {/* Hairline progress meter across the whole strip during gen */}
      {isLive && (
        <span
          aria-hidden
          className="absolute bottom-0 left-0 h-[2px] bg-brand/70 transition-[width] duration-700 ease-out"
          style={{ width: `${(doneCount / Math.max(list.length, 1)) * 100}%` }}
        />
      )}

      <div className="max-w-[1400px] mx-auto px-3 sm:px-4 md:px-6">
        {/* Always-on dock row — gives the tournament real visual presence even when collapsed */}
        <div className="flex items-stretch gap-2 sm:gap-3 py-2 sm:py-2.5">
          {/* Left rail — masthead label + phase meta, stacked */}
          <div className="hidden md:flex flex-col justify-center shrink-0 pr-1 border-r border-border/70 mr-1">
            <span className="text-xs font-medium text-muted-foreground leading-tight">
              Versions
            </span>
            <span className="font-mono text-[9px] tracking-[0.2em] uppercase text-foreground/70 tabular leading-tight mt-0.5">
              {phase === 'generating' && (
                <>
                  <span className="text-brand-accent">●</span> {doneCount}/{list.length} live
                </>
              )}
              {phase === 'judging' && 'judging'}
              {phase === 'done' && winner && (
                <>
                  ★ <span className="text-brand-accent">{winner.sigil}</span> wins
                </>
              )}
              {phase === 'idle' && 'awaiting'}
            </span>
          </div>

          {/* Tab strip — takes the room */}
          <div className="flex-1 grid grid-cols-1 sm:grid-cols-3 gap-2 min-w-0">
            {tabs}
          </div>

          {/* Toggle */}
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? 'Collapse version details' : 'Expand version details'}
            aria-expanded={open}
            className="self-stretch inline-flex flex-col items-center justify-center w-9 rounded-lg border border-border hover:border-brand/30 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors shrink-0 gap-0.5 focus-visible:ring-2 focus-visible:ring-brand"
          >
            {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            <span className="font-mono text-[7px] tracking-[0.2em] uppercase hidden sm:inline">
              {open ? 'hide' : 'show'}
            </span>
          </button>
        </div>

        {/* Expanded detail row */}
        {open && (
          <div className="pb-2.5 sm:pb-3 -mt-1">
            <div
              className="
                grid grid-cols-1 sm:grid-cols-3
                gap-1.5 sm:gap-2 lg:gap-2.5
              "
            >
              {list.map((c, idx) => (
                <CandidateCard
                  key={c.id}
                  c={c}
                  idx={idx}
                  isSelected={selectedId === c.id}
                  onSelect={() => onSelect(c.id)}
                />
              ))}
            </div>

            {phase === 'done' && verdictReasoning && (
              <p className="mt-2.5 font-display italic text-[12px] sm:text-[13px] text-muted-foreground leading-relaxed max-w-3xl">
                <span className="font-mono not-italic text-[9px] sm:text-[10px] tracking-[0.22em] uppercase text-foreground mr-2 whitespace-nowrap">
                  Why this version ·
                </span>
                {verdictReasoning}
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  )
}

/** A single selection target, with preview status separate from the design identity. */
function CandidateTab({
  c,
  idx,
  isSelected,
  onSelect,
  evidence,
}: {
  c: Candidate
  idx: number
  isSelected: boolean
  onSelect: () => void
  evidence?: RankedCandidate
}) {
  const isGen = c.status === 'generating'
  const isError = c.status === 'error'
  const title = c.fragment?.title || (
    isGen ? 'Creating your design…' : c.status === 'pending' ? 'Waiting to begin' : isError ? 'Generation failed' : c.label
  )
  const error = c.sandboxError || c.error
  const status = c.sandboxStatus === 'error' && error
    ? `Preview failed: ${error}`
    : candidateHealthLabel(c.status, c.health, c.sandboxStatus) ?? STATUS_COPY[c.status]

  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={c.status === 'pending' || isError}
      aria-pressed={isSelected}
      aria-label={`${c.label}: ${title}. ${status}${isSelected ? '. Selected' : ''}`}
      title={error || c.scoreComment || `${c.label} — ${title}`}
      className={`group relative flex w-full min-w-0 flex-col gap-3 overflow-hidden rounded-lg border px-3.5 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent/50 disabled:cursor-not-allowed ${
        isSelected
          ? 'border-foreground/15 bg-foreground/[0.045]'
          : 'border-border bg-card hover:border-foreground/20 hover:bg-foreground/[0.025]'
      }`}
    >
      {isSelected && <span aria-hidden className="absolute bottom-3 left-0 top-3 w-[2px] rounded-r-full bg-brand-accent/80" />}
      <span className="flex min-w-0 items-start gap-3">
        <span aria-hidden className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md border text-sm font-medium ${isSelected ? 'border-brand-accent/15 bg-brand-accent/[0.06] text-brand-accent' : 'border-border bg-background/70 text-muted-foreground'}`}>
          {c.sigil}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex items-center gap-2 font-sans text-[11px] leading-none text-muted-foreground">
            <span className="truncate">{c.label}</span>
            <span className="font-mono text-[9px] text-muted-foreground/40">{String(idx + 1).padStart(2, '0')}</span>
            {c.model?.name && (
              <span title={`Model: ${c.model.name}`} className="min-w-0 max-w-[110px] truncate rounded-full border border-border px-1.5 py-[3px] font-mono text-[9px] leading-none text-muted-foreground">
                {c.model.name}
              </span>
            )}
          </span>
          <span className="truncate font-sans text-[13px] font-medium leading-snug text-foreground">{title}</span>
        </span>
        {isSelected ? <Check aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-accent" /> : c.isWinner ? <span className="shrink-0 rounded-full bg-brand-accent/[0.06] px-2 py-1 font-sans text-[9px] leading-none text-brand-accent">Editor’s pick</span> : null}
      </span>
      <span className="flex min-w-0 items-center justify-between gap-3 pl-11">
        <span title={error} className={`flex min-w-0 items-center gap-1.5 font-sans text-[10px] ${c.sandboxStatus === 'error' || isError ? 'text-destructive' : 'text-muted-foreground/70'}`}>
          <span aria-hidden className={`h-1 w-1 shrink-0 rounded-full ${statusDot(c.status, c.sandboxStatus)}`} />
          <span className="truncate">{status}</span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {evidence && (
            <span
              title={`Evidence score — ${evidence.score.reasons.slice(0, 3).join(' · ')}`}
              className={`rounded px-1.5 py-[3px] font-mono text-[10px] leading-none tabular-nums ${
                evidence.score.disqualified ? 'bg-destructive/10 text-destructive' : evidence.rank === 1 ? 'bg-brand-accent/10 text-foreground' : 'bg-foreground/[0.05] text-muted-foreground'
              }`}
            >
              {evidence.score.disqualified ? 'DQ' : `${evidence.rank === 1 ? '★ ' : ''}${Math.round(evidence.score.total)}`}
            </span>
          )}
          {c.scoreComposite != null && <span title="Editorial score" className="font-mono text-[10px] tabular-nums text-muted-foreground/60">{c.scoreComposite.toFixed(2)}</span>}
        </span>
      </span>
    </button>
  )
}

/**
 * Detailed card — only visible when the dock is expanded.
 * Compact horizontal layout: meta column + telemetry column.
 */
function CandidateCard({
  c,
  idx,
  isSelected,
  onSelect,
}: {
  c: Candidate
  idx: number
  isSelected: boolean
  onSelect: () => void
}) {
  const isWin = !!c.isWinner
  const isGen = c.status === 'generating'
  const isPending = c.status === 'pending'
  const isError = c.status === 'error'
  const isDone = c.status === 'done' || c.status === 'judging' || isWin

  const code = fragmentCodeText(c.fragment?.code)
  const charCount = code.length
  const lineCount = code ? code.split('\n').length : 0
  const deps = Array.isArray(c.fragment?.additional_dependencies)
    ? (c.fragment.additional_dependencies.filter(Boolean) as string[])
    : []
  const tail = code ? code.split('\n').slice(-3).join('\n') : ''

  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!isGen) return
    const i = setInterval(() => setTick((t) => t + 1), 600)
    return () => clearInterval(i)
  }, [isGen])

  const tailRef = useRef<HTMLPreElement>(null)
  useEffect(() => {
    if (tailRef.current) tailRef.current.scrollTop = tailRef.current.scrollHeight
  }, [code])

  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={isPending || isError}
      className={`
        group relative w-full text-left bg-card transition-colors overflow-hidden flex flex-col focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand
        ${
          isWin
            ? 'border border-brand-accent'
            : isSelected
              ? 'border border-brand-accent bg-brand-accent/[0.025]'
              : 'border border-border hover:border-brand/40'
        }
        ${isPending || isError ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}
        rounded-lg p-0
      `}
    >
      {isGen && (
        <span aria-hidden className="pointer-events-none absolute inset-0 specimen-scan" />
      )}
      {isGen && (
        <span
          aria-hidden
          className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-brand to-transparent specimen-shimmer"
        />
      )}

      {/* Body: title + description */}
      <div className="px-2.5 lg:px-3 pt-2 lg:pt-2.5 pb-1.5 lg:pb-2 relative">
        <div className="flex items-center justify-between gap-2 mb-1">
          <p className="font-display italic text-[10px] lg:text-[11px] text-muted-foreground truncate">
            {c.label} · <span className="not-italic font-mono tracking-[0.14em] text-muted-foreground/70">{String(idx + 1).padStart(3, '0')}</span>
          </p>
          <span
            className={`font-mono text-[9px] lg:text-[10px] tracking-[0.18em] uppercase whitespace-nowrap shrink-0 inline-flex items-center gap-1 ${
              isWin
                ? 'text-brand-accent'
                : isError || c.sandboxStatus === 'error'
                  ? 'text-destructive'
                  : 'text-foreground/80'
            }`}
          >
            {(isGen || c.sandboxStatus === 'starting') && <Loader2 className="h-3 w-3 animate-spin" />}
            {isWin
              ? `★ ${candidateHealthLabel(c.status, c.health, c.sandboxStatus) || 'Selected'}`
              : (candidateHealthLabel(c.status, c.health, c.sandboxStatus) ?? STATUS_COPY[c.status])}
          </span>
        </div>

        <p className="font-display text-[13px] sm:text-[14px] lg:text-[15px] leading-tight line-clamp-2 min-h-[2.6em]">
          {c.fragment?.title || (
            <SkeletonText loading={isGen || isPending} text={isError ? 'failed' : '—'} />
          )}
        </p>
        {(c.fragment?.description || isGen) && (
          <p className="mt-1 lg:mt-1.5 text-[10px] sm:text-[11px] text-muted-foreground leading-snug line-clamp-2">
            {c.fragment?.description || (
              <span className="opacity-60 italic">drafting description…</span>
            )}
          </p>
        )}
        {(isError || c.sandboxStatus === 'error') && (
          <p className="mt-2 text-xs leading-relaxed text-destructive line-clamp-3">
            {c.sandboxError || c.error || 'This version could not be generated. Try another prompt.'}
          </p>
        )}
      </div>

      {/* Telemetry / file path */}
      {(isGen || (isDone && !c.scoreComposite)) && (
        <div className="px-2.5 lg:px-3 pb-1.5 flex items-center font-mono text-[9px] lg:text-[10px] tracking-[0.14em] uppercase text-muted-foreground tabular gap-x-1.5 lg:gap-x-2 overflow-hidden whitespace-nowrap">
          <span className="shrink-0">
            <span className="text-foreground">{lineCount.toString().padStart(3, '0')}</span>
            <span className="text-muted-foreground/60"> ln</span>
          </span>
          <span className="text-muted-foreground/30 shrink-0">·</span>
          <span className="shrink-0">
            <span className="text-foreground">{charCount.toLocaleString()}</span>
            <span className="text-muted-foreground/60"> ch</span>
          </span>
          <span className="hidden md:inline text-muted-foreground/30 shrink-0">·</span>
          <span className="hidden md:inline shrink-0">
            deps <span className="text-foreground">{deps.length}</span>
          </span>
          {isGen && (
            <span className="ml-auto text-brand shrink-0">
              {['◐', '◓', '◑', '◒'][tick % 4]}
              <span className="hidden lg:inline"> live</span>
            </span>
          )}
        </div>
      )}

      {/* Streaming code tail — only while generating */}
      {isGen && tail && (
        <pre
          ref={tailRef}
          aria-hidden
          className="mx-2.5 lg:mx-3 mb-1.5 px-2 py-1 bg-background/60 border border-border/60 font-mono text-[9px] lg:text-[10px] leading-[1.4] text-muted-foreground/90 max-h-[42px] lg:max-h-[52px] overflow-hidden whitespace-pre"
        >
          {tail}
          <span className="inline-block w-1.5 h-3 bg-brand align-[-2px] ml-0.5 animate-pulse" />
        </pre>
      )}

      {/* Deps chips */}
      {deps.length > 0 && (
        <div className="px-2.5 lg:px-3 pb-1.5 flex flex-wrap gap-1">
          {deps.slice(0, 2).map((d) => (
            <span
              key={d}
              className="font-mono text-[9px] tracking-[0.14em] uppercase border border-border px-1.5 py-0.5 text-muted-foreground truncate max-w-[120px]"
            >
              {d}
            </span>
          ))}
          {deps.slice(2, 4).map((d) => (
            <span
              key={d}
              className="hidden lg:inline-block font-mono text-[9px] tracking-[0.14em] uppercase border border-border px-1.5 py-0.5 text-muted-foreground truncate max-w-[120px]"
            >
              {d}
            </span>
          ))}
          {deps.length > 2 && (
            <span className="lg:hidden font-mono text-[9px] tracking-[0.14em] uppercase text-muted-foreground/60 px-1 py-0.5">
              +{deps.length - 2}
            </span>
          )}
          {deps.length > 4 && (
            <span className="hidden lg:inline-block font-mono text-[9px] tracking-[0.14em] uppercase text-muted-foreground/60 px-1 py-0.5">
              +{deps.length - 4}
            </span>
          )}
        </div>
      )}

      {/* push stats to bottom for matching heights */}
      <div className="flex-1" />

      {/* Stats row */}
      <dl className="grid grid-cols-3 divide-x divide-border/70 border-t border-border/70">
        <Stat label="Clarity" value={formatPct(c.scoreClarity)} pulsing={c.status === 'judging'} />
        <Stat label="Fit" value={formatPct(c.scoreFit)} pulsing={c.status === 'judging'} />
        <Stat label="Polish" value={formatPct(c.scorePolish)} pulsing={c.status === 'judging'} />
      </dl>

      {/* Composite footer + critique on hover */}
      <footer className="border-t border-border/70 px-2.5 lg:px-3 py-1.5 flex items-center justify-between gap-2">
        <span className="font-mono text-[9px] lg:text-[10px] tracking-[0.2em] uppercase text-muted-foreground">
          Composite
        </span>
        <span
          className={`font-display text-[13px] lg:text-base tabular shrink-0 ${
            isWin ? 'text-brand-accent' : ''
          }`}
        >
          {c.scoreComposite != null
            ? c.scoreComposite.toFixed(2)
            : isGen
              ? <span className="text-[10px] lg:text-[11px] text-muted-foreground/50">awaiting</span>
              : c.fragment?.code
                ? '·'
                : '—'}
        </span>
      </footer>

      {c.scoreComment && (
        <p className="hidden lg:block px-2.5 lg:px-3 pb-2 pt-1 text-[11px] italic text-muted-foreground leading-snug line-clamp-2">
          “{c.scoreComment}”
        </p>
      )}
    </button>
  )
}

function Stat({
  label,
  value,
  pulsing,
}: {
  label: string
  value: string
  pulsing?: boolean
}) {
  return (
    <div className="px-1.5 lg:px-2.5 py-1 lg:py-1.5 min-w-0">
      <dt className="font-mono text-[8px] lg:text-[9px] tracking-[0.18em] lg:tracking-[0.22em] uppercase text-muted-foreground truncate">
        {label}
      </dt>
      <dd className="font-display text-[13px] lg:text-[15px] tabular leading-none mt-0.5 truncate">
        {value === '—' && pulsing ? (
          <span className="inline-block w-6 lg:w-8 h-3 bg-foreground/20 animate-pulse align-middle" />
        ) : (
          <>
            {value}
            {value !== '—' && (
              <span className="text-[9px] lg:text-[10px] text-muted-foreground ml-0.5 hidden md:inline">
                /100
              </span>
            )}
          </>
        )}
      </dd>
    </div>
  )
}

function SkeletonText({ loading, text }: { loading: boolean; text: string }) {
  if (!loading) return <>{text}</>
  return (
    <span className="inline-flex flex-col gap-1.5">
      <span className="block h-3 w-32 bg-foreground/15 animate-pulse" />
      <span className="block h-3 w-20 bg-foreground/10 animate-pulse" />
    </span>
  )
}

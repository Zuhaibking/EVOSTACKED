'use client'

import { fragmentCodeText } from '@/lib/schema'
import { Candidate } from '@/lib/tournament-client'
import { candidateHealthLabel } from '@/lib/candidate-health'
import { VariantId } from '@/lib/tournament'
import { ChevronDown, ChevronUp, Loader2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

const STATUS_COPY: Record<Candidate['status'], string> = {
  pending: 'Standby',
  generating: 'Generating',
  done: 'Sequenced',
  error: 'Failed',
  judging: 'Judging',
}

function formatPct(n?: number) {
  if (n == null || Number.isNaN(n)) return '—'
  return `${(n * 100).toFixed(0)}`
}

function statusDot(status: Candidate['status']) {
  if (status === 'generating') return 'bg-brand animate-pulse'
  if (status === 'done') return 'bg-brand-accent'
  if (status === 'error') return 'bg-destructive'
  return 'bg-muted-foreground/40'
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
    />
  ))

  if (layout === 'rail') {
    return (
      <section aria-label="Specimens — tournament candidates" className="relative">
        {isLive && (
          <span
            aria-hidden
            className="absolute bottom-0 left-0 h-[2px] bg-brand/70 transition-[width] duration-700 ease-out"
            style={{ width: `${(doneCount / Math.max(list.length, 1)) * 100}%` }}
          />
        )}
        <div className="flex flex-col gap-1.5">{tabs}</div>
        {phase === 'done' && verdictReasoning && (
          <p className="mt-2.5 font-display italic text-[12px] sm:text-[13px] text-muted-foreground leading-relaxed">
            <span className="font-mono not-italic text-[9px] sm:text-[10px] tracking-[0.22em] uppercase text-foreground mr-2 whitespace-nowrap">
              Editor’s note ·
            </span>
            {verdictReasoning}
          </p>
        )}
      </section>
    )
  }

  return (
    <section
      aria-label="Specimens — tournament candidates"
      className="border-b border-border/60 bg-background/95 relative"
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
            <span className="font-mono text-[9px] tracking-[0.26em] uppercase text-muted-foreground leading-tight">
              § Specimens
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
          <div className="flex-1 grid grid-cols-3 gap-1 sm:gap-1.5 min-w-0">
            {tabs}
          </div>

          {/* Toggle */}
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? 'Collapse specimens' : 'Expand specimens'}
            aria-expanded={open}
            className="self-stretch inline-flex flex-col items-center justify-center w-8 sm:w-9 border border-border hover:border-foreground/70 hover:bg-foreground/[0.04] text-muted-foreground hover:text-foreground transition-colors shrink-0 gap-0.5"
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
                  Editor’s note ·
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

/**
 * Two-line "candidate tab": sigil column + meta row + title row.
 * Slim but substantial — feels like a newspaper section bookmark, not a chip.
 */
function CandidateTab({
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

  const composite =
    c.scoreComposite != null
      ? c.scoreComposite.toFixed(2)
      : isGen
        ? '·'
        : c.fragment?.code
          ? '·'
          : '—'

  const title =
    c.fragment?.title ||
    (isGen ? 'streaming…' : isPending ? 'standby' : isError ? 'failed' : '—')

  return (
    <div
      aria-current={isSelected ? 'true' : undefined}
      title={`${c.label}${c.fragment?.title ? ' — ' + c.fragment.title : ''}`}
      className={`
        group relative flex items-stretch h-12 sm:h-[52px] text-left min-w-0
        border transition-colors overflow-hidden
        ${
          isSelected
            ? 'border-brand-accent bg-brand-accent/[0.06] text-foreground shadow-[2px_2px_0_0_hsl(var(--brand)/0.18)]'
            : isWin
              ? 'border-brand-accent/50 bg-brand-accent/[0.03] text-foreground'
              : 'border-border text-foreground/85'
        }
        ${isPending || isError ? 'opacity-55' : ''}
      `}
    >
      {/* Live shimmer rail */}
      {isGen && (
        <span
          aria-hidden
          className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-brand to-transparent specimen-shimmer"
        />
      )}

      {/* Sigil column — full-height brutalist square */}
      <span
        className={`flex items-center justify-center w-9 sm:w-11 shrink-0 border-r font-display text-[15px] sm:text-[17px] font-black leading-none ${
          isSelected
            ? 'border-brand-accent/60 text-brand-accent bg-brand-accent/[0.06]'
            : isWin
              ? 'border-brand-accent/60 text-brand-accent bg-brand-accent/[0.06]'
              : 'border-border text-foreground/80 bg-foreground/[0.015]'
        }`}
      >
        {c.sigil}
      </span>

      {/* Content column */}
      <span className="flex-1 min-w-0 flex flex-col justify-center px-2 sm:px-2.5 py-1 gap-0.5">
        <span className="flex items-center gap-1.5 min-w-0">
          <span className="font-mono text-[9px] sm:text-[10px] tracking-[0.2em] uppercase text-muted-foreground shrink-0">
            {c.label}
          </span>
          <span className="font-mono text-[8px] tracking-[0.16em] uppercase text-muted-foreground/50 tabular shrink-0 hidden md:inline">
            · {String(idx + 1).padStart(2, '0')}
          </span>
          <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${statusDot(c.status)}`} />
          {isWin && <span className="text-brand-accent text-[11px] leading-none shrink-0">★</span>}
        </span>

        {/* Row 2 — candidate title (the actual generated identity) */}
        <span
          className={`font-display text-[12px] sm:text-[13px] leading-tight truncate ${
            isGen ? 'italic text-muted-foreground/70' : 'text-foreground'
          }`}
        >
          {isGen && !c.fragment?.title ? (
            <span className="inline-flex items-center gap-1.5">
              <Loader2 className="h-2.5 w-2.5 animate-spin" />
              streaming…
            </span>
          ) : (
            title
          )}
        </span>
      </span>

      <span
        className={`flex items-center px-1.5 sm:px-2 font-display text-[12px] sm:text-[13px] tabular leading-none shrink-0 ${
          isSelected || isWin ? 'text-brand-accent' : 'text-foreground'
        }`}
      >
        {composite}
      </span>

      {isSelected ? (
        <span
          className="flex items-center justify-center min-w-[3.75rem] sm:min-w-[4.25rem] shrink-0 border-l border-brand-accent/50 px-2 font-mono text-[9px] sm:text-[10px] tracking-[0.18em] uppercase text-brand-accent"
        >
          ACTIVE
        </span>
      ) : (
        <button
          type="button"
          onClick={onSelect}
          disabled={isPending || isError}
          aria-label={`Use ${c.label}`}
          className="flex items-center justify-center min-w-[3.75rem] sm:min-w-[4.25rem] shrink-0 border-l border-border px-2 font-mono text-[9px] sm:text-[10px] tracking-[0.18em] uppercase text-foreground hover:bg-foreground/[0.06] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
        >
          USE
        </button>
      )}
    </div>
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
        group relative w-full text-left bg-card transition-all overflow-hidden flex flex-col
        ${
          isWin
            ? 'border-2 border-brand-accent shadow-[3px_3px_0_0_hsl(var(--brand)/0.25)]'
            : isSelected
              ? 'border-2 border-foreground'
              : 'border border-border hover:border-foreground/60'
        }
        ${isPending || isError ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}
        rounded-none p-0
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
                : isError
                  ? 'text-destructive'
                  : 'text-foreground/80'
            }`}
          >
            {isGen && <Loader2 className="h-3 w-3 animate-spin" />}
            {isWin
              ? `★ ${candidateHealthLabel(c.status, c.health) || 'Survived'}`
              : (candidateHealthLabel(c.status, c.health) ?? STATUS_COPY[c.status])}
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

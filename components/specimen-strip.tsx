'use client'

import { Candidate } from '@/lib/tournament-client'
import { VariantId } from '@/lib/tournament'
import { Loader2 } from 'lucide-react'
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

export function SpecimenStrip({
  candidates,
  selectedId,
  onSelect,
  verdictReasoning,
  phase,
}: {
  candidates: Record<VariantId, Candidate>
  selectedId?: VariantId
  onSelect: (id: VariantId) => void
  verdictReasoning?: string
  phase: 'idle' | 'generating' | 'judging' | 'done'
}) {
  const list = Object.values(candidates)
  const winner = list.find((c) => c.isWinner)

  return (
    <section
      aria-label="Specimens — tournament candidates"
      className="border-b border-border/60 bg-background/80"
    >
      <div className="max-w-[1400px] mx-auto px-4 md:px-6 py-3">
        <div className="flex items-baseline justify-between mb-3">
          <p className="font-mono text-[10px] tracking-[0.24em] uppercase text-muted-foreground">
            § Specimens · {list.length} candidates
          </p>
          <p className="font-mono text-[10px] tracking-[0.22em] uppercase text-muted-foreground tabular">
            {phase === 'generating' && (
              <>
                Sequencing in parallel{' '}
                <span className="text-brand-accent">
                  · {list.filter((c) => c.status === 'done').length}/{list.length}
                </span>
              </>
            )}
            {phase === 'judging' && 'Editor in deliberation'}
            {phase === 'done' && winner && (
              <>
                Verdict ·{' '}
                <span className="text-brand-accent">
                  {winner.label} prevails
                </span>
              </>
            )}
            {phase === 'idle' && 'Awaiting brief'}
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4">
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
          <p className="mt-3 font-display italic text-[13px] text-muted-foreground leading-relaxed max-w-3xl">
            <span className="font-mono not-italic text-[10px] tracking-[0.22em] uppercase text-foreground mr-2">
              Editor’s note ·
            </span>
            {verdictReasoning}
          </p>
        )}
      </div>
    </section>
  )
}

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

  // Live metrics derived from the streaming fragment
  const code = (c.fragment?.code as string | undefined) ?? ''
  const charCount = code.length
  const lineCount = code ? code.split('\n').length : 0
  const deps = (c.fragment?.additional_dependencies as string[] | undefined) ?? []
  const tail = code ? code.split('\n').slice(-5).join('\n') : ''

  // Smoothed counter so the card feels alive even if no chars are flowing
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!isGen) return
    const i = setInterval(() => setTick((t) => t + 1), 600)
    return () => clearInterval(i)
  }, [isGen])

  // Auto-scroll the live code tail to the bottom as it grows
  const tailRef = useRef<HTMLPreElement>(null)
  useEffect(() => {
    if (tailRef.current) tailRef.current.scrollTop = tailRef.current.scrollHeight
  }, [code])

  return (
    <button
      onClick={onSelect}
      disabled={isPending || isError}
      className={`group relative text-left bg-card transition-all overflow-hidden ${
        isWin
          ? 'border-2 border-brand-accent shadow-[6px_6px_0_0_hsl(var(--brand)/0.3)]'
          : isSelected
            ? 'border-2 border-foreground'
            : 'border border-border hover:border-foreground/60'
      } ${isPending || isError ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'} rounded-none p-0`}
    >
      {/* Scanline shimmer when generating */}
      {isGen && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 specimen-scan"
        />
      )}

      {/* Top edge progress bar — visible during gen */}
      {isGen && (
        <span
          aria-hidden
          className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-brand to-transparent specimen-shimmer"
        />
      )}

      <header className="flex items-center justify-between border-b border-border/70 px-3 py-2 relative">
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center justify-center h-5 w-5 border font-display text-[11px] font-black ${
              isWin
                ? 'border-brand-accent text-brand-accent'
                : 'border-foreground'
            }`}
          >
            {c.sigil}
          </span>
          <span className="font-mono text-[10px] tracking-[0.22em] uppercase text-muted-foreground">
            Candidate · {String(idx + 1).padStart(3, '0')}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className={`h-1.5 w-1.5 rounded-full ${statusDot(c.status)}`} />
          <span
            className={`font-mono text-[10px] tracking-[0.22em] uppercase ${
              isWin
                ? 'text-brand-accent'
                : isError
                  ? 'text-destructive'
                  : 'text-foreground/80'
            }`}
          >
            {isGen && (
              <Loader2 className="inline-block h-3 w-3 mr-1 animate-spin" />
            )}
            {isWin ? 'Survived' : STATUS_COPY[c.status]}
          </span>
        </div>
      </header>

      <div className="px-3 pt-3 pb-2 relative">
        <p className="font-display italic text-[11px] text-muted-foreground mb-0.5">
          {c.label}
        </p>
        <p className="font-display text-[15px] leading-tight line-clamp-2 min-h-[2.6em]">
          {c.fragment?.title || (
            <SkeletonText
              loading={isGen || isPending}
              text={isError ? 'failed' : '—'}
            />
          )}
        </p>
        {(c.fragment?.description || isGen) && (
          <p className="mt-1.5 text-[11px] text-muted-foreground leading-snug line-clamp-2 min-h-[1.7em]">
            {c.fragment?.description || (
              <span className="opacity-60 italic">drafting description…</span>
            )}
          </p>
        )}
      </div>

      {/* Live telemetry row during generation */}
      {(isGen || (isDone && !c.scoreComposite)) && (
        <div className="px-3 pb-2 flex items-center justify-between font-mono text-[10px] tracking-[0.18em] uppercase text-muted-foreground tabular gap-2 flex-wrap">
          <span>
            <span className="text-foreground">{lineCount.toString().padStart(3, '0')}</span>
            <span className="text-muted-foreground/60"> ln</span>
          </span>
          <span className="text-muted-foreground/30">·</span>
          <span>
            <span className="text-foreground">
              {charCount.toLocaleString()}
            </span>
            <span className="text-muted-foreground/60"> ch</span>
          </span>
          <span className="text-muted-foreground/30">·</span>
          <span>
            deps <span className="text-foreground">{deps.length}</span>
          </span>
          {isGen && (
            <>
              <span className="text-muted-foreground/30">·</span>
              <span className="text-brand">
                {['◐', '◓', '◑', '◒'][tick % 4]} live
              </span>
            </>
          )}
        </div>
      )}

      {/* File path during gen / done */}
      {c.fragment?.file_path && (
        <div className="px-3 pb-2 font-mono text-[10px] tracking-[0.14em] text-muted-foreground/80 truncate">
          <span className="text-muted-foreground/50">¶ </span>
          {c.fragment.file_path}
        </div>
      )}

      {/* Stack / deps chips */}
      {deps.length > 0 && (
        <div className="px-3 pb-2 flex flex-wrap gap-1">
          {deps.slice(0, 4).map((d) => (
            <span
              key={d}
              className="font-mono text-[9px] tracking-[0.14em] uppercase border border-border px-1.5 py-0.5 text-muted-foreground"
            >
              {d}
            </span>
          ))}
          {deps.length > 4 && (
            <span className="font-mono text-[9px] tracking-[0.14em] uppercase text-muted-foreground/60 px-1 py-0.5">
              +{deps.length - 4}
            </span>
          )}
        </div>
      )}

      {/* Live streaming code tail — only while generating */}
      {isGen && tail && (
        <pre
          ref={tailRef}
          aria-hidden
          className="mx-3 mb-3 px-2 py-1.5 bg-background/60 border border-border/60 font-mono text-[10px] leading-[1.4] text-muted-foreground/90 max-h-[68px] overflow-hidden whitespace-pre"
        >
          {tail}
          <span className="inline-block w-1.5 h-3 bg-brand align-[-2px] ml-0.5 animate-pulse" />
        </pre>
      )}

      <dl className="grid grid-cols-3 divide-x divide-border/70 border-t border-border/70">
        <Stat label="Clarity" value={formatPct(c.scoreClarity)} pulsing={c.status === 'judging'} />
        <Stat label="Fit" value={formatPct(c.scoreFit)} pulsing={c.status === 'judging'} />
        <Stat label="Polish" value={formatPct(c.scorePolish)} pulsing={c.status === 'judging'} />
      </dl>

      <footer className="border-t border-border/70 px-3 py-2 flex items-center justify-between">
        <span className="font-mono text-[10px] tracking-[0.22em] uppercase text-muted-foreground">
          Composite
        </span>
        <span
          className={`font-display text-base tabular ${
            isWin ? 'text-brand-accent' : ''
          }`}
        >
          {c.scoreComposite != null
            ? c.scoreComposite.toFixed(2)
            : isGen
              ? <span className="text-muted-foreground/50">awaiting</span>
              : c.fragment?.code
                ? '·'
                : '—'}
        </span>
      </footer>

      {c.scoreComment && (
        <p className="px-3 pb-3 text-[11px] italic text-muted-foreground leading-snug">
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
    <div className="px-3 py-2">
      <dt className="font-mono text-[9px] tracking-[0.24em] uppercase text-muted-foreground">
        {label}
      </dt>
      <dd className="font-display text-base tabular leading-none mt-1">
        {value === '—' && pulsing ? (
          <span className="inline-block w-8 h-3 bg-foreground/20 animate-pulse align-middle" />
        ) : (
          <>
            {value}
            {value !== '—' && (
              <span className="text-[10px] text-muted-foreground ml-0.5">
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

'use client'

import {
  disqualification,
  formatKB,
  formatMs,
  formatPercent,
  normalizeJudgeValue,
  rankCandidates,
  relHigher,
  relLower,
  type RankedCandidate,
} from '@/lib/evidence/score'
import { DEFAULT_WEIGHTS, type EvidenceMetrics, type EvidenceWeights } from '@/lib/evidence/types'
import { Check, ChevronDown, Crown, FlaskConical, Gauge, Loader2, Palette, RotateCcw, ShieldCheck, Sparkles } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'

type Judge = { clarity: number; fit: number; polish: number }
type BoardCandidate = {
  id: string
  label: string
  modelName?: string
  evidence?: EvidenceMetrics
  judge?: Judge | null
  healthy?: boolean | null
  /** What the candidate is waiting on before it can be measured (e.g. "Generating…"). */
  stage?: string
}
type PartKey = keyof EvidenceWeights

const PARTS: { key: PartKey; label: string; icon: typeof Gauge; hint: string }[] = [
  { key: 'performance', label: 'Performance', icon: Gauge, hint: 'p50 / p95 latency, throughput, page weight' },
  { key: 'reliability', label: 'Reliability', icon: ShieldCheck, hint: 'error rate, typecheck, repairs, runtime errors' },
  { key: 'quality', label: 'Quality', icon: Sparkles, hint: 'accessibility, SEO, best-practice audits' },
  { key: 'design', label: 'Design', icon: Palette, hint: "judge's clarity / fit / polish" },
]

// rank · candidate · score · p50 · p95 · JS · errors · a11y · seo · bp · clarity · fit · polish · expand
const COLS =
  'grid-cols-[28px_minmax(170px,1.5fr)_96px_68px_68px_68px_60px_38px_38px_38px_50px_50px_50px_24px]'

/* ───────────────────────────── small visual atoms ───────────────────────────── */

/** Severity for a relative or absolute 0–100 score. Color is never the only channel — values are always printed. */
function tone(score: number | null | undefined): string {
  if (score == null) return 'bg-foreground/15'
  if (score >= 90) return 'bg-brand-accent'
  if (score >= 70) return 'bg-amber-500'
  return 'bg-destructive'
}
function strokeTone(score: number): string {
  if (score >= 90) return 'stroke-brand-accent'
  if (score >= 50) return 'stroke-amber-500'
  return 'stroke-destructive'
}

function Bar({ value }: { value: number | null }) {
  return (
    <span aria-hidden className="mt-1 block h-[3px] w-full overflow-hidden rounded-full bg-foreground/[0.07]">
      <span
        className={`block h-full rounded-full transition-[width] duration-500 ease-out ${tone(value)}`}
        style={{ width: `${Math.max(4, value ?? 0)}%` }}
      />
    </span>
  )
}

function Skel({ w = 'w-10' }: { w?: string }) {
  return <span aria-hidden className={`inline-block h-3 ${w} animate-pulse rounded bg-foreground/10`} />
}

/** A value + unit and a best-to-worst bar (`rel` 0–100, 100 = best of the field). */
function MetricCell({ text, rel, best, title }: { text: string; rel: number | null; best?: boolean; title?: string }) {
  const [num, unit] = text === '—' ? ['—', ''] : [text.replace(/\s?[A-Za-z%]+$/, ''), text.match(/[A-Za-z%]+$/)?.[0] ?? '']
  return (
    <div role="cell" className="min-w-0" title={title}>
      <span className={`block truncate font-mono text-[12px] tabular-nums leading-none ${best ? 'text-foreground font-medium' : 'text-foreground/80'}`}>
        {num}
        {unit && <span className="ml-0.5 text-[10px] font-normal text-muted-foreground">{unit}</span>}
      </span>
      <Bar value={rel} />
    </div>
  )
}

function Dial({ audit, audited, label }: { audit: { score: number; issues: string[] }; audited: boolean; label: string }) {
  const r = 12
  const c = 2 * Math.PI * r
  const score = Math.round(audit.score)
  const title = audited
    ? `${label} ${score}/100${audit.issues.length ? ` — ${audit.issues.join('; ')}` : ' — no issues found'}`
    : `${label}: not audited`
  return (
    <div role="cell" className="flex justify-center" title={title} aria-label={title}>
      {audited ? (
        <svg viewBox="0 0 30 30" className="h-[30px] w-[30px]">
          <circle cx="15" cy="15" r={r} fill="none" strokeWidth="2.5" className="stroke-foreground/[0.08]" />
          <circle
            cx="15"
            cy="15"
            r={r}
            fill="none"
            strokeWidth="2.5"
            strokeLinecap="round"
            transform="rotate(-90 15 15)"
            className={`${strokeTone(score)} transition-[stroke-dashoffset] duration-700 ease-out`}
            strokeDasharray={c}
            strokeDashoffset={c * (1 - Math.max(0.02, score / 100))}
          />
          <text
            x="15"
            y="15"
            dy="0.35em"
            textAnchor="middle"
            className="fill-foreground font-mono text-[9px] tabular-nums"
          >
            {score}
          </text>
        </svg>
      ) : (
        <span className="font-mono text-[11px] text-muted-foreground/60">—</span>
      )}
    </div>
  )
}

/* ───────────────────────────── board ───────────────────────────── */

export function EvidenceBoard({
  candidates,
  winnerId,
  weights,
  onWeightsChange,
  onSelect,
  selectedId,
}: {
  candidates: BoardCandidate[]
  winnerId?: string | null
  weights: EvidenceWeights
  onWeightsChange: (w: EvidenceWeights) => void
  onSelect?: (id: string) => void
  selectedId?: string | null
}) {
  // Mirror weights locally so sliders re-rank instantly even if the parent re-renders slowly.
  const [w, setW] = useState<EvidenceWeights>(weights)
  useEffect(() => {
    setW(weights)
  }, [weights])

  const ranked = useMemo(() => rankCandidates(candidates, w), [candidates, w])
  const [expanded, setExpanded] = useState<string | null>(null)

  // Field values for best-to-worst bars (eligible, measured candidates only).
  const field = useMemo(() => {
    const ev = candidates.filter((c) => !disqualification(c)).map((c) => c.evidence).filter((e): e is EvidenceMetrics => !!e)
    const judge = (k: keyof Judge) => candidates.filter((c) => !disqualification(c)).map((c) => normalizeJudgeValue(c.judge?.[k]))
    return {
      p50: ev.map((e) => e.ttfbP50Ms),
      p95: ev.map((e) => e.ttfbP95Ms),
      js: ev.map((e) => e.jsBytes),
      clarity: judge('clarity'),
      fit: judge('fit'),
      polish: judge('polish'),
    }
  }, [candidates])

  // FLIP: animate rows from their previous offsetTop to the new one whenever layout changes.
  const rowRefs = useRef(new Map<string, HTMLDivElement>())
  const prevTops = useRef(new Map<string, number>())
  useLayoutEffect(() => {
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const next = new Map<string, number>()
    rowRefs.current.forEach((el, id) => {
      const top = el.offsetTop
      next.set(id, top)
      const prev = prevTops.current.get(id)
      if (reduce || prev == null || Math.abs(prev - top) < 1) return
      el.style.transition = 'none'
      el.style.transform = `translateY(${prev - top}px)`
      void el.offsetHeight // commit the inverted position before playing
      requestAnimationFrame(() => {
        el.style.transition = 'transform 460ms cubic-bezier(0.2, 0.8, 0.2, 1)'
        el.style.transform = ''
      })
    })
    prevTops.current = next
  })

  const measuring = candidates.filter((c) => !c.evidence && c.healthy !== false && (!c.stage || /measur/i.test(c.stage))).length
  const leader = ranked.find((r) => r.measured && !r.score.disqualified) ?? null
  const runnerUp = leader ? ranked.find((r) => r.id !== leader.id && r.measured && !r.score.disqualified) ?? null : null
  const requests = Math.max(0, ...candidates.map((c) => c.evidence?.requests ?? 0)) || 60
  const totalWeight = Math.max(1, w.performance + w.reliability + w.quality + w.design)

  const setPart = (key: PartKey, value: number) => {
    const nextW = { ...w, [key]: value }
    setW(nextW)
    onWeightsChange(nextW)
  }
  const reset = () => {
    setW(DEFAULT_WEIGHTS)
    onWeightsChange(DEFAULT_WEIGHTS)
  }

  return (
    <section aria-label="Evidence leaderboard" className="@container overflow-hidden rounded-lg border border-border bg-card text-card-foreground">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-sm font-medium text-foreground">
            <FlaskConical aria-hidden className="h-4 w-4 text-brand" />
            Evidence leaderboard
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">Ranked on measured speed, reliability and quality, not taste alone.</p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-[11px] text-muted-foreground" aria-live="polite">
          {measuring > 0 ? (
            <>
              <Loader2 aria-hidden className="h-3 w-3 animate-spin text-brand" />
              Measuring {measuring} of {candidates.length}…
            </>
          ) : (
            <>
              <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-brand-accent" />
              {candidates.length} measured
            </>
          )}
        </span>
      </header>

      <div className="grid grid-cols-1 @4xl:grid-cols-[minmax(0,1fr)_272px]">
        {/* ── Leaderboard ── */}
        <div className="min-w-0 overflow-x-auto">
          <div role="table" aria-label="Candidates ranked by evidence score" className="min-w-[960px] px-2 pb-2">
            <div role="rowgroup">
              <div aria-hidden className={`grid ${COLS} items-end gap-2 px-2 pt-3 text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground/80`}>
                <span />
                <span />
                <span />
                <span className="col-span-3 border-b border-border/70 pb-1">Performance · {Math.round((w.performance / totalWeight) * 100)}%</span>
                <span className="border-b border-border/70 pb-1">Reliab. · {Math.round((w.reliability / totalWeight) * 100)}%</span>
                <span className="col-span-3 border-b border-border/70 pb-1 text-center">Quality · {Math.round((w.quality / totalWeight) * 100)}%</span>
                <span className="col-span-3 border-b border-border/70 pb-1">Design · {Math.round((w.design / totalWeight) * 100)}%</span>
                <span aria-hidden />
              </div>
              <div role="row" className={`grid ${COLS} items-center gap-2 border-b border-border px-2 py-1.5 text-[11px] text-muted-foreground`}>
                <span role="columnheader" className="text-center">#</span>
                <span role="columnheader">Version</span>
                <span role="columnheader">Score</span>
                <span role="columnheader" title="Median time to first byte">p50</span>
                <span role="columnheader" title="95th percentile time to first byte">p95</span>
                <span role="columnheader" title="JavaScript shipped (uncompressed, dev build)">JS</span>
                <span role="columnheader" title="Non-2xx or failed requests in the burst">Errors</span>
                <span role="columnheader" className="text-center" title="Accessibility audit">A11y</span>
                <span role="columnheader" className="text-center">SEO</span>
                <span role="columnheader" className="text-center" title="Best practices audit">BP</span>
                <span role="columnheader">Clarity</span>
                <span role="columnheader">Fit</span>
                <span role="columnheader">Polish</span>
                <span role="columnheader" className="sr-only">Details</span>
              </div>
            </div>

            <div role="rowgroup" className="relative">
              {ranked.map((r) => (
                <Row
                  key={r.id}
                  r={r}
                  isLeader={leader?.id === r.id}
                  isJudgePick={!!winnerId && winnerId === r.id}
                  isSelected={!!selectedId && selectedId === r.id}
                  expanded={expanded === r.id}
                  onToggle={() => setExpanded((cur) => (cur === r.id ? null : r.id))}
                  onSelect={onSelect}
                  field={field}
                  rowRef={(el) => {
                    if (el) rowRefs.current.set(r.id, el)
                    else rowRefs.current.delete(r.id)
                  }}
                />
              ))}
              {!ranked.length && <p className="px-3 py-8 text-center text-sm text-muted-foreground">No versions to compare yet.</p>}
            </div>
          </div>
        </div>

        {/* ── Weights + why ── */}
        <aside className="border-t border-border @4xl:border-l @4xl:border-t-0">
          <div className="px-4 py-3">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-medium text-foreground">What matters to you</h4>
              <button
                type="button"
                onClick={reset}
                className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <RotateCcw aria-hidden className="h-3 w-3" /> Reset
              </button>
            </div>
            <div className="mt-3 space-y-3">
              {PARTS.map(({ key, label, icon: Icon, hint }) => (
                <label key={key} className="block" title={hint}>
                  <span className="flex items-center justify-between text-[12px]">
                    <span className="inline-flex items-center gap-1.5 text-foreground/90">
                      <Icon aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />
                      {label}
                    </span>
                    <span className="font-mono text-[11px] tabular-nums text-muted-foreground">{Math.round((w[key] / totalWeight) * 100)}%</span>
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={w[key]}
                    onChange={(e) => setPart(key, Number(e.target.value))}
                    aria-label={`${label} weight`}
                    aria-valuetext={`${w[key]} (${Math.round((w[key] / totalWeight) * 100)}% of the score)`}
                    className="mt-1.5 h-1.5 w-full cursor-pointer accent-brand"
                  />
                </label>
              ))}
            </div>
          </div>

          <div className="border-t border-border px-4 py-3">
            <h4 className="flex items-center gap-1.5 text-xs font-medium text-foreground">
              <Crown aria-hidden className="h-3.5 w-3.5 text-amber-500" />
              {leader ? `Why ${leader.candidate.label} is #1` : 'Why #1 wins'}
            </h4>
            {leader ? (
              <>
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                  Score {leader.score.total.toFixed(1)}
                  {runnerUp ? ` — leads ${runnerUp.candidate.label} by ${(leader.score.total - runnerUp.score.total).toFixed(1)} pts` : ''}
                  {winnerId && winnerId !== leader.id
                    ? `. The judge preferred ${candidates.find((c) => c.id === winnerId)?.label ?? 'another version'} on taste.`
                    : '.'}
                </p>
                <ul className="mt-2 space-y-1.5">
                  {leader.score.reasons.slice(0, 6).map((reason) => (
                    <li key={reason} className="flex items-start gap-2 text-[12px] leading-snug text-foreground/90">
                      <Check aria-hidden className="mt-0.5 h-3 w-3 shrink-0 text-brand-accent" />
                      <span>{reason}</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <div className="mt-2 space-y-2" aria-label="Collecting evidence">
                <Skel w="w-44" />
                <Skel w="w-36" />
                <Skel w="w-40" />
              </div>
            )}
          </div>
        </aside>
      </div>

      <footer className="border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
        Measured live in each sandbox (dev server) · {requests} requests · relative ranking
      </footer>
    </section>
  )
}

/* ───────────────────────────── row ───────────────────────────── */

function Row({
  r,
  isLeader,
  isJudgePick,
  isSelected,
  expanded,
  onToggle,
  onSelect,
  field,
  rowRef,
}: {
  r: RankedCandidate<BoardCandidate>
  isLeader: boolean
  isJudgePick: boolean
  isSelected: boolean
  expanded: boolean
  onToggle: () => void
  onSelect?: (id: string) => void
  field: Record<'p50' | 'p95' | 'js' | 'clarity' | 'fit' | 'polish', (number | null)[]>
  rowRef: (el: HTMLDivElement | null) => void
}) {
  const c = r.candidate
  const e = c.evidence
  const dq = disqualification(c)
  const pending = !e && !dq
  const audited = !!e && e.htmlBytes != null
  const judge = c.judge
  const j = (k: keyof Judge) => normalizeJudgeValue(judge?.[k])
  const isMin = (v: number | null | undefined, xs: (number | null)[]) => v != null && xs.filter((x) => x != null).length > 1 && v <= Math.min(...(xs.filter((x) => x != null) as number[]))
  const isMax = (v: number | null | undefined, xs: (number | null)[]) => v != null && xs.filter((x) => x != null).length > 1 && v >= Math.max(...(xs.filter((x) => x != null) as number[]))
  const metric = (node: ReactNode) => (pending ? <div role="cell"><Skel /></div> : node)
  const judgeCell = (k: keyof Judge) => {
    const v = j(k)
    return v == null ? (
      <div role="cell" className="font-mono text-[11px] text-muted-foreground/60">—</div>
    ) : (
      <MetricCell text={String(Math.round(v))} rel={relHigher(v, field[k])} best={isMax(v, field[k])} />
    )
  }

  return (
    <div ref={rowRef} className="relative will-change-transform">
      <div
        role="row"
        aria-selected={isSelected}
        onClick={() => onSelect?.(c.id)}
        className={`group grid ${COLS} items-center gap-2 rounded-md px-2 py-2.5 transition-colors ${onSelect ? 'cursor-pointer' : ''} ${
          isSelected ? 'bg-foreground/[0.05]' : 'hover:bg-foreground/[0.025]'
        } ${dq ? 'opacity-70' : ''}`}
      >
        {isSelected && <span aria-hidden className="absolute bottom-2 left-0 top-2 w-[2px] rounded-r-full bg-brand" />}
        <div role="cell" className="flex justify-center">
          {isLeader ? (
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-500/15" title="Evidence #1">
              <Crown aria-label="Rank 1" className="h-3.5 w-3.5 text-amber-500" />
            </span>
          ) : (
            <span className="font-mono text-[12px] tabular-nums text-muted-foreground">{dq ? '—' : r.rank}</span>
          )}
        </div>

        <div role="cell" className="min-w-0">
          <button
            type="button"
            className="flex min-w-0 max-w-full items-center gap-2 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={`Select ${c.label}`}
          >
            <span className="truncate text-[13px] font-medium text-foreground">{c.label}</span>
            {c.modelName && (
              <span className="shrink-0 truncate rounded-full border border-border bg-background/60 px-1.5 py-0.5 font-mono text-[10px] leading-none text-muted-foreground max-w-[120px]" title={`Model: ${c.modelName}`}>
                {c.modelName}
              </span>
            )}
          </button>
          <div className="mt-1 flex min-w-0 items-center gap-1.5">
            {dq ? (
              <span className="inline-flex min-w-0 items-center gap-1 rounded bg-destructive/10 px-1.5 py-0.5 text-[10px] font-medium text-destructive" title={dq}>
                DQ <span className="truncate font-normal">· {dq}</span>
              </span>
            ) : pending ? (
              <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                <Loader2 aria-hidden className="h-2.5 w-2.5 animate-spin" /> {c.stage ?? 'Measuring…'}
              </span>
            ) : (
              <span className="truncate text-[10px] text-muted-foreground" title={r.score.reasons.join(' · ')}>
                {r.score.reasons[0]}
              </span>
            )}
            {isJudgePick && (
              <span className="shrink-0 rounded-full bg-brand/10 px-1.5 py-0.5 text-[10px] leading-none text-brand">Judge’s pick</span>
            )}
          </div>
        </div>

        <div role="cell" className="min-w-0">
          {pending ? (
            <Skel w="w-12" />
          ) : (
            <>
              <span className={`font-mono text-[17px] font-medium tabular-nums leading-none ${dq ? 'text-muted-foreground line-through' : 'text-foreground'}`}>
                {dq ? '0' : r.score.total.toFixed(1)}
              </span>
              <span aria-hidden className="mt-1.5 block h-[3px] w-full overflow-hidden rounded-full bg-foreground/[0.07]">
                <span className="block h-full rounded-full bg-brand transition-[width] duration-500 ease-out" style={{ width: `${dq ? 0 : r.score.total}%` }} />
              </span>
            </>
          )}
        </div>

        {metric(<MetricCell text={formatMs(e?.ttfbP50Ms)} rel={relLower(e?.ttfbP50Ms, field.p50, 15)} best={isMin(e?.ttfbP50Ms, field.p50)} title="Median TTFB over the load burst" />)}
        {metric(<MetricCell text={formatMs(e?.ttfbP95Ms)} rel={relLower(e?.ttfbP95Ms, field.p95, 30)} best={isMin(e?.ttfbP95Ms, field.p95)} title="p95 TTFB over the load burst" />)}
        {metric(<MetricCell text={formatKB(e?.jsBytes)} rel={relLower(e?.jsBytes, field.js, 50 * 1024)} best={isMin(e?.jsBytes, field.js)} title="JavaScript referenced by the page (uncompressed)" />)}
        {metric(
          <MetricCell
            text={e && e.requests ? formatPercent(e.errorRate) : '—'}
            rel={e && e.requests ? Math.max(0, 100 - e.errorRate * 200) : null}
            title={e ? `${Math.round(e.errorRate * e.requests)} of ${e.requests} requests failed` : undefined}
          />,
        )}
        {pending ? (
          <>
            <div role="cell" className="flex justify-center"><Skel w="w-6" /></div>
            <div role="cell" className="flex justify-center"><Skel w="w-6" /></div>
            <div role="cell" className="flex justify-center"><Skel w="w-6" /></div>
          </>
        ) : (
          <>
            <Dial label="Accessibility" audit={e?.a11y ?? { score: 0, issues: [] }} audited={audited} />
            <Dial label="SEO" audit={e?.seo ?? { score: 0, issues: [] }} audited={audited} />
            <Dial label="Best practices" audit={e?.bestPractices ?? { score: 0, issues: [] }} audited={audited} />
          </>
        )}
        {judgeCell('clarity')}
        {judgeCell('fit')}
        {judgeCell('polish')}

        <div role="cell" className="flex justify-center">
          <button
            type="button"
            onClick={(ev) => {
              ev.stopPropagation()
              onToggle()
            }}
            aria-expanded={expanded}
            aria-label={`${expanded ? 'Hide' : 'Show'} evidence for ${c.label}`}
            className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronDown aria-hidden className={`h-3.5 w-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`} />
          </button>
        </div>
      </div>

      {expanded && <Details r={r} />}
    </div>
  )
}

function Details({ r }: { r: RankedCandidate<BoardCandidate> }) {
  const e = r.candidate.evidence
  const parts = r.score.parts
  const audits: [string, { score: number; issues: string[] } | undefined][] = [
    ['Accessibility', e?.a11y],
    ['SEO', e?.seo],
    ['Best practices', e?.bestPractices],
  ]
  return (
    <div className="mx-2 mb-2 grid gap-3 rounded-md border border-border/70 bg-background/50 px-3 py-3 text-[11px] @3xl:grid-cols-3">
      <div>
        <p className="mb-1.5 font-medium text-foreground">Score breakdown</p>
        <dl className="space-y-1">
          {PARTS.map(({ key, label }) => (
            <div key={key} className="flex items-center gap-2">
              <dt className="w-20 shrink-0 text-muted-foreground">{label}</dt>
              <dd className="flex flex-1 items-center gap-2">
                <span className="h-[3px] flex-1 overflow-hidden rounded-full bg-foreground/[0.07]">
                  <span className={`block h-full rounded-full ${tone(parts[key])}`} style={{ width: `${parts[key]}%` }} />
                </span>
                <span className="w-7 text-right font-mono tabular-nums text-foreground/80">{parts[key]}</span>
              </dd>
            </div>
          ))}
        </dl>
        {e && (
          <p className="mt-2 leading-relaxed text-muted-foreground">
            Cold start {formatMs(e.coldStartMs)} · {e.rps != null ? `${e.rps} req/s` : '— req/s'} · HTML {formatKB(e.htmlBytes)} · CSS {formatKB(e.cssBytes)} · {e.imageCount ?? '—'} images
          </p>
        )}
      </div>
      <div>
        <p className="mb-1.5 font-medium text-foreground">Audit findings</p>
        {e ? (
          <ul className="space-y-1">
            {audits.flatMap(([name, a]) =>
              (a?.issues.length ? a.issues : [`No issues found`]).slice(0, 4).map((issue) => (
                <li key={`${name}-${issue}`} className="leading-snug text-muted-foreground">
                  <span className="text-foreground/80">{name}:</span> {issue}
                </li>
              )),
            )}
          </ul>
        ) : (
          <p className="text-muted-foreground">Waiting for measurement…</p>
        )}
      </div>
      <div>
        <p className="mb-1.5 font-medium text-foreground">Evidence</p>
        <ul className="space-y-1">
          {r.score.reasons.slice(0, 8).map((reason) => (
            <li key={reason} className="leading-snug text-muted-foreground">{reason}</li>
          ))}
          {e?.notes.slice(0, 4).map((note) => (
            <li key={note} className="leading-snug text-muted-foreground/70">{note}</li>
          ))}
        </ul>
      </div>
    </div>
  )
}

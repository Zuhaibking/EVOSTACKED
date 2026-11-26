'use client'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { DiscoveryAnswer, DiscoveryQuestion, DiscoveryResponse, ProjectSpec } from '@/lib/platform/types'
import { cn } from '@/lib/utils'
import {
  ArrowRight,
  Check,
  CircleCheck,
  CircleDashed,
  CornerDownLeft,
  Database,
  Layers,
  Lightbulb,
  ListChecks,
  LoaderCircle,
  Plug,
  Plus,
  Quote,
  RotateCcw,
  SkipForward,
  Sparkles,
  TriangleAlert,
  Undo2,
  Users,
  Workflow,
  type LucideIcon,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'

/** Mirrors SKIPPED_ANSWER in lib/discovery/heuristics.ts ("decide for me"). */
const SKIPPED = '[skipped]'
const MAX_ROUNDS = 3
const MAX_ANSWERS = 30

type Draft = { selected: string[]; other: string; otherOpen: boolean; text: string; skipped: boolean }
const EMPTY_DRAFT: Draft = { selected: [], other: '', otherOpen: false, text: '', skipped: false }

export type DiscoveryPanelProps = {
  idea: string
  onComplete: (spec: ProjectSpec, brief: string) => void
  onSkip: () => void
  model?: unknown
  config?: unknown
}

function answerFor(q: DiscoveryQuestion, d: Draft | undefined): string {
  if (!d || d.skipped) return ''
  const other = d.otherOpen ? d.other.trim() : ''
  if (q.kind === 'text') return d.text.trim()
  if (q.kind === 'single') return other || d.selected[0] || ''
  return [...d.selected, ...(other ? [other] : [])].join(', ')
}

const FIELD_LABEL: Record<string, string> = {
  name: 'Naming', audience: 'Audience', features: 'Features', entities: 'Data', workflows: 'Workflows',
  integrations: 'Integrations', pages: 'Pages', brand: 'Brand', constraints: 'Constraints', summary: 'Concept',
}

const CSS = `
@keyframes evo-dp-in { from { opacity: 0; transform: translateY(6px) } to { opacity: 1; transform: none } }
@keyframes evo-dp-shimmer { 0% { background-position: 200% 0 } 100% { background-position: -200% 0 } }
.evo-dp-in { animation: evo-dp-in .4s cubic-bezier(.2,.8,.2,1) both }
.evo-dp-shimmer { background: linear-gradient(90deg, hsl(var(--muted)) 0%, hsl(var(--muted-foreground) / .16) 50%, hsl(var(--muted)) 100%); background-size: 200% 100%; animation: evo-dp-shimmer 1.6s linear infinite }
.evo-dp-shimmer-text { background: linear-gradient(90deg, hsl(var(--muted-foreground)) 20%, hsl(var(--foreground)) 50%, hsl(var(--muted-foreground)) 80%); background-size: 200% 100%; -webkit-background-clip: text; background-clip: text; color: transparent; animation: evo-dp-shimmer 2.2s linear infinite }
@media (prefers-reduced-motion: reduce) { .evo-dp-in, .evo-dp-shimmer, .evo-dp-shimmer-text { animation: none } }
`

export function DiscoveryPanel({ idea, onComplete, onSkip, model }: DiscoveryPanelProps) {
  const [result, setResult] = useState<DiscoveryResponse | null>(null)
  const [answers, setAnswers] = useState<DiscoveryAnswer[]>([])
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [roundsAnswered, setRoundsAnswered] = useState(0)
  const [responses, setResponses] = useState(0)
  const [peak, setPeak] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const abortRef = useRef<AbortController | null>(null)
  const lastRequest = useRef<{ answers: DiscoveryAnswer[]; spec: ProjectSpec | null; answered: boolean }>({ answers: [], spec: null, answered: false })
  const modelRef = useRef(model)
  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => { modelRef.current = model }, [model])

  const analyze = useCallback(async (nextAnswers: DiscoveryAnswer[], spec: ProjectSpec | null, answered: boolean) => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    lastRequest.current = { answers: nextAnswers, spec, answered }
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/discovery', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ idea, spec, answers: nextAnswers, model: modelRef.current }),
        signal: controller.signal,
      })
      const data = (await res.json().catch(() => null)) as (DiscoveryResponse & { error?: string }) | null
      if (!res.ok || !data?.spec) throw new Error(data?.error || `Discovery failed (${res.status}).`)
      if (controller.signal.aborted) return
      setResult(data)
      setAnswers(nextAnswers)
      setDrafts({})
      setResponses((n) => n + 1)
      if (answered) setRoundsAnswered((n) => n + 1)
      setPeak((p) => Math.max(p, Math.round(data.completeness)))
      scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (e) {
      if (controller.signal.aborted) return
      setError(e instanceof Error ? e.message : 'Discovery failed.')
    } finally {
      if (abortRef.current === controller) setLoading(false)
    }
  }, [idea])

  useEffect(() => {
    setResult(null); setAnswers([]); setDrafts({}); setRoundsAnswered(0); setResponses(0); setPeak(0)
    void analyze([], null, false)
    return () => abortRef.current?.abort()
  }, [analyze])

  const questions = result?.questions ?? []
  const done = !!result?.done
  const canContinue = !!result && !loading && !done && questions.length > 0
  const canGenerate = !!result && !loading && (done || roundsAnswered >= 1)

  const submit = useCallback(() => {
    if (!result || loading || result.done || !result.questions.length) return
    const fresh = result.questions.map((q) => ({ questionId: q.id, question: q.question, answer: answerFor(q, drafts[q.id]) || SKIPPED }))
    void analyze([...answers, ...fresh].slice(-MAX_ANSWERS), result.spec, true)
  }, [result, loading, drafts, answers, analyze])

  const generate = useCallback(() => {
    if (!result || loading) return
    // Fold in anything typed this round that hasn't been sent through discovery yet.
    const pending = result.questions
      .map((q) => ({ q, a: answerFor(q, drafts[q.id]) }))
      .filter((x) => x.a)
      .map((x) => `- ${x.q.question} → ${x.a}`)
    onComplete(result.spec, pending.length ? `${result.brief}\n\nLatest answers (apply these too):\n${pending.join('\n')}` : result.brief)
  }, [result, loading, drafts, onComplete])

  const retry = () => { const r = lastRequest.current; void analyze(r.answers, r.spec, r.answered) }

  // Enter continues from anywhere except controls that own Enter (chips, links, textareas).
  const handleEnter = useCallback((e: KeyboardEvent | ReactKeyboardEvent, target: EventTarget | null) => {
    const composing = 'nativeEvent' in e ? e.nativeEvent.isComposing : e.isComposing
    if (e.key !== 'Enter' || e.shiftKey || composing) return
    const tag = (target as HTMLElement | null)?.tagName
    const mod = e.metaKey || e.ctrlKey
    if (!mod && (tag === 'BUTTON' || tag === 'A' || tag === 'TEXTAREA' || tag === 'SELECT')) return
    e.preventDefault()
    if (canContinue) submit()
    else if (canGenerate && (done || mod)) generate()
  }, [canContinue, canGenerate, done, submit, generate])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.target === document.body) handleEnter(e, e.target) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [handleEnter])

  const setDraft = (id: string, patch: Partial<Draft>) =>
    setDrafts((all) => ({ ...all, [id]: { ...EMPTY_DRAFT, ...all[id], ...patch } }))

  const currentRound = Math.min(roundsAnswered + 1, MAX_ROUNDS)

  return (
    <section
      aria-label="Project discovery"
      className="flex h-full min-h-0 w-full flex-col bg-background text-foreground"
      onKeyDown={(e) => handleEnter(e, e.target)}
    >
      <style>{CSS}</style>

      <header className="flex items-center justify-between gap-4 border-b px-5 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand/10 text-brand">
            <Sparkles className="h-4 w-4" />
          </span>
          <div className="min-w-0 leading-tight">
            <div className="text-sm font-medium">Project discovery</div>
            <div className="truncate text-xs text-muted-foreground">A few sharp questions → a build-ready spec</div>
          </div>
        </div>
        <div className="flex items-center gap-5">
          <div className="hidden items-center gap-2 sm:flex" aria-label={done ? 'Discovery complete' : `Round ${currentRound} of ${MAX_ROUNDS}`}>
            <span className="label-caps tabular">{done ? 'Complete' : `Round ${currentRound}/${MAX_ROUNDS}`}</span>
            <div className="flex gap-1">
              {Array.from({ length: MAX_ROUNDS }, (_, i) => i + 1).map((n) => (
                <span
                  key={n}
                  className={cn(
                    'h-1.5 w-5 rounded-full transition-colors duration-500',
                    done || n <= roundsAnswered ? 'bg-brand' : n === currentRound ? 'bg-brand/40' : 'bg-border',
                  )}
                />
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2.5">
            <div className="hidden text-right leading-tight md:block">
              <div className="label-caps">Spec</div>
              <div className="text-[11px] text-muted-foreground">{done ? 'ready to build' : 'completeness'}</div>
            </div>
            <ProgressRing value={peak} ready={done || peak >= 80} />
          </div>
        </div>
      </header>

      <div ref={scrollRef} className="workspace-scrollbar min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto grid w-full max-w-6xl gap-6 px-5 py-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-w-0 space-y-4">
            <figure className="rounded-xl border bg-muted/40 px-4 py-3.5">
              <div className="flex gap-3">
                <Quote className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/70" aria-hidden />
                <div className="min-w-0">
                  <blockquote className="line-clamp-4 text-[15px] leading-relaxed text-foreground/90">{idea}</blockquote>
                  <figcaption className="label-caps mt-1.5">Your idea</figcaption>
                </div>
              </div>
            </figure>

            {error ? (
              <div role="alert" className="evo-dp-in rounded-xl border border-destructive/40 bg-destructive/5 p-4">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <TriangleAlert className="h-4 w-4 text-destructive" /> Discovery hit a snag
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{error}</p>
                <div className="mt-3 flex gap-2">
                  <Button size="sm" variant="outline" onClick={retry}><RotateCcw className="h-3.5 w-3.5" /> Try again</Button>
                  <Button size="sm" variant="ghost" onClick={onSkip}>Skip discovery</Button>
                </div>
              </div>
            ) : loading ? (
              <Analyzing first={responses === 0} />
            ) : done ? (
              <div className="evo-dp-in rounded-xl border border-brand-accent/40 bg-brand-accent/5 p-5">
                <div className="flex items-center gap-2">
                  <CircleCheck className="h-5 w-5 text-brand-accent" />
                  <h3 className="text-[15px] font-medium">Your spec is ready</h3>
                </div>
                <p className="mt-1.5 max-w-prose text-sm leading-relaxed text-muted-foreground">
                  Enough is known to generate three distinct designs, a tailored database and a {result?.spec.projectType} control center. Review the spec, then generate.
                </p>
                <Button className="mt-4 bg-brand text-brand-foreground hover:bg-brand/90" onClick={generate}>
                  Generate 3 designs <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-baseline justify-between px-0.5">
                  <h2 className="text-sm font-medium">
                    {roundsAnswered === 0 ? 'A few things to pin down' : 'Sharper follow-ups'}
                  </h2>
                  <span className="text-xs text-muted-foreground">Answer what you can — skip the rest</span>
                </div>
                {questions.map((q, i) => (
                  <QuestionCard key={q.id} q={q} index={i} draft={drafts[q.id] ?? EMPTY_DRAFT} onChange={(patch) => setDraft(q.id, patch)} />
                ))}
              </div>
            )}

            {answers.length > 0 && (
              <details className="group rounded-xl border bg-card/60 px-4 py-3 text-sm">
                <summary className="flex cursor-pointer list-none items-center justify-between text-muted-foreground marker:hidden">
                  <span>Your answers · {answers.filter((a) => a.answer !== SKIPPED).length} given</span>
                  <Plus className="h-3.5 w-3.5 transition-transform group-open:rotate-45" />
                </summary>
                <ul className="mt-3 space-y-2">
                  {answers.map((a) => (
                    <li key={a.questionId} className="text-[13px] leading-snug">
                      <div className="text-muted-foreground">{a.question}</div>
                      <div className={cn(a.answer === SKIPPED ? 'italic text-muted-foreground/70' : 'text-foreground')}>
                        {a.answer === SKIPPED ? 'Skipped — decided for you' : a.answer}
                      </div>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>

          <aside className="min-w-0 self-start lg:sticky lg:top-0">
            {result ? (
              <SpecCard spec={result.spec} known={result.known} missing={result.missing} updating={loading} version={responses} />
            ) : (
              <SpecSkeleton />
            )}
          </aside>
        </div>
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t bg-background/90 px-5 py-3 backdrop-blur">
        <Button variant="ghost" size="sm" onClick={onSkip} className="text-muted-foreground">
          <SkipForward className="h-3.5 w-3.5" /> Skip discovery
        </Button>
        <div className="flex items-center gap-2">
          {canContinue && (
            <span className="hidden items-center gap-1.5 text-[11px] text-muted-foreground md:flex">
              <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px]">Enter</kbd> to continue
            </span>
          )}
          <Button variant="outline" onClick={submit} disabled={!canContinue}>
            {loading && responses > 0 ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <CornerDownLeft className="h-3.5 w-3.5" />}
            Continue
          </Button>
          <Button
            onClick={generate}
            disabled={!canGenerate}
            title={canGenerate ? undefined : 'Answer one round first — or skip discovery'}
            className="bg-brand text-brand-foreground hover:bg-brand/90"
          >
            Generate 3 designs <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </footer>
    </section>
  )
}

function ProgressRing({ value, ready }: { value: number; ready: boolean }) {
  const size = 44
  const r = (size - 6) / 2
  const c = 2 * Math.PI * r
  const v = Math.max(0, Math.min(100, value))
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="progressbar" aria-label="Spec completeness" aria-valuemin={0} aria-valuemax={100} aria-valuenow={v}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={4} className="stroke-border" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={4}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - v / 100)}
          className={cn('transition-[stroke-dashoffset,stroke] duration-700 ease-out', ready ? 'stroke-brand-accent' : 'stroke-brand')}
        />
      </svg>
      <span className="tabular absolute inset-0 grid place-items-center text-[11px] font-semibold">{v}%</span>
    </div>
  )
}

function Analyzing({ first }: { first: boolean }) {
  return (
    <div role="status" aria-live="polite" className="evo-dp-in rounded-xl border bg-card p-5">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 animate-pulse text-brand" />
        <span className="evo-dp-shimmer-text text-sm font-medium">Understanding your project…</span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {first ? 'Reading your idea, inferring the project type and what is already known.' : 'Folding in your answers and choosing sharper follow-ups.'}
      </p>
      <div className="mt-5 space-y-5" aria-hidden>
        {[0, 1, 2].map((i) => (
          <div key={i} className="space-y-2.5">
            <div className="evo-dp-shimmer h-3.5 w-2/3 rounded" />
            <div className="evo-dp-shimmer h-2.5 w-2/5 rounded" />
            <div className="flex gap-2 pt-1">
              {[0, 1, 2, 3].map((j) => <div key={j} className="evo-dp-shimmer h-8 rounded-full" style={{ width: 72 + ((i + j) % 3) * 24 }} />)}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

const chipClass = (active: boolean) =>
  cn(
    'inline-flex min-h-8 max-w-full items-center gap-1.5 rounded-full border px-3 py-1 text-left text-[13px] leading-tight transition-[background-color,border-color,color,box-shadow] duration-150',
    active
      ? 'border-brand/60 bg-brand/10 text-foreground shadow-[0_0_0_1px_hsl(var(--brand)/0.25)]'
      : 'border-border bg-background text-foreground/80 hover:border-foreground/30 hover:text-foreground',
  )

function QuestionCard({ q, index, draft, onChange }: { q: DiscoveryQuestion; index: number; draft: Draft; onChange: (patch: Partial<Draft>) => void }) {
  const labelId = `${q.id}-label`
  const answered = !!answerFor(q, draft)
  const toggle = (opt: string) => {
    if (q.kind === 'single') onChange({ selected: [opt], otherOpen: false })
    else onChange({ selected: draft.selected.includes(opt) ? draft.selected.filter((o) => o !== opt) : [...draft.selected, opt] })
  }
  return (
    <div
      className={cn('evo-dp-in rounded-xl border bg-card p-4 transition-[opacity,border-color] duration-200', draft.skipped && 'opacity-60', answered && 'border-brand/30')}
      style={{ animationDelay: `${index * 70}ms` }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="label-caps mb-1 flex items-center gap-1.5">
            {FIELD_LABEL[q.field] ?? 'Detail'} · Q{index + 1}
            {answered && <CircleCheck className="h-3 w-3 text-brand" aria-label="Answered" />}
          </div>
          <h3 id={labelId} className="text-[15px] font-medium leading-snug">{q.question}</h3>
          <p className="mt-1 flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground">
            <Lightbulb className="mt-0.5 h-3 w-3 shrink-0" aria-hidden /> {q.why}
          </p>
        </div>
        <button
          type="button"
          onClick={() => onChange({ skipped: !draft.skipped })}
          className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          aria-pressed={draft.skipped}
        >
          {draft.skipped ? <><Undo2 className="h-3 w-3" /> Undo</> : <><SkipForward className="h-3 w-3" /> Skip</>}
        </button>
      </div>

      {draft.skipped ? (
        <p className="mt-3 text-xs italic text-muted-foreground">Skipped — we’ll choose a sensible default.</p>
      ) : q.kind === 'text' ? (
        <Input
          aria-labelledby={labelId}
          value={draft.text}
          onChange={(e) => onChange({ text: e.target.value })}
          placeholder={q.placeholder || 'Type your answer…'}
          maxLength={500}
          className="mt-3 h-10 bg-background"
        />
      ) : (
        <div className="mt-3">
          <div role={q.kind === 'single' ? 'radiogroup' : 'group'} aria-labelledby={labelId} className="flex flex-wrap gap-2">
            {q.options.map((opt) => {
              const active = draft.selected.includes(opt)
              return (
                <button
                  key={opt}
                  type="button"
                  role={q.kind === 'single' ? 'radio' : undefined}
                  aria-checked={q.kind === 'single' ? active : undefined}
                  aria-pressed={q.kind === 'multi' ? active : undefined}
                  onClick={() => toggle(opt)}
                  className={chipClass(active)}
                >
                  {q.kind === 'multi' && (
                    <span className={cn('grid h-3.5 w-3.5 shrink-0 place-items-center rounded-[4px] border transition-colors', active ? 'border-brand bg-brand text-brand-foreground' : 'border-muted-foreground/40')}>
                      {active && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
                    </span>
                  )}
                  {opt}
                </button>
              )
            })}
            <button
              type="button"
              role={q.kind === 'single' ? 'radio' : undefined}
              aria-checked={q.kind === 'single' ? draft.otherOpen : undefined}
              aria-pressed={q.kind === 'multi' ? draft.otherOpen : undefined}
              onClick={() => onChange(q.kind === 'single' ? { otherOpen: true, selected: [] } : { otherOpen: !draft.otherOpen })}
              className={cn(chipClass(draft.otherOpen), !draft.otherOpen && 'border-dashed text-muted-foreground')}
            >
              <Plus className="h-3 w-3" /> Other…
            </button>
          </div>
          {draft.otherOpen && (
            <Input
              autoFocus
              aria-label={`Other answer: ${q.question}`}
              value={draft.other}
              onChange={(e) => onChange({ other: e.target.value })}
              placeholder={q.placeholder || 'Describe it in your words…'}
              maxLength={300}
              className="evo-dp-in mt-2.5 h-10 bg-background"
            />
          )}
        </div>
      )}
    </div>
  )
}

const PRIORITY_CHIP: Record<ProjectSpec['features'][number]['priority'], string> = {
  must: 'border-foreground/80 bg-foreground text-background',
  should: 'border-border bg-background text-foreground',
  could: 'border-dashed border-border text-muted-foreground',
}

function SpecSection({ icon: Icon, title, aside, children }: { icon: LucideIcon; title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h4 className="label-caps flex items-center gap-1.5"><Icon className="h-3 w-3" aria-hidden /> {title}</h4>
        {aside}
      </div>
      {children}
    </section>
  )
}

function SpecCard({ spec, known, missing, updating, version }: { spec: ProjectSpec; known: string[]; missing: string[]; updating: boolean; version: number }) {
  return (
    <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
      <div className="flex items-center justify-between border-b px-4 py-2.5">
        <span className="label-caps">Live spec</span>
        <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground" aria-live="polite">
          {updating ? <><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand" /> Updating…</> : <>v{version}</>}
        </span>
      </div>
      <div key={version} className={cn('evo-dp-in space-y-4 p-4 transition-opacity duration-300', updating && 'opacity-60')}>
        <div>
          <div className="flex items-start justify-between gap-3">
            <h2 className="font-display text-xl font-semibold leading-tight">{spec.name}</h2>
            <span className="mt-0.5 shrink-0 rounded-full border border-brand/30 bg-brand/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-brand">
              {spec.projectType}
            </span>
          </div>
          <p className="mt-1 text-[13px] leading-snug text-muted-foreground">{spec.tagline}</p>
        </div>

        <SpecSection icon={Users} title="Audience">
          <dl className="space-y-1 text-[12.5px] leading-snug">
            <div className="flex gap-2"><dt className="w-16 shrink-0 text-muted-foreground">Customers</dt><dd>{spec.audience.customers.join(', ') || '—'}</dd></div>
            <div className="flex gap-2"><dt className="w-16 shrink-0 text-muted-foreground">Operators</dt><dd>{spec.audience.operators.join(', ') || '—'}</dd></div>
          </dl>
        </SpecSection>

        <SpecSection
          icon={Layers}
          title="Features"
          aside={
            <span className="flex items-center gap-2 text-[10px] text-muted-foreground">
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-foreground" />must</span>
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full border border-foreground/50" />should</span>
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full border border-dashed border-muted-foreground" />could</span>
            </span>
          }
        >
          <div className="flex flex-wrap gap-1.5">
            {spec.features.map((f) => (
              <span key={f.name} title={f.description} className={cn('rounded-full border px-2.5 py-0.5 text-[12px]', PRIORITY_CHIP[f.priority])}>{f.name}</span>
            ))}
          </div>
        </SpecSection>

        <SpecSection icon={Database} title="Data">
          <div className="flex flex-wrap gap-1.5">
            {spec.entities.map((e) => (
              <span key={e.name} title={e.description} className="rounded-md border bg-muted/50 px-2 py-0.5 font-mono text-[11px]">{e.name}</span>
            ))}
          </div>
        </SpecSection>

        {spec.workflows.length > 0 && (
          <SpecSection icon={Workflow} title="Workflows">
            <ul className="space-y-1.5">
              {spec.workflows.slice(0, 5).map((w) => (
                <li key={w.name} className="text-[12.5px] leading-snug">
                  <span className="font-medium">{w.name}</span>
                  <span className="text-muted-foreground"> · {w.trigger} → {w.outcome}</span>
                </li>
              ))}
            </ul>
          </SpecSection>
        )}

        {spec.integrations.length > 0 && (
          <SpecSection icon={Plug} title="Integrations">
            <div className="flex flex-wrap gap-1.5">
              {spec.integrations.map((i) => <span key={i} className="rounded-md border px-2 py-0.5 font-mono text-[11px]">{i}</span>)}
            </div>
          </SpecSection>
        )}

        <SpecSection icon={ListChecks} title={`Known · ${known.length}`}>
          <ul className="space-y-1">
            {known.map((k) => (
              <li key={k} className="flex gap-2 text-[12.5px] leading-snug">
                <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-accent" strokeWidth={2.5} aria-hidden /> {k}
              </li>
            ))}
          </ul>
        </SpecSection>

        {missing.length > 0 && (
          <SpecSection icon={CircleDashed} title="Still open">
            <ul className="space-y-1">
              {missing.slice(0, 5).map((m) => (
                <li key={m} className="flex gap-2 text-[12.5px] leading-snug text-muted-foreground">
                  <CircleDashed className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> {m}
                </li>
              ))}
            </ul>
          </SpecSection>
        )}
      </div>
    </div>
  )
}

function SpecSkeleton() {
  return (
    <div className="overflow-hidden rounded-xl border bg-card" aria-hidden>
      <div className="border-b px-4 py-2.5"><span className="label-caps">Live spec</span></div>
      <div className="space-y-4 p-4">
        <div className="evo-dp-shimmer h-6 w-3/5 rounded" />
        <div className="evo-dp-shimmer h-3 w-4/5 rounded" />
        {[0, 1, 2].map((i) => (
          <div key={i} className="space-y-2">
            <div className="evo-dp-shimmer h-2.5 w-20 rounded" />
            <div className="flex flex-wrap gap-1.5">{[0, 1, 2].map((j) => <div key={j} className="evo-dp-shimmer h-5 w-20 rounded-full" />)}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

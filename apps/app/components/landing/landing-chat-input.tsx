'use client'

import { ArrowRight, Loader2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { FormEvent, KeyboardEvent, useMemo, useState } from 'react'
import TextareaAutosize from 'react-textarea-autosize'

const QUICK_ADDS = [
  { key: 'budget',  label: 'Budget',  token: 'Budget under ₹10k/month.',        hint: '₹/$$/€' },
  { key: 'scale',   label: 'Scale',   token: 'Target 5,000 MAU at launch.',     hint: 'MAU / RPS' },
  { key: 'region',  label: 'Region',  token: 'Hosted in GCP asia-south1.',      hint: 'GCP/AWS' },
  { key: 'stack',   label: 'Stack',   token: 'Prefer Next.js on edge runtime.', hint: 'Next/Vue/Py' },
  { key: 'data',    label: 'Data',    token: 'SQLite acceptable; Postgres if needed.', hint: 'db hints' },
  { key: 'auth',    label: 'Auth',    token: 'Email + OAuth (Google) sign-in.', hint: 'identity' },
]

const SAMPLES = [
  'AI agent platform for creators, GCP asia-south1, under ₹10k/month, 5k MAU.',
  'Real-time chat app with threaded replies, file uploads, 1k concurrent.',
  'Indie e-commerce storefront with Razorpay, low-cost hosting.',
  'Streamlit dashboard that analyses uploaded CSVs with Pandas.',
]

/** Corner viewfinder bracket — decorative */
function Bracket({
  position,
}: {
  position: 'tl' | 'tr' | 'bl' | 'br'
}) {
  const map: Record<typeof position, string> = {
    tl: 'top-0 left-0 border-t border-l',
    tr: 'top-0 right-0 border-t border-r',
    bl: 'bottom-0 left-0 border-b border-l',
    br: 'bottom-0 right-0 border-b border-r',
  }
  return (
    <span
      aria-hidden
      className={`pointer-events-none absolute h-4 w-4 border-foreground ${map[position]} -m-px`}
    />
  )
}

export function LandingChatInput() {
  const router = useRouter()
  const [value, setValue] = useState('')
  const [submitting, setSubmitting] = useState(false)

  function submit() {
    const prompt = value.trim()
    if (!prompt || submitting) return
    setSubmitting(true)
    router.push(`/app?prompt=${encodeURIComponent(prompt)}`)
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    submit()
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      submit()
    }
  }

  function appendToken(token: string) {
    setValue((prev) => {
      const trimmed = prev.trimEnd()
      if (trimmed.length === 0) return token
      return `${trimmed} ${token}`
    })
  }

  // Estimates — rough heuristics; real numbers shown at /app pre-flight.
  const estimates = useMemo(() => {
    const words = value.trim().split(/\s+/).filter(Boolean).length
    const hasDetail = words >= 6
    const N = hasDetail ? 20 : 12
    const minutes = hasDetail ? '18–24 min' : '10–14 min'
    const usd = hasDetail ? '≈ $0.80' : '≈ $0.45'
    return { N, minutes, usd, ready: hasDetail }
  }, [value])

  return (
    <form
      onSubmit={onSubmit}
      aria-label="Submit specimen for tournament"
      className="group relative"
    >
      {/* Offset block shadow layer */}
      <div
        aria-hidden
        className="absolute inset-0 translate-x-1.5 translate-y-1.5 bg-foreground/10 group-focus-within:translate-x-2 group-focus-within:translate-y-2 group-focus-within:bg-brand/40 transition-[transform,background-color] duration-200"
      />

      <div className="relative border border-foreground bg-card">
        {/* Corner brackets */}
        <Bracket position="tl" />
        <Bracket position="tr" />
        <Bracket position="bl" />
        <Bracket position="br" />

        {/* Header bar */}
        <header className="flex items-center justify-between border-b border-border px-4 py-2.5 bg-background/40">
          <div className="flex items-center gap-3 min-w-0">
            <span className="font-mono text-[10px] tracking-[0.24em] uppercase text-foreground">
              Specimen&nbsp;Submission
            </span>
            <span className="text-muted-foreground/40 hidden sm:inline">·</span>
            <span className="hidden sm:inline font-mono text-[10px] tracking-[0.18em] uppercase text-muted-foreground tabular">
              Form&nbsp;0043-A · Rev.&nbsp;2
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full rounded-full bg-brand-accent opacity-75 animate-ping" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-brand-accent" />
            </span>
            <span className="font-mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground">
              Trials open
            </span>
          </div>
        </header>

        {/* Field A — brief */}
        <div className="px-4 md:px-6 pt-5 pb-3">
          <label
            htmlFor="brief"
            className="flex items-baseline justify-between mb-3"
          >
            <span className="font-mono text-[10px] tracking-[0.24em] uppercase text-muted-foreground">
              § Field&nbsp;A — describe&nbsp;the&nbsp;brief
            </span>
            <span className="font-mono text-[10px] tabular text-muted-foreground/60">
              {value.length}&nbsp;chars
            </span>
          </label>
          <TextareaAutosize
            id="brief"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="e.g. AI agent platform for creators, GCP asia-south1, budget under ₹10k/month, 5,000 MAU target. Preference for edge runtimes."
            minRows={3}
            maxRows={10}
            disabled={submitting}
            aria-describedby="brief-help"
            className="w-full resize-none bg-transparent font-display text-xl md:text-[1.6rem] leading-[1.35] placeholder:text-muted-foreground/50 placeholder:font-display placeholder:italic placeholder:text-lg focus:outline-none disabled:opacity-60"
          />
        </div>

        {/* Field B — quick-add constraints */}
        <div className="px-4 md:px-6 pb-4 border-t border-border/60 pt-3">
          <p className="font-mono text-[10px] tracking-[0.24em] uppercase text-muted-foreground mb-2.5">
            § Field&nbsp;B — append&nbsp;a&nbsp;constraint&nbsp;<span className="text-muted-foreground/60">(optional)</span>
          </p>
          <div className="flex flex-wrap gap-1.5">
            {QUICK_ADDS.map((q) => (
              <button
                key={q.key}
                type="button"
                onClick={() => appendToken(q.token)}
                title={q.token}
                className="inline-flex items-baseline gap-1.5 border border-border bg-background/60 px-2.5 py-1 font-mono text-[11px] tracking-[0.08em] uppercase text-muted-foreground hover:text-foreground hover:border-foreground hover:bg-foreground hover:text-background transition-colors"
              >
                <span>+ {q.label}</span>
                <span className="text-[9px] opacity-60 group-hover:opacity-100">
                  {q.hint}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Estimate tape */}
        <div className="px-4 md:px-6 pt-0 pb-3">
          <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 font-mono text-[10px] tracking-[0.18em] uppercase text-muted-foreground border-t border-dotted border-border pt-3">
            <span className="text-muted-foreground/60">Est.</span>
            <span>
              <span className="text-foreground tabular">N={estimates.N}</span>&nbsp;candidates
            </span>
            <span className="text-muted-foreground/30">·</span>
            <span>
              <span className="text-foreground tabular">{estimates.minutes}</span>
            </span>
            <span className="text-muted-foreground/30">·</span>
            <span>
              <span className="text-foreground tabular">{estimates.usd}</span>&nbsp;llm+sbx
            </span>
            <span className="ml-auto text-muted-foreground/60">
              {estimates.ready ? 'Ready to submit' : 'Keep going…'}
            </span>
          </div>
        </div>

        {/* Footer — submit */}
        <div className="border-t border-border px-4 md:px-6 py-3 flex items-center justify-between gap-3 bg-background/40">
          <p
            id="brief-help"
            className="hidden sm:block font-mono text-[10px] tracking-[0.16em] uppercase text-muted-foreground"
          >
            <kbd className="border border-border bg-muted px-1.5 py-0.5 mr-1">⌘</kbd>
            <kbd className="border border-border bg-muted px-1.5 py-0.5">↵</kbd>
            {' '}or click to enter the arena
          </p>
          <button
            type="submit"
            disabled={!value.trim() || submitting}
            className="relative inline-flex items-center gap-2 border border-foreground bg-foreground text-background font-mono text-xs tracking-[0.22em] uppercase px-5 py-2.5 hover:bg-brand hover:border-brand hover:text-brand-foreground transition-colors disabled:opacity-35 disabled:cursor-not-allowed"
          >
            {submitting ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Entering
              </>
            ) : (
              <>
                Begin Trial
                <ArrowRight className="h-3.5 w-3.5" />
              </>
            )}
          </button>
        </div>
      </div>

      {/* Samples — inline chips below */}
      <div className="relative mt-5 flex flex-col sm:flex-row sm:items-baseline gap-2 sm:gap-4">
        <span className="font-mono text-[10px] tracking-[0.24em] uppercase text-muted-foreground shrink-0">
          Sample briefs
        </span>
        <ul className="flex flex-wrap gap-1.5">
          {SAMPLES.map((ex, i) => (
            <li key={ex}>
              <button
                type="button"
                onClick={() => setValue(ex)}
                className="group/s inline-flex items-baseline gap-2 border border-dotted border-border bg-background/40 px-2.5 py-1 font-mono text-[11px] text-muted-foreground hover:text-foreground hover:border-foreground hover:border-solid transition-colors max-w-[30rem]"
                title={ex}
              >
                <span className="tracking-[0.18em] uppercase shrink-0">
                  EX·{String(i + 1).padStart(2, '0')}
                </span>
                <span className="italic font-display text-[13px] truncate">
                  {ex}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </form>
  )
}

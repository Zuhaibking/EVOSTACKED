'use client'

import { ArrowRight, Loader2, Plus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { FormEvent, KeyboardEvent, useRef, useState } from 'react'
import TextareaAutosize from 'react-textarea-autosize'

const QUICK_ADDS = [
  { key: 'budget', label: 'Budget', token: 'Budget under ₹10k/month.' },
  { key: 'scale', label: 'Scale', token: 'Target 5,000 MAU at launch.' },
  { key: 'region', label: 'Region', token: 'Hosted in GCP asia-south1.' },
  { key: 'stack', label: 'Stack', token: 'Prefer Next.js on edge runtime.' },
  { key: 'data', label: 'Data', token: 'SQLite acceptable; Postgres if needed.' },
  { key: 'auth', label: 'Auth', token: 'Email + OAuth (Google) sign-in.' },
]

const SAMPLES = [
  'AI agent platform for creators, GCP asia-south1, under ₹10k/month, 5k MAU.',
  'Real-time chat app with threaded replies, file uploads, 1k concurrent.',
  'Indie e-commerce storefront with Razorpay, low-cost hosting.',
  'Streamlit dashboard that analyses uploaded CSVs with Pandas.',
]

export function LandingChatInput() {
  const router = useRouter()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [value, setValue] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const empty = value.trim().length === 0

  function submit() {
    const prompt = value.trim()
    if (submitting) return
    if (!prompt) {
      textareaRef.current?.focus()
      return
    }
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
    textareaRef.current?.focus()
  }

  return (
    <form onSubmit={onSubmit} aria-label="Start a project" className="relative">
      <div className="relative overflow-hidden rounded-xl border border-border bg-card transition-[border-color,box-shadow] duration-150 focus-within:border-ring/60 focus-within:ring-4 focus-within:ring-ring/10">
        {/* Header bar */}
        <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 md:px-6">
          <span className="label-caps text-foreground">Your next project</span>
          <span className="label-caps hidden items-center gap-2 sm:inline-flex">
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-brand-accent" />
            Ready when you are
          </span>
        </header>

        {/* Field A — brief */}
        <div className="px-4 pb-4 pt-5 md:px-6">
          <label htmlFor="brief" className="mb-3 flex items-baseline justify-between gap-3">
            <span className="label-caps">Describe your idea</span>
            <span className="tabular font-mono text-[11px] text-muted-foreground" aria-live="polite">
              {value.length}&nbsp;chars
            </span>
          </label>
          <TextareaAutosize
            id="brief"
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="e.g. A portfolio for a photographer, with a striking image gallery, a short bio, and a contact form."
            minRows={3}
            maxRows={10}
            disabled={submitting}
            aria-describedby="brief-help"
            className="w-full resize-none bg-transparent font-display text-xl leading-[1.4] outline-none placeholder:font-display placeholder:text-lg placeholder:italic placeholder:text-muted-foreground focus:outline-none focus-visible:outline-none disabled:opacity-60 md:text-2xl"
          />
        </div>

        {/* Field B — quick-add constraints */}
        <div className="border-t border-border px-4 pb-4 pt-3.5 md:px-6">
          <p className="label-caps mb-2.5">
            Add a detail <span className="normal-case tracking-normal">(optional)</span>
          </p>
          <div className="flex flex-wrap gap-1.5">
            {QUICK_ADDS.map((q) => (
              <button
                key={q.key}
                type="button"
                onClick={() => appendToken(q.token)}
                title={q.token}
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background/60 px-2.5 text-xs text-muted-foreground transition-colors hover:border-foreground/30 hover:bg-accent hover:text-foreground active:bg-accent/80"
              >
                <Plus aria-hidden className="h-3 w-3" />
                {q.label}
              </button>
            ))}
          </div>
        </div>

        {/* Footer — submit */}
        <div className="flex items-center justify-between gap-3 border-t border-border bg-background/40 px-4 py-3 md:px-6">
          <p id="brief-help" className="hidden text-xs text-muted-foreground sm:block">
            <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 text-[11px] text-foreground">
              Cmd/Ctrl
            </kbd>{' '}
            +{' '}
            <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 text-[11px] text-foreground">
              Enter
            </kbd>{' '}
            to start
          </p>
          <button
            type="submit"
            disabled={submitting}
            aria-disabled={empty || undefined}
            className="group ml-auto inline-flex h-10 items-center gap-2 rounded-lg bg-foreground px-4 text-sm font-medium text-background transition-colors hover:bg-brand hover:text-brand-foreground active:bg-brand/90 disabled:cursor-wait disabled:opacity-70 aria-disabled:bg-foreground/85 aria-disabled:hover:bg-foreground/85 aria-disabled:hover:text-background"
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Opening the arena
              </>
            ) : (
              <>
                Start building
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 group-aria-disabled:translate-x-0" />
              </>
            )}
          </button>
        </div>
      </div>

      {/* Samples — inline chips below */}
      <div className="mt-5 flex flex-col gap-2.5 sm:flex-row sm:items-baseline sm:gap-4">
        <span className="label-caps shrink-0">Try a sample</span>
        <ul className="flex min-w-0 flex-wrap gap-1.5">
          {SAMPLES.map((ex) => (
            <li key={ex} className="min-w-0 max-w-full">
              <button
                type="button"
                onClick={() => {
                  setValue(ex)
                  textareaRef.current?.focus()
                }}
                className="inline-flex h-8 max-w-full items-center rounded-md border border-border bg-background/40 px-2.5 text-muted-foreground transition-colors hover:border-foreground/30 hover:bg-accent hover:text-foreground sm:max-w-[30rem]"
                title={ex}
              >
                <span className="truncate font-display text-[13px] italic">{ex}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </form>
  )
}

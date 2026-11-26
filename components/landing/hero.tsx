import { LandingChatInput } from './landing-chat-input'
import { ArrowRight } from 'lucide-react'
import Link from 'next/link'

const PIPELINE = ['Discover', 'Compete', 'Measure', 'Launch']

const EVIDENCE = [
  { k: 'Performance', v: 0.94 },
  { k: 'Accessibility', v: 0.97 },
  { k: 'Brief fit', v: 0.88 },
]

const BRIEF_TIPS = [
  'Who it is for and what it should do.',
  'A visual style or a reference you like.',
  'A preferred framework, if you have one.',
]

export function Hero() {
  return (
    <section aria-labelledby="hero-heading" className="noise-overlay relative">
      <div className="relative mx-auto max-w-[1400px] px-6 pb-16 pt-12 md:px-10 md:pb-24 md:pt-20 lg:pt-24">
        <div className="relative grid grid-cols-12 gap-x-6 gap-y-12 md:gap-x-10">
          {/* Headline column */}
          <div className="relative z-10 col-span-12 lg:col-span-7">
            <ol
              aria-label="How EvoStack works"
              className="mb-7 flex flex-wrap items-center gap-x-2.5 gap-y-1"
            >
              {PIPELINE.map((step, i) => (
                <li key={step} className="label-caps flex items-center gap-2.5">
                  <span className={i === 0 ? 'text-foreground' : undefined}>{step}</span>
                  {i < PIPELINE.length - 1 && (
                    <span aria-hidden className="text-brand">→</span>
                  )}
                </li>
              ))}
            </ol>

            <h1
              id="hero-heading"
              className="font-display text-[clamp(2.75rem,7vw,5.75rem)] font-black leading-[0.92] tracking-tight text-foreground"
            >
              <span className="block">
                Three{' '}
                <span className="font-normal italic text-muted-foreground">specimens.</span>
              </span>
              <span className="block text-brand">One survives.</span>
            </h1>

            <p className="mt-8 max-w-[38rem] text-pretty text-lg leading-relaxed text-foreground/90 md:text-xl">
              Describe an idea. EvoStack asks the right questions, then three models compete on
              measured evidence.{' '}
              <span className="text-muted-foreground">
                The build you pick ships with its own backend, database and tailored control center.
              </span>
            </p>

            <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
              <a
                href="#start"
                className="group inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-brand px-5 text-sm font-medium text-brand-foreground shadow-xs transition-colors hover:bg-brand/90 active:bg-brand/85"
              >
                Start with an idea
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </a>
              <Link
                href="/app"
                className="inline-flex h-11 items-center justify-center rounded-lg border border-border px-5 text-sm font-medium text-foreground transition-colors hover:border-foreground/30 hover:bg-accent active:bg-accent/80"
              >
                Open the workspace
              </Link>
            </div>
          </div>

          {/* Specimen card — an example verdict */}
          <aside
            aria-label="Example verdict"
            className="relative z-10 col-span-12 lg:col-span-5"
          >
            <div className="overflow-hidden rounded-xl border border-border bg-card shadow-[0_1px_0_hsl(var(--foreground)/0.04),0_24px_48px_-24px_rgb(0_0_0/0.45)] lg:mt-10">
              <header className="flex items-center justify-between border-b border-border px-5 py-3">
                <span className="label-caps">Example verdict</span>
                <span className="label-caps inline-flex items-center gap-2 text-foreground">
                  <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-brand-accent" />
                  Winner
                </span>
              </header>

              <div className="px-5 pb-4 pt-5">
                <p className="mb-1 font-display text-sm italic text-muted-foreground">Candidate B</p>
                <p className="font-display text-2xl leading-tight">
                  Next.js<span className="text-muted-foreground"> · </span>React
                  <span className="text-muted-foreground"> · </span>Tailwind
                </p>
              </div>

              <p className="border-y border-border px-5 py-4 text-sm leading-relaxed text-muted-foreground">
                “Fastest build, the clearest hierarchy and the closest fit to the brief.”
              </p>

              <div className="px-5 py-4">
                <p className="label-caps mb-3">Measured evidence</p>
                <dl className="space-y-2.5">
                  {EVIDENCE.map((row) => (
                    <div key={row.k} className="flex items-center gap-3">
                      <dt className="w-28 shrink-0 text-xs text-muted-foreground">{row.k}</dt>
                      <dd className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                        <span
                          className="absolute inset-y-0 left-0 rounded-full bg-brand-accent"
                          style={{ width: `${row.v * 100}%` }}
                        />
                      </dd>
                      <dd className="tabular w-10 text-right font-mono text-xs text-foreground">
                        {row.v.toFixed(2)}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>

              <footer className="border-t border-border px-5 py-3 text-xs text-muted-foreground">
                Example only — your verdict is measured from your own builds.
              </footer>
            </div>
          </aside>
        </div>

        {/* Submission */}
        <div
          id="start"
          className="relative mt-20 grid scroll-mt-24 grid-cols-12 gap-x-6 gap-y-8 md:mt-24 md:gap-x-10"
        >
          <div className="col-span-12 lg:col-span-4">
            <p className="label-caps mb-3">Start with an idea</p>
            <h2 className="font-display text-3xl font-black leading-tight md:text-4xl">
              Submit a brief.
              <br />
              <span className="font-normal italic">Explore the possibilities.</span>
            </h2>
            <p className="mt-5 max-w-sm text-sm leading-relaxed text-muted-foreground">
              A sentence is enough to begin — EvoStack asks follow-up questions. A clearer brief
              gives every candidate a stronger starting point.
            </p>
            <ol className="mt-6 space-y-2.5 text-sm text-foreground/85">
              {BRIEF_TIPS.map((tip, i) => (
                <li key={tip} className="flex gap-3">
                  <span className="tabular w-5 shrink-0 pt-px font-mono text-xs text-muted-foreground">
                    0{i + 1}
                  </span>
                  {tip}
                </li>
              ))}
            </ol>
          </div>
          <div className="col-span-12 lg:col-span-8">
            <LandingChatInput />
          </div>
        </div>
      </div>
    </section>
  )
}

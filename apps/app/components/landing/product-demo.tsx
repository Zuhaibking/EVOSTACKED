'use client'

import {
  DEMO_CANDIDATES,
  DEMO_CYCLE_MS,
  DEMO_PROMPT,
  DEMO_TABS,
  DEMO_TAGLINE,
  demoClock,
  type DemoCandidateId,
  type DemoChipStatus,
  type DemoClock,
} from '@/lib/landing-product-demo'
import { useEffect, useRef, useState } from 'react'

function clockKey(c: DemoClock) {
  return [
    c.phase,
    c.typed,
    c.docked,
    c.selected,
    c.statuses.minimal,
    c.statuses.rich,
    c.statuses.playful,
    c.activity.join('|'),
    c.tab,
    c.previewReady,
    c.cursor.x,
    c.cursor.y,
    c.cursor.clicking,
    c.zoom,
  ].join('~')
}

function useDemoClock(active: boolean) {
  const [clock, setClock] = useState(() => demoClock(0))
  const start = useRef<number | null>(null)
  const lastKey = useRef('')

  useEffect(() => {
    if (!active) {
      start.current = null
      return
    }
    let frame = 0
    const tick = (now: number) => {
      if (start.current == null) start.current = now
      const next = demoClock(now - start.current)
      const key = clockKey(next)
      if (key !== lastKey.current) {
        lastKey.current = key
        setClock(next)
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [active])

  return clock
}

function statusTone(status: DemoChipStatus) {
  if (status === 'Ready') return 'text-[hsl(75_78%_58%)]'
  if (status === 'Generating' || status === 'Building') {
    return 'text-[hsl(235_82%_72%)]'
  }
  return 'text-white/40'
}

function MockSite({ variant }: { variant: DemoCandidateId }) {
  const isPremium = variant === 'rich'
  const isInnovate = variant === 'playful'
  return (
    <div
      className={`h-full w-full overflow-hidden ${
        isInnovate
          ? 'bg-[#0b0914]'
          : isPremium
            ? 'bg-[#12100e]'
            : 'bg-[#141311]'
      }`}
    >
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/10">
        <span className="font-display text-[11px] tracking-[0.2em] uppercase text-white/85">
          Lumina
        </span>
        <div className="flex gap-3 font-mono text-[7px] tracking-[0.16em] uppercase text-white/35">
          <span>Product</span>
          <span>Pricing</span>
          <span className="hidden sm:inline">Journal</span>
        </div>
      </div>

      <div
        className={`px-5 pt-5 ${
          isInnovate ? 'grid grid-cols-2 gap-3 items-end' : ''
        }`}
      >
        <div>
          <p className="font-mono text-[7px] tracking-[0.22em] uppercase text-white/40 mb-1.5">
            {isInnovate
              ? 'Spatial workspace'
              : isPremium
                ? 'Editorial suite'
                : 'Internal tool'}
          </p>
          <h3
            className={`font-display leading-[0.92] text-white ${
              isPremium
                ? 'text-[1.28rem] italic font-normal'
                : 'text-[1.12rem] font-black'
            }`}
          >
            Work smarter.
            <br />
            <span
              className={
                isPremium ? 'text-[hsl(75_78%_62%)]' : 'text-white/65'
              }
            >
              Move faster.
            </span>
          </h3>
          <div className="mt-3 flex gap-2">
            <span className="rounded-sm bg-white text-[#111] px-2.5 py-1 font-mono text-[7px] tracking-[0.14em] uppercase">
              Start free
            </span>
            <span className="rounded-sm border border-white/20 px-2.5 py-1 font-mono text-[7px] tracking-[0.14em] uppercase text-white/70">
              See pricing
            </span>
          </div>
        </div>
        {isInnovate && (
          <div className="h-[4.4rem] rounded-md border border-white/10 bg-gradient-to-br from-[hsl(235_72%_42%/0.55)] via-[hsl(75_70%_40%/0.12)] to-transparent" />
        )}
      </div>

      <div className="mt-4 grid grid-cols-3 gap-1.5 px-5">
        {(isPremium
          ? ['Plan', 'Compose', 'Ship']
          : ['Plan', 'Ship', 'Measure']
        ).map((label) => (
          <div
            key={label}
            className="rounded-sm border border-white/10 bg-white/[0.04] px-2 py-1.5"
          >
            <div
              className={`h-0.5 w-5 mb-1.5 ${
                isPremium ? 'bg-[hsl(75_78%_58%/0.7)]' : 'bg-white/25'
              }`}
            />
            <p className="font-mono text-[7px] tracking-[0.14em] uppercase text-white/70">
              {label}
            </p>
          </div>
        ))}
      </div>

      <div className="mt-3 mx-5 mb-3 flex items-center justify-between rounded-sm border border-white/10 px-2.5 py-1.5">
        <span className="font-mono text-[7px] tracking-[0.16em] uppercase text-white/40">
          {isInnovate ? 'Studio' : isPremium ? 'Pro' : 'Starter'}
        </span>
        <span className="font-display text-[13px] text-white">
          {isInnovate ? '$29' : isPremium ? '$19' : '$0'}
          <span className="text-[9px] text-white/35"> /mo</span>
        </span>
      </div>
    </div>
  )
}

function PreviewPane({ clock }: { clock: DemoClock }) {
  if (clock.previewReady) {
    return (
      <div className="absolute inset-2.5 overflow-hidden rounded-md border border-white/10 shadow-[0_20px_40px_rgba(0,0,0,0.35)]">
        <div key={clock.selected} className="h-full landing-demo-fade">
          <MockSite variant={clock.selected} />
        </div>
      </div>
    )
  }

  if (clock.phase === 'planning' || clock.phase === 'generating') {
    return (
      <div className="absolute inset-2.5 rounded-md border border-white/8 p-4">
        <div className="h-2 w-20 rounded-sm bg-white/10 mb-3 landing-demo-fade" />
        <div className="h-8 w-2/3 rounded-sm bg-white/[0.07] mb-4" />
        <div className="grid grid-cols-3 gap-2">
          <div className="h-12 rounded-sm bg-white/[0.06]" />
          <div className="h-12 rounded-sm bg-white/[0.05]" />
          <div className="h-12 rounded-sm bg-white/[0.04]" />
        </div>
        <p className="mt-6 font-display italic text-white/30 text-sm">
          {clock.phase === 'planning'
            ? 'Planning the product…'
            : 'Generating three candidates…'}
        </p>
      </div>
    )
  }

  if (clock.phase === 'verifying') {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="font-display italic text-white/35 text-sm">
          Verifying isolated previews…
        </p>
      </div>
    )
  }

  return (
    <div className="flex h-full items-center justify-center">
      <p className="font-display italic text-white/28 text-sm">
        Waiting for a brief
      </p>
    </div>
  )
}

function ArenaMock({ clock }: { clock: DemoClock }) {
  return (
    <div className="relative h-full w-full overflow-hidden bg-[#0e0c0a] text-[#f3eee6]">
      <div
        className="absolute inset-0 landing-demo-stage"
        style={{ transform: `scale(${clock.zoom})` }}
      >
        <header className="flex h-8 items-center justify-between border-b border-white/10 px-3">
          <span className="font-display text-[11px] tracking-tight">
            Evo<span className="italic font-normal">Stack</span>
          </span>
          <span className="font-mono text-[8px] tracking-[0.2em] uppercase text-white/40">
            Arena
          </span>
        </header>

        <div className="grid h-[calc(100%-2rem)] grid-cols-[34%_minmax(0,1fr)] max-[520px]:grid-cols-[38%_minmax(0,1fr)]">
          <aside
            className={`flex min-h-0 flex-col border-r border-white/10 bg-black/25 transition-opacity duration-700 ${
              clock.phase === 'idle' ? 'opacity-55' : 'opacity-100'
            }`}
          >
            <div className="px-2.5 pt-2 pb-1 font-mono text-[8px] tracking-[0.2em] uppercase text-white/35">
              Tournament
            </div>
            <div className="space-y-1 px-2 pb-2">
              {DEMO_CANDIDATES.map((c) => {
                const status = clock.statuses[c.id]
                const selected = clock.selected === c.id && clock.previewReady
                const working =
                  status === 'Generating' || status === 'Building'
                return (
                  <div
                    key={c.id}
                    className={`rounded-[2px] border px-2 py-1.5 transition-colors duration-500 ${
                      selected
                        ? 'border-[hsl(75_78%_58%/0.55)] bg-white/[0.06]'
                        : 'border-white/10 bg-white/[0.02]'
                    }`}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-mono text-[9px] tracking-[0.16em] uppercase">
                        {c.label}
                      </span>
                      <span className="font-mono text-[8px] tabular text-white/30">
                        {status === 'Ready' ? '—' : c.sigil}
                      </span>
                    </div>
                    <div
                      className={`mt-0.5 flex items-center gap-1.5 font-mono text-[8px] tracking-[0.14em] uppercase ${statusTone(status)}`}
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          status === 'Ready'
                            ? 'bg-[hsl(75_78%_58%)]'
                            : working
                              ? 'bg-[hsl(235_82%_68%)] landing-demo-pulse'
                              : 'bg-white/25'
                        }`}
                      />
                      {status}
                    </div>
                    {working && (
                      <div className="mt-1 h-0.5 overflow-hidden rounded-full bg-white/10">
                        <span className="landing-demo-bar block h-full bg-[hsl(235_82%_68%)]" />
                      </div>
                    )}
                    {status === 'Ready' && (
                      <div className="mt-1 flex gap-2 font-mono text-[7px] tracking-[0.12em] uppercase text-white/35">
                        <span>A 92</span>
                        <span>R 88</span>
                        <span>S pass</span>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            <div className="min-h-0 flex-1 overflow-hidden border-t border-white/10 px-2.5 py-2 max-[640px]:hidden">
              <p className="font-mono text-[8px] tracking-[0.2em] uppercase text-white/35 mb-1.5">
                Activity
              </p>
              <ul className="space-y-1">
                {clock.activity.length === 0 ? (
                  <li className="font-mono text-[8px] text-white/25">
                    Waiting for a run.
                  </li>
                ) : (
                  clock.activity.map((line, i) => {
                    const done = clock.phase === 'ready' || i < clock.activity.length - 1
                    return (
                      <li
                        key={line}
                        className="landing-demo-line flex items-start gap-1.5 font-mono text-[8px] leading-snug text-white/70"
                      >
                        <span
                          className={
                            done
                              ? 'text-[hsl(75_78%_58%)]'
                              : 'text-[hsl(235_82%_72%)]'
                          }
                        >
                          {done ? '✓' : '⟳'}
                        </span>
                        {line}
                      </li>
                    )
                  })
                )}
              </ul>
            </div>

            <div
              className={`border-t border-white/10 p-2 transition-opacity duration-700 ${
                clock.docked ? 'opacity-100' : 'opacity-0'
              }`}
            >
              <div className="rounded-[2px] border border-white/15 bg-black/40 px-2 py-1.5">
                <p className="font-display text-[9px] leading-snug text-white/55 line-clamp-2">
                  {DEMO_PROMPT}
                </p>
              </div>
            </div>
          </aside>

          <div className="relative min-w-0">
            <div className="flex h-8 items-center gap-2 border-b border-white/10 px-2.5">
              <div className="inline-flex border border-white/15">
                {DEMO_TABS.map((tab, idx) => (
                  <span
                    key={tab}
                    className={`h-6 px-2 font-mono text-[8px] tracking-[0.16em] uppercase leading-6 ${
                      idx > 0 ? 'border-l border-white/15' : ''
                    } ${
                      tab === clock.tab
                        ? 'bg-white text-[#111]'
                        : 'text-white/35'
                    }`}
                  >
                    {tab}
                  </span>
                ))}
              </div>
              <div className="hidden sm:inline-flex border border-white/15">
                {['Desktop', 'Tablet', 'Mobile'].map((label, idx) => (
                  <span
                    key={label}
                    className={`h-6 px-1.5 font-mono text-[7px] tracking-[0.14em] uppercase leading-6 ${
                      idx > 0 ? 'border-l border-white/15' : ''
                    } ${
                      label === 'Desktop' ? 'text-white/80' : 'text-white/30'
                    }`}
                  >
                    {label}
                  </span>
                ))}
              </div>
            </div>

            <div className="relative h-[calc(100%-2rem)] overflow-hidden bg-[#161310]">
              <PreviewPane clock={clock} />
            </div>

            <div
              className={`pointer-events-none absolute inset-x-[8%] bottom-[16%] transition-all duration-700 ${
                clock.docked
                  ? 'opacity-0 translate-y-3'
                  : 'opacity-100 translate-y-0'
              }`}
            >
              <div className="rounded-[2px] border border-white/15 bg-[#1a1714]/92 shadow-[0_12px_40px_rgba(0,0,0,0.45)]">
                <p className="min-h-[2.15rem] font-display text-[11px] sm:text-[12px] leading-relaxed px-3 pt-2 text-white/85">
                  {clock.typed || (
                    <span className="text-white/30">
                      What do you want to build or change?
                    </span>
                  )}
                  {clock.phase === 'typing' && (
                    <span className="landing-demo-caret ml-0.5 inline-block h-3 w-px align-middle bg-white/80" />
                  )}
                </p>
                <div className="flex items-center justify-between px-2 py-1.5 border-t border-white/10">
                  <div className="flex gap-1">
                    {['Fix', 'Improve', 'Ask'].map((chip) => (
                      <span
                        key={chip}
                        className="h-5 px-1.5 font-mono text-[7px] tracking-[0.16em] uppercase leading-5 border border-white/15 text-white/35"
                      >
                        {chip}
                      </span>
                    ))}
                  </div>
                  <span
                    className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] ${
                      clock.phase === 'submit'
                        ? 'bg-[hsl(75_78%_58%)] text-[#111]'
                        : 'bg-white text-black'
                    }`}
                  >
                    ↑
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <span
        className={`landing-demo-cursor ${clock.cursor.clicking ? 'landing-demo-cursor-click' : ''}`}
        style={{
          left: `${clock.cursor.x}%`,
          top: `${clock.cursor.y}%`,
          opacity: clock.cursor.visible ? 1 : 0,
        }}
        aria-hidden
      />
    </div>
  )
}

export function ProductDemo() {
  const root = useRef<HTMLElement>(null)
  const [active, setActive] = useState(false)
  const [reduceMotion, setReduceMotion] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const apply = () => setReduceMotion(mq.matches)
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [])

  useEffect(() => {
    const el = root.current
    if (!el) return
    const io = new IntersectionObserver(
      ([entry]) => setActive(Boolean(entry?.isIntersecting)),
      { threshold: 0.28 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    const onVis = () => {
      if (document.hidden) setActive(false)
      else if (root.current) {
        const rect = root.current.getBoundingClientRect()
        setActive(rect.top < window.innerHeight && rect.bottom > 0)
      }
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

  const live = useDemoClock(active && !reduceMotion)
  const clock = reduceMotion ? demoClock(DEMO_CYCLE_MS - 1) : live

  const [lead, rest] = (() => {
    const parts = DEMO_TAGLINE.split('. ')
    return [`${parts[0]}. ${parts[1]}.`, parts.slice(2).join('. ')]
  })()

  return (
    <section
      ref={root}
      id="arena-demo"
      aria-labelledby="arena-demo-heading"
      className="relative border-t border-foreground noise-overlay"
    >
      <div className="max-w-[1400px] mx-auto px-6 md:px-10 py-16 md:py-24">
        <header className="max-w-3xl mx-auto text-center mb-10 md:mb-14">
          <p className="label-caps mb-4">§ 01.2 — Arena</p>
          <h2
            id="arena-demo-heading"
            className="font-display text-4xl md:text-5xl lg:text-6xl font-black leading-[0.95] tracking-tight"
          >
            {lead}
            <br />
            <span className="italic font-normal">{rest}</span>
          </h2>
          <p className="mt-6 text-muted-foreground leading-relaxed mx-auto max-w-xl">
            A prompt becomes a shared plan, three isolated candidates, and live
            previews — Product, Premium, and Innovate — without leaving the
            workspace.
          </p>
        </header>

        <div className="landing-demo-well mx-auto max-w-[1100px]">
          <div
            className="landing-demo-frame"
            role="img"
            aria-label="Looped demonstration of EvoStack Arena: a prompt is typed, Product Premium and Innovate generate in parallel, then three live previews become READY."
          >
            <div className="landing-demo-chrome">
              <span className="landing-demo-dot bg-[#ff5f57]" />
              <span className="landing-demo-dot bg-[#febc2e]" />
              <span className="landing-demo-dot bg-[#28c840]" />
              <span className="landing-demo-url">arena.evostack.dev</span>
            </div>
            <div className="landing-demo-screen min-h-[22rem] aspect-[4/5] sm:min-h-0 sm:aspect-[16/10]">
              <ArenaMock clock={clock} />
            </div>
          </div>
        </div>

        <p className="mt-5 text-center text-xs text-muted-foreground italic font-display">
          Fig. 01.2 — simulated Arena loop. Autoplay, muted, no live generation.
        </p>
      </div>
    </section>
  )
}

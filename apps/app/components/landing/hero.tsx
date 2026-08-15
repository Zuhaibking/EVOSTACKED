import { LandingChatInput } from './landing-chat-input'

export function Hero() {
  return (
    <section
      aria-labelledby="hero-heading"
      className="relative noise-overlay"
    >
      <div className="max-w-[1400px] mx-auto px-6 md:px-10 py-12 md:py-20 lg:py-24 relative">
        {/* Oversized figure number, marginalia */}
        <div
          aria-hidden
          className="fig-gutter absolute -left-6 md:left-0 top-6 text-[9rem] md:text-[14rem] leading-none select-none pointer-events-none"
        >
          01
        </div>

        <div className="grid grid-cols-12 gap-6 md:gap-10 relative">
          {/* Headline column */}
          <div className="col-span-12 lg:col-span-7 relative z-10">
            <div className="flex items-center gap-3 mb-6">
              <span className="inline-block h-[1px] w-10 bg-foreground" />
              <span className="font-mono text-[10px] tracking-[0.3em] uppercase text-muted-foreground">
                An experimental method — for software
              </span>
            </div>

            <h1
              id="hero-heading"
              className="font-display font-black tracking-tight leading-[0.92] text-foreground"
            >
              <span className="block text-[clamp(2.75rem,8vw,7.5rem)]">
                Fifty
                <span className="italic font-normal text-muted-foreground">
                  {' '}specimens.
                </span>
              </span>
              <span className="block text-[clamp(2.75rem,8vw,7.5rem)] text-brand">
                One survives.
              </span>
            </h1>

            <div className="mt-10 max-w-xl">
              <p className="dropcap font-display text-lg md:text-xl leading-relaxed text-foreground/90">
                EvoStack is a tournament engine for software architecture. You
                write the brief. It generates competing implementations, runs
                each under synthetic load, kills the weak, mutates the strong —
                and ships the survivor as deploy-ready code, with a scorecard
                proving the verdict.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 font-mono text-[11px] tracking-[0.2em] uppercase text-muted-foreground">
                <span>
                  <span className="text-foreground">N</span> = up to 50 candidates
                </span>
                <span className="text-muted-foreground/30">·</span>
                <span>
                  <span className="text-foreground">G</span> = 3 generations
                </span>
                <span className="text-muted-foreground/30">·</span>
                <span>
                  <span className="text-foreground">t</span> ≈ 20 min
                </span>
              </div>
            </div>
          </div>

          {/* Specimen card — exhibit A */}
          <aside
            aria-label="Exhibit A — winning specimen"
            className="col-span-12 lg:col-span-5 relative z-10"
          >
            <div className="relative lg:mt-12">
              <div className="absolute -top-8 right-0 stamp text-brand-accent">
                Exhibit&nbsp;A — Survivor
              </div>
              <div className="border border-foreground bg-card shadow-[8px_8px_0_0_hsl(var(--brand)/0.25)]">
                <header className="flex items-center justify-between border-b border-border px-4 py-2">
                  <span className="font-mono text-[10px] tracking-[0.22em] uppercase text-muted-foreground">
                    Candidate #087
                  </span>
                  <span className="font-mono text-[10px] tracking-[0.22em] uppercase text-brand-accent">
                    Gen 3 · Winner
                  </span>
                </header>

                <div className="px-5 pt-5 pb-4">
                  <p className="font-display italic text-muted-foreground text-sm mb-1">
                    Stack
                  </p>
                  <p className="font-display text-2xl leading-tight">
                    Next.js
                    <span className="text-muted-foreground"> · </span>
                    SQLite
                    <span className="text-muted-foreground"> · </span>
                    Edge
                  </p>
                </div>

                <dl className="grid grid-cols-3 divide-x divide-border border-y border-border">
                  <div className="p-4">
                    <dt className="font-mono text-[9px] tracking-[0.24em] uppercase text-muted-foreground">
                      p95
                    </dt>
                    <dd className="mt-1 font-display text-2xl tabular">
                      52
                      <span className="text-sm text-muted-foreground ml-0.5">
                        ms
                      </span>
                    </dd>
                  </div>
                  <div className="p-4">
                    <dt className="font-mono text-[9px] tracking-[0.24em] uppercase text-muted-foreground">
                      Cost/mo
                    </dt>
                    <dd className="mt-1 font-display text-2xl tabular">
                      ₹3.1
                      <span className="text-sm text-muted-foreground ml-0.5">
                        k
                      </span>
                    </dd>
                  </div>
                  <div className="p-4">
                    <dt className="font-mono text-[9px] tracking-[0.24em] uppercase text-muted-foreground">
                      Errors
                    </dt>
                    <dd className="mt-1 font-display text-2xl tabular">
                      0.01
                      <span className="text-sm text-muted-foreground ml-0.5">
                        %
                      </span>
                    </dd>
                  </div>
                </dl>

                <div className="px-5 py-4">
                  <p className="font-mono text-[10px] tracking-[0.22em] uppercase text-muted-foreground mb-2">
                    Score composition
                  </p>
                  <div className="space-y-2 font-mono text-[11px] tabular">
                    {[
                      { k: 'Latency', v: 0.93 },
                      { k: 'Cost',    v: 0.86 },
                      { k: 'Reliability', v: 0.99 },
                      { k: 'Footprint',   v: 0.71 },
                    ].map((row) => (
                      <div key={row.k} className="flex items-center gap-3">
                        <span className="w-20 text-muted-foreground uppercase tracking-[0.14em] text-[10px]">
                          {row.k}
                        </span>
                        <span className="flex-1 h-[3px] bg-border relative overflow-hidden">
                          <span
                            className="absolute inset-y-0 left-0 bg-brand-accent"
                            style={{ width: `${row.v * 100}%` }}
                          />
                        </span>
                        <span className="w-10 text-right">{row.v.toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <footer className="border-t border-border px-5 py-2.5 flex items-center justify-between">
                  <span className="font-mono text-[10px] tracking-[0.22em] uppercase text-muted-foreground">
                    Composite
                  </span>
                  <span className="font-display text-xl tabular">
                    0.87
                  </span>
                </footer>
              </div>

              <p className="mt-3 text-xs text-muted-foreground italic font-display max-w-sm">
                Fig. 01 — a representative winner from an AI-agent-platform
                tournament. Composite score normalised to [0, 1].
              </p>
            </div>
          </aside>
        </div>

        {/* Submission */}
        <div className="mt-20 md:mt-28 grid grid-cols-12 gap-6 md:gap-10 relative">
          <div className="col-span-12 lg:col-span-4">
            <p className="label-caps mb-3">§ 01.1 — Enter</p>
            <h2 className="font-display text-3xl md:text-4xl font-black leading-tight">
              Submit a brief.
              <br />
              <span className="italic font-normal">We&apos;ll hold the trial.</span>
            </h2>
            <p className="mt-5 text-sm text-muted-foreground leading-relaxed">
              Your prompt becomes the forcing function. The more specific the
              constraints — budget, region, target traffic, preferred stacks —
              the more signal the tournament can extract.
            </p>
            <ul className="mt-6 space-y-2 text-sm text-muted-foreground">
              <li className="flex gap-3">
                <span className="font-mono text-[10px] tracking-widest uppercase text-muted-foreground/70 translate-y-1">
                  i
                </span>
                Mention a cost ceiling if you have one.
              </li>
              <li className="flex gap-3">
                <span className="font-mono text-[10px] tracking-widest uppercase text-muted-foreground/70 translate-y-1">
                  ii
                </span>
                Mention traffic targets in MAU or RPS.
              </li>
              <li className="flex gap-3">
                <span className="font-mono text-[10px] tracking-widest uppercase text-muted-foreground/70 translate-y-1">
                  iii
                </span>
                Stack preferences are welcome, not required.
              </li>
            </ul>
          </div>
          <div className="col-span-12 lg:col-span-8">
            <LandingChatInput />
          </div>
        </div>
      </div>
    </section>
  )
}

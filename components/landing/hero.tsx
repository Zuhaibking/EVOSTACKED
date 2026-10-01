import { LandingChatInput } from './landing-chat-input'

export function Hero() {
  return (
    <section
      aria-labelledby="hero-heading"
      className="relative noise-overlay"
    >
      <div className="max-w-[1400px] mx-auto px-6 md:px-10 py-12 md:py-20 lg:py-24 relative">
        <div className="grid grid-cols-12 gap-6 md:gap-10 relative">
          {/* Headline column */}
          <div className="col-span-12 lg:col-span-7 relative z-10">
            <div className="flex items-center gap-3 mb-6">
              <span className="inline-block h-[1px] w-10 bg-foreground" />
              <span className="font-mono text-[10px] tracking-[0.3em] uppercase text-muted-foreground">
                A new perspective — on building software
              </span>
            </div>

            <h1
              id="hero-heading"
              className="font-display font-black tracking-tight leading-[0.92] text-foreground"
            >
              <span className="block text-[clamp(2.75rem,7vw,5.75rem)]">
                Three
                <span className="italic font-normal text-muted-foreground">
                  {' '}specimens.
                </span>
              </span>
              <span className="block text-[clamp(2.75rem,7vw,5.75rem)] text-brand">
                One survives.
              </span>
            </h1>

            <div className="mt-10 max-w-xl">
              <p className="font-display text-lg md:text-xl leading-relaxed text-foreground/90">
                One idea. Three distinct implementations. EvoStack explores
                different approaches to your brief, uses an AI editor to choose
                a favorite, and lets you preview and refine the result.
              </p>
              <div className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-[11px] tracking-[0.12em] uppercase text-muted-foreground">
                <span>Three approaches</span><span className="text-border">/</span><span>One editorial verdict</span><span className="text-border">/</span><span>Live preview</span>
              </div>
            </div>
          </div>

          {/* Specimen card — exhibit A */}
          <aside
            aria-label="Exhibit A — winning specimen"
            className="col-span-12 lg:col-span-5 relative z-10"
          >
            <div className="relative lg:mt-12">
              <div className="overflow-hidden rounded-lg border border-border bg-card">
                <header className="flex items-center justify-between border-b border-border px-4 py-2">
                  <span className="font-mono text-[10px] tracking-[0.22em] uppercase text-muted-foreground">
                    Illustrative verdict
                  </span>
                  <span className="font-mono text-[10px] tracking-[0.22em] uppercase text-brand-accent">
                    Selected design
                  </span>
                </header>

                <div className="px-5 pt-5 pb-4">
                  <p className="font-display italic text-muted-foreground text-sm mb-1">
                    Stack
                  </p>
                  <p className="font-display text-2xl leading-tight">
                    Next.js
                    <span className="text-muted-foreground"> · </span>
                    React
                    <span className="text-muted-foreground"> · </span>
                    Tailwind
                  </p>
                </div>

                <div className="border-y border-border px-5 py-4 text-sm leading-relaxed text-muted-foreground">“A focused layout, clear hierarchy, and thoughtful details — the strongest fit for the brief.”</div>

                <div className="px-5 py-4">
                  <p className="font-mono text-[10px] tracking-[0.22em] uppercase text-muted-foreground mb-2">
                    Editorial criteria
                  </p>
                  <div className="space-y-2 font-mono text-[11px] tabular">
                    {[
                      { k: 'Clarity', v: 0.93 },
                      { k: 'Fit', v: 0.86 },
                      { k: 'Polish', v: 0.90 },
                    ].map((row) => (
                      <div key={row.k} className="flex items-center gap-3">
                        <span className="w-20 text-muted-foreground uppercase tracking-[0.12em] text-[10px]">
                          {row.k}
                        </span>
                        <span className="flex-1 h-1 rounded-full bg-border relative overflow-hidden">
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

                <footer className="border-t border-border px-5 py-3 text-xs text-muted-foreground">Example only. Your verdict is generated from your designs.</footer>
              </div>


            </div>
          </aside>
        </div>

        {/* Submission */}
        <div className="mt-16 md:mt-20 grid grid-cols-12 gap-6 md:gap-10 relative">
          <div className="col-span-12 lg:col-span-4">
            <p className="label-caps mb-3">Start with an idea</p>
            <h2 className="font-display text-3xl md:text-4xl font-black leading-tight">
              Submit a brief.
              <br />
              <span className="italic font-normal">Explore the possibilities.</span>
            </h2>
            <p className="mt-5 text-sm text-muted-foreground leading-relaxed">
              Tell us who it is for, what it should do, and the look you have
              in mind. A clear brief gives each design a stronger starting point.
            </p>
            <ul className="mt-6 space-y-2 text-sm text-muted-foreground">
              <li className="flex gap-3">
                <span className="font-mono text-[10px] tracking-widest uppercase text-muted-foreground/70 translate-y-1">
                  i
                </span>
                Describe the main features.
              </li>
              <li className="flex gap-3">
                <span className="font-mono text-[10px] tracking-widest uppercase text-muted-foreground/70 translate-y-1">
                  ii
                </span>
                Share a visual style or reference.
              </li>
              <li className="flex gap-3">
                <span className="font-mono text-[10px] tracking-widest uppercase text-muted-foreground/70 translate-y-1">
                  iii
                </span>
                Add a preferred framework, if you have one.
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

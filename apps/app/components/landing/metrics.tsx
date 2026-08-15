const FINDINGS = [
  {
    n: 'i',
    headline: '20 min',
    unit: 'end-to-end',
    caption:
      'Median elapsed from prompt submission to deploy-ready winner. Manual build of the same brief, benchmarked: ≈ 12 days.',
    sub: 'vs 12d manual',
  },
  {
    n: 'ii',
    headline: '60%',
    unit: 'cost delta',
    caption:
      'Average monthly-cost spread between a naïve first-pick stack and the tournament winner, holding workload constant.',
    sub: 'naïve → winner',
  },
  {
    n: 'iii',
    headline: '500 rps',
    unit: 'sustained',
    caption:
      'Synthetic workload imposed on every candidate before scoring. No specimen reaches the leaderboard untested.',
    sub: 'warm-start, 60s',
  },
  {
    n: 'iv',
    headline: '1-click',
    unit: 'deploy',
    caption:
      'Winner exports as code + Dockerfile + Terraform. Ship on Cloud Run, Vercel, or Fly without hand-editing config.',
    sub: 'terraform apply',
  },
]

export function Metrics() {
  return (
    <section
      id="findings"
      aria-labelledby="findings-heading"
      className="relative border-t border-foreground"
    >
      <div className="max-w-[1400px] mx-auto px-6 md:px-10 py-16 md:py-24">
        <div className="grid grid-cols-12 gap-6 md:gap-10 items-end mb-12">
          <div className="col-span-12 md:col-span-7">
            <p className="label-caps mb-3">§ 05 — Findings</p>
            <h2
              id="findings-heading"
              className="font-display text-4xl md:text-5xl lg:text-6xl font-black leading-[0.95] tracking-tight"
            >
              Reported results
              <span className="italic font-normal text-muted-foreground">
                , not
              </span>
              <br />
              <span className="italic font-normal text-muted-foreground">
                promises.
              </span>
            </h2>
          </div>
          <p className="col-span-12 md:col-span-5 text-sm text-muted-foreground leading-relaxed md:text-right max-w-sm md:ml-auto">
            Each figure below is observed across representative runs. Your
            tournament&apos;s scorecard reports its own figures — these are
            priors, not guarantees.
          </p>
        </div>

        <ol className="grid grid-cols-1 md:grid-cols-2 border-l border-t border-border">
          {FINDINGS.map((f) => (
            <li
              key={f.n}
              className="relative p-8 md:p-10 border-r border-b border-border noise-overlay group hover:bg-muted/20 transition-colors"
            >
              <div className="flex items-start justify-between">
                <span className="font-mono text-[10px] tracking-[0.22em] uppercase text-muted-foreground">
                  Fig. {f.n}
                </span>
                <span className="font-mono text-[10px] tracking-[0.22em] uppercase text-muted-foreground">
                  {f.unit}
                </span>
              </div>
              <div className="mt-8">
                <p className="font-display font-black text-6xl md:text-7xl leading-none tabular text-foreground">
                  {f.headline}
                </p>
                <p className="mt-2 font-mono text-xs tracking-[0.18em] uppercase text-brand-accent">
                  {f.sub}
                </p>
              </div>
              <p className="mt-8 font-display italic text-base md:text-lg text-muted-foreground leading-relaxed max-w-md">
                {f.caption}
              </p>
            </li>
          ))}
        </ol>

        {/* pull-quote */}
        <blockquote className="mt-20 md:mt-28 max-w-4xl mx-auto text-center">
          <div
            aria-hidden
            className="font-display font-black italic text-6xl md:text-8xl text-muted-foreground/30 leading-none select-none"
          >
            &ldquo;
          </div>
          <p className="-mt-6 font-display text-2xl md:text-4xl lg:text-5xl font-semibold leading-[1.15] tracking-tight">
            Built a working SaaS in{' '}
            <span className="text-brand italic font-normal">twenty minutes</span>{' '}
            instead of two weeks — and the scorecard proves why this stack,
            not any of the{' '}
            <span className="italic font-normal text-muted-foreground">
              forty-nine others.
            </span>
          </p>
          <footer className="mt-8 font-mono text-[10px] tracking-[0.22em] uppercase text-muted-foreground">
            — Demo transcript · Run #0043
          </footer>
        </blockquote>
      </div>
    </section>
  )
}

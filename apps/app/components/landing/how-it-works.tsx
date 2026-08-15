const PROTOCOL = [
  {
    n: '01',
    title: 'Intake',
    body: 'Your brief is parsed into constraints — budget, traffic, preferred stacks. The orchestrator samples N candidate configurations, diversified across templates, models, and architectural choices.',
    tag: 'Method',
  },
  {
    n: '02',
    title: 'Generation',
    body: 'Each candidate is generated in parallel: structured output against a schema, with variation prompts injecting diversity. Morph applies edits for targeted mutations in later generations.',
    tag: 'Apparatus',
  },
  {
    n: '03',
    title: 'Assay',
    body: 'Every specimen is deployed to its own sandbox and hit with synthetic traffic shaped by your brief. We record p50/p95/p99 latency, error rate, RSS, cold-start, bundle size, and projected monthly cost.',
    tag: 'Measurement',
  },
  {
    n: '04',
    title: 'Selection',
    body: 'A composite score collapses the metrics. Bottom candidates are culled. Top candidates carry over (elitism) and mutate via Morph patches — swap Postgres for SQLite, enable edge runtime, prune dependencies.',
    tag: 'Pressure',
  },
  {
    n: '05',
    title: 'Convergence',
    body: 'Generations run until the best score plateaus (&lt;2% improvement), budget is exhausted, or a max-generation cap is hit. The survivor is snapshotted before its sandbox expires.',
    tag: 'Termination',
  },
  {
    n: '06',
    title: 'Report',
    body: 'The winner exports as a .zip — full source, Dockerfile, deploy config for the target cloud, and a markdown scorecard explaining the verdict with numbers and comparisons to runners-up.',
    tag: 'Dissemination',
  },
]

export function HowItWorks() {
  return (
    <section
      id="protocol"
      aria-labelledby="protocol-heading"
      className="relative border-t border-foreground noise-overlay"
    >
      <div className="max-w-[1400px] mx-auto px-6 md:px-10 py-16 md:py-24">
        <div className="grid grid-cols-12 gap-6 md:gap-10">
          <div className="col-span-12 lg:col-span-4">
            <p className="label-caps mb-4">§ 02 — Protocol</p>
            <h2
              id="protocol-heading"
              className="font-display text-4xl md:text-5xl lg:text-6xl font-black leading-[0.95] tracking-tight"
            >
              The method,
              <br />
              <span className="italic font-normal">in six steps.</span>
            </h2>
            <p className="mt-6 text-muted-foreground leading-relaxed max-w-sm">
              EvoStack treats stack selection as a search problem. Generate,
              measure, select, repeat — until the data converges on a winner.
            </p>
            <div className="mt-8 space-y-2 font-mono text-[11px] tracking-[0.14em] uppercase text-muted-foreground">
              <p>
                <span className="text-foreground">Subject</span> — your brief
              </p>
              <p>
                <span className="text-foreground">Substrate</span> — E2B sandboxes
              </p>
              <p>
                <span className="text-foreground">Observer</span> — synthetic load harness
              </p>
            </div>
          </div>

          <ol className="col-span-12 lg:col-span-8 border-t border-border">
            {PROTOCOL.map((step, i) => (
              <li
                key={step.n}
                className="group grid grid-cols-12 gap-4 md:gap-6 py-7 border-b border-border hover:bg-muted/20 transition-colors relative"
              >
                <div className="col-span-3 md:col-span-2">
                  <div className="font-display italic text-5xl md:text-6xl font-black leading-none tabular text-foreground/90 group-hover:text-brand transition-colors">
                    {step.n}
                  </div>
                  <div className="mt-2 label-caps">{step.tag}</div>
                </div>
                <div className="col-span-9 md:col-span-10">
                  <div className="flex items-baseline justify-between gap-4">
                    <h3 className="font-display text-2xl md:text-3xl font-bold">
                      {step.title}
                    </h3>
                    <span className="font-mono text-xs tabular text-muted-foreground shrink-0">
                      step&nbsp;{i + 1}/{PROTOCOL.length}
                    </span>
                  </div>
                  <p
                    className="mt-3 text-sm md:text-base text-muted-foreground leading-relaxed max-w-2xl"
                    dangerouslySetInnerHTML={{ __html: step.body }}
                  />
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  )
}

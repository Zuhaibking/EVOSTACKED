const MASTHEAD = [
  { name: 'Zuhaib Pott',      role: 'Concept · Direction',           initials: 'ZP' },
  { name: 'Suhaib',           role: 'Systems · Engineering',         initials: 'S'  },
]

const ATTRIBUTIONS = [
  { k: 'License',       v: 'Apache 2.0' },
  { k: 'Forked from',   v: 'E2B Fragments' },
  { k: 'Sandbox',       v: 'E2B Code Interpreter' },
  { k: 'Orchestration', v: 'Vercel AI SDK · Morph' },
  { k: 'Institution',   v: 'Final-year capstone' },
  { k: 'Typeset in',    v: 'Fraunces · IBM Plex' },
]

export function Team() {
  return (
    <section
      id="colophon"
      aria-labelledby="team-heading"
      className="relative border-t border-foreground noise-overlay"
    >
      <div className="max-w-[1400px] mx-auto px-6 md:px-10 py-16 md:py-24">
        <div className="grid grid-cols-12 gap-6 md:gap-10">
          <div className="col-span-12 md:col-span-5 lg:col-span-4">
            <p className="label-caps mb-4">§ 06 — Colophon</p>
            <h2
              id="team-heading"
              className="font-display text-5xl md:text-6xl lg:text-7xl font-black leading-[0.9] tracking-tight"
            >
              Team
              <br />
              <span className="italic font-normal">Zuhaib.</span>
            </h2>
            <p className="mt-6 text-muted-foreground leading-relaxed max-w-sm">
              EvoStack is our capstone project. We think picking a tech stack
              should be an experiment, not a bet. So we built a tournament
              engine that actually runs the experiment.
            </p>
            <p className="mt-6 font-display italic text-sm text-muted-foreground max-w-sm">
              — Published on the open source record. Every run is falsifiable.
              Every scorecard is auditable.
            </p>
          </div>

          <div className="col-span-12 md:col-span-7 lg:col-span-8 grid grid-cols-1 md:grid-cols-2 gap-4">
            {MASTHEAD.map((m) => (
              <div
                key={m.name}
                className="border border-border bg-card/60 p-5 md:p-6 flex items-start gap-4 hover:border-foreground transition-colors"
              >
                <div className="h-14 w-14 shrink-0 border border-foreground flex items-center justify-center font-display font-black text-xl italic tabular">
                  {m.initials}
                </div>
                <div className="min-w-0">
                  <p className="font-display text-xl font-bold">{m.name}</p>
                  <p className="mt-1 font-mono text-[10px] tracking-[0.22em] uppercase text-muted-foreground">
                    {m.role}
                  </p>
                </div>
              </div>
            ))}

            <div className="col-span-1 md:col-span-2 border border-border bg-card/40 p-5 md:p-6 mt-2">
              <p className="label-caps mb-4">Attributions</p>
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2">
                {ATTRIBUTIONS.map((a) => (
                  <div
                    key={a.k}
                    className="flex items-baseline justify-between gap-4 border-b border-dotted border-border py-1.5 font-mono text-xs"
                  >
                    <dt className="tracking-[0.14em] uppercase text-muted-foreground">
                      {a.k}
                    </dt>
                    <dd className="text-foreground tabular">{a.v}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

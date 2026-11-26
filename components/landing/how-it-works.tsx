const PROTOCOL = [
  {
    n: '01',
    tag: 'Discovery',
    title: 'Describe the idea',
    body: 'Start with a sentence. EvoStack asks a few adaptive follow-up questions and turns your answers into a structured spec.',
  },
  {
    n: '02',
    tag: 'Tournament',
    title: 'Three builds compete',
    body: 'Different models build three candidates in parallel, each running live in its own sandbox.',
  },
  {
    n: '03',
    tag: 'Evidence',
    title: 'Judge on evidence',
    body: 'Every candidate is measured — performance, accessibility and fit to the brief — and ranked on the results. You make the final call.',
  },
  {
    n: '04',
    tag: 'Launch',
    title: 'Launch the product',
    body: 'Your pick becomes a working product: its own backend and database, plus a control center tailored to what you built.',
  },
]

export function HowItWorks() {
  return (
    <section
      id="protocol"
      aria-labelledby="protocol-heading"
      className="noise-overlay relative scroll-mt-20 border-t border-border"
    >
      <div className="mx-auto max-w-[1400px] px-6 py-16 md:px-10 md:py-24">
        <div className="grid grid-cols-12 gap-x-6 gap-y-10 md:gap-x-10">
          <div className="col-span-12 lg:col-span-4">
            <p className="label-caps mb-4">The method</p>
            <h2
              id="protocol-heading"
              className="font-display text-4xl font-black leading-[0.95] tracking-tight md:text-5xl lg:text-6xl"
            >
              The method,
              <br />
              <span className="font-normal italic">in four steps.</span>
            </h2>
            <p className="mt-6 max-w-sm leading-relaxed text-muted-foreground">
              From a single sentence to a running product. Explore real alternatives, decide on
              evidence, then launch.
            </p>
          </div>

          <ol className="col-span-12 overflow-hidden rounded-xl border border-border bg-card lg:col-span-8">
            {PROTOCOL.map((step, i) => (
              <li
                key={step.n}
                className="group grid grid-cols-12 gap-4 border-b border-border px-5 py-6 transition-colors last:border-b-0 hover:bg-muted/40 md:gap-6 md:px-6"
              >
                <div className="col-span-3 md:col-span-2">
                  <div className="tabular font-display text-3xl font-black italic leading-none text-foreground/90 transition-colors group-hover:text-brand md:text-4xl">
                    {step.n}
                  </div>
                  <div className="label-caps mt-2.5">{step.tag}</div>
                </div>
                <div className="col-span-9 md:col-span-10">
                  <div className="flex items-baseline justify-between gap-4">
                    <h3 className="font-display text-2xl font-bold md:text-3xl">{step.title}</h3>
                    <span className="tabular hidden shrink-0 font-mono text-xs text-muted-foreground sm:inline">
                      {i + 1}/{PROTOCOL.length}
                    </span>
                  </div>
                  <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground md:text-base">
                    {step.body}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  )
}

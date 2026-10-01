const PROTOCOL = [
  { n: '01', title: 'Write the brief', body: 'Describe your idea, key features, and visual direction. Choose a framework and model, or let EvoStack pick a starting point.', tag: 'Intake' },
  { n: '02', title: 'Explore three designs', body: 'Three implementations are generated in parallel, each with its own approach to your idea.', tag: 'Generation' },
  { n: '03', title: 'Choose your favorite', body: 'An AI editor compares the designs and recommends a winner. You can select any candidate and see it running in a live sandbox.', tag: 'Selection' },
  { n: '04', title: 'Refine and share', body: 'Iterate through chat, inspect individual elements, download the source, or share your sandbox preview with a timed link.', tag: 'Iteration' },
]

export function HowItWorks() {
  return (
    <section
      id="protocol"
      aria-labelledby="protocol-heading"
      className="relative border-t border-border noise-overlay"
    >
      <div className="max-w-[1400px] mx-auto px-6 md:px-10 py-16 md:py-24">
        <div className="grid grid-cols-12 gap-6 md:gap-10">
          <div className="col-span-12 lg:col-span-4">
            <p className="label-caps mb-4">The method</p>
            <h2
              id="protocol-heading"
              className="font-display text-4xl md:text-5xl lg:text-6xl font-black leading-[0.95] tracking-tight"
            >
              The method,
              <br />
              <span className="italic font-normal">in four steps.</span>
            </h2>
            <p className="mt-6 text-muted-foreground leading-relaxed max-w-sm">
              A considered path from the first idea to a running design.
              Explore alternatives, make the call, then refine the details.
            </p>

          </div>

          <ol className="col-span-12 lg:col-span-8 overflow-hidden rounded-lg border border-border bg-card">
            {PROTOCOL.map((step, i) => (
              <li
                key={step.n}
                className="group grid grid-cols-12 gap-4 md:gap-6 px-5 py-6 border-b border-border last:border-b-0 hover:bg-muted/20 transition-colors relative"
              >
                <div className="col-span-3 md:col-span-2">
                  <div className="font-display italic text-3xl md:text-4xl font-black leading-none tabular text-foreground/90 group-hover:text-brand transition-colors">
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

import { Cpu } from 'lucide-react'
import Image from 'next/image'

// Honest roster: OpenAI is live today; Gemini and NVIDIA NIM are joining the
// multi-model battle. Don't list a provider here until it is wired up.
const MODELS: { name: string; detail: string; src?: string; status: 'Live' | 'Joining' }[] = [
  { name: 'OpenAI', detail: 'GPT family', src: '/thirdparty/logos/openai.svg', status: 'Live' },
  { name: 'Google', detail: 'Gemini', src: '/thirdparty/logos/google.svg', status: 'Joining' },
  { name: 'NVIDIA NIM', detail: 'Open models', status: 'Joining' },
]

const TEMPLATES = [
  { name: 'Next.js', src: '/thirdparty/templates/nextjs-developer.svg', port: 3000 },
  { name: 'Vue.js', src: '/thirdparty/templates/vue-developer.svg', port: 3000 },
  { name: 'Streamlit', src: '/thirdparty/templates/streamlit-developer.svg', port: 8501 },
  { name: 'Gradio', src: '/thirdparty/templates/gradio-developer.svg', port: 7860 },
  { name: 'Python', src: '/thirdparty/templates/code-interpreter-v1.svg', port: null as number | null },
]

export function StackStrip() {
  return (
    <section
      id="stack"
      aria-labelledby="stack-heading"
      className="noise-overlay relative scroll-mt-20 border-t border-border"
    >
      <div className="mx-auto max-w-[1400px] px-6 py-16 md:px-10 md:py-20">
        <div className="grid grid-cols-12 items-start gap-x-6 gap-y-10 md:gap-x-10">
          <div className="col-span-12 md:col-span-4 lg:col-span-3">
            <p className="label-caps mb-3">Under the hood</p>
            <h2
              id="stack-heading"
              className="font-display text-3xl font-black leading-tight md:text-4xl"
            >
              Many models.
              <br />
              <span className="font-normal italic text-muted-foreground">One arena.</span>
            </h2>
            <p className="mt-5 max-w-xs text-sm leading-relaxed text-muted-foreground">
              Candidates come from different model families, so the tournament compares genuinely
              different ideas — not three rolls of the same dice.
            </p>
          </div>

          <div className="col-span-12 space-y-12 md:col-span-8 lg:col-span-9">
            {/* Models */}
            <div>
              <div className="mb-5 flex items-baseline justify-between gap-4 border-b border-border pb-2.5">
                <h3 className="label-caps">Models in the tournament</h3>
                <p className="label-caps text-foreground">Multi-model</p>
              </div>
              <ul className="grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-3">
                {MODELS.map((m) => (
                  <li key={m.name} className="flex items-center gap-3 bg-background px-4 py-4">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-card">
                      {m.src ? (
                        <Image src={m.src} alt="" width={18} height={18} className="h-[18px] w-auto dark:invert-[0.92]" />
                      ) : (
                        <Cpu aria-hidden className="h-[18px] w-[18px] text-foreground/80" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-foreground">{m.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">{m.detail}</span>
                    </span>
                    <span
                      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[11px] ${
                        m.status === 'Live'
                          ? 'border-brand-accent/40 text-foreground'
                          : 'border-border text-muted-foreground'
                      }`}
                    >
                      <span
                        aria-hidden
                        className={`h-1.5 w-1.5 rounded-full ${m.status === 'Live' ? 'bg-brand-accent' : 'bg-muted-foreground/60'}`}
                      />
                      {m.status}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Templates */}
            <div>
              <div className="mb-5 flex items-baseline justify-between gap-4 border-b border-border pb-2.5">
                <h3 className="label-caps">Sandbox templates</h3>
                <p className="label-caps tabular">{TEMPLATES.length} available</p>
              </div>
              <ul className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-3 md:grid-cols-5">
                {TEMPLATES.map((t) => (
                  <li key={t.name} className="flex flex-col gap-3 bg-background p-4 transition-colors hover:bg-muted/40">
                    <Image src={t.src} alt="" width={28} height={28} className="h-7 w-auto self-start" />
                    <div>
                      <p className="text-sm font-medium text-foreground">{t.name}</p>
                      <p className="tabular font-mono text-[11px] text-muted-foreground">
                        {t.port ? `port ${t.port}` : 'headless'}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            <p className="text-sm text-muted-foreground">
              Sandboxes run on{' '}
              <a
                href="https://e2b.dev"
                target="_blank"
                rel="noopener noreferrer"
                className="text-foreground underline decoration-border underline-offset-4 transition-colors hover:decoration-foreground"
              >
                E2B
              </a>
              . New templates are welcome by pull request.
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}

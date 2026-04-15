import Image from 'next/image'

const PROVIDERS = [
  { name: 'Anthropic',  src: '/thirdparty/logos/anthropic.svg'  },
  { name: 'OpenAI',     src: '/thirdparty/logos/openai.svg'     },
  { name: 'Google',     src: '/thirdparty/logos/google.svg'     },
  { name: 'Mistral',    src: '/thirdparty/logos/mistral.svg'    },
  { name: 'Groq',       src: '/thirdparty/logos/groq.svg'       },
  { name: 'Fireworks',  src: '/thirdparty/logos/fireworks.svg'  },
  { name: 'Together',   src: '/thirdparty/logos/togetherai.svg' },
  { name: 'DeepSeek',   src: '/thirdparty/logos/deepseek.svg'   },
  { name: 'xAI',        src: '/thirdparty/logos/xai.svg'        },
  { name: 'Ollama',     src: '/thirdparty/logos/ollama.svg'     },
]

const TEMPLATES = [
  { name: 'Next.js',   src: '/thirdparty/templates/nextjs-developer.svg',       port: 3000 },
  { name: 'Vue.js',    src: '/thirdparty/templates/vue-developer.svg',          port: 3000 },
  { name: 'Streamlit', src: '/thirdparty/templates/streamlit-developer.svg',    port: 8501 },
  { name: 'Gradio',    src: '/thirdparty/templates/gradio-developer.svg',       port: 7860 },
  { name: 'Python',    src: '/thirdparty/templates/code-interpreter-v1.svg',    port: null as number | null },
]

export function StackStrip() {
  return (
    <section
      aria-labelledby="lineage-heading"
      className="relative border-t border-foreground noise-overlay"
    >
      <div className="max-w-[1400px] mx-auto px-6 md:px-10 py-14 md:py-16">
        <div className="grid grid-cols-12 gap-6 md:gap-10 items-start">
          <div className="col-span-12 md:col-span-3">
            <p className="label-caps mb-3">§ 04 — Taxonomy</p>
            <h2
              id="lineage-heading"
              className="font-display text-2xl md:text-3xl font-black leading-tight"
            >
              Selected sires
              <br />
              <span className="italic font-normal text-muted-foreground">
                &amp; archived
              </span>
              <br />
              <span className="italic font-normal text-muted-foreground">
                lineages.
              </span>
            </h2>
          </div>

          <div className="col-span-12 md:col-span-9 space-y-10">
            {/* Models */}
            <div>
              <div className="flex items-baseline justify-between border-b border-border pb-2 mb-5">
                <p className="label-caps">i. Sires — language models</p>
                <p className="font-mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground tabular">
                  10 supported
                </p>
              </div>
              <ul className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-px bg-border">
                {PROVIDERS.map((p) => (
                  <li
                    key={p.name}
                    className="bg-background px-3 py-4 flex items-center gap-3 hover:bg-muted/30 transition-colors"
                  >
                    <Image
                      src={p.src}
                      alt={p.name}
                      width={22}
                      height={22}
                      className="h-5 w-auto shrink-0 opacity-80 dark:invert-[0.92]"
                    />
                    <span className="font-mono text-[11px] tracking-[0.12em] uppercase text-muted-foreground truncate">
                      {p.name}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Templates */}
            <div>
              <div className="flex items-baseline justify-between border-b border-border pb-2 mb-5">
                <p className="label-caps">ii. Lineages — sandbox templates</p>
                <p className="font-mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground tabular">
                  5 active
                </p>
              </div>
              <ul className="grid grid-cols-2 md:grid-cols-5 gap-px bg-border">
                {TEMPLATES.map((t) => (
                  <li
                    key={t.name}
                    className="bg-background p-4 flex flex-col gap-2 hover:bg-muted/30 transition-colors"
                  >
                    <Image
                      src={t.src}
                      alt={t.name}
                      width={28}
                      height={28}
                      className="h-7 w-auto"
                    />
                    <div>
                      <p className="font-display text-base font-semibold">
                        {t.name}
                      </p>
                      <p className="font-mono text-[10px] tracking-[0.16em] uppercase text-muted-foreground">
                        {t.port ? `port ${t.port}` : 'headless'}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            <p className="font-mono text-[11px] tracking-[0.16em] uppercase text-muted-foreground">
              Sandbox runtime by{' '}
              <a
                href="https://e2b.dev"
                target="_blank"
                rel="noopener noreferrer"
                className="text-foreground underline underline-offset-4 decoration-border hover:decoration-foreground"
              >
                E2B
              </a>
              .&nbsp; New lineages are admitted by pull request.
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}

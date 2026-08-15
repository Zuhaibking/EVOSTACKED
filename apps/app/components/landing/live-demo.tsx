'use client'

import { useEffect, useState } from 'react'

type Status = 'alive' | 'winner' | 'killed' | 'measuring'

type Row = {
  id: string
  gen: number
  stack: string
  p95: number | null
  cost: number | null
  err: number | null
  score: number | null
  status: Status
  note?: string
}

const ROWS: Row[] = [
  { id: '087', gen: 3, stack: 'Next · SQLite · Edge',     p95: 52,  cost: 3.1, err: 0.01, score: 0.87, status: 'winner',    note: 'parent #034 + edge-mut' },
  { id: '071', gen: 3, stack: 'Svelte · libSQL',          p95: 76,  cost: 3.4, err: 0.05, score: 0.82, status: 'alive' },
  { id: '023', gen: 2, stack: 'Vue · Postgres',           p95: 140, cost: 4.8, err: 0.20, score: 0.81, status: 'alive' },
  { id: '062', gen: 2, stack: 'Next · Turso · Bun',       p95: 88,  cost: 3.7, err: 0.04, score: 0.74, status: 'alive' },
  { id: '041', gen: 2, stack: 'Streamlit · DuckDB',       p95: 180, cost: 2.9, err: 0.10, score: 0.78, status: 'alive' },
  { id: '034', gen: 1, stack: 'Next · Redis',             p95: 94,  cost: 3.9, err: 0.03, score: 0.71, status: 'alive' },
  { id: '099', gen: 3, stack: 'Python · FastAPI',         p95: 116, cost: 3.3, err: 0.08, score: 0.69, status: 'alive' },
  { id: '005', gen: 3, stack: 'Gradio · SQLite',          p95: null, cost: null, err: null, score: null, status: 'measuring' },
  { id: '018', gen: 2, stack: 'Remix · D1',               p95: 312, cost: 5.2, err: 0.80, score: 0.41, status: 'alive' },
  { id: '012', gen: 1, stack: 'Next · Postgres',          p95: null, cost: null, err: null, score: null, status: 'killed',   note: 'OOM @ 450rps' },
  { id: '003', gen: 0, stack: 'Django · Postgres',        p95: null, cost: null, err: null, score: null, status: 'killed',   note: 'timeout warm-up' },
]

function StatusCell({ s, note }: { s: Status; note?: string }) {
  const label =
    s === 'winner'
      ? '▲ Winner'
      : s === 'alive'
        ? '▲ Alive'
        : s === 'measuring'
          ? '● Measuring'
          : '▼ Killed'
  const cls =
    s === 'winner'
      ? 'text-brand-accent'
      : s === 'alive'
        ? 'text-foreground'
        : s === 'measuring'
          ? 'text-muted-foreground'
          : 'text-brand-danger'
  return (
    <div className="flex items-baseline gap-2">
      <span className={`font-mono text-xs tracking-wide tabular ${cls}`}>
        {label}
      </span>
      {note && (
        <span className="font-mono text-[10px] text-muted-foreground/70 italic">
          {note}
        </span>
      )}
    </div>
  )
}

function jitter(base: number, seed: number, t: number) {
  return Math.max(20, Math.round(base + Math.sin(t / 1.6 + seed) * 8))
}

export function LiveDemo() {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1400)
    return () => clearInterval(id)
  }, [])

  return (
    <section
      id="ledger"
      aria-labelledby="ledger-heading"
      className="relative border-t border-foreground noise-overlay"
    >
      <div className="max-w-[1400px] mx-auto px-6 md:px-10 py-16 md:py-24">
        <div className="grid grid-cols-12 gap-6 md:gap-10">
          <header className="col-span-12 lg:col-span-4">
            <p className="label-caps mb-4">§ 03 — Ledger</p>
            <h2
              id="ledger-heading"
              className="font-display text-4xl md:text-5xl lg:text-6xl font-black leading-[0.95] tracking-tight"
            >
              The
              <br />
              <span className="italic font-normal">bracket,</span>
              <br />
              settling.
            </h2>
            <p className="mt-6 text-muted-foreground leading-relaxed max-w-sm">
              What EvoStack shows you while the tournament is in flight. Every
              row is a live sandbox under synthetic load. Scores recompute each
              tick; losers don&apos;t make it to the next generation.
            </p>
            <div className="mt-8 font-mono text-[11px] tracking-[0.14em] uppercase text-muted-foreground space-y-1.5">
              <p>Run 2026-04-16 · 18:04 IST</p>
              <p>Brief: &quot;AI agent platform for creators…&quot;</p>
              <p>
                Population <span className="text-foreground">50</span>
                &nbsp;·&nbsp; alive <span className="text-brand-accent">8</span>
                &nbsp;·&nbsp; killed <span className="text-brand-danger">2</span>
              </p>
            </div>
          </header>

          <div className="col-span-12 lg:col-span-8">
            <div className="border border-foreground bg-card">
              {/* ledger header */}
              <div className="grid grid-cols-12 gap-2 md:gap-3 px-4 md:px-5 py-2.5 border-b-2 border-foreground font-mono text-[10px] tracking-[0.22em] uppercase text-muted-foreground">
                <div className="col-span-1">#</div>
                <div className="col-span-1">Gen</div>
                <div className="col-span-4">Stack</div>
                <div className="col-span-1 text-right tabular">p95</div>
                <div className="col-span-1 text-right tabular">₹/mo</div>
                <div className="col-span-1 text-right tabular">Err</div>
                <div className="col-span-1 text-right tabular">Score</div>
                <div className="col-span-2">Status</div>
              </div>

              <div className="divide-y divide-border">
                {ROWS.map((r, i) => {
                  const live =
                    r.status === 'alive' && r.p95 != null
                      ? jitter(r.p95, i, tick)
                      : r.p95

                  const stripe = r.status === 'winner' ? 'bg-brand-accent/5' : ''
                  return (
                    <div
                      key={r.id}
                      className={`grid grid-cols-12 gap-2 md:gap-3 px-4 md:px-5 py-3 items-baseline font-mono text-xs hover:bg-muted/30 transition-colors ${stripe}`}
                    >
                      <div className="col-span-1 text-muted-foreground tabular">
                        {r.id}
                      </div>
                      <div className="col-span-1 text-muted-foreground tabular">
                        g{r.gen}
                      </div>
                      <div className="col-span-4 font-sans text-foreground">
                        {r.stack}
                        {r.status === 'winner' && (
                          <span className="ml-2 inline-block align-middle border border-brand-accent text-brand-accent px-1 text-[9px] tracking-[0.2em] uppercase">
                            Survivor
                          </span>
                        )}
                      </div>
                      <div className="col-span-1 text-right tabular">
                        {live != null ? `${live}ms` : '—'}
                      </div>
                      <div className="col-span-1 text-right tabular">
                        {r.cost != null ? `${r.cost.toFixed(1)}k` : '—'}
                      </div>
                      <div className="col-span-1 text-right tabular text-muted-foreground">
                        {r.err != null ? `${r.err.toFixed(2)}%` : '—'}
                      </div>
                      <div className="col-span-1 text-right tabular font-semibold">
                        {r.score != null ? r.score.toFixed(2) : '—'}
                      </div>
                      <div className="col-span-2">
                        <StatusCell s={r.status} note={r.note} />
                      </div>
                    </div>
                  )
                })}
              </div>

              <footer className="border-t-2 border-foreground px-4 md:px-5 py-2.5 flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono text-[10px] tracking-[0.22em] uppercase text-muted-foreground">
                  † Values recomputed each tick. Sandboxes run for ≤ 10 min.
                </span>
                <a
                  href="/app"
                  className="font-mono text-[10px] tracking-[0.22em] uppercase text-foreground hover:text-brand transition-colors"
                >
                  View the real arena →
                </a>
              </footer>
            </div>

            <p className="mt-3 text-xs text-muted-foreground italic font-display">
              Fig. 02 — a representative slice of a run in progress. Row
              highlight indicates current leader.
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}

const ENTRIES = [
  { id: '#087', stack: 'next · sqlite · edge',   p95: '52ms',  delta: '▲ 0.87' },
  { id: '#023', stack: 'vue · postgres',          p95: '140ms', delta: '▲ 0.81' },
  { id: '#041', stack: 'streamlit · duckdb',      p95: '180ms', delta: '▲ 0.78' },
  { id: '#062', stack: 'next · turso · bun',      p95: '88ms',  delta: '▲ 0.74' },
  { id: '#012', stack: 'next · postgres',         p95: 'OOM',   delta: '▼ dead' },
  { id: '#005', stack: 'gradio · sqlite',         p95: '…',     delta: '● msr' },
  { id: '#099', stack: 'python · fastapi',        p95: '116ms', delta: '▲ 0.69' },
  { id: '#034', stack: 'next · redis',            p95: '94ms',  delta: '▲ 0.71' },
  { id: '#071', stack: 'svelte · libsql',         p95: '76ms',  delta: '▲ 0.82' },
  { id: '#018', stack: 'remix · d1',              p95: '312ms', delta: '▽ 0.41' },
]

function Row() {
  return (
    <>
      {ENTRIES.map((e, i) => {
        const isWin = e.delta.startsWith('▲')
        const isDead = e.delta.includes('dead')
        return (
          <span
            key={`${e.id}-${i}`}
            className="inline-flex items-center gap-3 px-5 whitespace-nowrap tabular"
          >
            <span className="text-muted-foreground/70">{e.id}</span>
            <span className="text-foreground/90">{e.stack}</span>
            <span className="text-muted-foreground">{e.p95}</span>
            <span
              className={
                isDead
                  ? 'text-brand-danger'
                  : isWin
                    ? 'text-brand-accent'
                    : 'text-muted-foreground'
              }
            >
              {e.delta}
            </span>
            <span className="text-muted-foreground/30 px-1">·</span>
          </span>
        )
      })}
    </>
  )
}

export function Ticker() {
  return (
    <div
      aria-hidden
      className="relative border-y border-border bg-background/80 backdrop-blur-sm overflow-hidden"
    >
      <div className="absolute left-0 top-0 bottom-0 z-10 w-24 bg-gradient-to-r from-background to-transparent pointer-events-none" />
      <div className="absolute right-0 top-0 bottom-0 z-10 w-24 bg-gradient-to-l from-background to-transparent pointer-events-none" />
      <div className="absolute left-3 top-1/2 -translate-y-1/2 z-20 flex items-center gap-2 bg-background pr-3">
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full rounded-full bg-brand-accent opacity-75 animate-ping" />
          <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-brand-accent" />
        </span>
        <span className="font-mono text-[10px] tracking-[0.2em] text-muted-foreground">
          LIVE&nbsp;TAPE
        </span>
      </div>
      <div className="pl-32">
        <div className="flex w-max animate-ticker-scroll py-2.5 text-xs font-mono motion-reduce:animate-none">
          <Row />
          <Row />
        </div>
      </div>
    </div>
  )
}

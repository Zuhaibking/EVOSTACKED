export type RunHistoryItem = {
  id: string
  title: string
  preview: string
  updatedAt: string
  hasTournament: boolean
  status: string
  memoryVersion: number
  selectedCandidate?: string | null
  activeVersion?: number | null
}

export function textFromStoredContent(content: unknown): string {
  if (typeof content === 'string') return content.trim()
  if (!content || typeof content !== 'object') return ''
  const rec = content as { content?: unknown; text?: unknown }
  if (typeof rec.text === 'string') return rec.text.trim()
  if (typeof rec.content === 'string') return rec.content.trim()
  if (!Array.isArray(rec.content)) return ''
  return rec.content
    .map((part) => {
      if (typeof part === 'string') return part
      if (!part || typeof part !== 'object') return ''
      const text = (part as { text?: unknown }).text
      return typeof text === 'string' ? text : ''
    })
    .join('\n')
    .trim()
}

export function titleFromRunSources(opts: {
  productName?: string
  firstUserText?: string
}): string {
  const named = opts.productName?.trim()
  if (named) return named
  const first = opts.firstUserText?.trim()
  if (first) {
    const line = first.split('\n')[0].trim()
    return line.length > 72 ? `${line.slice(0, 69)}…` : line
  }
  return 'Untitled run'
}

export function pickRestoreRunId(opts: {
  urlRunId?: string | null
  storedRunId?: string | null
  runs: RunHistoryItem[]
}): string | null {
  if (opts.urlRunId) return opts.urlRunId
  const worked = opts.runs.filter((run) => run.memoryVersion > 0)
  const pool = worked.length ? worked : opts.runs
  const poolIds = new Set(pool.map((run) => run.id))
  if (opts.storedRunId && poolIds.has(opts.storedRunId)) return opts.storedRunId
  return pool[0]?.id ?? null
}

export function writeRunToUrl(runId: string) {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  url.searchParams.set('run', runId)
  window.history.replaceState(window.history.state, '', url)
}

export function readRunFromUrl(): string | null {
  if (typeof window === 'undefined') return null
  const value = new URLSearchParams(window.location.search).get('run')
  return value?.trim() || null
}

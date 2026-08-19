import type { MemoryPack } from '@evostack/shared'

/** ~3–4k tokens. Keep memory injection small so plan + generation stay dominant. */
export const MEMORY_PROMPT_MAX_CHARS = 14_000

type MemoryItem = MemoryPack['memoryItems'][number]

export type MemoryPromptSource = {
  memoryItems?: MemoryItem[] | null
  recentMessages?: unknown[] | null
  brain?: unknown
}

function clip(text: string, max: number): string {
  const trimmed = text.replace(/\s+/g, ' ').trim()
  if (trimmed.length <= max) return trimmed
  return `${trimmed.slice(0, Math.max(0, max - 1)).trimEnd()}…`
}

function itemText(items: MemoryItem[] | undefined, kind: MemoryItem['kind']): string[] {
  if (!items?.length) return []
  return items
    .filter((i) => i.kind === kind && typeof i.text === 'string' && i.text.trim())
    .map((i) => i.text.trim())
}

function messageText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((c) =>
        typeof c === 'string'
          ? c
          : c && typeof c === 'object' && (c as { type?: string }).type === 'text'
            ? String((c as { text?: string }).text || '')
            : '',
      )
      .join('\n')
  }
  if (content && typeof content === 'object') {
    const obj = content as { text?: unknown; content?: unknown }
    if (typeof obj.text === 'string') return obj.text
    if (obj.content != null) return messageText(obj.content)
  }
  return ''
}

function recentUserMessages(messages: unknown[] | undefined): string[] {
  if (!messages?.length) return []
  const out: string[] = []
  for (const raw of messages) {
    if (!raw || typeof raw !== 'object') continue
    const m = raw as { role?: string; content?: unknown }
    if (m.role !== 'user') continue
    const text = messageText(m.content).trim()
    if (text) out.push(text)
  }
  return out
}

function brainNotes(brain: unknown): {
  requests: string[]
  improvements: string[]
  fileTree: string[]
} {
  if (!brain || typeof brain !== 'object') {
    return { requests: [], improvements: [], fileTree: [] }
  }
  const b = brain as {
    userRequests?: unknown
    improvements?: unknown
    fileTree?: unknown
  }
  const requests = Array.isArray(b.userRequests)
    ? b.userRequests.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    : []
  const improvements: string[] = []
  if (Array.isArray(b.improvements)) {
    for (const row of b.improvements) {
      if (!row || typeof row !== 'object') continue
      const r = row as { request?: unknown; note?: unknown }
      const request = typeof r.request === 'string' ? r.request.trim() : ''
      const note = typeof r.note === 'string' ? r.note.trim() : ''
      const line = [request, note].filter(Boolean).join(' — ')
      if (line) improvements.push(line)
    }
  }
  const fileTree = Array.isArray(b.fileTree)
    ? b.fileTree.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    : []
  return { requests, improvements, fileTree }
}

function uniqueTail(items: string[], maxItems: number, itemMax: number): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (let i = items.length - 1; i >= 0 && out.length < maxItems; i--) {
    const clipped = clip(items[i], itemMax)
    const key = clipped.toLowerCase()
    if (!clipped || seen.has(key)) continue
    seen.add(key)
    out.push(clipped)
  }
  return out.reverse()
}

function section(title: string, lines: string[]): string {
  if (!lines.length) return ''
  return `### ${title}\n${lines.map((l) => `- ${l}`).join('\n')}`
}

/**
 * Compact, consumption-only memory block for system prompts.
 * Does not change how memory is stored — only what generation sees.
 */
export function formatMemoryForPrompt(
  source: MemoryPromptSource | null | undefined,
  maxChars = MEMORY_PROMPT_MAX_CHARS,
): string {
  if (!source) return ''
  const items = source.memoryItems || []
  const brain = brainNotes(source.brain)

  const requests = uniqueTail(
    [
      ...itemText(items, 'user_request'),
      ...brain.requests,
      ...recentUserMessages(source.recentMessages || undefined),
    ],
    8,
    420,
  )
  const improvements = uniqueTail(
    [
      ...brain.improvements,
      ...itemText(items, 'decision'),
      ...itemText(items, 'fact'),
    ],
    8,
    360,
  )
  const fileSummaries = uniqueTail(itemText(items, 'file_summary'), 8, 280)
  const fileTree = uniqueTail(brain.fileTree, 16, 80)

  const files =
    fileSummaries.length || fileTree.length
      ? [
          ...fileSummaries,
          ...(fileTree.length
            ? [`Paths: ${fileTree.slice(0, 16).join(', ')}`]
            : []),
        ]
      : []

  const body = [
    section('Recent user requests', requests),
    section('Previous improvement notes', improvements),
    section('Short file summaries', files),
  ]
    .filter(Boolean)
    .join('\n\n')

  if (!body) return ''

  const header =
    '## Project memory (honor unless the new request contradicts it)\nUse this as continuity — do not copy it verbatim into the product, and do not invent facts that are not listed.'
  const full = `${header}\n\n${body}`
  if (full.length <= maxChars) return full
  return `${full.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`
}

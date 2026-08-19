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

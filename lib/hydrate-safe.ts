/** Next.js SSR + React hydration: CSS quotes in <style> children become &#x27; on the server. */

const SCRIPT_EXT = /\.(tsx|ts|jsx|js|mjs|cjs)$/i

export function sanitizeHydrationFile(filePath: string, content: string): string {
  if (!content || !SCRIPT_EXT.test(filePath)) return content
  return sanitizeStyleHydration(content)
}

export function sanitizeStyleHydration(code: string): string {
  if (!code.includes('<style')) return code
  let out = ''
  let i = 0
  while (i < code.length) {
    const start = code.indexOf('<style', i)
    if (start < 0) {
      out += code.slice(i)
      break
    }
    if (code.startsWith('<stylesheet', start)) {
      out += code.slice(i, start + 11)
      i = start + 11
      continue
    }
    out += code.slice(i, start)
    const tagEnd = findTagEnd(code, start)
    if (tagEnd < 0) {
      out += code.slice(start)
      break
    }
    const open = code.slice(start, tagEnd + 1)
    if (/\bjsx\b/.test(open) || /dangerouslySetInnerHTML/.test(open)) {
      out += open
      i = tagEnd + 1
      continue
    }
    const close = code.indexOf('</style>', tagEnd + 1)
    if (close < 0) {
      out += code.slice(start)
      break
    }
    const inner = code.slice(tagEnd + 1, close)
    if (!inner.trim()) {
      out += code.slice(start, close + 8)
      i = close + 8
      continue
    }
    const attrs = open
      .slice(6, open.endsWith('>') ? -1 : undefined)
      .replace(/\/\s*$/, '')
      .trim()
    const html = styleChildToHtmlExpr(inner)
    out += `<style${attrs ? ` ${attrs}` : ''} dangerouslySetInnerHTML={{ __html: ${html} }} />`
    i = close + 8
  }
  return out
}

function styleChildToHtmlExpr(inner: string): string {
  const t = inner.trim()
  if (t.startsWith('{') && t.endsWith('}')) return t.slice(1, -1).trim()
  return JSON.stringify(inner)
}

function findTagEnd(code: string, start: number): number {
  let i = start
  let brace = 0
  let quote: string | null = null
  while (i < code.length) {
    const c = code[i]
    if (quote) {
      if (c === '\\') {
        i += 2
        continue
      }
      if (c === quote) quote = null
      i++
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c
      i++
      continue
    }
    if (c === '{') brace++
    else if (c === '}') brace--
    else if (c === '>' && brace === 0) return i
    i++
  }
  return -1
}

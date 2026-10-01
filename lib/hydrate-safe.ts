/** Next.js SSR + React hydration: CSS quotes in <style> children become &#x27; on the server. */

const SCRIPT_EXT = /\.(tsx|ts|jsx|js|mjs|cjs)$/i

export function sanitizeHydrationFile(filePath: string, content: string): string {
  if (!content || !SCRIPT_EXT.test(filePath)) return content
  return sanitizeStateHydration(sanitizeStyleHydration(content))
}

/** Defer supported browser/theme hook values until after the identical initial render. */
export function sanitizeStateHydration(code: string): string {
  const masked = maskLiterals(code)
  const edits: { start: number; end: number; text: string }[] = []
  const namespace = '__evoHydrationReact'
  let nextId = 0
  while (masked.includes(`__evoMounted${nextId}`)) nextId++

  const states = /\b(?:const|let)\s+\[\s*([\w$]+)\s*,\s*([\w$]+)\s*\]\s*=\s*(?:[\w$]+\.)?useState\s*(?:<[^>]*>)?\s*\(/g
  for (const m of masked.matchAll(states)) {
    const open = m.index! + m[0].length - 1
    const close = callEnd(masked, open)
    if (close < 0 || /^\s*(?:as\b|satisfies\b|,)/.test(masked.slice(close + 1))) continue
    const initial = code.slice(open + 1, close).trim()
    const initialMask = masked.slice(open + 1, close)
    if (!/\b(?:window|document|localStorage|sessionStorage)\b/.test(initialMask)) continue
    if (/\bJSON\s*\.\s*parse\b|\breturn\s*\{/.test(initialMask)) continue
    const literals = initial.match(/"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'/g) || []
    const hasLight = literals.some((literal) => literal === "'light'" || literal === '"light"')
    const hasDark = literals.some((literal) => literal === "'dark'" || literal === '"dark"')
    const isBoolean = /^(?:is)?dark(?:Mode)?$|^(?:is)?light(?:Mode)?$/i.test(m[1])
    const isTheme = /^(?:theme|currentTheme|preferredTheme|colorScheme)$/i.test(m[1]) && (hasLight || hasDark)
    if (!isBoolean && !isTheme) continue
    const fallback = isBoolean ? 'false' : hasLight ? "'light'" : "'dark'"
    const lazy = /^(?:\(\s*\)|function\b)/.test(initial)
    const restored = lazy ? `(${initial})()` : `(${initial})`
    edits.push({
      start: open + 1,
      end: close + 1,
      text: `${fallback});\n${namespace}.useEffect(() => { try { ${m[2]}(${restored}) } catch { /* storage may be unavailable */ } }, [])`,
    })
  }

  const themes = /\b(?:const|let)\s*\{([^{}]*)\}\s*=\s*(?:[\w$]+\.)?useTheme\s*\(\s*\)/g
  for (const m of masked.matchAll(themes)) {
    const properties = code.slice(m.index!, m.index! + m[0].length).match(/\{([^{}]*)\}/)?.[1]
    if (!properties || /\.\.\.|=/.test(properties)) continue
    const bindings: { property: string; local: string; value: string }[] = []
    const id = nextId
    const renamed = properties.split(',').map((part) => {
      const binding = /^\s*(theme|resolvedTheme)\s*(?::\s*([\w$]+))?\s*$/.exec(part)
      if (!binding) return part
      if (binding[2]?.startsWith('__evoTheme')) return part
      const value = `__evoTheme${id}_${bindings.length}`
      bindings.push({ property: binding[1], local: binding[2] || binding[1], value })
      return `${binding[1]}: ${value}`
    }).join(',')
    if (!bindings.length) continue
    nextId++
    const declaration = code.slice(m.index!, m.index! + m[0].length).replace(/\{[^{}]*\}/, `{${renamed}}`)
    edits.push({
      start: m.index!,
      end: m.index! + m[0].length,
      text: `${declaration};\nconst [__evoMounted${id}, __evoSetMounted${id}] = ${namespace}.useState(false);\n${namespace}.useEffect(() => { __evoSetMounted${id}(true) }, []);\n${bindings.map((b) => `const ${b.local} = __evoMounted${id} ? ${b.value} : undefined;`).join('\n')}`,
    })
  }
  if (!edits.length) return code
  // ponytail: only recognized hook declarations; arbitrary render-time browser reads need model repair.
  let out = code
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    out = out.slice(0, edit.start) + edit.text + out.slice(edit.end)
  }
  return code.includes(`import * as ${namespace}`) ? out : `${out}\nimport * as ${namespace} from 'react'\n`
}

function callEnd(masked: string, open: number): number {
  let depth = 0
  for (let i = open; i < masked.length; i++) {
    if (masked[i] === '(') depth++
    if (masked[i] === ')' && --depth === 0) return i
  }
  return -1
}

/** Keep offsets while excluding comments and strings from hook matching. */
function maskLiterals(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|`(?:\\[\s\S]|[^`\\])*`/g, (literal) => literal.replace(/[^\n]/g, ' '))
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

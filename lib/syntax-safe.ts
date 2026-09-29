/** Close generated strings and cut-off pages so Next does not fail with Unexpected eof. */

import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const SCRIPT_EXT = /\.(tsx|ts|jsx|js|mjs|cjs)$/i

type Mode = 'code' | 'jsx'
type Frame =
  | { k: 'p' | 'k' | 'c' }
  | { k: 'b'; jsxExpr?: boolean }
  | { k: 's'; q: '"' | "'" | '`'; at: number }
  | { k: 'x'; name: string; back: Mode }

export function sanitizeSyntaxFile(filePath: string, content: string): string {
  if (!content || !SCRIPT_EXT.test(filePath)) return content
  const jsx = /\.(tsx|jsx)$/i.test(filePath)
  const { edits, stack } = scan(content, jsx)
  if (!edits.length && !stack.length) return content
  const repaired = applyEdits(content, edits)
  if (!stack.length) return repaired
  const closed = repaired + closeStack(stack)
  // A closer that still does not parse is noise. Keep the quote repair only.
  if (parses(closed, filePath)) return closed
  return repaired
}

export function repairSyntax(code: string, jsx = true): string {
  const { edits, stack } = scan(code, jsx)
  const repaired = applyEdits(code, edits)
  return stack.length ? repaired + closeStack(stack) : repaired
}

function scan(code: string, jsx: boolean): { edits: { i: number; c: string }[]; stack: Frame[] } {
  const edits: { i: number; c: string }[] = []
  const stack: Frame[] = []
  let mode: Mode = 'code'
  let i = 0
  const n = code.length

  while (i < n) {
    const s = stringTop(stack)
    if (s) {
      const c = code[i]
      if (c === '\\') {
        i += 2
        continue
      }
      if (s.q === '`' && c === '$' && code[i + 1] === '{') {
        stack.push({ k: 'b' })
        i += 2
        continue
      }
      // ponytail: a raw newline cannot occur in a ' or " string, so the opener was meant to be a template.
      // Ceiling: the broken string becomes a template. Upgrade: only rewrite after SWC reports eof.
      if ((s.q === '"' || s.q === "'") && (c === '\n' || c === '\r')) {
        edits.push({ i: s.at, c: '`' })
        s.q = '`'
        if (c === '\r' && code[i + 1] === '\n') i++
        i++
        continue
      }
      // ponytail: a line that is only "; or '; closes a template opened with a backtick.
      // Ceiling: CSS whose entire line is "; would end the string there.
      if (s.q === '`' && (c === '"' || c === "'") && loneCloser(code, i)) {
        edits.push({ i, c: '`' })
        stack.pop()
        i++
        continue
      }
      if (c === s.q) {
        stack.pop()
        i++
        continue
      }
      i++
      continue
    }

    if (stack[stack.length - 1]?.k === 'c') {
      if (code[i] === '*' && code[i + 1] === '/') {
        stack.pop()
        i += 2
        continue
      }
      i++
      continue
    }

    if (mode === 'jsx') {
      const c = code[i]
      if (c === '{') {
        stack.push({ k: 'b', jsxExpr: true })
        mode = 'code'
        i++
        continue
      }
      if (c === '<') {
        const tag = readTag(code, i)
        if (tag) {
          if (tag.kind === 'close') {
            if (stack[stack.length - 1]?.k === 'x') {
              mode = (stack.pop() as Extract<Frame, { k: 'x' }>).back
            }
          } else if (tag.kind === 'open') {
            stack.push({ k: 'x', name: tag.name, back: 'jsx' })
          }
          i = tag.next
          continue
        }
      }
      i++
      continue
    }

    const c = code[i]
    if (c === '/' && code[i + 1] === '/') {
      while (i < n && code[i] !== '\n') i++
      continue
    }
    if (c === '/' && code[i + 1] === '*') {
      stack.push({ k: 'c' })
      i += 2
      continue
    }
    if (c === '/' && regexHere(code, i)) {
      i = skipRegex(code, i)
      continue
    }
    if (c === "'" || c === '"' || c === '`') {
      stack.push({ k: 's', q: c, at: i })
      i++
      continue
    }
    if (c === '(') {
      stack.push({ k: 'p' })
      i++
      continue
    }
    if (c === '{') {
      stack.push({ k: 'b' })
      i++
      continue
    }
    if (c === '[') {
      stack.push({ k: 'k' })
      i++
      continue
    }
    if (c === ')' || c === '}' || c === ']') {
      const want = c === ')' ? 'p' : c === '}' ? 'b' : 'k'
      const top = stack[stack.length - 1]
      if (top?.k === want) {
        stack.pop()
        if (want === 'b' && (top as { jsxExpr?: boolean }).jsxExpr) {
          mode = stack[stack.length - 1]?.k === 'x' ? 'jsx' : 'code'
        }
      }
      i++
      continue
    }
    if (jsx && c === '<' && startsJsx(code, i)) {
      const tag = readTag(code, i)
      if (tag) {
        if (tag.kind === 'close') {
          if (stack[stack.length - 1]?.k === 'x') {
            mode = (stack.pop() as Extract<Frame, { k: 'x' }>).back
          }
        } else if (tag.kind === 'open') {
          stack.push({ k: 'x', name: tag.name, back: mode })
          mode = 'jsx'
        }
        i = tag.next
        continue
      }
    }
    i++
  }

  return { edits, stack }
}

function stringTop(stack: Frame[]): Extract<Frame, { k: 's' }> | null {
  const top = stack[stack.length - 1]
  return top && top.k === 's' ? top : null
}

function loneCloser(code: string, i: number): boolean {
  let b = i - 1
  while (b >= 0 && code[b] !== '\n') {
    if (code[b] !== ' ' && code[b] !== '\t' && code[b] !== '\r') return false
    b--
  }
  let f = i + 1
  if (code[f] === ';') f++
  while (code[f] === ' ' || code[f] === '\t' || code[f] === '\r') f++
  return f >= code.length || code[f] === '\n'
}

function startsJsx(code: string, i: number): boolean {
  const n = code[i + 1]
  if (n === '/') return code[i + 2] !== '/' && code[i + 2] !== '*'
  if (!n || !/[A-Za-z]/.test(n)) return false
  let j = i - 1
  while (j >= 0 && /\s/.test(code[j])) j--
  if (j < 0) return true
  const p = code[j]
  if ('(=,{[?:&|+!~;'.includes(p) || p === '}') return true
  if (p === '>') return true
  if (!/[\w$]/.test(p)) return false
  let k = j
  while (k >= 0 && /[\w$]/.test(code[k])) k--
  const word = code.slice(k + 1, j + 1)
  return (
    word === 'return' ||
    word === 'yield' ||
    word === 'throw' ||
    word === 'case' ||
    word === 'else' ||
    word === 'void'
  )
}

type Tag = { next: number; kind: 'open' | 'close' | 'self'; name: string }

function readTag(code: string, i: number): Tag | null {
  let j = i + 1
  let closing = false
  if (code[j] === '/') {
    closing = true
    j++
  }
  if (code[j] === '>') {
    return { next: j + 1, kind: closing ? 'close' : 'open', name: '' }
  }
  const m = /^[A-Za-z][\w-]*(?:\.[\w-]+)*/.exec(code.slice(j))
  if (!m) return null
  const name = m[0]
  j += name.length
  if (closing) {
    while (j < code.length && /\s/.test(code[j])) j++
    if (code[j] !== '>') return null
    return { next: j + 1, kind: 'close', name }
  }
  let brace = 0
  let quote: string | null = null
  while (j < code.length) {
    const c = code[j]
    if (quote) {
      if (c === '\\') {
        j += 2
        continue
      }
      if (c === quote) quote = null
      j++
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c
      j++
      continue
    }
    if (c === '{') brace++
    else if (c === '}' && brace > 0) brace--
    else if (c === '>' && brace === 0) {
      const self = code[j - 1] === '/'
      return { next: j + 1, kind: self ? 'self' : 'open', name }
    }
    j++
  }
  return { next: j, kind: 'open', name }
}

function regexHere(code: string, i: number): boolean {
  let j = i - 1
  while (j >= 0 && /\s/.test(code[j])) j--
  if (j < 0) return true
  const p = code[j]
  if ('([{:;,=!&|?+-*%~^<>'.includes(p)) return true
  if (!/[\w$]/.test(p)) return false
  let k = j
  while (k >= 0 && /[\w$]/.test(code[k])) k--
  return /^(return|typeof|void|case|throw|else|in|of|yield|delete|await|do)$/.test(
    code.slice(k + 1, j + 1),
  )
}

function skipRegex(code: string, i: number): number {
  let j = i + 1
  let cls = false
  while (j < code.length) {
    const c = code[j]
    if (c === '\\') {
      j += 2
      continue
    }
    if (c === '[') cls = true
    else if (c === ']') cls = false
    else if (c === '/' && !cls) return j + 1
    else if (c === '\n') return i + 1
    j++
  }
  return j
}

function applyEdits(code: string, edits: { i: number; c: string }[]): string {
  if (!edits.length) return code
  let out = code
  for (let k = edits.length - 1; k >= 0; k--) {
    const e = edits[k]
    out = out.slice(0, e.i) + e.c + out.slice(e.i + 1)
  }
  return out
}

function closeStack(stack: Frame[]): string {
  let s = ''
  for (let i = stack.length - 1; i >= 0; i--) {
    const f = stack[i]
    if (f.k === 's') s += f.q
    else if (f.k === 'b') s += '}'
    else if (f.k === 'p') s += ')'
    else if (f.k === 'k') s += ']'
    else if (f.k === 'c') s += '*/'
    else if (f.k === 'x') s += f.name ? `</${f.name}>` : '</>'
  }
  return s
}

function parses(code: string, filePath: string): boolean {
  try {
    const ts = /\.(tsx|ts|jsx)$/i.test(filePath)
    const { transformSync } = require('next/dist/build/swc/index.js') as {
      transformSync: (src: string, opts: object) => unknown
    }
    transformSync(code, {
      filename: filePath,
      jsc: {
        parser: {
          syntax: ts ? 'typescript' : 'ecmascript',
          tsx: /\.(tsx|jsx)$/i.test(filePath),
          dynamicImport: true,
        },
        target: 'es2017',
      },
    })
    return true
  } catch {
    return false
  }
}

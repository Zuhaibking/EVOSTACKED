/** Motion spring/inertia can only tween two keyframes. Generated pages crash otherwise. */

const MOTION_TAG = /<(?:motion|Motion|m)\.[A-Za-z][\w]*/g
const VALUE_PROP = /(?:animate|initial|exit|whileHover|whileTap|whileInView|whileDrag|whileFocus|variants)\s*=\s*\{/g
const SPRING_TYPE = /type:\s*(['"])(spring|inertia)\1/g
const TWEEN_TYPE = /type:\s*(['"])(tween|keyframes)\1/
const TRANSITION_OBJECT = /transition\s*=\s*\{\{/
const TRANSITION_IDENT = /transition\s*=\s*\{([A-Za-z_$][\w]*)\}/
const SCRIPT_EXT = /\.(tsx|ts|jsx|js|mjs|cjs|vue)$/i

export function sanitizeMotionFile(
  filePath: string,
  content: string,
): string {
  if (!content || !SCRIPT_EXT.test(filePath)) return content
  return sanitizeMotionKeyframes(content)
}

export function sanitizeMotionKeyframes(code: string): string {
  if (!code || !/motion/i.test(code)) return code
  let out = ''
  let last = 0
  MOTION_TAG.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = MOTION_TAG.exec(code))) {
    const start = m.index
    const end = findTagEnd(code, start)
    if (end < 0) continue
    const tag = code.slice(start, end + 1)
    out += code.slice(last, start)
    out += fixMotionTag(tag)
    last = end + 1
    MOTION_TAG.lastIndex = last
  }
  return last ? out + code.slice(last) : code
}

function fixMotionTag(tag: string): string {
  if (!hasMultiKeyframes(tag)) return tag

  let next = tag.replace(SPRING_TYPE, 'type: $1tween$1')
  if (TWEEN_TYPE.test(next)) return next

  if (TRANSITION_OBJECT.test(next)) {
    return next.replace(TRANSITION_OBJECT, 'transition={{ type: "tween", ')
  }

  if (TRANSITION_IDENT.test(next)) {
    return next.replace(
      TRANSITION_IDENT,
      'transition={{ ...$1, type: "tween" }}',
    )
  }

  if (next.endsWith('/>')) {
    return `${next.slice(0, -2)} transition={{ type: "tween" }} />`
  }
  if (next.endsWith('>')) {
    return `${next.slice(0, -1)} transition={{ type: "tween" }}>`
  }
  return next
}

function hasMultiKeyframes(tag: string): boolean {
  VALUE_PROP.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = VALUE_PROP.exec(tag))) {
    const open = m.index + m[0].length - 1
    const close = matchPair(tag, open, '{', '}')
    if (close < 0) continue
    if (hasThreePlusArray(tag.slice(open, close + 1))) return true
  }
  return false
}

function hasThreePlusArray(src: string): boolean {
  for (let i = 0; i < src.length; i++) {
    if (src[i] !== '[') continue
    if (inQuoteAt(src, i)) continue
    if (arrayTopCommas(src, i) >= 2) return true
  }
  return false
}

function arrayTopCommas(src: string, open: number): number {
  let i = open + 1
  let depth = 1
  let brace = 0
  let paren = 0
  let quote: string | null = null
  let commas = 0
  while (i < src.length && depth > 0) {
    const c = src[i]
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
    if (c === '[') depth++
    else if (c === ']') depth--
    else if (c === '{') brace++
    else if (c === '}') brace--
    else if (c === '(') paren++
    else if (c === ')') paren--
    else if (c === ',' && depth === 1 && brace === 0 && paren === 0) commas++
    i++
  }
  return commas
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

function matchPair(
  src: string,
  open: number,
  left: string,
  right: string,
): number {
  let depth = 0
  let quote: string | null = null
  for (let i = open; i < src.length; i++) {
    const c = src[i]
    if (quote) {
      if (c === '\\') {
        i++
        continue
      }
      if (c === quote) quote = null
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c
      continue
    }
    if (c === left) depth++
    else if (c === right) {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

function inQuoteAt(src: string, idx: number): boolean {
  let quote: string | null = null
  for (let i = 0; i < idx; i++) {
    const c = src[i]
    if (quote) {
      if (c === '\\') {
        i++
        continue
      }
      if (c === quote) quote = null
      continue
    }
    if (c === '"' || c === "'" || c === '`') quote = c
  }
  return quote !== null
}

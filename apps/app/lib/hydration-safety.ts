/**
 * Deterministic SSR/hydration hazard detection for generated React/Next code.
 * ZERO provider / E2B / network calls.
 *
 * Goal: catch render-time time/random/browser APIs that diverge between
 * server HTML and the first client render — without product-specific rules.
 */

export type HydrationRiskCode =
  | 'render_time_now'
  | 'render_new_date'
  | 'render_random'
  | 'render_browser_api'
  | 'render_locale_time'

export type HydrationRisk = {
  code: HydrationRiskCode
  severity: 'error' | 'warning'
  message: string
  /** Approximate 1-based line when available. */
  line?: number
  snippet?: string
}

const EFFECT_CALLEE = /\b(useEffect|useLayoutEffect)\s*\(/g

/**
 * Replace useEffect / useLayoutEffect callback bodies with spaces so
 * Date.now() / Math.random() inside effects are not flagged.
 */
export function maskClientEffectBodies(source: string): string {
  if (!source) return source
  const out = source.split('')
  EFFECT_CALLEE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = EFFECT_CALLEE.exec(source))) {
    const openParen = m.index + m[0].length - 1
    const closeParen = findMatchingParen(source, openParen)
    if (closeParen < 0) continue
    for (let i = openParen + 1; i < closeParen; i++) {
      if (out[i] !== '\n') out[i] = ' '
    }
    EFFECT_CALLEE.lastIndex = closeParen + 1
  }
  return out.join('')
}

function findMatchingParen(source: string, openIdx: number): number {
  let depth = 0
  let inStr: '"' | "'" | '`' | null = null
  let escaped = false
  for (let i = openIdx; i < source.length; i++) {
    const ch = source[i]
    if (inStr) {
      if (escaped) {
        escaped = false
        continue
      }
      if (ch === '\\' && inStr !== '`') {
        escaped = true
        continue
      }
      if (ch === inStr) inStr = null
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      inStr = ch
      continue
    }
    if (ch === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') i++
      continue
    }
    if (ch === '/' && source[i + 1] === '*') {
      i += 2
      while (
        i < source.length - 1 &&
        !(source[i] === '*' && source[i + 1] === '/')
      ) {
        i++
      }
      i++
      continue
    }
    if (ch === '(') depth++
    else if (ch === ')') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

/** Strip line and block comments for simpler scanning (keep newlines). */
export function stripCommentsPreserveLines(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) =>
      block
        .split('')
        .map((c) => (c === '\n' ? '\n' : ' '))
        .join(''),
    )
    .replace(/^\s*\/\/.*$/gm, (line) => ' '.repeat(line.length))
}

function lineAt(source: string, index: number): number {
  let line = 1
  for (let i = 0; i < index && i < source.length; i++) {
    if (source[i] === '\n') line++
  }
  return line
}

function snippetAt(source: string, index: number): string {
  const start = source.lastIndexOf('\n', index - 1) + 1
  let end = source.indexOf('\n', index)
  if (end < 0) end = source.length
  return source.slice(start, end).trim().slice(0, 120)
}

type PatternDef = {
  code: HydrationRiskCode
  severity: 'error' | 'warning'
  re: RegExp
  message: string
}

const PATTERNS: PatternDef[] = [
  {
    code: 'render_time_now',
    severity: 'error',
    re: /\bDate\.now\s*\(/g,
    message:
      'Date.now() during render/SSR can hydrate differently on the client. Initialize clocks/countdowns in useEffect with a stable placeholder first.',
  },
  {
    code: 'render_new_date',
    severity: 'error',
    // new Date() with empty args only — new Date('2026-01-01') is stable
    re: /\bnew\s+Date\s*\(\s*\)/g,
    message:
      'new Date() with no arguments during render/SSR is hydration-unsafe. Use a fixed timestamp string, or set the live value in useEffect.',
  },
  {
    code: 'render_random',
    severity: 'error',
    re: /\bMath\.random\s*\(/g,
    message:
      'Math.random() during render/SSR produces different server vs client output. Generate random values in useEffect or use stable deterministic IDs.',
  },
  {
    code: 'render_random',
    severity: 'error',
    re: /\bcrypto\.randomUUID\s*\(/g,
    message:
      'crypto.randomUUID() during render/SSR is hydration-unsafe. Create IDs in useEffect or use stable deterministic keys.',
  },
  {
    code: 'render_browser_api',
    severity: 'error',
    re: /\b(localStorage|sessionStorage)\b/g,
    message:
      'localStorage/sessionStorage during render/SSR breaks hydration. Read/write browser storage inside useEffect only.',
  },
  {
    code: 'render_browser_api',
    severity: 'error',
    re: /\bwindow\.(innerWidth|innerHeight|localStorage|sessionStorage|location|navigator)\b/g,
    message:
      'Browser-only window APIs during render/SSR are hydration-unsafe. Access them after mount in useEffect.',
  },
  {
    code: 'render_locale_time',
    severity: 'warning',
    re: /\.toLocale(?:String|DateString|TimeString)\s*\(/g,
    message:
      'toLocale* during render may differ by server vs client locale/timezone. Prefer a fixed locale after mount, or format only in useEffect.',
  },
]

/**
 * Detect hydration-sensitive patterns outside client effect bodies.
 */
export function detectHydrationRisksInSource(
  source: string,
  opts?: { filePath?: string },
): HydrationRisk[] {
  if (!source || typeof source !== 'string') return []
  const file = opts?.filePath || 'unknown'
  const cleaned = stripCommentsPreserveLines(source)
  const masked = maskClientEffectBodies(cleaned)
  const risks: HydrationRisk[] = []
  const seen = new Set<string>()

  for (const p of PATTERNS) {
    p.re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = p.re.exec(masked))) {
      const key = `${p.code}:${m.index}`
      if (seen.has(key)) continue
      seen.add(key)
      risks.push({
        code: p.code,
        severity: p.severity,
        message: `${file}: ${p.message}`,
        line: lineAt(source, m.index),
        snippet: snippetAt(source, m.index),
      })
    }
  }

  return risks
}

/** True when source looks like a React/Next UI module worth scanning. */
export function shouldScanFileForHydration(filePath: string): boolean {
  const p = (filePath || '').replace(/\\/g, '/').toLowerCase()
  if (!/\.(tsx|jsx|js|mjs|cjs)$/.test(p)) return false
  if (/(^|\/)(next\.config|postcss\.config|tailwind\.config)/.test(p)) {
    return false
  }
  return true
}

export function formatHydrationRepairHints(risks: HydrationRisk[]): string {
  if (!risks.length) return ''
  const lines = risks.slice(0, 8).map((r) => `- [${r.severity}] ${r.message}`)
  return `## Hydration / SSR safety failures
${lines.join('\n')}

Required fix pattern (keep the feature — do not delete countdowns/clocks/animations):
1. Render a stable placeholder on the server and first client paint (e.g. "—", "00:00:00", or empty).
2. Set live/time/random/browser values inside useEffect / useLayoutEffect only.
3. Optional gate: const [ready, setReady] = useState(false); useEffect(() => setReady(true), []).
Never call Date.now(), new Date(), Math.random(), or browser storage during render or in useState initializers.
`
}

/**
 * Deterministic stylesheet integrity — @import order, truncation, duplicates.
 * ZERO OpenAI / E2B / network. No product-specific heuristics.
 */
import { getFragmentFiles, type FragmentFile } from '@/lib/fragment'
import type { FragmentSchema } from '@/lib/schema'
import type { DeepPartial } from '@evostack/shared'

export type CssIssueCode =
  | 'invalid_css_import_order'
  | 'malformed_css'
  | 'truncated_css'
  | 'duplicate_stylesheet'

export type CssIntegrityIssue = {
  code: CssIssueCode
  severity: 'error'
  message: string
  file?: string
  line?: number
}

export type CssIntegrityResult = {
  ok: boolean
  issues: CssIntegrityIssue[]
}

export type StylesheetNormalizeResult = {
  css: string
  changed: boolean
}

export type TopLevelCssRuleKind =
  | 'charset'
  | 'import'
  | 'layer-statement'
  | 'rule'

export type TopLevelCssRule = {
  kind: TopLevelCssRuleKind
  name?: string
  start: number
  end: number
  line: number
  text: string
}

export function isCssFile(path: string): boolean {
  return /\.css$/i.test(path.replace(/\\/g, '/'))
}

export function isGlobalsStylesheet(path: string): boolean {
  return /(^|\/)globals\.css$/i.test(path.replace(/\\/g, '/'))
}

export function looksLikeTailwindEntrypoint(css: string): boolean {
  return /@import\s+["']tailwindcss["']|@tailwind\b/i.test(css)
}

function lineAt(css: string, index: number): number {
  let line = 1
  const end = Math.min(index, css.length)
  for (let i = 0; i < end; i++) {
    if (css[i] === '\n') line++
  }
  return line
}

function isIdentChar(ch: string): boolean {
  return /[A-Za-z0-9_-]/.test(ch)
}

/** Advance through a CSS string literal starting at `i` (the opening quote). */
function consumeString(
  css: string,
  i: number,
): { end: number; closed: boolean } {
  const quote = css[i]
  let j = i + 1
  while (j < css.length) {
    if (css[j] === '\\') {
      j += 2
      continue
    }
    if (css[j] === quote) return { end: j + 1, closed: true }
    j++
  }
  return { end: j, closed: false }
}

/** Advance through `/* ... *\/` starting at `i` (`/`). */
function consumeComment(
  css: string,
  i: number,
): { end: number; closed: boolean } {
  let j = i + 2
  while (j < css.length - 1) {
    if (css[j] === '*' && css[j + 1] === '/') return { end: j + 2, closed: true }
    j++
  }
  return { end: css.length, closed: false }
}

function skipWs(css: string, i: number): number {
  while (i < css.length && /\s/.test(css[i])) i++
  return i
}

/**
 * Skip whitespace and comments. Returns -1 if an unclosed comment is hit.
 */
function skipWsAndComments(
  css: string,
  i: number,
): { index: number; unclosedComment: boolean } {
  let j = i
  while (j < css.length) {
    j = skipWs(css, j)
    if (css[j] === '/' && css[j + 1] === '*') {
      const c = consumeComment(css, j)
      if (!c.closed) return { index: c.end, unclosedComment: true }
      j = c.end
      continue
    }
    // Generated stylesheets often use // comments (PostCSS / Tailwind).
    // Skip them between rules so they are not treated as malformed selectors.
    if (css[j] === '/' && css[j + 1] === '/') {
      while (j < css.length && css[j] !== '\n') j++
      continue
    }
    break
  }
  return { index: j, unclosedComment: false }
}

function findMatchingBrace(
  css: string,
  openIndex: number,
): { end: number; closed: boolean; unclosedString: boolean; unclosedComment: boolean } {
  let depth = 0
  let j = openIndex
  while (j < css.length) {
    const ch = css[j]
    if (ch === '/' && css[j + 1] === '*') {
      const c = consumeComment(css, j)
      if (!c.closed) {
        return {
          end: c.end,
          closed: false,
          unclosedString: false,
          unclosedComment: true,
        }
      }
      j = c.end
      continue
    }
    if (ch === '"' || ch === "'") {
      const s = consumeString(css, j)
      if (!s.closed) {
        return {
          end: s.end,
          closed: false,
          unclosedString: true,
          unclosedComment: false,
        }
      }
      j = s.end
      continue
    }
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) {
        return {
          end: j + 1,
          closed: true,
          unclosedString: false,
          unclosedComment: false,
        }
      }
    }
    j++
  }
  return {
    end: j,
    closed: false,
    unclosedString: false,
    unclosedComment: false,
  }
}

function scanNestedImport(
  css: string,
  blockStart: number,
  blockEnd: number,
): number | null {
  let j = blockStart + 1
  while (j < blockEnd - 1) {
    if (css[j] === '/' && css[j + 1] === '*') {
      const c = consumeComment(css, j)
      j = c.end
      continue
    }
    if (css[j] === '"' || css[j] === "'") {
      j = consumeString(css, j).end
      continue
    }
    if (
      css[j] === '@' &&
      css.slice(j, j + 7).toLowerCase() === '@import' &&
      !isIdentChar(css[j + 7] || '')
    ) {
      return j
    }
    j++
  }
  return null
}

export function parseTopLevelCss(css: string): {
  rules: TopLevelCssRule[]
  issues: CssIntegrityIssue[]
} {
  const rules: TopLevelCssRule[] = []
  const issues: CssIntegrityIssue[] = []
  let i = 0

  const pushIssue = (
    code: CssIssueCode,
    message: string,
    index: number,
  ) => {
    issues.push({
      code,
      severity: 'error',
      message,
      line: lineAt(css, index),
    })
  }

  while (i < css.length) {
    const skipped = skipWsAndComments(css, i)
    if (skipped.unclosedComment) {
      pushIssue(
        'truncated_css',
        `Unclosed comment starting at line ${lineAt(css, i)}`,
        i,
      )
      break
    }
    i = skipped.index
    if (i >= css.length) break

    const start = i
    const line = lineAt(css, start)

    if (css[i] === '@') {
      let nameEnd = i + 1
      while (nameEnd < css.length && isIdentChar(css[nameEnd])) nameEnd++
      const name = css.slice(i + 1, nameEnd).toLowerCase()

      let j = nameEnd
      let paren = 0
      let ended: 'semi' | 'brace' | 'eof' = 'eof'
      let braceAt = -1
      let unclosedString = false
      let unclosedComment = false

      while (j < css.length) {
        const ch = css[j]
        if (ch === '/' && css[j + 1] === '*') {
          const c = consumeComment(css, j)
          if (!c.closed) {
            unclosedComment = true
            j = c.end
            break
          }
          j = c.end
          continue
        }
        if (ch === '"' || ch === "'") {
          const s = consumeString(css, j)
          if (!s.closed) {
            unclosedString = true
            j = s.end
            break
          }
          j = s.end
          continue
        }
        if (ch === '(') paren++
        else if (ch === ')') paren = Math.max(0, paren - 1)
        else if (ch === '{' && paren === 0) {
          ended = 'brace'
          braceAt = j
          break
        } else if (ch === ';' && paren === 0) {
          ended = 'semi'
          j++
          break
        }
        j++
      }

      if (unclosedComment) {
        pushIssue(
          'truncated_css',
          `Unclosed comment in @${name} at line ${line}`,
          start,
        )
        break
      }
      if (unclosedString) {
        pushIssue(
          'truncated_css',
          `Unclosed string in @${name} at line ${line}`,
          start,
        )
        break
      }

      if (ended === 'eof') {
        const code =
          name === 'import' || name === 'charset' ? 'truncated_css' : 'malformed_css'
        pushIssue(
          code,
          name === 'import'
            ? `@import at line ${line} is missing a terminating semicolon`
            : `Unterminated @${name} at line ${line}`,
          start,
        )
        break
      }

      let end = j
      if (ended === 'brace') {
        const block = findMatchingBrace(css, braceAt)
        if (block.unclosedComment) {
          pushIssue(
            'truncated_css',
            `Unclosed comment in @${name} block at line ${line}`,
            start,
          )
          break
        }
        if (block.unclosedString) {
          pushIssue(
            'truncated_css',
            `Unclosed string in @${name} block at line ${line}`,
            start,
          )
          break
        }
        if (!block.closed) {
          pushIssue(
            'truncated_css',
            `Unclosed @${name} block starting at line ${line}`,
            start,
          )
          break
        }
        end = block.end
        const nested = scanNestedImport(css, braceAt, end)
        if (nested != null) {
          const nline = lineAt(css, nested)
          issues.push({
            code: 'invalid_css_import_order',
            severity: 'error',
            message: `Line ${nline}: @import inside a CSS block is invalid — @import must be top-level and precede ordinary rules`,
            line: nline,
          })
        }
      }

      let kind: TopLevelCssRuleKind = 'rule'
      if (name === 'charset') kind = 'charset'
      else if (name === 'import') kind = 'import'
      else if (name === 'layer' && ended === 'semi') kind = 'layer-statement'

      rules.push({
        kind,
        name,
        start,
        end,
        line,
        text: css.slice(start, end),
      })
      i = end
      continue
    }

    if (css[i] === '}') {
      pushIssue(
        'malformed_css',
        `Unexpected closing brace at line ${line}`,
        i,
      )
      i++
      continue
    }

    // Style rule: selector { ... }
    let j = i
    let foundBrace = false
    let unclosedString = false
    let unclosedComment = false
    while (j < css.length) {
      const ch = css[j]
      if (ch === '/' && css[j + 1] === '*') {
        const c = consumeComment(css, j)
        if (!c.closed) {
          unclosedComment = true
          j = c.end
          break
        }
        j = c.end
        continue
      }
      if (ch === '"' || ch === "'") {
        const s = consumeString(css, j)
        if (!s.closed) {
          unclosedString = true
          j = s.end
          break
        }
        j = s.end
        continue
      }
      if (ch === '{') {
        foundBrace = true
        break
      }
      if (ch === '}') break
      j++
    }

    if (unclosedComment) {
      pushIssue('truncated_css', `Unclosed comment at line ${line}`, start)
      break
    }
    if (unclosedString) {
      pushIssue('truncated_css', `Unclosed string at line ${line}`, start)
      break
    }
    if (!foundBrace) {
      pushIssue(
        'malformed_css',
        `Malformed CSS starting at line ${line} (expected a rule block)`,
        start,
      )
      break
    }

    const block = findMatchingBrace(css, j)
    if (block.unclosedComment) {
      pushIssue('truncated_css', `Unclosed comment in rule at line ${line}`, start)
      break
    }
    if (block.unclosedString) {
      pushIssue('truncated_css', `Unclosed string in rule at line ${line}`, start)
      break
    }
    if (!block.closed) {
      pushIssue(
        'truncated_css',
        `Unclosed style rule starting at line ${line}`,
        start,
      )
      break
    }

    const nested = scanNestedImport(css, j, block.end)
    if (nested != null) {
      const nline = lineAt(css, nested)
      issues.push({
        code: 'invalid_css_import_order',
        severity: 'error',
        message: `Line ${nline}: @import inside a CSS block is invalid — @import must be top-level and precede ordinary rules`,
        line: nline,
      })
    }

    rules.push({
      kind: 'rule',
      start,
      end: block.end,
      line,
      text: css.slice(start, block.end),
    })
    i = block.end
  }

  return { rules, issues }
}

function isPreludeKind(kind: TopLevelCssRuleKind): boolean {
  return kind === 'charset' || kind === 'import' || kind === 'layer-statement'
}

export function validateStylesheet(
  css: string,
  filePath?: string,
): CssIntegrityResult {
  const { rules, issues } = parseTopLevelCss(css)
  const prefix = filePath ? `${filePath}:` : ''

  let seenNormalRule = false
  for (const rule of rules) {
    if (rule.kind === 'import') {
      if (seenNormalRule) {
        issues.push({
          code: 'invalid_css_import_order',
          severity: 'error',
          message: `${prefix}${rule.line}: @import after CSS rules. @import must precede ordinary rules (only @charset and @layer statements may appear first).`,
          file: filePath,
          line: rule.line,
        })
      }
    } else if (!isPreludeKind(rule.kind)) {
      seenNormalRule = true
    }
  }

  const labeled = issues.map((issue) => ({
    ...issue,
    file: issue.file || filePath,
    message:
      filePath && !issue.message.startsWith(filePath)
        ? `${filePath}:${issue.line ?? '?'}: ${issue.message.replace(/^Line \d+:\s*/, '')}`
        : issue.message,
  }))

  return { ok: labeled.length === 0, issues: labeled }
}

export function validateFragmentStylesheets(
  files: Array<{ file_path: string; file_content: string }>,
): CssIntegrityResult {
  const issues: CssIntegrityIssue[] = []
  const cssFiles = files.filter((f) => isCssFile(f.file_path))

  for (const f of cssFiles) {
    const result = validateStylesheet(f.file_content, f.file_path)
    issues.push(...result.issues)
  }

  const tailwindGlobals = cssFiles.filter(
    (f) =>
      isGlobalsStylesheet(f.file_path) &&
      looksLikeTailwindEntrypoint(f.file_content),
  )
  if (tailwindGlobals.length >= 2) {
    issues.push({
      code: 'duplicate_stylesheet',
      severity: 'error',
      message: `Duplicate Tailwind entry stylesheets: ${tailwindGlobals
        .map((f) => f.file_path)
        .join(', ')}. Keep a single globals.css entrypoint.`,
      file: tailwindGlobals[0]?.file_path,
    })
  }

  return { ok: issues.length === 0, issues }
}

/**
 * Move top-level @charset then @import to the start of the file.
 * Other rules stay in place. Does not rewrite malformed/truncated CSS.
 */
export function normalizeStylesheet(css: string): StylesheetNormalizeResult {
  if (!css.trim()) return { css, changed: false }

  const { rules, issues } = parseTopLevelCss(css)
  const fatal = issues.some(
    (i) => i.code === 'truncated_css' || i.code === 'malformed_css',
  )
  if (fatal) return { css, changed: false }

  const needsHoist = rules.some((rule, idx) => {
    if (rule.kind !== 'import' && rule.kind !== 'charset') return false
    return rules.slice(0, idx).some((prev) => !isPreludeKind(prev.kind))
  })

  const charsetIdx = rules.findIndex((r) => r.kind === 'charset')
  const firstNonCharset = rules.findIndex((r) => r.kind !== 'charset')
  const charsetNotFirst =
    charsetIdx > 0 && (firstNonCharset === -1 || charsetIdx > firstNonCharset)

  if (!needsHoist && !charsetNotFirst) return { css, changed: false }

  const charsets = rules.filter((r) => r.kind === 'charset')
  const imports = rules.filter((r) => r.kind === 'import')
  const remove = [...charsets, ...imports].sort((a, b) => b.start - a.start)

  let remainder = css
  for (const r of remove) {
    remainder = remainder.slice(0, r.start) + remainder.slice(r.end)
  }

  const head = [...charsets, ...imports]
    .map((r) => r.text.replace(/\s+$/, ''))
    .join('\n')
  const body = remainder.replace(/^\s*\n/, '')
  const next = body.length > 0 ? `${head}\n${body}` : `${head}\n`

  if (next === css) return { css, changed: false }
  return { css: next, changed: true }
}

export function normalizeFragmentStylesheets<
  T extends {
    code?: FragmentSchema['code'] | DeepPartial<FragmentSchema>['code']
    file_path?: string
  },
>(fragment: T): { fragment: T; changed: boolean } {
  const files = getFragmentFiles(fragment)
  if (!files.length) return { fragment, changed: false }

  let changed = false
  const next: FragmentFile[] = files.map((f) => {
    if (!isCssFile(f.file_path)) return f
    const normalized = normalizeStylesheet(f.file_content)
    if (!normalized.changed) return f
    changed = true
    return { file_path: f.file_path, file_content: normalized.css }
  })

  if (!changed) return { fragment, changed: false }
  return {
    fragment: { ...fragment, code: next },
    changed: true,
  }
}

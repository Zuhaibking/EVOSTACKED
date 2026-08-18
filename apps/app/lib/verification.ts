import { z } from 'zod'

export const verificationStatusSchema = z.enum(['passed', 'partial', 'failed'])

export type VerificationStatus = z.infer<typeof verificationStatusSchema>

/**
 * Deterministic runtime evidence for one candidate.
 * Populated from filesystem / command / HTTP checks — not LLM opinion.
 */
export type VerificationResult = {
  status: VerificationStatus
  filesWritten: boolean
  /** Whether extra deps installed, failed, or were not required. */
  dependenciesInstalled: boolean | 'not_required'
  processStarted: boolean
  previewReachable: boolean
  errors: string[]
  warnings: string[]
  durationMs: number
  /** Present when a sandbox was created (for preview reuse). */
  sbxId?: string
  /** Web preview URL when available. */
  url?: string
  template?: string
  checkedFiles?: string[]
  missingFiles?: string[]
  httpStatus?: number
}

export function truncateDiagnostic(
  text: string | undefined | null,
  max = 700,
): string {
  if (!text) return ''
  // Strip obvious secret-looking assignments from logs.
  const scrubbed = text
    .replace(
      /((?:api[_-]?key|secret|token|password|authorization)\s*[=:]\s*)([^\s"'\\]+)/gi,
      '$1[redacted]',
    )
    .replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, 'Bearer [redacted]')
  const trimmed = scrubbed.trim()
  if (trimmed.length <= max) return trimmed
  return `${trimmed.slice(0, max)}\n…[truncated]…`
}

export function isCompileOrBuildFailure(message: string | undefined | null): boolean {
  return /Failed to compile|Parsing ecmascript|Expected jsx identifier|Unexpected token|has no corresponding closing tag|@import rules must precede|Module not found|Can't resolve|Cannot find module|SyntaxError|BUILD FAILED|Build failed|CSS syntax|JSX element/i.test(
    message || '',
  )
}

/** Next.js / React hydration overlay — HTTP 200 but the app is not usable. */
export function isHydrationOverlayFailure(
  message: string | undefined | null,
): boolean {
  return /Hydration failed|did not match(?: what was rendered on the server)?|matching <[a-zA-Z]+> in <[a-zA-Z]+>|Text content does not match|Minified React error #(?:418|423|425)/i.test(
    message || '',
  )
}

/**
 * Next.js SSR / server runtime exception (often embedded in __NEXT_DATA__.err).
 * Not a compile overlay — but still an unhealthy preview that must not soft-pass.
 */
export function isServerRuntimeFailure(
  message: string | undefined | null,
): boolean {
  return /ReferenceError:|TypeError:|React is not defined|Unhandled (?:Runtime )?Error|server[- ]side exception|Application error: a (?:client|server)-side exception/i.test(
    message || '',
  )
}

/** Compile overlay, hydration overlay, OR SSR runtime exception — not a healthy preview. */
export function isPreviewOverlayFailure(
  message: string | undefined | null,
): boolean {
  return (
    isCompileOrBuildFailure(message) ||
    isHydrationOverlayFailure(message) ||
    isServerRuntimeFailure(message)
  )
}

/** True when runtime evidence is a Next/SWC compile overlay, not a healthy app. */
export function verificationHasCompileFailure(
  v?: Pick<VerificationResult, 'errors'> | null,
): boolean {
  return (v?.errors || []).some((e) => isCompileOrBuildFailure(e))
}

/** True when the preview is a Next compile or hydration error overlay. */
export function verificationHasPreviewOverlayFailure(
  v?: Pick<VerificationResult, 'errors'> | null,
): boolean {
  return (v?.errors || []).some((e) => isPreviewOverlayFailure(e))
}

/** Pull a Next/Lightning compile diagnostic out of an HTML error overlay. */
function htmlToPlainText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '\n')
    .replace(/<style[\s\S]*?<\/style>/gi, '\n')
    .replace(/<[^>]+>/g, '\n')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n')
}

/** Pull a Next/React hydration diagnostic out of an HTTP 200 error overlay. */
export function extractHydrationErrorFromHtml(
  html: string | undefined | null,
): string | undefined {
  if (!html) return undefined
  const text = htmlToPlainText(html)
  const nested = text.match(
    /Expected server HTML to contain a matching[^\n]*/i,
  )
  const failed = text.match(/Hydration failed[^\n]*/i)
  const mismatch = text.match(/Text content does not match[^\n]*/i)
  const primary = nested?.[0] || failed?.[0] || mismatch?.[0]
  if (primary && isHydrationOverlayFailure(primary)) {
    return truncateDiagnostic(primary, 400)
  }
  if (isHydrationOverlayFailure(text)) {
    return truncateDiagnostic(
      failed?.[0] || nested?.[0] || 'Hydration failed because the initial UI does not match what was rendered on the server.',
      400,
    )
  }
  return undefined
}

/** Pull a Next/Lightning compile diagnostic out of an HTML error overlay. */
export function extractCompileErrorFromHtml(
  html: string | undefined | null,
): string | undefined {
  if (!html) return undefined
  const text = htmlToPlainText(html)
  const importOrder = text.match(
    /@import rules must precede[^\n.]*(?:\.[^\n]*)?/i,
  )
  if (importOrder?.[0]) return truncateDiagnostic(importOrder[0], 400)
  const loc = text.match(/([\w./-]+\.(?:css|tsx|ts|jsx|js)):(\d+)(?::(\d+))?/)
  const turbo = text.match(/Parsing ecmascript source code failed[^\n]*/i)
  const jsxId = text.match(
    /Unexpected token '[^']+'\.\s*Expected jsx identifier[^\n]*/i,
  )
  const useful = extractUsefulError(text, '')
  const primary = turbo?.[0] || jsxId?.[0] || useful
  if (isCompileOrBuildFailure(primary)) {
    if (loc && !primary.includes(loc[1])) {
      return truncateDiagnostic(`${loc[1]}:${loc[2]} ${primary}`, 400)
    }
    return truncateDiagnostic(primary, 400)
  }
  if (
    loc &&
    /import|compile|error|ecmascript|jsx identifier/i.test(text) &&
    !isHydrationOverlayFailure(text)
  ) {
    return truncateDiagnostic(`${loc[1]}:${loc[2]} compile error`, 400)
  }
  return undefined
}

/**
 * Pull Next.js SSR / runtime errors from __NEXT_DATA__.err.
 * htmlToPlainText strips <script>, so this must run on raw HTML first.
 * Shape observed on Innovate HTTP 500: page=/_error, err.message="React is not defined".
 */
export function extractNextDataServerErrorFromHtml(
  html: string | undefined | null,
): string | undefined {
  if (!html) return undefined
  const m = html.match(
    /<script[^>]*\bid=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i,
  )
  if (!m?.[1]) return undefined
  try {
    const data = JSON.parse(m[1]) as {
      err?: { name?: string; message?: string; stack?: string; source?: string }
      props?: { pageProps?: { statusCode?: number } }
    }
    const err = data?.err
    if (!err?.message || typeof err.message !== 'string') return undefined
    const name =
      typeof err.name === 'string' && err.name.trim() ? err.name.trim() : 'Error'
    const stackLine = String(err.stack || '')
      .split('\n')
      .map((l) => l.trim())
      .find((l) => /^at\s+/.test(l))
    const statusCode = data?.props?.pageProps?.statusCode
    const bits = [`${name}: ${err.message.trim()}`]
    if (stackLine) bits.push(stackLine)
    if (typeof statusCode === 'number') bits.push(`HTTP ${statusCode}`)
    const combined = bits.join(' — ')
    if (
      isServerRuntimeFailure(combined) ||
      isCompileOrBuildFailure(combined) ||
      isHydrationOverlayFailure(combined) ||
      (typeof statusCode === 'number' && statusCode >= 500)
    ) {
      return truncateDiagnostic(combined, 400)
    }
    return undefined
  } catch {
    return undefined
  }
}

/** Hydration overlay first, then compile overlay — either blocks a healthy preview. */
export function extractPreviewOverlayErrorFromHtml(
  html: string | undefined | null,
): string | undefined {
  return (
    extractNextDataServerErrorFromHtml(html) ||
    extractHydrationErrorFromHtml(html) ||
    extractCompileErrorFromHtml(html)
  )
}

export function extractUsefulError(stdout: string, stderr: string): string {
  const blob = `${stderr}\n${stdout}`
  const patterns = [
    /@import rules must precede[^\n]*/i,
    /Failed to compile[^\n]*/i,
    /Hydration failed[^\n]*/i,
    /Expected server HTML to contain a matching[^\n]*/i,
    /Parsing ecmascript source code failed[^\n]*/i,
    /Expected jsx identifier[^\n]*/i,
    /Module not found:[^\n]+/i,
    /Cannot find module[^\n]+/i,
    /Unable to resolve[^\n]+/i,
    /ERROR in [^\n]+/i,
    /SyntaxError:[^\n]+/i,
    /TypeError:[^\n]+/i,
    /ReferenceError:[^\n]+/i,
    /npm ERR![^\n]+/i,
    /ERROR: [^\n]+/i,
    /Error: [^\n]+/i,
  ]
  for (const re of patterns) {
    const m = blob.match(re)
    if (m?.[0]) return truncateDiagnostic(m[0], 400)
  }
  const errLines = blob
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /error|fail|unable|cannot|enoent|err!/i.test(l))
  if (errLines.length) {
    return truncateDiagnostic(errLines.slice(0, 6).join('\n'), 700)
  }
  return truncateDiagnostic(stderr || stdout, 500)
}

export function formatVerificationForJudge(v: VerificationResult): string {
  const deps =
    v.dependenciesInstalled === 'not_required'
      ? 'not_required'
      : v.dependenciesInstalled
        ? 'ok'
        : 'failed'
  const errs = v.errors.length
    ? v.errors.map((e) => `  - ${e}`).join('\n')
    : '  (none)'
  const warns = v.warnings.length
    ? v.warnings.map((w) => `  - ${w}`).join('\n')
    : '  (none)'
  return `Runtime verification: ${v.status.toUpperCase()}
filesWritten=${v.filesWritten}; deps=${deps}; processStarted=${v.processStarted}; previewReachable=${v.previewReachable}; httpStatus=${v.httpStatus ?? 'n/a'}; durationMs=${v.durationMs}
errors:
${errs}
warnings:
${warns}`
}

/** Prefer a runnable candidate when the LLM picks a failed one. */
export function preferRunnableWinner<T extends { id: string }>(
  winnerId: T['id'],
  candidates: Array<{ id: T['id']; verification?: VerificationResult }>,
): T['id'] {
  const byId = new Map(candidates.map((c) => [c.id, c]))
  const current = byId.get(winnerId)?.verification
  if (current && current.status !== 'failed') return winnerId

  const runnable = candidates.filter(
    (c) =>
      c.verification &&
      (c.verification.status === 'passed' ||
        c.verification.status === 'partial'),
  )
  if (runnable.length === 0) return winnerId

  const passed = runnable.find((c) => c.verification?.status === 'passed')
  return (passed ?? runnable[0]).id
}

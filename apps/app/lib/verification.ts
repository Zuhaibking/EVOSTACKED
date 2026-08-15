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

export function extractUsefulError(stdout: string, stderr: string): string {
  const blob = `${stderr}\n${stdout}`
  const patterns = [
    /Module not found:[^\n]+/i,
    /Cannot find module[^\n]+/i,
    /Unable to resolve[^\n]+/i,
    /ERROR in [^\n]+/i,
    /SyntaxError:[^\n]+/i,
    /TypeError:[^\n]+/i,
    /ReferenceError:[^\n]+/i,
    /Failed to compile[^\n]+/i,
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

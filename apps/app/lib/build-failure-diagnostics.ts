/**
 * Copy-only build-failure lines for Console / empty preview.
 * No layout. Scrubs secrets via truncateDiagnostic.
 */
import type { RepairAttemptRecord } from '@/lib/repair'
import {
  isCompileOrBuildFailure,
  isHydrationOverlayFailure,
  truncateDiagnostic,
  type VerificationResult,
} from '@/lib/verification'

export function formatPreviewUnavailableTitle(reason?: string | null): string {
  if (reason && isHydrationOverlayFailure(reason)) {
    return 'Hydration failed'
  }
  if (
    reason &&
    (/BUILD FAILED/i.test(reason) || isCompileOrBuildFailure(reason))
  ) {
    return 'Build failed'
  }
  return 'Preview unavailable'
}

export function formatPreviewUnavailableReason(opts: {
  errors?: string[]
  fallback?: string
}): string {
  const first =
    opts.errors?.[0] ||
    opts.fallback ||
    'Runtime deployment did not produce a preview URL for this candidate.'
  const cleaned = truncateDiagnostic(first, 400)
  if (isHydrationOverlayFailure(cleaned) && !/^HYDRATION FAILED/i.test(cleaned)) {
    return `HYDRATION FAILED\n${cleaned}`
  }
  if (isCompileOrBuildFailure(cleaned) && !/^BUILD FAILED/i.test(cleaned)) {
    return `BUILD FAILED\n${cleaned}`
  }
  return cleaned
}

export function formatCandidateBuildDiagnostics(candidate: {
  finalVerification?: VerificationResult | null
  verification?: VerificationResult | null
  repairAttempt?: Pick<RepairAttemptRecord, 'success' | 'attempted'> | null
  error?: string
  architectureCompliance?: { status?: string } | null
  smoke?: { status?: string } | null
}): string[] {
  const runtime = candidate.finalVerification || candidate.verification
  const lines: string[] = []
  const errors = (runtime?.errors || []).map((e) => truncateDiagnostic(e, 400))
  const compile =
    errors.find((e) => isCompileOrBuildFailure(e)) || errors[0]
  const hydration = errors.find((e) => isHydrationOverlayFailure(e))
  const isBuildFail =
    runtime?.status === 'failed' ||
    Boolean(compile && isCompileOrBuildFailure(compile))
  const isHydrationFail = Boolean(hydration)

  if (isHydrationFail && !isCompileOrBuildFailure(compile)) {
    lines.push('HYDRATION FAILED')
    if (hydration) lines.push(hydration)
    if (candidate.repairAttempt) {
      lines.push('Repair attempted: YES')
      lines.push(
        `Repair result: ${candidate.repairAttempt.success ? 'SUCCEEDED' : 'FAILED'}`,
      )
    } else {
      lines.push('Repair attempted: NO')
    }
  } else if (isBuildFail) {
    lines.push('BUILD FAILED')
    const loc = compile?.match(/([\w./-]+\.(?:css|tsx|ts|jsx|js)):(\d+)/)
    if (loc) lines.push(`${loc[1]}:${loc[2]}`)
    if (compile) lines.push(compile)
    if (candidate.repairAttempt) {
      lines.push('Repair attempted: YES')
      lines.push(
        `Repair result: ${candidate.repairAttempt.success ? 'SUCCEEDED' : 'FAILED'}`,
      )
    } else {
      lines.push('Repair attempted: NO')
    }
  } else {
    if (runtime?.status) lines.push(`Runtime ${runtime.status}`)
    if (errors.length) lines.push(...errors)
    if (candidate.repairAttempt) {
      lines.push(
        `Repair ${candidate.repairAttempt.success ? 'applied' : 'failed'}`,
      )
    }
  }

  if (candidate.architectureCompliance?.status) {
    lines.push(`Architecture ${candidate.architectureCompliance.status}`)
  }
  if (candidate.smoke?.status) {
    lines.push(`Smoke ${candidate.smoke.status}`)
  }
  if (candidate.error && !lines.includes(candidate.error)) {
    const err = truncateDiagnostic(candidate.error, 400)
    if (!lines.includes(err)) lines.push(err)
  }

  return Array.from(new Set(lines.filter(Boolean)))
}

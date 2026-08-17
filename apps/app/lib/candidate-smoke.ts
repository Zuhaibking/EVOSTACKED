/**
 * Smoke result application — diagnostic only; never destroys preview URLs.
 * ZERO provider / E2B / network calls.
 */
import { hasFragmentCode } from '@/lib/fragment'
import {
  isReusableExecutionResult,
  resolveReusablePreviewExecution,
} from '@/lib/preview-execution'
import type { SmokeSuiteResult } from '@/lib/smoke'
import type { ExecutionResult } from '@/lib/types'
import type { DeepPartial } from '@evostack/shared'
import type { FragmentSchema } from '@/lib/schema'
import {
  verificationHasPreviewOverlayFailure,
  type VerificationResult,
} from '@/lib/verification'

export type SmokeCandidateSlice = {
  status?: string
  error?: string
  fragment?: DeepPartial<FragmentSchema> | FragmentSchema | null
  execution?: ExecutionResult | null
  verification?: VerificationResult | null
  finalVerification?: VerificationResult | null
  smoke?: SmokeSuiteResult | null
}

/** True when this candidate already has a reusable preview URL. */
export function candidatePreviewIsHealthy(c: SmokeCandidateSlice): boolean {
  if (!hasFragmentCode(c.fragment)) return false
  if (
    verificationHasPreviewOverlayFailure(
      c.finalVerification || c.verification,
    )
  ) {
    return false
  }
  const execution = resolveReusablePreviewExecution({
    execution: c.execution,
    verification: c.verification,
    finalVerification: c.finalVerification,
  })
  return Boolean(execution && isReusableExecutionResult(execution))
}

/**
 * Apply smoke suite result without clearing source, execution, or preview URL.
 * When runtime/preview is healthy, smoke failure/timeout is diagnostic metadata only.
 */
export function applySmokeResultToCandidate<T extends SmokeCandidateSlice>(
  candidate: T,
  smoke: SmokeSuiteResult,
): T {
  const smokeStatus = smoke.status
  const previewHealthy = candidatePreviewIsHealthy(candidate)
  const smokeIsSoftDiagnostic =
    previewHealthy &&
    (smokeStatus === 'failed' ||
      smokeStatus === 'timeout' ||
      smokeStatus === 'not_testable')

  const prior = candidate.status
  const hardFailedPrior =
    prior === 'verify_failed' ||
    prior === 'repair_failed' ||
    prior === 'architecture_failed' ||
    prior === 'error'

  const status = smokeIsSoftDiagnostic
    ? hardFailedPrior
      ? prior
      : smokeStatus === 'not_testable'
        ? 'not_testable'
        : 'tested'
    : smokeStatus === 'passed'
      ? 'tested'
      : smokeStatus === 'not_testable'
        ? 'not_testable'
        : 'smoke_failed'

  return {
    ...candidate,
    status,
    smoke,
    error: smokeIsSoftDiagnostic
      ? candidate.error
      : smokeStatus === 'failed' || smokeStatus === 'timeout'
        ? smoke.summary || smoke.tests?.[0]?.error || candidate.error
        : candidate.error,
    execution: candidate.execution,
    finalVerification: candidate.finalVerification,
    verification: candidate.verification,
    fragment: candidate.fragment,
  }
}

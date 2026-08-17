/**
 * Deterministic recommendation for initial tournament — zero LLM calls.
 * Judge winner is OPTIONAL metadata only; never auto-promotes activeVersion.
 */
import type { ArchitectureComplianceResult } from '@/lib/architecture-compliance'
import { totalCodeLength } from '@/lib/fragment'
import type { SmokeSuiteResult } from '@/lib/smoke'
import type { VariantId, Verdict } from '@/lib/tournament'
import { VARIANTS } from '@/lib/tournament'
import {
  isHydrationOverlayFailure,
  verificationHasCompileFailure,
  verificationHasPreviewOverlayFailure,
  type VerificationResult,
} from '@/lib/verification'

export type DeterministicJudgeInput = {
  id: VariantId
  fragment?: any
  finalVerification?: VerificationResult | null
  architectureCompliance?: ArchitectureComplianceResult | null
  smoke?: SmokeSuiteResult | null
}

function rank(r: DeterministicJudgeInput): number {
  let s = 0
  const runtime = r.finalVerification?.status
  const overlayBroken = verificationHasPreviewOverlayFailure(
    r.finalVerification,
  )
  if (overlayBroken) s += 0
  else if (runtime === 'passed') s += 4
  else if (runtime === 'partial') s += 3
  if (r.smoke?.status === 'passed') s += 3
  else if (r.smoke?.status === 'failed' || r.smoke?.status === 'timeout') s -= 1
  if (r.architectureCompliance?.status === 'passed') s += 3
  else if (r.architectureCompliance?.status === 'failed') s -= 2
  else if (r.architectureCompliance?.status === 'partial') s += 1
  if (r.fragment) s += Math.min(1, totalCodeLength(r.fragment) / 4000)
  return s
}

/**
 * Build a full verdict covering every provided candidate.
 * Missing candidates are still scored if present in `candidates`.
 * Recommendation never deletes or hides anyone.
 */
export function buildDeterministicTournamentVerdict(
  candidates: DeterministicJudgeInput[],
): Verdict {
  const byId = new Map(candidates.map((c) => [c.id, c]))
  const scores = VARIANTS.map((v) => {
    const r = byId.get(v.id)
    if (!r) {
      return {
        id: v.id,
        clarity: 0,
        fit: 0,
        polish: 0,
        composite: 0,
        comment: 'Not generated.',
      }
    }
    const compileBroken = verificationHasCompileFailure(r.finalVerification)
    const overlayBroken = verificationHasPreviewOverlayFailure(
      r.finalVerification,
    )
    const hydrationBroken =
      overlayBroken &&
      !compileBroken &&
      (r.finalVerification?.errors || []).some((e) =>
        isHydrationOverlayFailure(e),
      )
    const runtimeFailed =
      overlayBroken || r.finalVerification?.status === 'failed'
    const score = rank(r)
    const clarity = runtimeFailed ? 0.45 : 0.72
    const fit = Math.max(0, Math.min(1, score / 10))
    const polish = overlayBroken
      ? 0.32
      : r.smoke?.status === 'passed'
        ? 0.78
        : r.finalVerification?.status === 'passed'
          ? 0.68
          : r.finalVerification?.status === 'partial'
            ? 0.55
            : 0.4
    const composite = (clarity + fit + polish) / 3
    return {
      id: v.id,
      clarity,
      fit,
      polish,
      composite,
      comment: compileBroken
        ? 'Build failed — source still inspectable.'
        : hydrationBroken
          ? 'Hydration failed — source still inspectable.'
          : r.architectureCompliance?.status === 'failed'
            ? 'Architecture needs attention.'
            : r.smoke?.status === 'failed'
              ? 'Smoke diagnostics failed — still inspectable.'
              : r.finalVerification?.status === 'failed'
                ? 'Runtime failed — source still available.'
                : 'Deterministic recommendation signal.',
    }
  })

  const withArtifact = scores.filter((s) => {
    const c = byId.get(s.id)
    return !!c?.fragment
  })
  const pool = withArtifact.length > 0 ? withArtifact : scores
  const winner = pool.reduce((a, b) =>
    a.composite >= b.composite ? a : b,
  )

  return {
    winnerId: winner.id,
    reasoning:
      'Optional recommendation from local diagnostics — you choose the active version.',
    scores,
  }
}

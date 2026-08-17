/**
 * Tournament candidate retention + Preview isolation.
 *
 * Pure / deterministic — no LLM, provider, or E2B calls.
 *
 * CORE RULE: all 3 initial tournament candidates remain inspectable.
 * Smoke / runtime / architecture / judge / repair failure is metadata, not deletion.
 */
import { candidatePreviewIsHealthy } from '@/lib/candidate-smoke'
import { hasFragmentCode } from '@/lib/fragment'
import {
  resolveReusablePreviewExecution,
  isReusableExecutionResult,
} from '@/lib/preview-execution'
import type { Candidate } from '@/lib/tournament-client'
import { VARIANTS, type VariantId, type Verdict } from '@/lib/tournament'
import type { ExecutionResult } from '@/lib/types'
import type { DeepPartial } from '@evostack/shared'
import type { FragmentSchema } from '@/lib/schema'
import { verificationHasPreviewOverlayFailure } from '@/lib/verification'

export const TOURNAMENT_CANDIDATE_COUNT = 3

export type CandidateRetentionRecord = {
  id: VariantId
  label: string
  /** True when generation produced a fragment artifact. */
  hasArtifact: boolean
  architecture?: string
  runtime?: string
  smoke?: string
  judgeScore?: number | null
  judgeUnavailable?: boolean
  failureReason?: string
  isRecommended: boolean
  /** Null until user clicks Use this version — never auto-filled from judge. */
  isActive: boolean
}

export type IsolatedPreview = {
  candidateId: VariantId
  available: boolean
  execution?: ExecutionResult
  reason?: string
}

/** Exactly 3 slots — always Product / Premium / Innovate order. */
export function listTournamentSlots(): typeof VARIANTS {
  return VARIANTS
}

/**
 * Retain every variant slot from a candidate map.
 * Missing slots stay pending (never invent a fake "generation failed"
 * for a candidate that was never attempted).
 */
export function retainTournamentCandidates(
  candidates: Partial<Record<VariantId, Candidate>> | null | undefined,
): Record<VariantId, Candidate> {
  const out = {} as Record<VariantId, Candidate>
  for (const v of VARIANTS) {
    const existing = candidates?.[v.id]
    if (existing) {
      out[v.id] = existing
    } else {
      out[v.id] = {
        id: v.id,
        label: v.label,
        sigil: v.sigil,
        status: 'pending',
      }
    }
  }
  return out
}

export function countRetainedCandidates(
  candidates: Partial<Record<VariantId, Candidate>> | null | undefined,
): number {
  return Object.keys(retainTournamentCandidates(candidates)).length
}

/**
 * First inspectable specimen (Product → Premium → Innovate).
 * Does NOT promote activeVersion — Preview/source only.
 */
export function pickInspectableCandidateId(
  candidates: Partial<Record<VariantId, Candidate>> | null | undefined,
): VariantId | undefined {
  const pool = retainTournamentCandidates(candidates)
  for (const v of VARIANTS) {
    const c = pool[v.id]
    if (!hasFragmentCode(c.fragment)) continue
    if (c.status === 'pending' || c.status === 'generating') continue
    return v.id
  }
  return undefined
}

export function smokeScoreLabel(
  smoke: Candidate['smoke'] | undefined | null,
): string {
  if (!smoke) return '—'
  const total = smoke.tests?.length ?? 0
  const passed =
    smoke.tests?.filter((t) => t.status === 'passed').length ?? 0
  if (total > 0) return `${passed}/${total}`
  if (smoke.status === 'passed') return '✓'
  if (smoke.status === 'not_testable') return 'n/a'
  if (smoke.status === 'failed' || smoke.status === 'timeout') return '✗'
  return '—'
}

export function runtimeScoreLabel(c: Candidate): string {
  const runtime = c.finalVerification || c.verification
  if (verificationHasPreviewOverlayFailure(runtime)) return 'Failed'
  const status = runtime?.status
  if (!status) return '—'
  if (status === 'passed') return '✓'
  if (status === 'partial') return 'partial'
  if (status === 'failed') return 'Failed'
  return String(status)
}

export function architectureScoreLabel(c: Candidate): string {
  const status = c.architectureCompliance?.status
  if (!status) return '—'
  if (status === 'passed') return '✓'
  if (status === 'partial') return 'partial'
  if (status === 'failed') return 'failed'
  return String(status)
}

export function candidateFailureReason(c: Candidate): string | undefined {
  // Prefer hard failures; smoke is diagnostic-only when preview is still healthy.
  const runtime = c.finalVerification || c.verification
  const previewHealthy = candidatePreviewIsHealthy(c)

  if (runtime?.status === 'failed') {
    return (
      runtime.errors?.[0] ||
      c.error ||
      'Runtime deployment failed.'
    )
  }
  if (c.architectureCompliance?.status === 'failed' && !previewHealthy) {
    return c.architectureCompliance.summary || 'Architecture compliance failed.'
  }
  if (
    (c.smoke?.status === 'failed' || c.smoke?.status === 'timeout') &&
    !previewHealthy
  ) {
    return c.smoke.summary || 'Smoke tests failed.'
  }
  if (c.error && !previewHealthy) return c.error
  if (c.status === 'error' && !hasFragmentCode(c.fragment)) {
    return 'Candidate generation failed.'
  }
  return undefined
}

/** Re-export for callers/tests — smoke must not destroy previews. */
export { applySmokeResultToCandidate, candidatePreviewIsHealthy } from '@/lib/candidate-smoke'

/**
 * Build retention metadata for UI / tests.
 * Judge winner is recommended only — never auto-active.
 */
export function buildRetentionReport(
  candidates: Partial<Record<VariantId, Candidate>> | null | undefined,
  opts?: {
    recommendedWinnerId?: VariantId | null
    activeCandidateId?: VariantId | null
  },
): {
  candidates: CandidateRetentionRecord[]
  recommendedWinner: VariantId | null
  activeCandidate: VariantId | null
} {
  const retained = retainTournamentCandidates(candidates)
  const recommended =
    opts?.recommendedWinnerId ??
    (Object.values(retained).find((c) => c.isWinner)?.id || null)
  const active = opts?.activeCandidateId ?? null

  return {
    candidates: VARIANTS.map((v) => {
      const c = retained[v.id]
      return {
        id: v.id,
        label: v.label,
        hasArtifact: hasFragmentCode(c.fragment),
        architecture: architectureScoreLabel(c),
        runtime: runtimeScoreLabel(c),
        smoke: smokeScoreLabel(c.smoke),
        judgeScore:
          c.scoreComposite != null ? Math.round(c.scoreComposite * 100) : null,
        judgeUnavailable: c.scoreComposite == null,
        failureReason: candidateFailureReason(c),
        isRecommended: recommended === v.id,
        isActive: active === v.id,
      }
    }),
    recommendedWinner: recommended,
    activeCandidate: active,
  }
}

/**
 * Preview for ONE candidate only — never accepts a global/other execution.
 * Failed runtime → unavailable (candidate still retained).
 */
export function resolveCandidateIsolatedPreview(candidate: {
  id: VariantId
  fragment?: DeepPartial<FragmentSchema> | FragmentSchema | null
  execution?: ExecutionResult | null
  verification?: Candidate['verification']
  finalVerification?: Candidate['finalVerification']
  error?: string
}): IsolatedPreview {
  const runtime =
    candidate.finalVerification || candidate.verification || null

  if (!hasFragmentCode(candidate.fragment)) {
    return {
      candidateId: candidate.id,
      available: false,
      reason: candidate.error || 'Candidate generation failed.',
    }
  }

  const execution = resolveReusablePreviewExecution({
    execution: candidate.execution,
    verification: candidate.verification,
    finalVerification: candidate.finalVerification,
  })

  if (execution && isReusableExecutionResult(execution)) {
    return {
      candidateId: candidate.id,
      available: true,
      execution,
    }
  }

  if (runtime?.status === 'failed') {
    const detail =
      (runtime.errors && runtime.errors[0]) ||
      candidate.error ||
      'Runtime deployment failed for this candidate.'
    return {
      candidateId: candidate.id,
      available: false,
      reason: detail,
    }
  }

  return {
    candidateId: candidate.id,
    available: false,
    reason:
      (runtime?.errors && runtime.errors[0]) ||
      (runtime?.warnings && runtime.warnings[0]) ||
      candidate.error ||
      'Runtime deployment did not produce a preview URL for this candidate.',
  }
}

/**
 * True when two previews are isolated (different URLs or both unavailable).
 */
export function previewsAreIsolated(
  a: IsolatedPreview,
  b: IsolatedPreview,
): boolean {
  if (a.candidateId === b.candidateId) return true
  if (!a.available || !b.available) return true
  const urlA =
    a.execution && 'url' in a.execution ? a.execution.url : undefined
  const urlB =
    b.execution && 'url' in b.execution ? b.execution.url : undefined
  if (!urlA || !urlB) return true
  return urlA !== urlB
}

/** activeVersion stays unset until explicit user selection. */
export function activeVersionBeforeSelection(
  activeVersion?: number | null,
  activeCandidateId?: VariantId | null,
): null {
  if (activeCandidateId) {
    // Selection already happened — not "before".
    return null
  }
  void activeVersion
  return null
}

/**
 * Judge marks recommendation only — does not imply activeCandidate.
 */
export function recommendedFromVerdict(
  verdict?: Verdict | null,
): VariantId | null {
  return verdict?.winnerId ?? null
}

/**
 * Whether "Use this version" can activate a candidate.
 * Source must exist; runnable execution is preferred but not required for
 * source inspection — activation still allowed when fragment exists.
 */
export function canActivateCandidate(c: Candidate | undefined): {
  ok: boolean
  reason?: string
} {
  if (!c) {
    return { ok: false, reason: 'Candidate generation failed.' }
  }
  if (!hasFragmentCode(c.fragment)) {
    return {
      ok: false,
      reason: c.error || 'Candidate generation failed — no source artifact.',
    }
  }
  const runtime = c.finalVerification || c.verification
  if (runtime?.status === 'failed') {
    return {
      ok: true,
      reason:
        'Runtime failed, so Preview is unavailable. You can still inspect the source.',
    }
  }
  return { ok: true }
}

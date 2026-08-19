import type { ArchitectureComplianceResult } from '@/lib/architecture-compliance'
import type { RepairAttemptRecord } from '@/lib/repair'
import type { SmokeSuiteResult } from '@/lib/smoke'
import type { VariantId, Verdict } from '@/lib/tournament'
import { VARIANTS } from '@/lib/tournament'
import { stackLabelForTemplate } from '@/lib/templates'
import type { VerificationResult } from '@/lib/verification'
import { truncateDiagnostic } from '@/lib/verification'

export type CandidateScoreSet = {
  clarity: number
  fit: number
  polish: number
  composite: number
  comment?: string
}

export type TournamentCandidateRecordData = {
  variant: string
  variantId: VariantId
  status: string
  scores: CandidateScoreSet | null
  verificationSummary: string | null
  smokeSummary: string | null
  architectureSummary: string | null
  template: string | null
  stackLabel: string | null
  fragment: unknown
  error: string | null
  previewUrl: string | null
  repairNotes: string | null
  usage: { inputTokens: number; outputTokens: number } | null
}

export function variantLabel(id: VariantId): string {
  return VARIANTS.find((v) => v.id === id)?.label || id
}

export function compactVerificationSummary(
  verification?: VerificationResult | null,
): string | null {
  if (!verification) return null
  const errors = (verification.errors || [])
    .slice(0, 2)
    .map((e) => truncateDiagnostic(e, 180))
    .filter(Boolean)
  const parts = [
    verification.status,
    `preview=${verification.previewReachable ? 'yes' : 'no'}`,
    errors.length ? errors.join('; ') : '',
  ].filter(Boolean)
  return parts.join(' · ') || null
}

export function compactSmokeSummary(
  smoke?: SmokeSuiteResult | null,
): string | null {
  if (!smoke) return null
  const total = smoke.tests?.length ?? 0
  const passed = smoke.tests?.filter((t) => t.status === 'passed').length ?? 0
  const counts = total > 0 ? `${passed}/${total}` : smoke.status
  const summary = smoke.summary ? truncateDiagnostic(smoke.summary, 220) : ''
  return [counts, summary].filter(Boolean).join(' · ') || smoke.status
}

export function compactArchitectureSummary(
  architecture?: ArchitectureComplianceResult | null,
): string | null {
  if (!architecture) return null
  const summary = architecture.summary
    ? truncateDiagnostic(architecture.summary, 220)
    : ''
  return [architecture.status, summary].filter(Boolean).join(' · ') || null
}

export function compactRepairNotes(
  repair?: RepairAttemptRecord | null,
): string | null {
  if (!repair?.attempted) return null
  const bits = [
    repair.success ? 'repair succeeded' : 'repair failed',
    repair.reason,
    repair.explanation,
    repair.error,
  ].filter(Boolean)
  return bits.length ? truncateDiagnostic(bits.join(' · '), 400) : null
}

export function scoresFromVerdict(
  verdict: Verdict | null | undefined,
  id: VariantId,
): CandidateScoreSet | null {
  const row = verdict?.scores.find((s) => s.id === id)
  if (!row) return null
  return {
    clarity: row.clarity,
    fit: row.fit,
    polish: row.polish,
    composite: row.composite,
    comment: row.comment,
  }
}

export function buildCandidateRecordData(input: {
  id: VariantId
  status: string
  fragment?: unknown
  error?: string | null
  verification?: VerificationResult | null
  smoke?: SmokeSuiteResult | null
  architecture?: ArchitectureComplianceResult | null
  scores?: CandidateScoreSet | null
  template?: string | null
  stackLabel?: string | null
  previewUrl?: string | null
  repairNotes?: string | null
  usage?: { inputTokens: number; outputTokens: number } | null
}): TournamentCandidateRecordData {
  const fragment = input.fragment ?? null
  const template =
    input.template ||
    (fragment &&
    typeof fragment === 'object' &&
    typeof (fragment as { template?: unknown }).template === 'string'
      ? ((fragment as { template: string }).template)
      : null)
  const previewFromVerification =
    input.verification && typeof input.verification.url === 'string'
      ? input.verification.url
      : null
  return {
    variant: variantLabel(input.id),
    variantId: input.id,
    status: input.status,
    scores: input.scores ?? null,
    verificationSummary: compactVerificationSummary(input.verification),
    smokeSummary: compactSmokeSummary(input.smoke),
    architectureSummary: compactArchitectureSummary(input.architecture),
    template,
    stackLabel:
      input.stackLabel?.trim() ||
      (template ? stackLabelForTemplate(template) : null),
    fragment,
    error: input.error?.trim() ? truncateDiagnostic(input.error, 400) : null,
    previewUrl: input.previewUrl || previewFromVerification,
    repairNotes: input.repairNotes?.trim()
      ? truncateDiagnostic(input.repairNotes, 400)
      : null,
    usage: input.usage ?? null,
  }
}

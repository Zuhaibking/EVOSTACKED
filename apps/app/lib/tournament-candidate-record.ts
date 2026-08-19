import type { ArchitectureComplianceResult } from '@/lib/architecture-compliance'
import { hasFragmentCode } from '@/lib/fragment'
import type { RepairAttemptRecord } from '@/lib/repair'
import type { FragmentSchema } from '@/lib/schema'
import type { SmokeSuiteResult } from '@/lib/smoke'
import type { VariantId, Verdict } from '@/lib/tournament'
import { VARIANTS } from '@/lib/tournament'
import { stackLabelForTemplate } from '@/lib/templates'
import type { VerificationResult } from '@/lib/verification'
import { truncateDiagnostic } from '@/lib/verification'
import type { DeepPartial } from '@evostack/shared'

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

export type StoredCandidateRow = {
  variantId: string
  status: string
  data?: unknown
}

const VARIANT_IDS = new Set(VARIANTS.map((v) => v.id))

const IN_FLIGHT_STATUS = new Set([
  'generating',
  'judging',
  'architecture_checking',
  'verifying',
  'repairing',
  'testing',
  'done',
  'architecture_checked',
  'architecture_partial',
])

type RestoredCandidate = {
  id: VariantId
  label: string
  sigil: string
  status: string
  fragment?: DeepPartial<FragmentSchema>
  error?: string
  template?: string
  stackLabel?: string
  scoreClarity?: number
  scoreFit?: number
  scorePolish?: number
  scoreComposite?: number
  scoreComment?: string
  isWinner?: boolean
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

/** Pull a runnable fragment out of vault rows, candidate JSON, or chat messages. */
export function extractFragment(
  value: unknown,
): DeepPartial<FragmentSchema> | undefined {
  if (!value || typeof value !== 'object') return undefined
  if (hasFragmentCode(value as DeepPartial<FragmentSchema>)) {
    return value as DeepPartial<FragmentSchema>
  }
  const rec = value as Record<string, unknown>
  for (const key of ['fragment', 'object', 'data'] as const) {
    const nested = rec[key]
    if (hasFragmentCode(nested as DeepPartial<FragmentSchema>)) {
      return nested as DeepPartial<FragmentSchema>
    }
    const inner = asRecord(nested)
    if (inner && hasFragmentCode(inner.fragment as DeepPartial<FragmentSchema>)) {
      return inner.fragment as DeepPartial<FragmentSchema>
    }
  }
  return undefined
}

export function fragmentFromStoredMessages(
  messages: unknown,
): DeepPartial<FragmentSchema> | undefined {
  if (!Array.isArray(messages)) return undefined
  for (let i = messages.length - 1; i >= 0; i--) {
    const found = extractFragment(messages[i])
    if (found) return found
  }
  return undefined
}

export function pickBootFragment(
  pool: Record<VariantId, RestoredCandidate>,
  preferredId?: VariantId | null,
  extras: Array<DeepPartial<FragmentSchema> | undefined> = [],
): DeepPartial<FragmentSchema> | undefined {
  const preferred = preferredId ? pool[preferredId]?.fragment : undefined
  if (hasFragmentCode(preferred)) return preferred
  for (const extra of extras) {
    if (hasFragmentCode(extra)) return extra
  }
  for (const v of VARIANTS) {
    if (hasFragmentCode(pool[v.id]?.fragment)) return pool[v.id].fragment
  }
  return undefined
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

const FAILED_STATUS = new Set([
  'error',
  'verify_failed',
  'repair_failed',
  'architecture_failed',
  'smoke_failed',
])

function settleStoredStatus(status: string, hasCode: boolean): string {
  if (hasCode && (IN_FLIGHT_STATUS.has(status) || status === 'pending' || FAILED_STATUS.has(status))) {
    return 'verified'
  }
  if (IN_FLIGHT_STATUS.has(status) || status === 'pending') {
    return status === 'pending' ? 'pending' : 'error'
  }
  return status || (hasCode ? 'verified' : 'pending')
}

/** Map persisted candidate rows onto the three specimen slots. No live sandbox URLs. */
export function candidatesFromStoredRows(
  rows: StoredCandidateRow[],
  opts?: { winnerId?: VariantId | null },
): Record<VariantId, RestoredCandidate> {
  const latest = new Map<VariantId, StoredCandidateRow>()
  for (const row of rows) {
    if (!VARIANT_IDS.has(row.variantId as VariantId)) continue
    const id = row.variantId as VariantId
    if (!latest.has(id)) latest.set(id, row)
  }

  const out = {} as Record<VariantId, RestoredCandidate>
  for (const v of VARIANTS) {
    const row = latest.get(v.id)
    if (!row) {
      out[v.id] = {
        id: v.id,
        label: v.label,
        sigil: v.sigil,
        status: 'pending',
      }
      continue
    }
    const data = asRecord(row.data)
    const fragment = extractFragment(data) || extractFragment(row.data)
    const hasCode = hasFragmentCode(fragment)
    const scores = asRecord(data?.scores)
    out[v.id] = {
      id: v.id,
      label: v.label,
      sigil: v.sigil,
      status: settleStoredStatus(row.status || String(data?.status || ''), hasCode),
      fragment: hasCode ? fragment : undefined,
      error: typeof data?.error === 'string' ? data.error : undefined,
      template: typeof data?.template === 'string' ? data.template : undefined,
      stackLabel:
        typeof data?.stackLabel === 'string' ? data.stackLabel : undefined,
      scoreClarity: asNumber(scores?.clarity),
      scoreFit: asNumber(scores?.fit),
      scorePolish: asNumber(scores?.polish),
      scoreComposite: asNumber(scores?.composite),
      scoreComment:
        typeof scores?.comment === 'string' ? scores.comment : undefined,
      isWinner: opts?.winnerId === v.id,
    }
  }
  return out
}

/** When a run has source in the vault but no candidate rows, pin it to one specimen. */
export function attachFragmentToCandidatePool(
  pool: Record<VariantId, RestoredCandidate>,
  fragment: DeepPartial<FragmentSchema> | undefined,
  preferredId?: VariantId | null,
): Record<VariantId, RestoredCandidate> {
  if (!hasFragmentCode(fragment)) return pool
  if (VARIANTS.some((v) => hasFragmentCode(pool[v.id]?.fragment))) return pool
  const id =
    preferredId && pool[preferredId] ? preferredId : VARIANTS[0].id
  return {
    ...pool,
    [id]: {
      ...pool[id],
      fragment,
      status:
        pool[id].status === 'pending' || pool[id].status === 'error'
          ? 'verified'
          : pool[id].status,
    },
  }
}

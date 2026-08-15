/**
 * Shared pre-deploy integrity prepare for chat / morph callers.
 * Reuses validateFragmentIntegrity + repairFragmentIntegrity.
 * ZERO LLM when the fragment already validates.
 * At most ONE integrity repair when repair context is provided.
 * Does NOT deploy / call E2B.
 */
import {
  formatIntegrityUserSummary,
  validateFragmentIntegrity,
  type FragmentIntegrityResult,
} from '@/lib/fragment-integrity'
import type { ApplicationPlan } from '@/lib/plan'
import type { RepairAttemptRecord } from '@/lib/repair'
import { repairFragmentIntegrity } from '@/lib/repair-candidate'
import type { LLMModel, LLMModelConfig } from '@/lib/models'
import type { FragmentSchema } from '@/lib/schema'

export type IntegrityRepairContext = {
  model: LLMModel
  config: LLMModelConfig
  plan?: ApplicationPlan | null
  productContext?: string
}

export type PrepareFragmentIntegrityResult = {
  fragment: FragmentSchema
  integrity: FragmentIntegrityResult
  /** True only when a repair LLM call ran and revalidation passed. */
  repaired: boolean
  /** True when a repair LLM call was attempted (success or fail). */
  repairAttempted: boolean
  repairAttempt?: RepairAttemptRecord | null
}

/**
 * Validate → optional one-shot integrity repair → re-validate.
 * Never loops. Never deploys.
 */
export async function prepareFragmentIntegrity(opts: {
  fragment: FragmentSchema
  /** Omit / null → validate only (no LLM). */
  repair?: IntegrityRepairContext | null
}): Promise<PrepareFragmentIntegrityResult> {
  const integrity = validateFragmentIntegrity(opts.fragment)
  if (integrity.ok) {
    return {
      fragment: opts.fragment,
      integrity,
      repaired: false,
      repairAttempted: false,
      repairAttempt: null,
    }
  }

  if (!opts.repair) {
    return {
      fragment: opts.fragment,
      integrity,
      repaired: false,
      repairAttempted: false,
      repairAttempt: null,
    }
  }

  const repaired = await repairFragmentIntegrity({
    fragment: opts.fragment,
    integrity,
    repairAttempts: 0,
    plan: opts.repair.plan,
    model: opts.repair.model,
    config: opts.repair.config,
    productContext: opts.repair.productContext,
  })

  return {
    fragment: repaired.fragment,
    integrity: repaired.integrity,
    repaired: Boolean(
      repaired.repairAttempt.success && repaired.integrity.ok,
    ),
    repairAttempted: true,
    repairAttempt: repaired.repairAttempt,
  }
}

/** JSON-safe integrity payload for HTTP errors (no Map). */
export function serializeIntegrityResult(result: FragmentIntegrityResult) {
  return {
    ok: result.ok,
    files: result.manifest.files,
    issues: result.issues,
    unresolvedImports: result.unresolvedImports,
  }
}

export type SandboxIntegrityErrorBody = {
  error: string
  code: 'FRAGMENT_INTEGRITY_FAILED'
  integrity: ReturnType<typeof serializeIntegrityResult>
  /** Source preserved for the caller — never treat as deploy success. */
  fragment: FragmentSchema
}

/** Build structured sandbox rejection (no deploy, no LLM). */
export function buildSandboxIntegrityError(
  fragment: FragmentSchema,
  integrity: FragmentIntegrityResult,
): SandboxIntegrityErrorBody {
  return {
    error: formatIntegrityUserSummary(integrity, {
      candidateLabel: 'Fragment',
    }),
    code: 'FRAGMENT_INTEGRITY_FAILED',
    integrity: serializeIntegrityResult(integrity),
    fragment,
  }
}

/** Pure deploy gate — true when sandbox may proceed. */
export function canDeployFragment(fragment: FragmentSchema): {
  ok: boolean
  integrity: FragmentIntegrityResult
} {
  const integrity = validateFragmentIntegrity(fragment)
  return { ok: integrity.ok, integrity }
}

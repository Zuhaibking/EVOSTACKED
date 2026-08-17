/**
 * Shared pre-deploy integrity prepare for chat / morph callers.
 * Reuses validateFragmentIntegrity + repairFragmentIntegrity.
 * ZERO LLM when the fragment already validates.
 * At most ONE integrity repair when repair context is provided.
 * Does NOT deploy / call E2B.
 */
import { normalizeFragmentStylesheets } from '@/lib/css-integrity'
import { normalizeFragmentSourceFiles } from '@/lib/source-syntax'
import { closeFragmentDependencies } from '@/lib/dependency-closure'
import { repairFragmentProviders } from '@/lib/provider-integrity'
import {
  canDeployIntegrity,
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

export type GeneratedProjectPreflight = {
  fragment: FragmentSchema
  integrity: FragmentIntegrityResult
  deterministicChanges: string[]
}

/**
 * Deterministic pre-validate normalize (CSS @import hoist). Zero LLM.
 */
export function prepareFragmentForValidation(
  fragment: FragmentSchema,
): FragmentSchema {
  const css = normalizeFragmentStylesheets(fragment).fragment
  return normalizeFragmentSourceFiles(css).fragment
}

/**
 * Normalize → strip manifests → close extra npm deps → mount missing
 * providers → validate. Zero LLM / E2B.
 */
export function runGeneratedProjectPreflight(
  fragment: FragmentSchema,
): GeneratedProjectPreflight {
  const changes: string[] = []
  let next = prepareFragmentForValidation(fragment)
  const closed = closeFragmentDependencies(next)
  if (closed.changed) {
    next = closed.fragment
    if (closed.added.length) {
      changes.push(`dependencies:${closed.added.join(',')}`)
    } else {
      changes.push('dependencies:sync')
    }
  }
  const providers = repairFragmentProviders(next)
  if (providers.repaired) {
    next = providers.fragment
    changes.push(
      ...providers.changedFiles.map((f) => `provider:${f}`),
    )
  }
  const integrity = validateFragmentIntegrity(next)
  return { fragment: next, integrity, deterministicChanges: changes }
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
  const preflight = runGeneratedProjectPreflight(opts.fragment)
  if (preflight.integrity.ok || canDeployIntegrity(preflight.integrity)) {
    return {
      fragment: preflight.fragment,
      integrity: preflight.integrity,
      repaired: false,
      repairAttempted: false,
      repairAttempt: null,
    }
  }

  if (!opts.repair) {
    return {
      fragment: preflight.fragment,
      integrity: preflight.integrity,
      repaired: false,
      repairAttempted: false,
      repairAttempt: null,
    }
  }

  const repaired = await repairFragmentIntegrity({
    fragment: preflight.fragment,
    integrity: preflight.integrity,
    repairAttempts: 0,
    plan: opts.repair.plan,
    model: opts.repair.model,
    config: opts.repair.config,
    productContext: opts.repair.productContext,
  })

  const again = runGeneratedProjectPreflight(repaired.fragment)
  return {
    fragment: again.fragment,
    integrity: again.integrity,
    repaired: Boolean(
      repaired.repairAttempt.success && canDeployIntegrity(again.integrity),
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
  fragment: FragmentSchema
} {
  const preflight = runGeneratedProjectPreflight(fragment)
  return {
    ok: canDeployIntegrity(preflight.integrity),
    integrity: preflight.integrity,
    fragment: preflight.fragment,
  }
}

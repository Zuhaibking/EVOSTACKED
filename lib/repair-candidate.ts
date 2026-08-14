import {
  ArchitectureComplianceResult,
  checkArchitectureCompliance,
} from '@/lib/architecture-compliance'
import type { ApplicationPlan } from '@/lib/plan'
import {
  MAX_REPAIR_ATTEMPTS_PER_CANDIDATE,
  REPAIR_SYSTEM_PROMPT,
  RepairAttemptRecord,
  RepairReason,
  applyRepairToFragment,
  buildUnifiedRepairPrompt,
  consumeRepairAttempt,
  repairResultSchema,
  selectRepairReason,
  shouldAttemptRepair,
} from '@/lib/repair'
import { FragmentSchema } from '@/lib/schema'
import { LLMModel, LLMModelConfig, getModelClient } from '@/lib/models'
import {
  DeployAndVerifyOptions,
  deployAndVerify,
} from '@/lib/verify-candidate'
import { VerificationResult } from '@/lib/verification'
import { ExecutionResult } from '@/lib/types'
import { generateObject, LanguageModel } from 'ai'

export type RepairAndReverifyInput = {
  fragment: FragmentSchema
  verification: VerificationResult
  architectureCompliance?: ArchitectureComplianceResult | null
  /** Must be 0. Structurally blocks second repairs. */
  repairAttempts: number
  plan?: ApplicationPlan | null
  model: LLMModel
  config: LLMModelConfig
  deployOpts?: DeployAndVerifyOptions
  productContext?: string
}

export type RepairAndReverifyResult = {
  /** Fragment that should continue in the pipeline (repaired if apply succeeded). */
  fragment: FragmentSchema
  originalFragment: FragmentSchema
  initialVerification: VerificationResult
  finalVerification: VerificationResult
  initialArchitectureCompliance: ArchitectureComplianceResult | null
  finalArchitectureCompliance: ArchitectureComplianceResult | null
  execution?: ExecutionResult
  repairAttempt: RepairAttemptRecord
  /** Always MAX after this function returns an attempt record. */
  repairAttempts: number
}

/**
 * Unified one-shot repair for architecture and/or runtime failure.
 * Never loops. Budget is consumed even if the model/apply/reverify fails.
 */
export async function repairAndReverify(
  input: RepairAndReverifyInput,
): Promise<RepairAndReverifyResult> {
  const originalFragment = input.fragment
  const initialVerification = input.verification
  const initialArchitectureCompliance = input.architectureCompliance ?? null

  const reason = selectRepairReason({
    architectureCompliance: initialArchitectureCompliance,
    verification: initialVerification,
  })

  const base = (
    repairAttempt: RepairAttemptRecord,
  ): RepairAndReverifyResult => ({
    fragment: originalFragment,
    originalFragment,
    initialVerification,
    finalVerification: initialVerification,
    initialArchitectureCompliance,
    finalArchitectureCompliance: initialArchitectureCompliance,
    execution: undefined,
    repairAttempt,
    repairAttempts: repairAttempt.repairAttempts,
  })

  if (
    !shouldAttemptRepair({
      repairAttempts: input.repairAttempts,
      architectureCompliance: initialArchitectureCompliance,
      verification: initialVerification,
    }) ||
    !reason
  ) {
    return base({
      attempted: true,
      reason: reason || 'runtime',
      repairAttempts: Math.max(
        input.repairAttempts,
        MAX_REPAIR_ATTEMPTS_PER_CANDIDATE,
      ),
      success: false,
      error:
        input.repairAttempts >= MAX_REPAIR_ATTEMPTS_PER_CANDIDATE
          ? 'Repair skipped — repair budget already consumed'
          : 'Repair skipped — no critical architecture/runtime failure',
    })
  }

  // Consume budget immediately so callers cannot double-invoke.
  const repairAttempts = consumeRepairAttempt(input.repairAttempts)

  const { model: _m, apiKey: _k, ...modelParams } = input.config
  const modelClient = getModelClient(input.model, input.config)

  let repairRaw: unknown
  try {
    const result = await generateObject({
      model: modelClient as LanguageModel,
      schema: repairResultSchema,
      system: REPAIR_SYSTEM_PROMPT,
      prompt: buildUnifiedRepairPrompt({
        reason,
        fragment: originalFragment,
        plan: input.plan,
        architectureCompliance: initialArchitectureCompliance,
        verification: initialVerification,
        productContext: input.productContext,
      }),
      maxRetries: 0,
      temperature: 0.2,
      ...modelParams,
    })
    repairRaw = result.object
  } catch (e: any) {
    return base({
      attempted: true,
      reason,
      repairAttempts,
      success: false,
      error: e?.message || 'Repair model call failed',
    })
  }

  const applied = applyRepairToFragment(originalFragment, repairRaw)
  if (!applied.ok) {
    return base({
      attempted: true,
      reason,
      repairAttempts,
      success: false,
      error: applied.error,
    })
  }

  // Re-check architecture on repaired files (deterministic, no LLM).
  const finalArchitectureCompliance = checkArchitectureCompliance({
    fragment: applied.fragment,
    plan: input.plan,
  })

  // Fresh sandbox deploy+verify (existing Part 3 path).
  try {
    const { verification, execution } = await deployAndVerify(
      applied.fragment,
      input.deployOpts,
    )
    return {
      fragment: applied.fragment,
      originalFragment,
      initialVerification,
      finalVerification: verification,
      initialArchitectureCompliance,
      finalArchitectureCompliance,
      execution,
      repairAttempt: {
        attempted: true,
        reason,
        repairAttempts,
        success: true,
        explanation: applied.explanation,
        changedFiles: applied.changedFiles,
      },
      repairAttempts,
    }
  } catch (e: any) {
    return {
      fragment: applied.fragment,
      originalFragment,
      initialVerification,
      finalVerification: initialVerification,
      initialArchitectureCompliance,
      finalArchitectureCompliance,
      repairAttempt: {
        attempted: true,
        reason,
        repairAttempts,
        success: false,
        explanation: applied.explanation,
        changedFiles: applied.changedFiles,
        error: e?.message || 'Re-verification after repair failed',
      },
      repairAttempts,
    }
  }
}

export function describeRepairReason(reason?: RepairReason | null): string {
  if (reason === 'architecture') return 'Architecture'
  if (reason === 'combined') return 'Architecture + Runtime'
  if (reason === 'runtime') return 'Runtime'
  return 'Repair'
}

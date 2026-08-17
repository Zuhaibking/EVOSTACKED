import { z } from 'zod'
import type { ArchitectureComplianceResult } from '@/lib/architecture-compliance'
import type { ApplicationPlan } from '@/lib/plan'
import type { RepairAttemptRecord, RepairReason } from '@/lib/repair'
import type { SmokeSuiteResult } from '@/lib/smoke'
import type { VerificationResult } from '@/lib/verification'
import type { ExecutionResult } from '@/lib/types'

/**
 * Exactly 3 candidates. IDs stay stable for client/judge compatibility.
 * Differentiation is product interpretation + craft — not palette swaps.
 */
export const VARIANTS = [
  {
    id: 'minimal',
    label: 'Product',
    sigil: 'P',
    temperature: 0.35,
    systemSuffix: `Interpretation: PRODUCT-FOCUSED.
Prioritize clarity, task success, and practical UX. Dense information only when it helps the job.
UI: restrained, high signal-to-noise, strong hierarchy, almost no ornament.
Make it feel like a sharp internal tool that a domain expert would keep open all day — not a marketing landing page and not a purple AI template.
Still implement every shared core feature, must-have interaction, interaction contract (exact accessible names), and architectureRequirements (no under/over-building).
Ship a real runnable app structure appropriate to complexity — not a single HTML dump.`,
  },
  {
    id: 'rich',
    label: 'Premium',
    sigil: 'R',
    temperature: 0.65,
    systemSuffix: `Interpretation: PREMIUM.
Same product requirements, elevated brand craft: considered typography, spacing, materials, and one signature motif (type, color, or layout) that belongs to this domain.
Feel trustworthy and productized (as if a funded team shipped v1). Generous rhythm, editorial headlines, tactile controls.
Avoid hollow luxury, gold-gradient kits, and generic "premium SaaS" dashboards.
Still implement every shared core feature, must-have interaction, interaction contract (exact accessible names), and architectureRequirements (no under/over-building).`,
  },
  {
    id: 'playful',
    label: 'Innovate',
    sigil: 'I',
    temperature: 0.9,
    systemSuffix: `Interpretation: INNOVATIVE.
Same product requirements, a genuinely different information architecture or interaction pattern (split workspace, spatial nav, stepper, canvas, or timeline) that makes the workflow clearer.
Surprise with structure and micro-interactions — not gimmicks, confetti, or novelty for its own sake.
Stay accessible and coherent; do not sacrifice core flows for novelty.
Still implement every shared core feature, must-have interaction, interaction contract (exact accessible names), and architectureRequirements (no under/over-building).`,
  },
] as const

export type VariantId = (typeof VARIANTS)[number]['id']

export const verdictSchema = z.object({
  winnerId: z
    .enum(['minimal', 'rich', 'playful'])
    .describe('Id of the candidate that best fulfils the brief.'),
  reasoning: z
    .string()
    .describe('One short sentence explaining the verdict in editorial voice.'),
  scores: z
    .array(
      z.object({
        id: z.enum(['minimal', 'rich', 'playful']),
        clarity: z.number().min(0).max(1),
        fit: z.number().min(0).max(1),
        polish: z.number().min(0).max(1),
        composite: z.number().min(0).max(1),
        comment: z
          .string()
          .describe('One short critique of this candidate, ~10 words.'),
      }),
    )
    .describe('One scoring entry per candidate.'),
})

export type Verdict = z.infer<typeof verdictSchema>

export type TournamentEvent =
  | { type: 'plan'; plan: ApplicationPlan }
  | { type: 'candidate_start'; id: VariantId; label: string; sigil: string }
  | { type: 'candidate_chunk'; id: VariantId; fragment: any }
  | { type: 'candidate_done'; id: VariantId; fragment: any }
  | { type: 'candidate_error'; id: VariantId; error: string }
  | {
      type: 'candidate_skipped'
      id: VariantId
      reason: 'daily_limit' | 'tournament_aborted'
      message: string
    }
  | {
      type: 'provider_quota'
      state:
        | 'ready'
        | 'rate_limited'
        | 'daily_limit_reached'
        | 'temporarily_rate_limited'
      message: string
      retryAfterMs?: number
    }
  | { type: 'candidate_architecture_checking'; id: VariantId }
  | {
      type: 'candidate_architecture_checked'
      id: VariantId
      architectureCompliance: ArchitectureComplianceResult
    }
  | { type: 'candidate_verifying'; id: VariantId }
  | {
      type: 'candidate_verified'
      id: VariantId
      verification: VerificationResult
      execution?: ExecutionResult
    }
  | {
      type: 'candidate_repairing'
      id: VariantId
      reason?: RepairReason
    }
  | {
      type: 'candidate_repaired'
      id: VariantId
      fragment: any
      repairAttempt: RepairAttemptRecord
      initialVerification: VerificationResult
      finalVerification: VerificationResult
      architectureCompliance?: ArchitectureComplianceResult
      execution?: ExecutionResult
    }
  | {
      type: 'candidate_repair_failed'
      id: VariantId
      repairAttempt: RepairAttemptRecord
      initialVerification: VerificationResult
      finalVerification: VerificationResult
      architectureCompliance?: ArchitectureComplianceResult
    }
  | { type: 'candidate_testing'; id: VariantId }
  | {
      type: 'candidate_tested'
      id: VariantId
      smoke: SmokeSuiteResult
    }
  | { type: 'verdict'; verdict: Verdict }
  | { type: 'tournament_done' }

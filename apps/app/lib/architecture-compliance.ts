import { z } from 'zod'

/** Types kept so Arena UI / brain / smoke can still read stored results. */

export const complianceCheckStatusSchema = z.enum([
  'pass',
  'fail',
  'warning',
  'not_applicable',
])
export type ComplianceCheckStatus = z.infer<typeof complianceCheckStatusSchema>

export const complianceSeveritySchema = z.enum([
  'critical',
  'high',
  'medium',
  'low',
])
export type ComplianceSeverity = z.infer<typeof complianceSeveritySchema>

export const complianceOverallStatusSchema = z.enum([
  'passed',
  'partial',
  'failed',
])
export type ComplianceOverallStatus = z.infer<
  typeof complianceOverallStatusSchema
>

export const architectureComplianceCheckSchema = z.object({
  id: z.string(),
  requirement: z.string(),
  status: complianceCheckStatusSchema,
  severity: complianceSeveritySchema,
  evidence: z.string(),
})
export type ArchitectureComplianceCheck = z.infer<
  typeof architectureComplianceCheckSchema
>

export const architectureComplianceResultSchema = z.object({
  status: complianceOverallStatusSchema,
  checks: z.array(architectureComplianceCheckSchema),
  missingRequirements: z.array(z.string()),
  suspiciousPatterns: z.array(z.string()),
  evidence: z.array(z.string()),
  summary: z.string(),
})
export type ArchitectureComplianceResult = z.infer<
  typeof architectureComplianceResultSchema
>

export function formatArchitectureComplianceForJudge(
  result?: ArchitectureComplianceResult | null,
): string {
  if (!result) return 'Architecture compliance: (not run)'
  return `Architecture compliance: ${result.status.toUpperCase()}\n${result.summary}`
}

export function architectureComplianceRankDelta(
  result?: ArchitectureComplianceResult | null,
): number {
  if (!result) return 0
  if (result.status === 'passed') return 3
  if (result.status === 'partial') return 0
  return -5
}

export function hasCriticalArchitectureFailure(
  result?: ArchitectureComplianceResult | null,
): boolean {
  if (!result) return false
  if (result.status === 'failed') return true
  return result.checks.some(
    (c) => c.status === 'fail' && c.severity === 'critical',
  )
}

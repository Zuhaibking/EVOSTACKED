/** Types kept so stored tournament candidates still typecheck. */

export const MAX_REPAIR_ATTEMPTS_PER_CANDIDATE = 1

export type RepairReason = 'architecture' | 'runtime' | 'combined' | 'integrity'

export type RepairAttemptRecord = {
  attempted: true
  reason: RepairReason
  repairAttempts: number
  explanation?: string
  changedFiles?: string[]
  success: boolean
  error?: string
}

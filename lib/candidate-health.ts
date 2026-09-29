export type HealthState =
  | 'GENERATING'
  | 'VERIFYING'
  | 'REPAIRING'
  | 'INSTALLING_DEPENDENCIES'
  | 'REBUILDING'
  | 'VERIFIED'
  | 'FAILED'
  | 'UNVERIFIED'

export type CandidateHealth = {
  state: HealthState
  buildStatus: 'passed' | 'failed' | 'skipped'
  runtimeStatus: 'passed' | 'failed' | 'skipped'
  dependencyStatus: 'passed' | 'failed' | 'skipped'
  repairAttempts: number
  repaired: boolean
  verified: boolean
  log: string[]
}

export function candidateHealthLabel(
  status: string,
  health?: CandidateHealth,
): string | null {
  if (status === 'generating' || status === 'pending' || status === 'judging' || status === 'error') {
    return null
  }
  if (health?.verified) return 'Verified'
  if (health?.state === 'FAILED') return 'Failed'
  if (status === 'done') return 'Unverified'
  return null
}

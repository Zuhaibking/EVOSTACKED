import { hasFragmentCode } from '@/lib/fragment'
import { candidatePreviewIsHealthy } from '@/lib/candidate-smoke'
import type { Candidate, CandidateStatus } from '@/lib/tournament-client'
import { verificationHasPreviewOverlayFailure } from '@/lib/verification'

export type SpecimenStatusTone = 'ready' | 'work' | 'queue' | 'fail' | 'idle'

export type SpecimenStatusDisplay = {
  label: string
  tone: SpecimenStatusTone
}

const FAILED: CandidateStatus[] = [
  'error',
  'architecture_failed',
  'verify_failed',
  'repair_failed',
  'smoke_failed',
]

/**
 * Chip label for one specimen. Saved source without a live sandbox is Idle,
 * not Starting — only the candidate currently being deployed spins.
 */
export function specimenStatus(
  c: Candidate,
  earlierStillWorking: boolean,
  opts?: { deploying?: boolean },
): SpecimenStatusDisplay {
  const status: CandidateStatus = c.status
  const overlayBroken = verificationHasPreviewOverlayFailure(
    c.finalVerification || c.verification,
  )
  const hasSource = hasFragmentCode(c.fragment)

  if (opts?.deploying) return { label: 'Starting', tone: 'work' }
  if (candidatePreviewIsHealthy(c)) return { label: 'Ready', tone: 'ready' }

  if (FAILED.includes(status) || overlayBroken) {
    if (hasSource) return { label: 'Idle', tone: 'idle' }
    return { label: 'Failed', tone: 'fail' }
  }
  if (status === 'generating') return { label: 'Generating', tone: 'work' }
  if (status === 'architecture_checking') return { label: 'Verifying', tone: 'work' }
  if (
    status === 'verifying' ||
    status === 'done' ||
    status === 'architecture_checked' ||
    status === 'architecture_partial'
  ) {
    return { label: 'Building', tone: 'work' }
  }
  if (status === 'repairing') return { label: 'Repairing', tone: 'work' }
  if (status === 'testing') return { label: 'Testing', tone: 'work' }
  if (status === 'judging') return { label: 'Judging', tone: 'work' }
  if (status === 'pending' || status === 'not_attempted') {
    if (hasSource) return { label: 'Idle', tone: 'idle' }
    if (earlierStillWorking) return { label: 'Queued', tone: 'queue' }
    return { label: 'Waiting', tone: 'idle' }
  }
  if (hasSource) return { label: 'Idle', tone: 'idle' }
  return { label: 'Waiting', tone: 'idle' }
}

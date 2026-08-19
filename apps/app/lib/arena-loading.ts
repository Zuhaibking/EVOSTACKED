import type { Candidate, CandidateStatus } from '@/lib/tournament-client'
import { VARIANTS, type VariantId } from '@/lib/tournament'

const ACTIVE_STATUSES: CandidateStatus[] = [
  'generating',
  'architecture_checking',
  'verifying',
  'repairing',
  'testing',
  'judging',
]

export function arenaLoadingLabel(opts: {
  tournamentPhase: string
  candidates: Record<VariantId, Candidate>
  isPreviewLoading: boolean
  isChatLoading: boolean
  evolutionRunning: boolean
}): string | null {
  if (opts.evolutionRunning) return 'Improving'
  if (opts.isPreviewLoading) return 'Deploying'
  if (opts.tournamentPhase === 'architecture') return 'Verifying'
  if (opts.tournamentPhase === 'verifying') return 'Verifying'
  if (opts.tournamentPhase === 'repairing') return 'Verifying'
  if (opts.tournamentPhase === 'testing') return 'Verifying'
  if (opts.tournamentPhase === 'judging') return 'Verifying'
  if (opts.tournamentPhase === 'generating') {
    const active = VARIANTS.find((v) =>
      ACTIVE_STATUSES.includes(opts.candidates[v.id]?.status),
    )
    if (active?.label === 'Product') return 'Generating Product'
    if (active?.label === 'Premium') return 'Generating Premium'
    if (active?.label === 'Innovate') return 'Generating Innovate'
    return 'Planning'
  }
  if (opts.isChatLoading) return 'Preparing Preview'
  return null
}

/** Compact per-candidate label. Null when that specimen is not actively working. */
export function candidateLoadingLabel(
  status: CandidateStatus | undefined,
): string | null {
  switch (status) {
    case 'generating':
      return 'Generating'
    case 'architecture_checking':
      return 'Verifying'
    case 'done':
    case 'architecture_checked':
    case 'architecture_partial':
    case 'verifying':
      return 'Building'
    case 'repairing':
      return 'Repairing'
    case 'testing':
      return 'Testing'
    case 'judging':
      return 'Judging'
    default:
      return null
  }
}

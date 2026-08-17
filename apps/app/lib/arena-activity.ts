/**
 * Honest Arena activity timeline.
 * Derived only from tournament.phase + per-candidate status/metadata.
 * Never marks a step complete unless observed state shows it happened.
 */
import { candidatePreviewIsHealthy } from '@/lib/candidate-smoke'
import { hasFragmentCode } from '@/lib/fragment'
import { VARIANTS, type VariantId } from '@/lib/tournament'
import type {
  Candidate,
  CandidateStatus,
  TournamentPhase,
} from '@/lib/tournament-client'

export type ArenaActivityTone = 'done' | 'work' | 'fail'

export type ArenaActivityItem = {
  id: string
  label: string
  tone: ArenaActivityTone
  candidateId?: VariantId
  allowSource?: boolean
  allowDetails?: boolean
}

const GENERATE_FAIL: CandidateStatus[] = ['error']
const ARCH_DONE: CandidateStatus[] = [
  'architecture_checked',
  'architecture_partial',
]
const ARCH_FAIL: CandidateStatus[] = ['architecture_failed']
const RUNTIME_FAIL: CandidateStatus[] = ['verify_failed']
const REPAIR_FAIL: CandidateStatus[] = ['repair_failed']
const SMOKE_FAIL: CandidateStatus[] = ['smoke_failed']

function hasArchitectureSignal(c: Candidate): boolean {
  return (
    c.status === 'architecture_checking' ||
    ARCH_DONE.includes(c.status) ||
    ARCH_FAIL.includes(c.status) ||
    !!c.architectureCompliance
  )
}

function hasRepairSignal(c: Candidate): boolean {
  return (
    c.status === 'repairing' ||
    c.status === 'repaired' ||
    REPAIR_FAIL.includes(c.status) ||
    !!c.repairAttempt
  )
}

function hasRuntimeSignal(c: Candidate): boolean {
  return (
    c.status === 'verifying' ||
    c.status === 'verified' ||
    RUNTIME_FAIL.includes(c.status) ||
    !!c.verification ||
    !!c.finalVerification
  )
}

function hasSmokeSignal(c: Candidate): boolean {
  return (
    c.status === 'testing' ||
    c.status === 'tested' ||
    SMOKE_FAIL.includes(c.status) ||
    c.status === 'not_testable' ||
    !!c.smoke
  )
}

function pushCandidatePipeline(
  items: ArenaActivityItem[],
  c: Candidate,
): void {
  const label = c.label
  const id = c.id
  const hasSource = hasFragmentCode(c.fragment)
  const failedGenerate =
    GENERATE_FAIL.includes(c.status) && !hasSource

  if (c.status === 'pending' || c.status === 'not_attempted') {
    return
  }

  if (c.status === 'generating') {
    items.push({
      id: `${id}-generating`,
      label: `Generating ${label}`,
      tone: 'work',
      candidateId: id,
    })
    return
  }

  if (failedGenerate) {
    items.push({
      id: `${id}-generating`,
      label: `${label} generation failed`,
      tone: 'fail',
      candidateId: id,
      allowDetails: true,
    })
    return
  }

  if (hasSource || c.status === 'done' || c.status === 'error') {
    items.push({
      id: `${id}-generated`,
      label: `${label} generated`,
      tone: hasSource ? 'done' : 'fail',
      candidateId: id,
      allowSource: hasSource,
      allowDetails: !hasSource,
    })
  }

  if (c.status === 'error' && hasSource) {
    items.push({
      id: `${id}-error`,
      label: `${label} failed`,
      tone: 'fail',
      candidateId: id,
      allowSource: true,
      allowDetails: true,
    })
  }

  if (hasArchitectureSignal(c)) {
    const fail = ARCH_FAIL.includes(c.status)
    const work = c.status === 'architecture_checking'
    items.push({
      id: `${id}-integrity`,
      label: `${label} integrity check`,
      tone: fail ? 'fail' : work ? 'work' : 'done',
      candidateId: id,
      allowSource: hasSource,
      allowDetails: fail,
    })
    if (work) return
  }

  if (hasRepairSignal(c)) {
    const fail = REPAIR_FAIL.includes(c.status) || c.repairAttempt?.success === false
    const work = c.status === 'repairing'
    const repaired =
      c.status === 'repaired' || c.repairAttempt?.success === true
    items.push({
      id: `${id}-repair`,
      label: fail
        ? `${label} repair failed`
        : work
          ? `Repairing ${label}`
          : repaired
            ? `${label} repaired`
            : `Repairing ${label}`,
      tone: fail ? 'fail' : work ? 'work' : 'done',
      candidateId: id,
      allowSource: hasSource,
      allowDetails: fail,
    })
    if (work) return
  }

  if (hasRuntimeSignal(c)) {
    const fail = RUNTIME_FAIL.includes(c.status)
    const work = c.status === 'verifying'
    items.push({
      id: `${id}-runtime`,
      label: fail
        ? `${label} build failed`
        : work
          ? `${label} deploying`
          : `${label} runtime`,
      tone: fail ? 'fail' : work ? 'work' : 'done',
      candidateId: id,
      allowSource: hasSource,
      allowDetails: fail,
    })
    if (work || fail) {
      if (fail) return
    }
  }

  if (candidatePreviewIsHealthy(c)) {
    items.push({
      id: `${id}-preview`,
      label: `${label} preview ready`,
      tone: 'done',
      candidateId: id,
      allowSource: hasSource,
    })
  }

  if (hasSmokeSignal(c)) {
    const fail = SMOKE_FAIL.includes(c.status)
    const work = c.status === 'testing'
    const skip = c.status === 'not_testable' || c.smoke?.status === 'not_testable'
    const timeout = c.smoke?.status === 'timeout'
    items.push({
      id: `${id}-smoke`,
      label: work
        ? `${label} smoke`
        : skip
          ? `${label} smoke n/a`
          : fail
            ? `${label} smoke failed`
            : timeout
              ? `${label} smoke timed out`
              : `${label} smoke`,
      tone: work ? 'work' : fail ? 'fail' : 'done',
      candidateId: id,
      allowSource: hasSource,
      allowDetails: fail,
    })
  }
}

export function buildArenaActivity(opts: {
  phase: TournamentPhase
  plan?: unknown
  candidates: Record<VariantId, Candidate>
  evolutionRunning?: boolean
}): ArenaActivityItem[] {
  const items: ArenaActivityItem[] = []
  const hasPlan = opts.plan != null
  const started = opts.phase !== 'idle' || hasPlan

  if (started) {
    const planningWork = opts.phase === 'generating' && !hasPlan
    items.push({
      id: 'plan',
      label: 'Planning',
      tone: planningWork ? 'work' : 'done',
    })
  }

  if (opts.evolutionRunning) {
    items.push({
      id: 'evolution',
      label: 'Improving',
      tone: 'work',
    })
  }

  for (const variant of VARIANTS) {
    const c = opts.candidates[variant.id]
    if (c) pushCandidatePipeline(items, c)
  }

  if (opts.phase === 'judging') {
    items.push({
      id: 'verdict',
      label: 'Scoring',
      tone: 'work',
    })
  }

  if (opts.phase === 'done' && hasPlan) {
    items.push({
      id: 'tournament-done',
      label: 'Tournament complete',
      tone: 'done',
    })
  }

  return items
}

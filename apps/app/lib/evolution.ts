/**
 * Evolution / "Improve this app" — iteration domain over an existing Project Brain.
 *
 * Pure, deterministic, provider-independent. Does not call LLMs.
 * Reuses ApplicationPlan, Verdict, VariantId, and Project Brain helpers.
 */
import { getFragmentFiles } from '@/lib/fragment'
import {
  getProjectBrainContextForIteration,
  recordImprovement,
  recordIssue,
  recordProjectVersion,
  sanitizeProjectBrain,
  type ProjectBrain,
  type ProjectBrainSummary,
} from '@/lib/project-brain'
import type { ApplicationPlan } from '@/lib/plan'
import type { FragmentSchema } from '@/lib/schema'
import type { Verdict, VariantId } from '@/lib/tournament'
import { VARIANTS } from '@/lib/tournament'
import type { DeepPartial } from '@evostack/shared'

export type EvolutionStatus =
  | 'pending'
  | 'running'
  | 'succeeded'
  | 'failed'

/** Initial Generate tournament size — never change. */
export const INITIAL_TOURNAMENT_CANDIDATE_COUNT = 3

/** Post-selection Improve-this-app: exactly one generation attempt. */
export const ITERATION_CANDIDATE_COUNT = 1

export type EvolutionCandidateMode = 'single' | 'tournament'

export type EvolutionCandidateSnapshot = {
  id: VariantId
  label: string
  composite?: number
  /** Display points 0–100 derived from composite. */
  points?: number
  runtimeStatus?: string
  smokeStatus?: string
  isWinner?: boolean
}

export type EvolutionRound = {
  iterationId: string
  roundNumber: number
  parentVersion: number
  userRequest: string
  status: EvolutionStatus
  /** Always 'single' for Improve-this-app after active selection. */
  candidateMode: EvolutionCandidateMode
  /** Active specimen being improved (required for single mode). */
  activeVariantId?: VariantId
  candidates: EvolutionCandidateSnapshot[]
  winnerId?: VariantId
  winnerLabel?: string
  previousScore?: number
  newScore?: number
  improvementDelta?: number
  error?: string
  createdAt: string
  completedAt?: string
}

/** Context sent to generation — includes baseline source for modification. */
export type EvolutionIterationContext = {
  summary: ProjectBrainSummary
  plan?: ApplicationPlan
  fileTree: string[]
  currentVersion: number
  activeCandidateId?: VariantId
  activeVersion?: number
  knownIssues: string[]
  recentRequests: string[]
  userRequest: string
  parentVersion: number
  previousScore?: number
  baselinePrimaryFile?: string
  baselineTemplate?: string
  /** Existing source files the model must modify (never stored in Project Brain). */
  baselineFiles: Array<{ file_path: string; file_content: string }>
}

export type EvolutionApiPayload = {
  mode: 'evolution'
  /** Cost-efficient default: one candidate. */
  candidateMode: EvolutionCandidateMode
  activeVariantId: VariantId
  userRequest: string
  parentVersion: number
  previousScore?: number
  plan: ApplicationPlan
  baselineFragment: FragmentSchema | DeepPartial<FragmentSchema>
  iterationContext: Omit<EvolutionIterationContext, 'baselineFiles'> & {
    fileTree: string[]
  }
}

function isoNow(now?: string): string {
  return now || new Date().toISOString()
}

function scrub(text: string, max = 500): string {
  return text
    .replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, 'Bearer [redacted]')
    .replace(/sk-[A-Za-z0-9]{10,}/g, '[redacted]')
    .replace(
      /((?:api[_-]?key|secret|token|password)\s*[=:]\s*)([^"\\s]+)/gi,
      '$1[redacted]',
    )
    .slice(0, max)
}

/** Convert judge composite (0–1) to display points (0–100). */
export function scoreToPoints(composite?: number | null): number | undefined {
  if (composite == null || Number.isNaN(composite)) return undefined
  return Math.round(Math.max(0, Math.min(1, composite)) * 100)
}

export function computeImprovementDelta(
  previousScore?: number | null,
  newScore?: number | null,
): number | undefined {
  if (previousScore == null || newScore == null) return undefined
  return newScore - previousScore
}

export function currentBrainScore(brain: ProjectBrain): number | undefined {
  const fromVersion = brain.versions[brain.versions.length - 1]?.compositeScore
  if (fromVersion != null) return scoreToPoints(fromVersion)
  const winner = brain.judge?.scores.find((s) => s.id === brain.currentWinnerId)
  return scoreToPoints(winner?.composite)
}

export function nextEvolutionRoundNumber(brain: ProjectBrain): number {
  return (brain.improvements?.length || 0) + 1
}

/**
 * Build iteration context from Project Brain + current fragment.
 * Baseline file bodies are for the generation request only — not for brain persistence.
 */
export function buildIterationContext(opts: {
  brain: ProjectBrain
  userRequest: string
  baselineFragment?: DeepPartial<FragmentSchema> | FragmentSchema | null
  previousScore?: number
}): EvolutionIterationContext {
  const base = getProjectBrainContextForIteration(opts.brain)
  const files = getFragmentFiles(opts.baselineFragment)
  const request = scrub(opts.userRequest.trim(), 2000)
  return {
    ...base,
    userRequest: request,
    parentVersion: base.currentVersion,
    previousScore:
      opts.previousScore ?? currentBrainScore(opts.brain) ?? undefined,
    baselinePrimaryFile:
      (typeof opts.baselineFragment?.file_path === 'string' &&
        opts.baselineFragment.file_path) ||
      files[0]?.file_path,
    baselineTemplate:
      typeof opts.baselineFragment?.template === 'string'
        ? opts.baselineFragment.template
        : opts.brain.template,
    baselineFiles: files.map((f) => ({
      file_path: f.file_path,
      file_content: f.file_content,
    })),
  }
}

export function createEvolutionRound(opts: {
  brain: ProjectBrain
  userRequest: string
  previousScore?: number
  now?: string
  /** Defaults to single-candidate cost-efficient iteration. */
  candidateMode?: EvolutionCandidateMode
  activeVariantId?: VariantId
}): EvolutionRound {
  const now = isoNow(opts.now)
  const roundNumber = nextEvolutionRoundNumber(opts.brain)
  const parentVersion =
    opts.brain.activeVersion || opts.brain.currentVersion || 0
  const candidateMode = opts.candidateMode || 'single'
  const activeVariantId =
    opts.activeVariantId || opts.brain.activeCandidateId

  if (candidateMode === 'single' && !activeVariantId) {
    throw new Error(
      'Single-candidate evolution requires an activeVariantId / activeCandidateId',
    )
  }

  const variantList =
    candidateMode === 'single' && activeVariantId
      ? VARIANTS.filter((v) => v.id === activeVariantId)
      : [...VARIANTS]

  return {
    iterationId: `evo_${parentVersion}_${roundNumber}_${now}`,
    roundNumber,
    parentVersion,
    userRequest: scrub(opts.userRequest.trim(), 2000),
    status: 'pending',
    candidateMode,
    activeVariantId,
    candidates: variantList.map((v) => ({
      id: v.id,
      label: v.label,
    })),
    previousScore:
      opts.previousScore ?? currentBrainScore(opts.brain) ?? undefined,
    createdAt: now,
  }
}

export function startEvolutionRound(round: EvolutionRound, now?: string): EvolutionRound {
  return {
    ...round,
    status: 'running',
    createdAt: round.createdAt || isoNow(now),
  }
}

export function candidateSnapshotsFromVerdict(
  verdict?: Verdict | null,
  mode: EvolutionCandidateMode = 'tournament',
  activeVariantId?: VariantId,
): EvolutionCandidateSnapshot[] {
  const list =
    mode === 'single' && activeVariantId
      ? VARIANTS.filter((v) => v.id === activeVariantId)
      : [...VARIANTS]
  return list.map((v) => {
    const score = verdict?.scores.find((s) => s.id === v.id)
    return {
      id: v.id,
      label: v.label,
      composite: score?.composite,
      points: scoreToPoints(score?.composite),
      isWinner: verdict?.winnerId === v.id,
    }
  })
}

/**
 * Deterministic single-iteration validation (no LLM judge).
 * Used after one Improve-this-app generation attempt.
 */
export function buildSingleIterationVerdict(opts: {
  id: VariantId
  verification?: { status?: string } | null
  architecture?: { status?: string } | null
  smoke?: { status?: string } | null
  previousScore?: number
  userRequest?: string
}): Verdict {
  const runtime = opts.verification?.status || 'failed'
  const arch = opts.architecture?.status || 'unknown'
  const smoke = opts.smoke?.status || 'not_testable'

  let composite = 0.45
  if (runtime === 'passed') composite += 0.28
  else if (runtime === 'partial') composite += 0.18
  else composite -= 0.2

  if (arch === 'passed') composite += 0.12
  else if (arch === 'partial') composite += 0.04
  else if (arch === 'failed') composite -= 0.15

  if (smoke === 'passed') composite += 0.1
  else if (smoke === 'failed' || smoke === 'timeout') composite -= 0.08

  // Slight bump when we have a prior score so deltas stay informative.
  if (opts.previousScore != null) {
    const prior = Math.max(0, Math.min(1, opts.previousScore / 100))
    composite = Math.min(0.98, Math.max(0.05, composite * 0.85 + prior * 0.15 + 0.02))
  } else {
    composite = Math.min(0.98, Math.max(0.05, composite))
  }

  const clarity = Math.min(1, composite + 0.02)
  const fit = composite
  const polish = Math.max(0.05, composite - 0.03)
  const mean = (clarity + fit + polish) / 3

  const ok = runtime === 'passed' || runtime === 'partial'
  return {
    winnerId: opts.id,
    reasoning: ok
      ? `Single-iteration validation passed for ${opts.id}${
          opts.userRequest ? ` (${scrub(opts.userRequest, 80)})` : ''
        }.`
      : `Single-iteration validation failed (runtime ${runtime}).`,
    scores: [
      {
        id: opts.id,
        clarity,
        fit,
        polish,
        composite: mean,
        comment: ok ? 'iteration accepted' : 'iteration rejected',
      },
    ],
  }
}

/**
 * Promote only when a winner exists with a fragment and non-failed final runtime.
 * Failed / missing verification leaves the parent app untouched.
 */
export function shouldPromoteEvolutionWinner(opts: {
  verdict?: Verdict | null
  candidates: Array<{
    id: VariantId
    fragment?: unknown
    finalVerification?: { status?: string } | null
    verification?: { status?: string } | null
  }>
}): boolean {
  if (!opts.verdict?.winnerId) return false
  const winner = opts.candidates.find((c) => c.id === opts.verdict!.winnerId)
  if (!winner?.fragment) return false
  const status =
    winner.finalVerification?.status || winner.verification?.status
  return status === 'passed' || status === 'partial'
}

export function completeEvolutionRound(
  round: EvolutionRound,
  opts: {
    verdict: Verdict
    candidates?: Array<{
      id: VariantId
      finalVerification?: { status?: string } | null
      verification?: { status?: string } | null
      smoke?: { status?: string } | null
    }>
    now?: string
  },
): EvolutionRound {
  const now = isoNow(opts.now)
  const winnerScore = opts.verdict.scores.find(
    (s) => s.id === opts.verdict.winnerId,
  )
  const newScore = scoreToPoints(winnerScore?.composite)
  const snapshots = candidateSnapshotsFromVerdict(
    opts.verdict,
    round.candidateMode || 'single',
    round.activeVariantId || opts.verdict.winnerId,
  ).map((c) => {
    const live = opts.candidates?.find((x) => x.id === c.id)
    return {
      ...c,
      runtimeStatus:
        live?.finalVerification?.status || live?.verification?.status,
      smokeStatus: live?.smoke?.status,
    }
  })
  const winnerMeta = VARIANTS.find((v) => v.id === opts.verdict.winnerId)
  return {
    ...round,
    status: 'succeeded',
    candidates: snapshots,
    winnerId: opts.verdict.winnerId,
    winnerLabel: winnerMeta?.label,
    newScore,
    improvementDelta: computeImprovementDelta(round.previousScore, newScore),
    completedAt: now,
    error: undefined,
  }
}

export function failEvolutionRound(
  round: EvolutionRound,
  error: string,
  now?: string,
): EvolutionRound {
  return {
    ...round,
    status: 'failed',
    error: scrub(error, 400),
    completedAt: isoNow(now),
  }
}

/**
 * Apply a successful evolution to Project Brain.
 * Records improvement + new version with parent linkage. Never stores source bodies.
 */
export function applyEvolutionToBrain(
  brain: ProjectBrain,
  round: EvolutionRound,
  opts: {
    verdict: Verdict
    fragment?: DeepPartial<FragmentSchema> | FragmentSchema | null
    verification?: ProjectBrain['verification'] | null
    architectureCompliance?: ProjectBrain['architectureCompliance'] | null
    smoke?: ProjectBrain['smoke'] | null
    repairAttempt?: ProjectBrain['repairHistory'][number] | null
    now?: string
  },
): ProjectBrain {
  const now = isoNow(opts.now)
  const label =
    round.userRequest.length > 48
      ? `Improved: ${round.userRequest.slice(0, 45)}…`
      : `Improved: ${round.userRequest}`

  let next = sanitizeProjectBrain({
    ...brain,
    updatedAt: now,
    currentWinnerId: opts.verdict.winnerId,
    currentWinnerLabel:
      VARIANTS.find((v) => v.id === opts.verdict.winnerId)?.label,
    activeCandidateId: opts.verdict.winnerId,
    activeCandidateLabel:
      VARIANTS.find((v) => v.id === opts.verdict.winnerId)?.label,
    judge: {
      winnerId: opts.verdict.winnerId,
      reasoning: scrub(opts.verdict.reasoning, 400),
      scores: opts.verdict.scores.map((s) => ({
        ...s,
        comment: scrub(s.comment, 160),
      })),
    },
  })

  if (opts.fragment) {
    const files = getFragmentFiles(opts.fragment)
    next = {
      ...next,
      fileTree: files.map((f) => f.file_path).slice(0, 200),
      primaryFile:
        (typeof opts.fragment.file_path === 'string' &&
          opts.fragment.file_path) ||
        files[0]?.file_path,
      template:
        typeof opts.fragment.template === 'string'
          ? opts.fragment.template
          : next.template,
    }
  }
  if (opts.verification) next = { ...next, verification: opts.verification }
  if (opts.architectureCompliance) {
    next = { ...next, architectureCompliance: opts.architectureCompliance }
  }
  if (opts.smoke) next = { ...next, smoke: opts.smoke }
  if (opts.repairAttempt) {
    next = {
      ...next,
      repairHistory: [...(next.repairHistory || []), opts.repairAttempt].slice(
        -8,
      ),
    }
  }

  next = recordImprovement(next, {
    request: round.userRequest,
    note: `Evolution round ${round.roundNumber}: ${round.previousScore ?? '—'} → ${round.newScore ?? '—'} (Δ ${round.improvementDelta ?? 0})`,
    at: now,
  })

  next = recordProjectVersion(next, {
    label,
    summary: opts.verdict.reasoning,
    parentVersion: round.parentVersion,
    previousScore: round.previousScore,
    improvementDelta: round.improvementDelta,
    userRequest: round.userRequest,
    now,
  })

  next = {
    ...next,
    activeVersion: next.currentVersion,
  }

  return sanitizeProjectBrain(next)
}

/**
 * Failed evolution: keep version/winner untouched; optionally log an issue.
 */
export function preserveBrainAfterFailedEvolution(
  brain: ProjectBrain,
  round: EvolutionRound,
  now?: string,
): ProjectBrain {
  const at = isoNow(now)
  return recordIssue(brain, {
    source: 'generation',
    severity: 'warning',
    message: `Evolution round ${round.roundNumber} failed — kept v${brain.currentVersion}. ${round.error || ''}`.trim(),
    at,
  })
}

/** Build API payload for one user-triggered single-candidate evolution (no auto loops). */
export function buildEvolutionApiPayload(
  context: EvolutionIterationContext,
  baselineFragment: FragmentSchema | DeepPartial<FragmentSchema>,
  opts?: { activeVariantId?: VariantId },
): EvolutionApiPayload {
  if (!context.plan) {
    throw new Error('Evolution requires an existing ApplicationPlan on Project Brain')
  }
  const activeVariantId =
    opts?.activeVariantId || context.activeCandidateId
  if (!activeVariantId) {
    throw new Error(
      'Evolution requires an active candidate — select Use this version first',
    )
  }
  const { baselineFiles: _omit, ...meta } = context
  return {
    mode: 'evolution',
    candidateMode: 'single',
    activeVariantId,
    userRequest: context.userRequest,
    parentVersion: context.parentVersion,
    previousScore: context.previousScore,
    plan: context.plan,
    baselineFragment,
    iterationContext: {
      ...meta,
      fileTree: context.fileTree,
      activeCandidateId: activeVariantId,
    },
  }
}

/** Format baseline sources for the evolution generation prompt (LLM input only). */
export function formatBaselineFilesForPrompt(
  files: Array<{ file_path: string; file_content: string }>,
  maxTotalChars = 72000,
): string {
  if (!files.length) return '(no existing files — treat as fresh implementation)'
  let used = 0
  const parts: string[] = []
  for (const f of files) {
    const header = `### FILE: ${f.file_path}\n`
    const budget = maxTotalChars - used - header.length - 20
    if (budget <= 0) {
      parts.push(`### FILE: ${f.file_path}\n…[truncated]`)
      break
    }
    const body =
      f.file_content.length > budget
        ? `${f.file_content.slice(0, budget)}\n…[truncated]`
        : f.file_content
    parts.push(`${header}\`\`\`\n${body}\n\`\`\``)
    used += header.length + body.length
  }
  return parts.join('\n\n')
}

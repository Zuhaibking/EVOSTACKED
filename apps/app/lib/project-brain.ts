/**
 * Project Brain — structured product knowledge for the current EvoStack run.
 *
 * Reuses ApplicationPlan, VerificationResult, SmokeSuiteResult, Verdict,
 * ArchitectureComplianceResult, and RepairAttemptRecord rather than duplicating
 * those schemas. Safe for client storage: no API keys, no full sandbox secrets.
 */
import type { ArchitectureComplianceResult } from '@/lib/architecture-compliance'
import { getFragmentFiles } from '@/lib/fragment'
import type { ApplicationPlan } from '@/lib/plan'
import type { RepairAttemptRecord } from '@/lib/repair'
import type { FragmentSchema } from '@/lib/schema'
import type { SmokeSuiteResult } from '@/lib/smoke'
import type { Verdict, VariantId } from '@/lib/tournament'
import { VARIANTS } from '@/lib/tournament'
import type { VerificationResult } from '@/lib/verification'
import { truncateDiagnostic } from '@/lib/verification'
import type { DeepPartial } from '@evostack/shared'

export const PROJECT_BRAIN_VERSION = 1 as const

export type ProjectIssue = {
  id: string
  at: string
  source:
    | 'architecture'
    | 'runtime'
    | 'smoke'
    | 'repair'
    | 'generation'
    | 'user'
  severity: 'info' | 'warning' | 'error'
  message: string
}

export type ProjectImprovement = {
  id: string
  at: string
  request: string
  note?: string
}

export type ProjectVersionRecord = {
  version: number
  label: string
  createdAt: string
  /** Variant id of the winner for this version, if any. */
  winnerId?: VariantId
  winnerLabel?: string
  compositeScore?: number
  runtimeStatus?: VerificationResult['status']
  smokeStatus?: SmokeSuiteResult['status']
  architectureStatus?: ArchitectureComplianceResult['status']
  summary?: string
  /** Evolution linkage (v2+). */
  parentVersion?: number
  /** Display points 0–100 before this version. */
  previousScore?: number
  /** newScore − previousScore in display points. */
  improvementDelta?: number
  /** User improvement request that produced this version. */
  userRequest?: string
}

/**
 * Compact, serializable project understanding.
 * Intentionally omits full fragment code bodies and execution URLs with tokens.
 */
export type ProjectBrain = {
  schemaVersion: typeof PROJECT_BRAIN_VERSION
  updatedAt: string
  /** Product knowledge from the shared ApplicationPlan (authoritative). */
  plan?: ApplicationPlan
  /** File paths only — never full source contents. */
  fileTree: string[]
  primaryFile?: string
  template?: string
  currentWinnerId?: VariantId
  currentWinnerLabel?: string
  /**
   * User-confirmed active specimen for iteration.
   * Until set, Improve-this-app is disabled (initial tournament is browse-only).
   */
  activeCandidateId?: VariantId
  activeCandidateLabel?: string
  /** Mirrors currentVersion once an active selection / iteration exists. */
  activeVersion?: number
  verification?: Pick<
    VerificationResult,
    'status' | 'previewReachable' | 'errors' | 'warnings' | 'durationMs'
  >
  architectureCompliance?: Pick<
    ArchitectureComplianceResult,
    'status' | 'summary'
  >
  smoke?: Pick<SmokeSuiteResult, 'status' | 'summary'>
  judge?: {
    winnerId: Verdict['winnerId']
    reasoning: string
    scores: Verdict['scores']
  }
  repairHistory: RepairAttemptRecord[]
  issues: ProjectIssue[]
  improvements: ProjectImprovement[]
  versions: ProjectVersionRecord[]
  /** Short recent user briefs / change requests (scrubbed). */
  userRequests: string[]
  currentVersion: number
}

export type CreateProjectBrainInput = {
  plan?: ApplicationPlan | null
  fragment?: DeepPartial<FragmentSchema> | FragmentSchema | null
  winnerId?: VariantId | null
  verification?: VerificationResult | null
  architectureCompliance?: ArchitectureComplianceResult | null
  smoke?: SmokeSuiteResult | null
  verdict?: Verdict | null
  repairAttempt?: RepairAttemptRecord | null
  userRequest?: string | null
  now?: string
}

function isoNow(now?: string): string {
  return now || new Date().toISOString()
}

function scrubText(value: string | undefined | null, max = 400): string {
  if (!value) return ''
  return truncateDiagnostic(value, max)
}

function winnerLabel(id?: VariantId | null): string | undefined {
  if (!id) return undefined
  return VARIANTS.find((v) => v.id === id)?.label
}

function compactVerification(
  v?: VerificationResult | null,
): ProjectBrain['verification'] | undefined {
  if (!v) return undefined
  return {
    status: v.status,
    previewReachable: v.previewReachable,
    errors: (v.errors || []).map((e) => scrubText(e, 240)).filter(Boolean),
    warnings: (v.warnings || []).map((w) => scrubText(w, 240)).filter(Boolean),
    durationMs: v.durationMs,
  }
}

function compactArchitecture(
  a?: ArchitectureComplianceResult | null,
): ProjectBrain['architectureCompliance'] | undefined {
  if (!a) return undefined
  return {
    status: a.status,
    summary: scrubText(a.summary, 300),
  }
}

function compactSmoke(
  s?: SmokeSuiteResult | null,
): ProjectBrain['smoke'] | undefined {
  if (!s) return undefined
  return {
    status: s.status,
    summary: scrubText(s.summary, 300) || s.summary || '',
  }
}

function compactRepair(
  r?: RepairAttemptRecord | null,
): RepairAttemptRecord | undefined {
  if (!r) return undefined
  return {
    ...r,
    explanation: scrubText(r.explanation, 300) || undefined,
    error: scrubText(r.error, 300) || undefined,
    changedFiles: r.changedFiles?.slice(0, 40),
  }
}

function emptyBrain(now?: string): ProjectBrain {
  return {
    schemaVersion: PROJECT_BRAIN_VERSION,
    updatedAt: isoNow(now),
    fileTree: [],
    repairHistory: [],
    issues: [],
    improvements: [],
    versions: [],
    userRequests: [],
    currentVersion: 0,
  }
}

/**
 * Build a Project Brain from tournament / workspace state.
 * Pure and deterministic for a given input.
 */
export function createProjectBrain(input: CreateProjectBrainInput = {}): ProjectBrain {
  const now = isoNow(input.now)
  const brain = emptyBrain(now)
  return updateProjectBrain(brain, input)
}

/**
 * Merge new evidence into an existing brain without mutating the input.
 */
export function updateProjectBrain(
  brain: ProjectBrain,
  patch: CreateProjectBrainInput,
): ProjectBrain {
  const now = isoNow(patch.now)
  const next: ProjectBrain = {
    ...brain,
    updatedAt: now,
    plan: patch.plan ?? brain.plan,
    repairHistory: [...(brain.repairHistory || [])],
    issues: [...(brain.issues || [])],
    improvements: [...(brain.improvements || [])],
    versions: [...(brain.versions || [])],
    userRequests: [...(brain.userRequests || [])],
  }

  if (patch.fragment) {
    const files = getFragmentFiles(patch.fragment)
    next.fileTree = files.map((f) => f.file_path).slice(0, 200)
    next.primaryFile =
      (typeof patch.fragment.file_path === 'string' &&
        patch.fragment.file_path) ||
      files[0]?.file_path
    if (typeof patch.fragment.template === 'string') {
      next.template = patch.fragment.template
    }
  }

  if (patch.winnerId) {
    next.currentWinnerId = patch.winnerId
    next.currentWinnerLabel = winnerLabel(patch.winnerId)
  }

  if (patch.verification !== undefined) {
    next.verification = compactVerification(patch.verification)
  }
  if (patch.architectureCompliance !== undefined) {
    next.architectureCompliance = compactArchitecture(
      patch.architectureCompliance,
    )
  }
  if (patch.smoke !== undefined) {
    next.smoke = compactSmoke(patch.smoke)
  }

  if (patch.verdict) {
    next.judge = {
      winnerId: patch.verdict.winnerId,
      reasoning: scrubText(patch.verdict.reasoning, 400),
      scores: patch.verdict.scores.map((s) => ({
        ...s,
        comment: scrubText(s.comment, 160),
      })),
    }
    next.currentWinnerId = patch.verdict.winnerId
    next.currentWinnerLabel = winnerLabel(patch.verdict.winnerId)
  }

  const repair = compactRepair(patch.repairAttempt)
  if (repair) {
    next.repairHistory = [...next.repairHistory, repair].slice(-8)
  }

  if (patch.userRequest?.trim()) {
    next.userRequests = [
      ...next.userRequests,
      scrubText(patch.userRequest.trim(), 500),
    ].slice(-12)
  }

  return sanitizeProjectBrain(next)
}

/**
 * Record a new project version (e.g. after initial tournament win).
 * Does not invent evolution — only appends a compact version stamp.
 */
export function recordProjectVersion(
  brain: ProjectBrain,
  opts: {
    label?: string
    summary?: string
    parentVersion?: number
    previousScore?: number
    improvementDelta?: number
    userRequest?: string
    now?: string
  } = {},
): ProjectBrain {
  const now = isoNow(opts.now)
  const version = (brain.currentVersion || 0) + 1
  const winnerScore = brain.judge?.scores.find(
    (s) => s.id === brain.currentWinnerId,
  )
  const record: ProjectVersionRecord = {
    version,
    label: opts.label || (version === 1 ? 'Initial generation' : `Version ${version}`),
    createdAt: now,
    winnerId: brain.currentWinnerId,
    winnerLabel: brain.currentWinnerLabel,
    compositeScore: winnerScore?.composite,
    runtimeStatus: brain.verification?.status,
    smokeStatus: brain.smoke?.status,
    architectureStatus: brain.architectureCompliance?.status,
    summary: scrubText(opts.summary, 300) || undefined,
    parentVersion: opts.parentVersion,
    previousScore: opts.previousScore,
    improvementDelta: opts.improvementDelta,
    userRequest: opts.userRequest
      ? scrubText(opts.userRequest, 500)
      : undefined,
  }

  return sanitizeProjectBrain({
    ...brain,
    updatedAt: now,
    currentVersion: version,
    versions: [...brain.versions, record].slice(-20),
  })
}

export function recordIssue(
  brain: ProjectBrain,
  issue: Omit<ProjectIssue, 'id' | 'at'> & { id?: string; at?: string },
): ProjectBrain {
  const at = issue.at || isoNow()
  const entry: ProjectIssue = {
    id: issue.id || `issue_${brain.issues.length + 1}_${at}`,
    at,
    source: issue.source,
    severity: issue.severity,
    message: scrubText(issue.message, 400),
  }
  return sanitizeProjectBrain({
    ...brain,
    updatedAt: at,
    issues: [...brain.issues, entry].slice(-40),
  })
}

export function recordImprovement(
  brain: ProjectBrain,
  improvement: Omit<ProjectImprovement, 'id' | 'at'> & {
    id?: string
    at?: string
  },
): ProjectBrain {
  const at = improvement.at || isoNow()
  const entry: ProjectImprovement = {
    id: improvement.id || `imp_${brain.improvements.length + 1}_${at}`,
    at,
    request: scrubText(improvement.request, 500),
    note: scrubText(improvement.note, 300) || undefined,
  }
  return sanitizeProjectBrain({
    ...brain,
    updatedAt: at,
    improvements: [...brain.improvements, entry].slice(-40),
    userRequests: [
      ...brain.userRequests,
      scrubText(improvement.request, 500),
    ].slice(-12),
  })
}

export type ProjectBrainSummary = {
  productName: string
  purpose: string
  targetUsers: string
  features: string[]
  architectureStatus: string
  runtimeStatus: string
  smokeStatus: string
  currentVersion: number
  winnerLabel?: string
  judgeReasoning?: string
}

/** Compact overview for UI / future Improve-this-app prompts. */
export function summarizeProjectBrain(brain: ProjectBrain): ProjectBrainSummary {
  return {
    productName: brain.plan?.productName || 'Untitled project',
    purpose: brain.plan?.productGoal || '',
    targetUsers: brain.plan?.targetUsers || '',
    features: brain.plan?.coreFeatures?.slice(0, 12) || [],
    architectureStatus: brain.architectureCompliance?.status || 'unknown',
    runtimeStatus: brain.verification?.status || 'unknown',
    smokeStatus: brain.smoke?.status || 'unknown',
    currentVersion: brain.currentVersion || 0,
    winnerLabel: brain.currentWinnerLabel,
    judgeReasoning: brain.judge?.reasoning,
  }
}

/**
 * Strip secrets and non-serializable junk before persistence.
 * Never keeps apiKey / Authorization / Bearer tokens / env-looking secrets.
 */
export function sanitizeProjectBrain(brain: ProjectBrain): ProjectBrain {
  const json = JSON.stringify(brain)
  const scrubbed = json
    .replace(
      /((?:api[_-]?key|secret|token|password|authorization)\s*[=:]\s*)([^"\\s]+)/gi,
      '$1[redacted]',
    )
    .replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, 'Bearer [redacted]')
    .replace(/sk-[A-Za-z0-9]{10,}/g, '[redacted]')
  const parsed = JSON.parse(scrubbed) as ProjectBrain
  // Hard ban common secret keys if anything leaked into the object graph.
  const ban = (obj: any): any => {
    if (!obj || typeof obj !== 'object') return obj
    if (Array.isArray(obj)) return obj.map(ban)
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(obj)) {
      if (
        /^(apiKey|api_key|accessToken|access_token|authorization|password|secret|NVIDIA_API_KEY|OPENAI_API_KEY|GOOGLE_.*API_KEY)$/i.test(
          k,
        )
      ) {
        continue
      }
      out[k] = ban(v)
    }
    return out
  }
  return ban(parsed) as ProjectBrain
}

export function serializeProjectBrain(brain: ProjectBrain): string {
  return JSON.stringify(sanitizeProjectBrain(brain))
}

export function deserializeProjectBrain(raw: string): ProjectBrain | null {
  try {
    const parsed = JSON.parse(raw) as ProjectBrain
    if (!parsed || parsed.schemaVersion !== PROJECT_BRAIN_VERSION) return null
    return sanitizeProjectBrain({
      ...emptyBrain(parsed.updatedAt),
      ...parsed,
      fileTree: parsed.fileTree || [],
      repairHistory: parsed.repairHistory || [],
      issues: parsed.issues || [],
      improvements: parsed.improvements || [],
      versions: parsed.versions || [],
      userRequests: parsed.userRequests || [],
      currentVersion: parsed.currentVersion || 0,
    })
  } catch {
    return null
  }
}

/**
 * Build / refresh brain from a completed tournament snapshot.
 * Preserves prior improvements / userRequests / versions / active selection.
 * Does NOT auto-promote a version — user must select "Use this version" for v1.
 */
export function buildBrainFromTournament(opts: {
  plan?: ApplicationPlan | null
  fragment?: DeepPartial<FragmentSchema> | FragmentSchema | null
  winnerId?: VariantId | null
  verification?: VerificationResult | null
  architectureCompliance?: ArchitectureComplianceResult | null
  smoke?: SmokeSuiteResult | null
  verdict?: Verdict | null
  repairAttempt?: RepairAttemptRecord | null
  userRequest?: string | null
  previous?: ProjectBrain | null
  now?: string
  /** When true (legacy tests), record v1 immediately from tournament winner. */
  autoRecordInitialVersion?: boolean
}): ProjectBrain {
  const previous = opts.previous
  let brain = createProjectBrain({
    plan: opts.plan,
    fragment: opts.fragment,
    winnerId: opts.winnerId,
    verification: opts.verification,
    architectureCompliance: opts.architectureCompliance,
    smoke: opts.smoke,
    verdict: opts.verdict,
    repairAttempt: opts.repairAttempt,
    userRequest: opts.userRequest,
    now: opts.now,
  })

  if (previous) {
    brain = {
      ...brain,
      improvements: previous.improvements || [],
      userRequests: [
        ...(previous.userRequests || []),
        ...(brain.userRequests || []),
      ].slice(-12),
      versions: previous.versions || [],
      currentVersion: previous.currentVersion || 0,
      activeCandidateId: previous.activeCandidateId,
      activeCandidateLabel: previous.activeCandidateLabel,
      activeVersion: previous.activeVersion,
      // Keep prior repair history and append current attempt if new.
      repairHistory: [
        ...(previous.repairHistory || []),
        ...(brain.repairHistory || []),
      ].slice(-8),
    }
  }

  if (
    opts.autoRecordInitialVersion &&
    brain.currentVersion === 0 &&
    (opts.winnerId || opts.verdict?.winnerId)
  ) {
    brain = recordProjectVersion(brain, {
      label: 'Initial generation',
      summary: opts.verdict?.reasoning,
      now: opts.now,
    })
    const id = (opts.winnerId || opts.verdict?.winnerId) as VariantId
    brain = {
      ...brain,
      activeCandidateId: id,
      activeCandidateLabel: winnerLabel(id),
      activeVersion: brain.currentVersion,
    }
  }

  // Fresh derived issues from current evidence (not accumulated across rebuilds).
  brain = { ...brain, issues: [] }
  if (opts.verification?.status === 'failed') {
    for (const err of opts.verification.errors.slice(0, 5)) {
      brain = recordIssue(brain, {
        source: 'runtime',
        severity: 'error',
        message: err,
        at: opts.now,
      })
    }
  }
  if (opts.architectureCompliance?.status === 'failed') {
    brain = recordIssue(brain, {
      source: 'architecture',
      severity: 'error',
      message:
        opts.architectureCompliance.summary || 'Architecture compliance failed',
      at: opts.now,
    })
  }
  if (
    opts.smoke &&
    (opts.smoke.status === 'failed' || opts.smoke.status === 'timeout')
  ) {
    brain = recordIssue(brain, {
      source: 'smoke',
      severity: 'warning',
      message: opts.smoke.summary || `Smoke ${opts.smoke.status}`,
      at: opts.now,
    })
  }

  return sanitizeProjectBrain(brain)
}

/**
 * User confirms a tournament specimen as the active project version.
 * Creates v1 on first selection; later calls only switch active metadata.
 */
export function selectActiveProjectVersion(
  brain: ProjectBrain,
  opts: {
    candidateId: VariantId
    fragment?: DeepPartial<FragmentSchema> | FragmentSchema | null
    verification?: VerificationResult | null
    architectureCompliance?: ArchitectureComplianceResult | null
    smoke?: SmokeSuiteResult | null
    scoreComposite?: number
    summary?: string
    now?: string
  },
): ProjectBrain {
  const now = isoNow(opts.now)
  const label = winnerLabel(opts.candidateId)
  let next: ProjectBrain = {
    ...brain,
    updatedAt: now,
    activeCandidateId: opts.candidateId,
    activeCandidateLabel: label,
    currentWinnerId: opts.candidateId,
    currentWinnerLabel: label,
  }

  if (opts.fragment) {
    const files = getFragmentFiles(opts.fragment)
    next.fileTree = files.map((f) => f.file_path).slice(0, 200)
    next.primaryFile =
      (typeof opts.fragment.file_path === 'string' &&
        opts.fragment.file_path) ||
      files[0]?.file_path
    if (typeof opts.fragment.template === 'string') {
      next.template = opts.fragment.template
    }
  }
  if (opts.verification) {
    next.verification = compactVerification(opts.verification)
  }
  if (opts.architectureCompliance) {
    next.architectureCompliance = compactArchitecture(
      opts.architectureCompliance,
    )
  }
  if (opts.smoke) {
    next.smoke = compactSmoke(opts.smoke)
  }
  if (opts.scoreComposite != null && next.judge) {
    next.judge = {
      ...next.judge,
      winnerId: opts.candidateId,
    }
  }

  if (next.currentVersion === 0) {
    next = recordProjectVersion(next, {
      label: `${label} selected`,
      summary: opts.summary || `${label} is now your active version.`,
      now,
    })
    // Stamp composite onto the version record when known.
    if (opts.scoreComposite != null && next.versions.length > 0) {
      const versions = [...next.versions]
      const last = versions[versions.length - 1]
      versions[versions.length - 1] = {
        ...last,
        compositeScore: opts.scoreComposite,
        winnerId: opts.candidateId,
        winnerLabel: label,
      }
      next = { ...next, versions }
    }
  }

  next = {
    ...next,
    activeVersion: next.currentVersion,
  }

  return sanitizeProjectBrain(next)
}

/** Future Improve-this-app consumers can read this shape without scraping the DOM. */
export function getProjectBrainContextForIteration(brain: ProjectBrain): {
  summary: ProjectBrainSummary
  plan?: ApplicationPlan
  fileTree: string[]
  currentVersion: number
  activeCandidateId?: VariantId
  activeVersion?: number
  knownIssues: string[]
  recentRequests: string[]
} {
  const summary = summarizeProjectBrain(brain)
  return {
    summary,
    plan: brain.plan,
    fileTree: brain.fileTree,
    currentVersion: brain.currentVersion,
    activeCandidateId: brain.activeCandidateId,
    activeVersion: brain.activeVersion ?? brain.currentVersion,
    knownIssues: brain.issues.map((i) => i.message).slice(-10),
    recentRequests: brain.userRequests.slice(-5),
  }
}

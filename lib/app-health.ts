/**
 * EvoStack App Health — deterministic 0–100 score from existing project signals.
 *
 * ZERO LLM / provider / E2B / network calls.
 *
 * ## Scoring formula (documented)
 *
 * Each dimension scores 0–100 or is `null` (not measured).
 * Missing dimensions are EXCLUDED from the weighted average — never treated as 0.
 *
 * Base weights (re-normalized over measured dims only):
 * | Dimension            | Weight |
 * |----------------------|--------|
 * | Runtime Reliability  | 0.25   |
 * | Architecture         | 0.20   |
 * | Smoke Tests          | 0.20   |
 * | Requirements         | 0.15   |
 * | Quality (judge)      | 0.10   |
 * | Repair Stability     | 0.10   |
 *
 * Final score = round( Σ (score_i × weight_i) / Σ weight_i ) for measured i.
 * Always clamped to [0, 100].
 */
import type { ProjectBrain } from '@/lib/project-brain'
import { scrubSecrets } from '@/lib/source-diff'
import type { VariantId } from '@/lib/tournament'
import type { VersionSnapshot } from '@/lib/version-vault'

export type AppHealthStatus =
  | 'excellent'
  | 'good'
  | 'needs_attention'
  | 'poor'

export type HealthDimensionId =
  | 'runtime'
  | 'architecture'
  | 'smoke'
  | 'requirements'
  | 'quality'
  | 'repair'

export type HealthDimension = {
  id: HealthDimensionId
  label: string
  /** 0–100, or null when not measured. */
  score: number | null
  measured: boolean
  note?: string
}

export type AppHealthRecommendation = {
  id: string
  title: string
  explanation: string
  priority: 'high' | 'medium' | 'low'
  improveRequest: string
  icon: 'ui' | 'ux' | 'speed' | 'quality' | 'architecture' | 'runtime'
}

export type AppHealthReport = {
  score: number
  status: AppHealthStatus
  statusLabel: string
  activeVersion?: number
  calculatedAt: string
  dimensions: HealthDimension[]
  recommendations: AppHealthRecommendation[]
  /** True when judge/quality was unavailable (common after single-candidate Improve). */
  qualityUnavailable: boolean
}

/** Documented base weights — re-normalized when dims are missing. */
export const APP_HEALTH_WEIGHTS: Record<HealthDimensionId, number> = {
  runtime: 0.25,
  architecture: 0.2,
  smoke: 0.2,
  requirements: 0.15,
  quality: 0.1,
  repair: 0.1,
}

const DIMENSION_LABELS: Record<HealthDimensionId, string> = {
  runtime: 'Runtime Reliability',
  architecture: 'Architecture',
  smoke: 'Smoke Tests',
  requirements: 'Requirements',
  quality: 'Quality',
  repair: 'Repair Stability',
}

export function healthStatusFromScore(score: number): AppHealthStatus {
  if (score >= 90) return 'excellent'
  if (score >= 75) return 'good'
  if (score >= 60) return 'needs_attention'
  return 'poor'
}

export function healthStatusLabel(status: AppHealthStatus): string {
  switch (status) {
    case 'excellent':
      return 'Excellent'
    case 'good':
      return 'Good'
    case 'needs_attention':
      return 'Needs attention'
    case 'poor':
      return 'Poor'
  }
}

function clampScore(n: number): number {
  if (Number.isNaN(n)) return 0
  return Math.max(0, Math.min(100, Math.round(n)))
}

function scoreRuntime(brain: ProjectBrain): HealthDimension {
  const v = brain.verification
  if (!v?.status) {
    return {
      id: 'runtime',
      label: DIMENSION_LABELS.runtime,
      score: null,
      measured: false,
      note: 'not measured',
    }
  }
  let score = 50
  if (v.status === 'passed') score = v.previewReachable ? 100 : 92
  else if (v.status === 'partial') score = v.previewReachable ? 72 : 65
  else if (v.status === 'failed') score = 18
  if (v.errors?.length) score = Math.min(score, v.status === 'failed' ? 18 : score - 5)
  if (v.warnings?.length && v.status !== 'failed') score = Math.max(0, score - 4)
  return {
    id: 'runtime',
    label: DIMENSION_LABELS.runtime,
    score: clampScore(score),
    measured: true,
    note: v.status,
  }
}

function scoreArchitecture(brain: ProjectBrain): HealthDimension {
  const a = brain.architectureCompliance
  if (!a?.status) {
    return {
      id: 'architecture',
      label: DIMENSION_LABELS.architecture,
      score: null,
      measured: false,
      note: 'not measured',
    }
  }
  let score = 50
  if (a.status === 'passed') score = 100
  else if (a.status === 'partial') score = 68
  else if (a.status === 'failed') score = 22
  return {
    id: 'architecture',
    label: DIMENSION_LABELS.architecture,
    score: clampScore(score),
    measured: true,
    note: scrubSecrets(a.summary || a.status).slice(0, 160),
  }
}

function scoreSmoke(brain: ProjectBrain): HealthDimension {
  const s = brain.smoke
  if (!s?.status) {
    return {
      id: 'smoke',
      label: DIMENSION_LABELS.smoke,
      score: null,
      measured: false,
      note: 'not measured',
    }
  }
  // not_testable = environment couldn't measure — do not pretend pass/fail.
  if (s.status === 'not_testable') {
    return {
      id: 'smoke',
      label: DIMENSION_LABELS.smoke,
      score: null,
      measured: false,
      note: 'not measured',
    }
  }
  let score = 50
  if (s.status === 'passed') score = 100
  else if (s.status === 'failed' || s.status === 'timeout') score = 28
  return {
    id: 'smoke',
    label: DIMENSION_LABELS.smoke,
    score: clampScore(score),
    measured: true,
    note: scrubSecrets(s.summary || s.status).slice(0, 160),
  }
}

function scoreRequirements(brain: ProjectBrain): HealthDimension {
  const contracts = brain.plan?.interactionContracts || []
  const smoke = brain.smoke?.status
  const features = brain.plan?.coreFeatures?.length || 0

  if (!contracts.length && !smoke && features === 0) {
    return {
      id: 'requirements',
      label: DIMENSION_LABELS.requirements,
      score: null,
      measured: false,
      note: 'not measured',
    }
  }

  // Derive from contracts + smoke/issue signals only — no invented pass.
  let score: number | null = null
  if (contracts.length > 0) {
    if (smoke === 'passed') score = 96
    else if (smoke === 'failed' || smoke === 'timeout') score = 38
    else if (smoke === 'not_testable') score = 72
    else score = 70 // contracts exist but smoke not run
  } else if (smoke === 'passed') {
    score = 88
  } else if (smoke === 'failed' || smoke === 'timeout') {
    score = 42
  } else if (features > 0 && brain.verification?.status === 'passed') {
    score = 80
  } else if (features > 0) {
    score = 60
  }

  if (score == null) {
    return {
      id: 'requirements',
      label: DIMENSION_LABELS.requirements,
      score: null,
      measured: false,
      note: 'not measured',
    }
  }

  const contractIssues = (brain.issues || []).filter(
    (i) =>
      i.source === 'smoke' ||
      /contract|requirement|accessible name/i.test(i.message),
  )
  if (contractIssues.length) score = Math.max(20, score - contractIssues.length * 8)

  return {
    id: 'requirements',
    label: DIMENSION_LABELS.requirements,
    score: clampScore(score),
    measured: true,
    note:
      contracts.length > 0
        ? `${contracts.length} contract(s)`
        : 'plan features',
  }
}

function scoreQuality(brain: ProjectBrain): HealthDimension {
  const id =
    brain.activeCandidateId ||
    brain.currentWinnerId ||
    brain.judge?.winnerId
  const entry = brain.judge?.scores?.find((s) => s.id === id)
  // Prefer active candidate; fall back to winner score if present.
  const composite =
    entry?.composite ??
    brain.judge?.scores?.find((s) => s.id === brain.judge?.winnerId)
      ?.composite

  if (composite == null || Number.isNaN(composite)) {
    return {
      id: 'quality',
      label: DIMENSION_LABELS.quality,
      score: null,
      measured: false,
      note: 'not measured',
    }
  }

  return {
    id: 'quality',
    label: DIMENSION_LABELS.quality,
    score: clampScore(composite * 100),
    measured: true,
    note: 'judge composite',
  }
}

function scoreRepair(brain: ProjectBrain): HealthDimension {
  const history = brain.repairHistory || []
  const hasRuntimeSignal = !!brain.verification?.status

  if (!hasRuntimeSignal && history.length === 0) {
    return {
      id: 'repair',
      label: DIMENSION_LABELS.repair,
      score: null,
      measured: false,
      note: 'not measured',
    }
  }

  if (history.length === 0) {
    // Verified without needing repair → stable.
    return {
      id: 'repair',
      label: DIMENSION_LABELS.repair,
      score: 100,
      measured: true,
      note: 'no repair needed',
    }
  }

  const latest = history[history.length - 1]
  let score = 70
  if (latest.success) score = 78
  else score = 36
  // Accumulated repairs across versions slightly reduce stability signal.
  if (history.length > 1) score = Math.max(25, score - (history.length - 1) * 6)

  return {
    id: 'repair',
    label: DIMENSION_LABELS.repair,
    score: clampScore(score),
    measured: true,
    note: latest.success ? 'repaired' : 'repair failed',
  }
}

/**
 * Weighted average over measured dimensions only.
 * Missing (null) dimensions redistribute weight — never score as zero.
 */
export function combineHealthScores(dimensions: HealthDimension[]): number {
  let weightSum = 0
  let weighted = 0
  for (const d of dimensions) {
    if (!d.measured || d.score == null) continue
    const w = APP_HEALTH_WEIGHTS[d.id] ?? 0
    weightSum += w
    weighted += d.score * w
  }
  if (weightSum <= 0) return 0
  return clampScore(weighted / weightSum)
}

function pushRec(
  list: AppHealthRecommendation[],
  item: AppHealthRecommendation,
  max = 3,
) {
  if (list.length >= max) return
  if (list.some((x) => x.id === item.id)) return
  list.push({
    ...item,
    title: scrubSecrets(item.title).slice(0, 80),
    explanation: scrubSecrets(item.explanation).slice(0, 240),
    improveRequest: scrubSecrets(item.improveRequest).slice(0, 500),
  })
}

/**
 * Deterministic recommendations from health weaknesses (max 3).
 * Never calls a model.
 */
export function buildHealthRecommendations(
  brain: ProjectBrain,
  dimensions: HealthDimension[],
): AppHealthRecommendation[] {
  const out: AppHealthRecommendation[] = []
  const byId = Object.fromEntries(dimensions.map((d) => [d.id, d])) as Record<
    HealthDimensionId,
    HealthDimension
  >

  if (byId.runtime?.measured && (byId.runtime.score ?? 100) < 70) {
    pushRec(out, {
      id: 'fix-runtime',
      title: 'Fix runtime reliability',
      explanation:
        brain.verification?.errors?.[0] ||
        'Runtime verification is weak — stabilize boot and preview.',
      priority: 'high',
      improveRequest:
        'Fix runtime reliability so the app boots cleanly and the preview stays reachable without changing the product goal.',
      icon: 'runtime',
    })
  }

  if (byId.architecture?.measured && (byId.architecture.score ?? 100) < 70) {
    pushRec(out, {
      id: 'fix-architecture',
      title: 'Improve architecture',
      explanation:
        brain.architectureCompliance?.summary ||
        'Architecture compliance needs attention.',
      priority: 'high',
      improveRequest:
        'Improve architecture compliance so the implementation matches the shared ApplicationPlan without unnecessary infrastructure.',
      icon: 'architecture',
    })
  }

  if (byId.smoke?.measured && (byId.smoke.score ?? 100) < 70) {
    const mobileish =
      /mobile|nav|responsive/i.test(brain.smoke?.summary || '') ||
      (brain.plan?.pages?.length || 0) > 1
    pushRec(out, {
      id: mobileish ? 'improve-mobile' : 'fix-interactions',
      title: mobileish ? 'Improve mobile experience' : 'Improve interaction flow',
      explanation:
        brain.smoke?.summary ||
        'Smoke tests indicate interaction or accessibility gaps.',
      priority: 'high',
      improveRequest: mobileish
        ? 'Improve the mobile experience: responsive layout, clearer mobile navigation, and reliable primary actions.'
        : 'Fix failing smoke/interaction flows. Keep accessible names aligned with interaction contracts.',
      icon: mobileish ? 'ux' : 'speed',
    })
  }

  if (
    byId.requirements?.measured &&
    (byId.requirements.score ?? 100) < 75 &&
    out.length < 3
  ) {
    pushRec(out, {
      id: 'honor-requirements',
      title: 'Strengthen requirements coverage',
      explanation: 'Core features or interaction contracts need tighter coverage.',
      priority: 'medium',
      improveRequest:
        'Strengthen requirements coverage: implement missing core features and keep interaction contract accessible names exact.',
      icon: 'ux',
    })
  }

  if (
    byId.repair?.measured &&
    (byId.repair.score ?? 100) < 60 &&
    out.length < 3
  ) {
    pushRec(out, {
      id: 'stabilize-repairs',
      title: 'Improve repair stability',
      explanation: 'Recent repair attempts suggest fragile generation output.',
      priority: 'medium',
      improveRequest:
        'Improve code robustness so the app verifies cleanly without relying on repair — clearer structure and fewer brittle edge cases.',
      icon: 'quality',
    })
  }

  // Soft UX opportunities when health is already strong.
  if (out.length === 0) {
    pushRec(out, {
      id: 'ux-improvements',
      title: 'Look for UX improvements',
      explanation:
        'No critical weaknesses detected — refine clarity and polish.',
      priority: 'low',
      improveRequest:
        'Look for UX improvements: clearer hierarchy, better empty states, and smoother primary task flow without changing core features.',
      icon: 'ux',
    })
    pushRec(out, {
      id: 'visual-hierarchy',
      title: 'Improve visual hierarchy',
      explanation: 'Tighten typography and spacing for a more productized feel.',
      priority: 'low',
      improveRequest:
        'Improve visual hierarchy: consistent spacing, stronger headings, and a cleaner primary view.',
      icon: 'ui',
    })
    pushRec(out, {
      id: 'mobile-ux',
      title: 'Improve mobile UX',
      explanation: 'Make the active layout more comfortable on small screens.',
      priority: 'low',
      improveRequest:
        'Improve mobile UX: responsive layout, readable tap targets, and clearer mobile navigation.',
      icon: 'ux',
    })
  }

  return out.slice(0, 3)
}

/**
 * Optionally overlay vault snapshot status when brain signals are thin
 * (e.g. after restore). Does not invent pass marks.
 */
function applySnapshotHints(
  brain: ProjectBrain,
  snapshot?: VersionSnapshot | null,
): ProjectBrain {
  if (!snapshot) return brain
  return {
    ...brain,
    verification: brain.verification?.status
      ? brain.verification
      : snapshot.runtimeStatus
        ? {
            status: snapshot.runtimeStatus as any,
            previewReachable: snapshot.previewReachable ?? false,
            errors: [],
            warnings: [],
            durationMs: 0,
          }
        : brain.verification,
    architectureCompliance: brain.architectureCompliance?.status
      ? brain.architectureCompliance
      : snapshot.architectureStatus
        ? {
            status: snapshot.architectureStatus as any,
            summary: snapshot.summary || '',
          }
        : brain.architectureCompliance,
    smoke: brain.smoke?.status
      ? brain.smoke
      : snapshot.smokeStatus
        ? {
            status: snapshot.smokeStatus as any,
            summary: snapshot.smokeStatus,
          }
        : brain.smoke,
    activeVersion: brain.activeVersion ?? snapshot.version,
  }
}

/**
 * Calculate App Health for the ACTIVE version from existing data only.
 */
export function calculateAppHealth(opts: {
  brain: ProjectBrain
  snapshot?: VersionSnapshot | null
  now?: string
}): AppHealthReport {
  const brain = applySnapshotHints(opts.brain, opts.snapshot)
  const dimensions: HealthDimension[] = [
    scoreRuntime(brain),
    scoreArchitecture(brain),
    scoreSmoke(brain),
    scoreRequirements(brain),
    scoreQuality(brain),
    scoreRepair(brain),
  ]

  const score = combineHealthScores(dimensions)
  const status = healthStatusFromScore(score)
  const qualityUnavailable = !dimensions.find((d) => d.id === 'quality')?.measured

  return {
    score,
    status,
    statusLabel: healthStatusLabel(status),
    activeVersion: brain.activeVersion ?? brain.currentVersion,
    calculatedAt: opts.now || new Date().toISOString(),
    dimensions,
    recommendations: buildHealthRecommendations(brain, dimensions),
    qualityUnavailable,
  }
}

/** Compact ephemeral summary — safe to show; no secrets / source bodies. */
export function summarizeAppHealth(report: AppHealthReport): {
  score: number
  status: AppHealthStatus
  activeVersion?: number
  at: string
} {
  return {
    score: report.score,
    status: report.status,
    activeVersion: report.activeVersion,
    at: report.calculatedAt,
  }
}

/** Guard for tests — health JSON must never leak secrets. */
export function healthOutputIsSecretFree(report: AppHealthReport): boolean {
  const raw = JSON.stringify(report)
  if (/sk-[A-Za-z0-9]{10,}/.test(raw)) return false
  if (/Bearer\s+[A-Za-z0-9\-._~+/]{8,}/.test(raw)) return false
  if (/"apiKey"\s*:/.test(raw)) return false
  return true
}

/**
 * Deterministic Evolution Report — derived from round + source diff + evidence.
 * Never calls an LLM.
 */
import {
  computeImprovementDelta,
  scoreToPoints,
  type EvolutionRound,
} from '@/lib/evolution'
import type { ProjectBrain, ProjectVersionRecord } from '@/lib/project-brain'
import { smokePassCount } from '@/lib/smoke'
import type { SourceDiff } from '@/lib/source-diff'
import { scrubSecrets, summarizeSourceDiff } from '@/lib/source-diff'
import type { SmokeSuiteResult } from '@/lib/smoke'
import type { Verdict } from '@/lib/tournament'

export type EvolutionReportSection = {
  id: 'ui' | 'ux' | 'functional' | 'architecture' | 'verification'
  title: string
  items: string[]
}

export type VersionScoreRow = {
  version: number
  label: string
  score?: number
  runtime?: string
  smokeLabel?: string
  isWinner?: boolean
  parentVersion?: number
  improvementDelta?: number
  userRequest?: string
  summary?: string
  winnerLabel?: string
}

export type EvolutionReport = {
  roundNumber: number
  parentVersion: number
  newVersion: number
  previousScore?: number
  newScore?: number
  improvementDelta?: number
  userRequest: string
  winnerLabel?: string
  winnerId?: string
  judgeReasoning?: string
  sections: EvolutionReportSection[]
  diffSummary: ReturnType<typeof summarizeSourceDiff>
  scoreComparison: VersionScoreRow[]
}

export type EvolutionEvidence = {
  parentRuntime?: string
  parentArchitecture?: string
  parentSmoke?: SmokeSuiteResult | null
  winnerRuntime?: string
  winnerArchitecture?: string
  winnerSmoke?: SmokeSuiteResult | null
  verdict?: Verdict | null
  newVersion?: number
}

function pathLooksUi(path: string): boolean {
  return (
    /\.(css|scss|sass|less)$/i.test(path) ||
    /(theme|style|layout|dashboard|chart|icon|badge|card)/i.test(path)
  )
}

function pathLooksUx(path: string): boolean {
  return /(nav|modal|dialog|form|sidebar|header|footer|mobile|responsive)/i.test(
    path,
  )
}

function pathLooksFunctional(path: string): boolean {
  return (
    /(^|\/)(lib|hooks|api|store|utils|services|data)\//i.test(path) ||
    /\.(py|sql|prisma)$/i.test(path)
  )
}

function classifyChange(path: string): 'ui' | 'ux' | 'functional' {
  if (pathLooksFunctional(path)) return 'functional'
  if (pathLooksUx(path)) return 'ux'
  if (pathLooksUi(path)) return 'ui'
  // Default page/component edits → UI + UX notes handled by dual tagging in builder.
  if (/(^|\/)(pages|app|components)\//i.test(path)) return 'ui'
  return 'functional'
}

function formatSmoke(suite?: SmokeSuiteResult | null): string {
  if (!suite) return '—'
  const { passed, total } = smokePassCount(suite)
  if (total > 0) return `${passed}/${total}`
  if (suite.status === 'passed') return '✓'
  if (suite.status === 'not_testable') return 'n/a'
  if (suite.status === 'failed' || suite.status === 'timeout') return '✗'
  return suite.status
}

function statusMark(status?: string): string {
  if (!status || status === 'unknown') return '—'
  if (status === 'passed' || status === 'partial' || status === 'not_testable') {
    return '✓'
  }
  if (status === 'failed' || status === 'timeout') return '✗'
  return status
}

/**
 * Build a deterministic evolution report from existing data only.
 */
export function buildEvolutionReport(opts: {
  round: EvolutionRound
  diff: SourceDiff
  evidence?: EvolutionEvidence
}): EvolutionReport {
  const { round, diff, evidence } = opts
  const newVersion =
    evidence?.newVersion ??
    (round.parentVersion > 0 ? round.parentVersion + 1 : 1)

  const ui: string[] = []
  const ux: string[] = []
  const functional: string[] = []

  for (const path of diff.addedFiles) {
    const file = diff.files.find((f) => f.path === path)
    const lines = file ? ` (+${file.addedLines} lines)` : ''
    const note = `Added ${path}${lines}`
    const kind = classifyChange(path)
    if (kind === 'ui') ui.push(note)
    else if (kind === 'ux') ux.push(note)
    else functional.push(note)
    if (/(^|\/)(pages|app|components)\//i.test(path) && kind === 'ui') {
      ux.push(`Updated surface: ${path}`)
    }
  }
  for (const path of diff.modifiedFiles) {
    const file = diff.files.find((f) => f.path === path)
    const lines = file
      ? ` (+${file.addedLines}/−${file.removedLines})`
      : ''
    const note = `Modified ${path}${lines}`
    const kind = classifyChange(path)
    if (kind === 'ui') ui.push(note)
    else if (kind === 'ux') ux.push(note)
    else functional.push(note)
  }
  for (const path of diff.removedFiles) {
    const note = `Removed ${path}`
    const kind = classifyChange(path)
    if (kind === 'ui') ui.push(note)
    else if (kind === 'ux') ux.push(note)
    else functional.push(note)
  }

  if (ui.length === 0 && diff.modifiedFiles.length + diff.addedFiles.length > 0) {
    ui.push('Visual/structure files touched (see source diff)')
  }
  if (
    functional.length === 0 &&
    diff.addedLines + diff.removedLines > 0 &&
    ui.length === 0
  ) {
    functional.push(
      `${diff.addedLines} lines added, ${diff.removedLines} removed across ${diff.modifiedFiles.length + diff.addedFiles.length + diff.removedFiles.length} files`,
    )
  }

  const architectureItems: string[] = []
  const parentArch = evidence?.parentArchitecture || 'unknown'
  const winnerArch = evidence?.winnerArchitecture || 'unknown'
  architectureItems.push(
    `Parent: ${statusMark(parentArch)} ${parentArch}`,
  )
  architectureItems.push(
    `Evolved: ${statusMark(winnerArch)} ${winnerArch}`,
  )
  if (parentArch !== winnerArch) {
    architectureItems.push(`Status changed ${parentArch} → ${winnerArch}`)
  } else {
    architectureItems.push('Architecture compliance status unchanged')
  }

  const verificationItems: string[] = []
  const parentRt = evidence?.parentRuntime || 'unknown'
  const winnerRt = evidence?.winnerRuntime || 'unknown'
  verificationItems.push(`Runtime ${parentRt} → ${winnerRt}`)
  verificationItems.push(
    `Smoke ${formatSmoke(evidence?.parentSmoke)} → ${formatSmoke(evidence?.winnerSmoke)}`,
  )
  if (evidence?.verdict?.reasoning) {
    verificationItems.push(scrubSecrets(evidence.verdict.reasoning).slice(0, 240))
  }

  const sections: EvolutionReportSection[] = [
    { id: 'ui', title: 'UI changes', items: ui.length ? ui : ['No UI file changes detected'] },
    { id: 'ux', title: 'UX changes', items: ux.length ? ux : ['No UX-oriented path changes detected'] },
    {
      id: 'functional',
      title: 'Functional changes',
      items: functional.length
        ? functional
        : ['No functional/lib path changes detected'],
    },
    { id: 'architecture', title: 'Architecture status', items: architectureItems },
    { id: 'verification', title: 'Verification status', items: verificationItems },
  ]

  const scoreComparison: VersionScoreRow[] = [
    {
      version: round.parentVersion,
      label: `v${round.parentVersion}`,
      score: round.previousScore,
      runtime: parentRt,
      smokeLabel: formatSmoke(evidence?.parentSmoke),
    },
    {
      version: newVersion,
      label: `v${newVersion}`,
      score: round.newScore,
      runtime: winnerRt,
      smokeLabel: formatSmoke(evidence?.winnerSmoke),
      isWinner: true,
      parentVersion: round.parentVersion,
      improvementDelta: round.improvementDelta,
      userRequest: round.userRequest,
      winnerLabel: round.winnerLabel,
      summary: evidence?.verdict?.reasoning
        ? scrubSecrets(evidence.verdict.reasoning).slice(0, 240)
        : undefined,
    },
  ]

  return {
    roundNumber: round.roundNumber,
    parentVersion: round.parentVersion,
    newVersion,
    previousScore: round.previousScore,
    newScore: round.newScore,
    improvementDelta:
      round.improvementDelta ??
      computeImprovementDelta(round.previousScore, round.newScore),
    userRequest: scrubSecrets(round.userRequest),
    winnerLabel: round.winnerLabel,
    winnerId: round.winnerId,
    judgeReasoning: evidence?.verdict?.reasoning
      ? scrubSecrets(evidence.verdict.reasoning).slice(0, 400)
      : undefined,
    sections,
    diffSummary: summarizeSourceDiff(diff),
    scoreComparison,
  }
}

/** Version history rows from Project Brain (metadata only — no source bodies). */
export function buildVersionHistory(brain: ProjectBrain): VersionScoreRow[] {
  return (brain.versions || []).map((v: ProjectVersionRecord, idx, arr) => ({
    version: v.version,
    label: v.label,
    score:
      v.compositeScore != null
        ? scoreToPoints(v.compositeScore)
        : v.previousScore != null && v.improvementDelta != null
          ? v.previousScore + v.improvementDelta
          : undefined,
    runtime: v.runtimeStatus,
    smokeLabel: v.smokeStatus
      ? statusMark(v.smokeStatus) + ' ' + v.smokeStatus
      : undefined,
    isWinner: idx === arr.length - 1,
    parentVersion: v.parentVersion,
    improvementDelta: v.improvementDelta,
    userRequest: v.userRequest,
    summary: v.summary,
    winnerLabel: v.winnerLabel,
  }))
}

/** Ensure failed evolution did not append a version (helper for tests/UI). */
export function versionCountUnchanged(
  before: number,
  afterBrain: ProjectBrain,
): boolean {
  return afterBrain.currentVersion === before
}

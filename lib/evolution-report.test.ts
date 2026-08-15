/**
 * Deterministic evolution-report tests (no LLM / E2B).
 * Run: npm run test:evolution-report
 */
import assert from 'node:assert/strict'
import { architecturePreset } from './architecture'
import {
  applyEvolutionToBrain,
  completeEvolutionRound,
  createEvolutionRound,
  failEvolutionRound,
  preserveBrainAfterFailedEvolution,
} from './evolution'
import {
  buildEvolutionReport,
  buildVersionHistory,
  versionCountUnchanged,
} from './evolution-report'
import {
  createProjectBrain,
  selectActiveProjectVersion,
  serializeProjectBrain,
} from './project-brain'
import { diffFragments } from './source-diff'
import type { ApplicationPlan } from './plan'
import type { Verdict } from './tournament'

const FIXED_NOW = '2026-08-15T14:00:00.000Z'

function plan(): ApplicationPlan {
  return {
    applicationType: 'utility',
    complexity: 'simple',
    productName: 'Attendance Manager',
    productGoal: 'Manage attendance',
    targetUsers: 'Teachers',
    problemStatement: 'Manual tracking',
    primaryUserGoal: 'Mark attendance',
    coreFeatures: ['Tracking'],
    secondaryFeatures: [],
    outOfScope: [],
    pages: [{ name: 'Home', path: '/', purpose: 'Dash' }],
    userFlows: ['open'],
    dataApproach: 'localStorage',
    needsAuth: false,
    needsBackend: false,
    architectureRequirements: architecturePreset('calculator'),
    architectureSummary: 'fe',
    designDirection: {
      tone: 'calm',
      typography: 'sans',
      colorApproach: 'neutral',
      componentStyle: 'compact',
      interactionStyle: 'direct',
    },
    sampleDataNotes: 'names',
    mustHaveInteractions: [],
    interactionContracts: [],
    documentation: 'none',
  }
}

function frag(files: Array<{ file_path: string; file_content: string }>) {
  return {
    title: 'Attendance',
    template: 'nextjs-developer',
    file_path: files[0]?.file_path || 'pages/index.tsx',
    code: files,
  }
}

const parentFrag = frag([
  {
    file_path: 'pages/index.tsx',
    file_content: 'export default function Page(){return <main/>}\n',
  },
  {
    file_path: 'components/OldStats.tsx',
    file_content: 'export function OldStats(){return null}\n',
  },
])

const evolvedFrag = frag([
  {
    file_path: 'pages/index.tsx',
    file_content:
      'export default function Page(){return <main><Dashboard/></main>}\n',
  },
  {
    file_path: 'components/Dashboard.tsx',
    file_content: 'export function Dashboard(){return <section/>}\n',
  },
  {
    file_path: 'components/AttendanceChart.tsx',
    file_content: 'export function AttendanceChart(){return <div/>}\n',
  },
])

function verdict(): Verdict {
  return {
    winnerId: 'rich',
    reasoning: 'Premium modernized the dashboard.',
    scores: [
      {
        id: 'minimal',
        clarity: 0.8,
        fit: 0.8,
        polish: 0.8,
        composite: 0.8,
        comment: 'ok',
      },
      {
        id: 'rich',
        clarity: 0.93,
        fit: 0.93,
        polish: 0.93,
        composite: 0.93,
        comment: 'best',
      },
      {
        id: 'playful',
        clarity: 0.85,
        fit: 0.85,
        polish: 0.85,
        composite: 0.85,
        comment: 'fine',
      },
    ],
  }
}

function parentBrain() {
  let brain = createProjectBrain({
    plan: plan(),
    fragment: parentFrag as any,
    winnerId: 'rich',
    verification: {
      status: 'passed',
      filesWritten: true,
      dependenciesInstalled: true,
      processStarted: true,
      previewReachable: true,
      errors: [],
      warnings: [],
      durationMs: 1,
    },
    verdict: {
      winnerId: 'rich',
      reasoning: 'v1',
      scores: [
        {
          id: 'minimal',
          clarity: 0.8,
          fit: 0.8,
          polish: 0.8,
          composite: 0.8,
          comment: 'a',
        },
        {
          id: 'rich',
          clarity: 0.84,
          fit: 0.84,
          polish: 0.84,
          composite: 0.84,
          comment: 'b',
        },
        {
          id: 'playful',
          clarity: 0.7,
          fit: 0.7,
          polish: 0.7,
          composite: 0.7,
          comment: 'c',
        },
      ],
    },
    now: FIXED_NOW,
  })
  brain = selectActiveProjectVersion(brain, {
    candidateId: 'rich',
    fragment: parentFrag as any,
    scoreComposite: 0.84,
    now: FIXED_NOW,
  })
  return brain
}

// 7. Version score delta
{
  const brain = parentBrain()
  let round = createEvolutionRound({
    brain,
    userRequest: 'Make the dashboard more modern and add a monthly attendance chart.',
    now: FIXED_NOW,
  })
  round = completeEvolutionRound(round, { verdict: verdict(), now: FIXED_NOW })
  assert.equal(round.previousScore, 84)
  assert.equal(round.newScore, 93)
  assert.equal(round.improvementDelta, 9)
}

// 8. Successful evolution report
{
  const brain = parentBrain()
  let round = createEvolutionRound({
    brain,
    userRequest: 'Make the dashboard more modern and add a monthly attendance chart.',
    now: FIXED_NOW,
  })
  round = completeEvolutionRound(round, { verdict: verdict(), now: FIXED_NOW })
  const diff = diffFragments(parentFrag as any, evolvedFrag as any)
  const report = buildEvolutionReport({
    round,
    diff,
    evidence: {
      parentRuntime: 'passed',
      parentArchitecture: 'passed',
      parentSmoke: {
        status: 'passed',
        tests: Array.from({ length: 18 }, (_, i) => ({
          status: i < 16 ? ('passed' as const) : ('failed' as const),
          testName: `t${i}`,
          durationMs: 1,
          completedActions: 1,
        })),
        durationMs: 1,
        summary: '16/18',
      },
      winnerRuntime: 'passed',
      winnerArchitecture: 'passed',
      winnerSmoke: {
        status: 'passed',
        tests: Array.from({ length: 18 }, (_, i) => ({
          status: 'passed' as const,
          testName: `t${i}`,
          durationMs: 1,
          completedActions: 1,
        })),
        durationMs: 1,
        summary: '18/18',
      },
      verdict: verdict(),
      newVersion: 2,
    },
  })

  assert.equal(report.parentVersion, 1)
  assert.equal(report.newVersion, 2)
  assert.equal(report.previousScore, 84)
  assert.equal(report.newScore, 93)
  assert.equal(report.improvementDelta, 9)
  assert.equal(report.winnerLabel, 'Premium')
  assert.match(report.userRequest, /monthly attendance chart/)
  assert.ok(report.diffSummary.addedFiles.includes('components/AttendanceChart.tsx'))
  assert.ok(report.diffSummary.removedFiles.includes('components/OldStats.tsx'))
  assert.ok(report.sections.some((s) => s.id === 'ui'))
  assert.ok(report.sections.some((s) => s.id === 'verification'))
  assert.equal(report.scoreComparison[0]?.score, 84)
  assert.equal(report.scoreComparison[1]?.score, 93)
  assert.equal(report.scoreComparison[1]?.smokeLabel, '18/18')
  assert.equal(report.scoreComparison[0]?.smokeLabel, '16/18')

  const next = applyEvolutionToBrain(brain, round, {
    verdict: verdict(),
    fragment: evolvedFrag as any,
    now: FIXED_NOW,
  })
  const history = buildVersionHistory(next)
  assert.equal(history.length, 2)
  assert.equal(history[0]?.version, 1)
  assert.equal(history[1]?.version, 2)
  assert.equal(history[1]?.parentVersion, 1)
  assert.equal(history[1]?.improvementDelta, 9)
}

// 9. Failed evolution does not create a new version
{
  const brain = parentBrain()
  const before = brain.currentVersion
  let round = createEvolutionRound({
    brain,
    userRequest: 'Break everything',
    now: FIXED_NOW,
  })
  round = failEvolutionRound(round, 'All candidates failed')
  const kept = preserveBrainAfterFailedEvolution(brain, round)
  assert.equal(versionCountUnchanged(before, kept), true)
  assert.equal(kept.versions.length, brain.versions.length)
}

// 10. No secrets in report
{
  const brain = parentBrain()
  let round = createEvolutionRound({
    brain,
    userRequest: 'Polish UI with sk-secretKEY1234567890abcdef',
    now: FIXED_NOW,
  })
  round = completeEvolutionRound(round, { verdict: verdict(), now: FIXED_NOW })
  const secretFrag = frag([
    {
      file_path: 'lib/keys.ts',
      file_content: 'const x = "sk-secretKEY1234567890abcdef"\n',
    },
  ])
  const diff = diffFragments(parentFrag as any, secretFrag as any)
  const report = buildEvolutionReport({ round, diff, evidence: { verdict: verdict() } })
  const raw = JSON.stringify(report) + serializeProjectBrain(brain)
  assert.ok(!raw.includes('sk-secretKEY1234567890abcdef'))
}

console.log('evolution-report.test.ts: all tests passed')

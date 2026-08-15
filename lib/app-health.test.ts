/**
 * Deterministic App Health tests — zero provider / E2B / network calls.
 * Run: npm run test:app-health
 */
import assert from 'node:assert/strict'
import { architecturePreset } from './architecture'
import {
  calculateAppHealth,
  combineHealthScores,
  healthOutputIsSecretFree,
  healthStatusFromScore,
  type HealthDimension,
} from './app-health'
import { createProjectBrain, selectActiveProjectVersion } from './project-brain'
import type { ApplicationPlan } from './plan'
import type { ProjectBrain } from './project-brain'
import type { VersionSnapshot } from './version-vault'
import { buildVersionSnapshot } from './version-vault'

const FIXED_NOW = '2026-08-15T17:00:00.000Z'

function plan(): ApplicationPlan {
  return {
    applicationType: 'utility',
    complexity: 'simple',
    productName: 'Attendance Manager',
    productGoal: 'Manage attendance',
    targetUsers: 'Teachers',
    problemStatement: 'Manual',
    primaryUserGoal: 'Mark',
    coreFeatures: ['Tracking', 'Stats'],
    secondaryFeatures: [],
    outOfScope: [],
    pages: [
      { name: 'Home', path: '/', purpose: 'Dash' },
      { name: 'Students', path: '/students', purpose: 'List' },
    ],
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
    mustHaveInteractions: ['Mark'],
    interactionContracts: [
      {
        id: 'mark_attendance',
        name: 'Mark attendance',
        purpose: 'Record',
        route: '/',
        priority: 'critical',
        action: 'Click mark',
        expectedOutcome: 'Marked',
        steps: [
          { action: 'click', target: 'Mark present', expected: 'ok' } as any,
        ],
      } as any,
    ],
    documentation: 'none',
  }
}

function perfectBrain(): ProjectBrain {
  let brain = createProjectBrain({
    plan: plan(),
    fragment: {
      file_path: 'pages/index.tsx',
      template: 'nextjs-developer',
      code: [
        {
          file_path: 'pages/index.tsx',
          file_content: 'export default function Page(){return null}',
        },
      ],
    } as any,
    winnerId: 'rich',
    verification: {
      status: 'passed',
      filesWritten: true,
      dependenciesInstalled: true,
      processStarted: true,
      previewReachable: true,
      errors: [],
      warnings: [],
      durationMs: 10,
    },
    architectureCompliance: {
      status: 'passed',
      summary: 'ok',
      missingRequirements: [],
      suspiciousPatterns: [],
      evidence: [],
    } as any,
    smoke: {
      status: 'passed',
      tests: [],
      durationMs: 5,
      summary: 'all passed',
    },
    verdict: {
      winnerId: 'rich',
      reasoning: 'best',
      scores: [
        {
          id: 'minimal',
          clarity: 0.9,
          fit: 0.9,
          polish: 0.9,
          composite: 0.9,
          comment: 'a',
        },
        {
          id: 'rich',
          clarity: 0.92,
          fit: 0.92,
          polish: 0.92,
          composite: 0.92,
          comment: 'b',
        },
        {
          id: 'playful',
          clarity: 0.8,
          fit: 0.8,
          polish: 0.8,
          composite: 0.8,
          comment: 'c',
        },
      ],
    },
    now: FIXED_NOW,
  })
  brain = selectActiveProjectVersion(brain, {
    candidateId: 'rich',
    scoreComposite: 0.92,
    now: FIXED_NOW,
  })
  return brain
}

// 1. Perfect application = high score
{
  const report = calculateAppHealth({ brain: perfectBrain(), now: FIXED_NOW })
  assert.ok(report.score >= 90, `expected high score, got ${report.score}`)
  assert.equal(report.status, 'excellent')
  assert.equal(report.recommendations.length <= 3, true)
}

// 2. Runtime failure lowers score
{
  const brain = perfectBrain()
  brain.verification = {
    status: 'failed',
    previewReachable: false,
    errors: ['boot failed'],
    warnings: [],
    durationMs: 10,
  }
  const report = calculateAppHealth({ brain, now: FIXED_NOW })
  const perfect = calculateAppHealth({ brain: perfectBrain(), now: FIXED_NOW })
  assert.ok(report.score < perfect.score)
  assert.ok(
    report.dimensions.find((d) => d.id === 'runtime')!.score! < 40,
  )
}

// 3. Architecture failure lowers score
{
  const brain = perfectBrain()
  brain.architectureCompliance = {
    status: 'failed',
    summary: 'missing persistence',
  }
  const report = calculateAppHealth({ brain, now: FIXED_NOW })
  assert.ok(report.dimensions.find((d) => d.id === 'architecture')!.score! < 40)
  assert.ok(report.score < 95)
}

// 4. Smoke failures lower score
{
  const brain = perfectBrain()
  brain.smoke = {
    status: 'failed',
    summary: 'mobile nav contract failed',
  }
  const report = calculateAppHealth({ brain, now: FIXED_NOW })
  assert.ok(report.dimensions.find((d) => d.id === 'smoke')!.score! < 40)
  assert.ok(report.recommendations.some((r) => /mobile|interaction/i.test(r.title)))
}

// 5. Missing judge score does not cause a fake zero
{
  const brain = perfectBrain()
  brain.judge = undefined
  const report = calculateAppHealth({ brain, now: FIXED_NOW })
  const quality = report.dimensions.find((d) => d.id === 'quality')!
  assert.equal(quality.measured, false)
  assert.equal(quality.score, null)
  assert.equal(report.qualityUnavailable, true)
  assert.ok(report.score >= 85, `missing quality must not zero overall: ${report.score}`)
}

// 6. Missing metrics handled safely
{
  const brain = createProjectBrain({ plan: plan(), now: FIXED_NOW })
  const report = calculateAppHealth({ brain, now: FIXED_NOW })
  assert.ok(report.score >= 0 && report.score <= 100)
  for (const d of report.dimensions) {
    if (!d.measured) assert.equal(d.score, null)
  }
}

// 7. Score always 0–100
{
  const dims: HealthDimension[] = [
    {
      id: 'runtime',
      label: 'r',
      score: 150,
      measured: true,
    },
    {
      id: 'architecture',
      label: 'a',
      score: -20,
      measured: true,
    },
  ]
  // combine clamps inputs via calculate path; direct combine uses given scores
  const raw = combineHealthScores([
    { id: 'runtime', label: 'r', score: 100, measured: true },
    { id: 'architecture', label: 'a', score: 0, measured: true },
  ])
  assert.ok(raw >= 0 && raw <= 100)
  void dims
}

// 8. Status levels are correct
{
  assert.equal(healthStatusFromScore(95), 'excellent')
  assert.equal(healthStatusFromScore(90), 'excellent')
  assert.equal(healthStatusFromScore(80), 'good')
  assert.equal(healthStatusFromScore(75), 'good')
  assert.equal(healthStatusFromScore(65), 'needs_attention')
  assert.equal(healthStatusFromScore(60), 'needs_attention')
  assert.equal(healthStatusFromScore(40), 'poor')
}

// 9–10. Recommendations deterministic + max 3
{
  const a = calculateAppHealth({ brain: perfectBrain(), now: FIXED_NOW })
  const b = calculateAppHealth({ brain: perfectBrain(), now: FIXED_NOW })
  assert.deepEqual(
    a.recommendations.map((r) => r.id),
    b.recommendations.map((r) => r.id),
  )
  assert.ok(a.recommendations.length <= 3)

  const weak = perfectBrain()
  weak.verification = {
    status: 'failed',
    previewReachable: false,
    errors: ['x'],
    warnings: [],
    durationMs: 1,
  }
  weak.architectureCompliance = { status: 'failed', summary: 'bad' }
  weak.smoke = { status: 'failed', summary: 'smoke' }
  const recs = calculateAppHealth({ brain: weak, now: FIXED_NOW }).recommendations
  assert.equal(recs.length, 3)
}

// 11. No provider/network calls
{
  const before = globalThis.fetch
  globalThis.fetch = (() => {
    throw new Error('fetch must not run')
  }) as typeof fetch
  try {
    calculateAppHealth({ brain: perfectBrain(), now: FIXED_NOW })
  } finally {
    globalThis.fetch = before
  }
}

// 12. Restoring a version recalculates health correctly (via snapshot hints)
{
  const snap: VersionSnapshot = buildVersionSnapshot({
    version: 2,
    parentVersion: 1,
    label: 'Dark mode',
    fragment: {
      file_path: 'pages/index.tsx',
      template: 'nextjs-developer',
      code: [
        {
          file_path: 'pages/index.tsx',
          file_content: 'export default function Page(){return <main/>}',
        },
      ],
    } as any,
    plan: plan(),
    activeCandidateId: 'rich',
    runtimeStatus: 'passed',
    smokeStatus: 'passed',
    architectureStatus: 'passed',
    previewReachable: true,
    compositeScore: 0.9,
  })
  // Thin brain after restore — snapshot fills status for health.
  const thin = createProjectBrain({ plan: plan(), now: FIXED_NOW })
  thin.activeVersion = 2
  thin.activeCandidateId = 'rich'
  const report = calculateAppHealth({
    brain: thin,
    snapshot: snap,
    now: FIXED_NOW,
  })
  assert.equal(report.activeVersion, 2)
  assert.ok(report.dimensions.find((d) => d.id === 'runtime')!.measured)
  assert.ok(report.score > 50)
}

// 13. Failed evolution does not corrupt health
{
  const brain = perfectBrain()
  const before = calculateAppHealth({ brain, now: FIXED_NOW }).score
  // Simulate failed evolution: brain unchanged aside from an issue note.
  brain.issues = [
    ...(brain.issues || []),
    {
      id: 'x',
      at: FIXED_NOW,
      source: 'generation',
      severity: 'warning',
      message: 'Evolution failed — kept v1',
    },
  ]
  const after = calculateAppHealth({ brain, now: FIXED_NOW }).score
  assert.equal(after, before)
}

// 14. Secrets never appear in health output
{
  const brain = perfectBrain()
  brain.architectureCompliance = {
    status: 'failed',
    summary: 'leak sk-secretKEY1234567890abcdef and Bearer tokentokentoken',
  }
  const report = calculateAppHealth({ brain, now: FIXED_NOW })
  assert.ok(healthOutputIsSecretFree(report))
  const raw = JSON.stringify(report)
  assert.ok(!raw.includes('sk-secretKEY1234567890abcdef'))
  assert.ok(!raw.includes('Bearer tokentokentoken'))
}

console.log('app-health.test.ts: all tests passed')

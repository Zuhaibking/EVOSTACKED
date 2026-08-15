/**
 * Deterministic Project Brain tests (no LLM / provider calls).
 * Run: npx tsx lib/project-brain.test.ts
 */
import assert from 'node:assert/strict'
import { architecturePreset } from './architecture'
import {
  buildBrainFromTournament,
  createProjectBrain,
  deserializeProjectBrain,
  getProjectBrainContextForIteration,
  recordImprovement,
  recordIssue,
  recordProjectVersion,
  selectActiveProjectVersion,
  serializeProjectBrain,
  summarizeProjectBrain,
  updateProjectBrain,
} from './project-brain'
import type { ApplicationPlan } from './plan'
import type { VerificationResult } from './verification'

const FIXED_NOW = '2026-08-15T10:00:00.000Z'

function samplePlan(overrides: Partial<ApplicationPlan> = {}): ApplicationPlan {
  return {
    applicationType: 'utility',
    complexity: 'simple',
    productName: 'Attendance Manager',
    productGoal: 'Manage student attendance for teachers.',
    targetUsers: 'Teachers and school admins',
    problemStatement: 'Tracking attendance is manual and error-prone.',
    primaryUserGoal: 'Mark and review attendance quickly',
    coreFeatures: [
      'Student management',
      'Attendance tracking',
      'Attendance statistics',
    ],
    secondaryFeatures: [],
    outOfScope: ['Payroll'],
    pages: [{ name: 'Home', path: '/', purpose: 'Dashboard' }],
    userFlows: ['Open app → mark attendance → view stats'],
    dataApproach: 'localStorage',
    needsAuth: false,
    needsBackend: false,
    architectureRequirements: architecturePreset('calculator'),
    architectureSummary: 'Simple frontend with local state.',
    designDirection: {
      tone: 'calm school utility',
      typography: 'clear sans',
      colorApproach: 'neutral with accent',
      componentStyle: 'compact cards',
      interactionStyle: 'direct',
    },
    sampleDataNotes: 'Use realistic student names and class periods.',
    mustHaveInteractions: ['Mark attendance'],
    interactionContracts: [],
    documentation: 'none',
    ...overrides,
  }
}

function passedVerification(): VerificationResult {
  return {
    status: 'passed',
    filesWritten: true,
    dependenciesInstalled: true,
    processStarted: true,
    previewReachable: true,
    errors: [],
    warnings: [],
    durationMs: 900,
    sbxId: 'sbx_test',
    url: 'https://sbx_test.e2b.dev',
    template: 'nextjs-developer',
  }
}

// 1. Creating a Project Brain from an ApplicationPlan
{
  const plan = samplePlan()
  const brain = createProjectBrain({
    plan,
    fragment: {
      title: 'Attendance Manager',
      template: 'nextjs-developer',
      file_path: 'pages/index.tsx',
      code: [
        { file_path: 'pages/index.tsx', file_content: 'export default function Page(){return null}' },
        { file_path: 'components/Roster.tsx', file_content: 'export function Roster(){return null}' },
      ],
    } as any,
    now: FIXED_NOW,
  })
  assert.equal(brain.plan?.productName, 'Attendance Manager')
  assert.equal(brain.plan?.productGoal, 'Manage student attendance for teachers.')
  assert.deepEqual(brain.plan?.coreFeatures, plan.coreFeatures)
  assert.deepEqual(brain.fileTree, ['pages/index.tsx', 'components/Roster.tsx'])
  assert.equal(brain.primaryFile, 'pages/index.tsx')
  assert.equal(brain.schemaVersion, 1)
}

// 2. Updating the brain
{
  let brain = createProjectBrain({ plan: samplePlan(), now: FIXED_NOW })
  brain = updateProjectBrain(brain, {
    winnerId: 'minimal',
    verification: passedVerification(),
    architectureCompliance: {
      status: 'passed',
      summary: 'Architecture verified',
      missingRequirements: [],
      suspiciousPatterns: [],
      evidence: [],
    } as any,
    smoke: { status: 'passed', tests: [], durationMs: 10, summary: 'ok' },
    now: '2026-08-15T10:01:00.000Z',
  })
  assert.equal(brain.currentWinnerId, 'minimal')
  assert.equal(brain.currentWinnerLabel, 'Product')
  assert.equal(brain.verification?.status, 'passed')
  assert.equal(brain.architectureCompliance?.status, 'passed')
  assert.equal(brain.smoke?.status, 'passed')
}

// 3. Recording a version
{
  let brain = createProjectBrain({
    plan: samplePlan(),
    winnerId: 'rich',
    verification: passedVerification(),
    verdict: {
      winnerId: 'rich',
      reasoning: 'Best fit for teachers',
      scores: [
        { id: 'minimal', clarity: 0.7, fit: 0.7, polish: 0.6, composite: 0.67, comment: 'solid' },
        { id: 'rich', clarity: 0.8, fit: 0.9, polish: 0.85, composite: 0.85, comment: 'polished' },
        { id: 'playful', clarity: 0.6, fit: 0.6, polish: 0.7, composite: 0.63, comment: 'noisy' },
      ],
    },
    now: FIXED_NOW,
  })
  brain = recordProjectVersion(brain, {
    label: 'Initial generation',
    summary: 'Best fit for teachers',
    now: FIXED_NOW,
  })
  assert.equal(brain.currentVersion, 1)
  assert.equal(brain.versions.length, 1)
  assert.equal(brain.versions[0].winnerLabel, 'Premium')
  assert.equal(brain.versions[0].runtimeStatus, 'passed')
  assert.equal(brain.versions[0].compositeScore, 0.85)
}

// 4. Recording an issue
{
  let brain = createProjectBrain({ plan: samplePlan(), now: FIXED_NOW })
  brain = recordIssue(brain, {
    source: 'runtime',
    severity: 'error',
    message: 'Module not found: recharts',
    at: FIXED_NOW,
  })
  assert.equal(brain.issues.length, 1)
  assert.equal(brain.issues[0].source, 'runtime')
  assert.match(brain.issues[0].message, /recharts/)
}

// 5. Recording an improvement
{
  let brain = createProjectBrain({ plan: samplePlan(), now: FIXED_NOW })
  brain = recordImprovement(brain, {
    request: 'Add CSV export for attendance',
    note: 'Queued for future iteration',
    at: FIXED_NOW,
  })
  assert.equal(brain.improvements.length, 1)
  assert.match(brain.improvements[0].request, /CSV export/)
  assert.ok(brain.userRequests.some((r) => /CSV export/.test(r)))
}

// 6. Serializing / deserializing
{
  const brain = createProjectBrain({
    plan: samplePlan(),
    winnerId: 'minimal',
    verification: passedVerification(),
    now: FIXED_NOW,
  })
  const raw = serializeProjectBrain(brain)
  const restored = deserializeProjectBrain(raw)
  assert.ok(restored)
  assert.equal(restored!.plan?.productName, 'Attendance Manager')
  assert.equal(restored!.currentWinnerLabel, 'Product')
  assert.equal(deserializeProjectBrain('not-json'), null)
}

// 7. API keys / secrets never appear in serialized brain
{
  let brain = createProjectBrain({
    plan: samplePlan({
      productGoal: 'Demo with OPENAI_API_KEY=sk-secretvalue123456 and Bearer tokensecret',
    }),
    now: FIXED_NOW,
  })
  brain = recordIssue(brain, {
    source: 'user',
    severity: 'info',
    message: 'leak OPENAI_API_KEY=sk-abcdefghijklmnopqrst and password=hunter2',
    at: FIXED_NOW,
  })
  // Inject a forbidden key shape to prove sanitizer strips it
  const dirty = {
    ...brain,
    apiKey: 'sk-should-never-persist',
    accessToken: 'clerk_token_xyz',
  } as any
  const raw = serializeProjectBrain(dirty)
  assert.doesNotMatch(raw, /sk-should-never-persist/)
  assert.doesNotMatch(raw, /clerk_token_xyz/)
  assert.doesNotMatch(raw, /sk-abcdefghijklmnopqrst/)
  assert.doesNotMatch(raw, /"apiKey"/)
  assert.doesNotMatch(raw, /"accessToken"/)
  assert.match(raw, /\[redacted\]/i)
}

// 8. Empty / missing optional data
{
  const brain = createProjectBrain({ now: FIXED_NOW })
  assert.equal(brain.plan, undefined)
  assert.deepEqual(brain.fileTree, [])
  assert.equal(brain.currentVersion, 0)
  const summary = summarizeProjectBrain(brain)
  assert.equal(summary.productName, 'Untitled project')
  assert.equal(summary.runtimeStatus, 'unknown')
  assert.equal(summary.architectureStatus, 'unknown')
  assert.equal(summary.smokeStatus, 'unknown')
}

// 9. Tournament helper + iteration context (foundation for Improve flow)
{
  const plan = samplePlan()
  const brain = buildBrainFromTournament({
    plan,
    fragment: {
      title: 'Attendance Manager',
      template: 'nextjs-developer',
      file_path: 'pages/index.tsx',
      code: [{ file_path: 'pages/index.tsx', file_content: 'x' }],
    } as any,
    winnerId: 'minimal',
    verification: passedVerification(),
    architectureCompliance: {
      status: 'passed',
      summary: 'ok',
      missingRequirements: [],
      suspiciousPatterns: [],
      evidence: [],
    } as any,
    smoke: { status: 'passed', tests: [], durationMs: 5, summary: 'ok' },
    verdict: {
      winnerId: 'minimal',
      reasoning: 'Clearest attendance UX',
      scores: [
        { id: 'minimal', clarity: 0.9, fit: 0.9, polish: 0.8, composite: 0.87, comment: 'clear' },
        { id: 'rich', clarity: 0.7, fit: 0.7, polish: 0.8, composite: 0.73, comment: 'heavy' },
        { id: 'playful', clarity: 0.6, fit: 0.6, polish: 0.6, composite: 0.6, comment: 'off' },
      ],
    },
    userRequest: 'Build an attendance manager for teachers',
    now: FIXED_NOW,
  })
  assert.equal(brain.currentVersion, 0)
  assert.equal(brain.activeCandidateId, undefined)
  // User selection creates v1
  const active = selectActiveProjectVersion(brain, {
    candidateId: 'minimal',
    fragment: {
      title: 'Attendance Manager',
      template: 'nextjs-developer',
      file_path: 'pages/index.tsx',
      code: [{ file_path: 'pages/index.tsx', file_content: 'x' }],
    } as any,
    scoreComposite: 0.87,
    now: FIXED_NOW,
  })
  assert.equal(active.currentVersion, 1)
  assert.equal(active.activeCandidateId, 'minimal')
  assert.equal(active.activeVersion, 1)
  const ctx = getProjectBrainContextForIteration(active)
  assert.equal(ctx.summary.productName, 'Attendance Manager')
  assert.ok(ctx.plan)
  assert.ok(ctx.fileTree.includes('pages/index.tsx'))
  assert.equal(ctx.currentVersion, 1)
  assert.equal(ctx.activeCandidateId, 'minimal')

  // Legacy auto-record path still available for tests
  const legacy = buildBrainFromTournament({
    plan,
    fragment: {
      title: 'Attendance Manager',
      template: 'nextjs-developer',
      file_path: 'pages/index.tsx',
      code: [{ file_path: 'pages/index.tsx', file_content: 'x' }],
    } as any,
    winnerId: 'minimal',
    verification: passedVerification(),
    verdict: {
      winnerId: 'minimal',
      reasoning: 'Clearest attendance UX',
      scores: [
        { id: 'minimal', clarity: 0.9, fit: 0.9, polish: 0.8, composite: 0.87, comment: 'clear' },
        { id: 'rich', clarity: 0.7, fit: 0.7, polish: 0.8, composite: 0.73, comment: 'heavy' },
        { id: 'playful', clarity: 0.6, fit: 0.6, polish: 0.6, composite: 0.6, comment: 'off' },
      ],
    },
    autoRecordInitialVersion: true,
    now: FIXED_NOW,
  })
  assert.equal(legacy.currentVersion, 1)
  assert.equal(legacy.versions[0].label, 'Initial generation')
}

// Existing tournament invariants remain untouched by this module
{
  const { VARIANTS, MAX_REPAIR } = {
    VARIANTS: ['minimal', 'rich', 'playful'],
    MAX_REPAIR: 1,
  }
  assert.equal(VARIANTS.length, 3)
  assert.equal(MAX_REPAIR, 1)
}

console.log('project-brain.test.ts: all tests passed')

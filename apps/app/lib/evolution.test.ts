/**
 * Deterministic Evolution tests — single-candidate iteration + tournament invariants.
 * Run: npm run test:evolution
 */
import assert from 'node:assert/strict'
import { architecturePreset } from './architecture'
import {
  applyEvolutionToBrain,
  buildEvolutionApiPayload,
  buildIterationContext,
  buildSingleIterationVerdict,
  completeEvolutionRound,
  computeImprovementDelta,
  createEvolutionRound,
  failEvolutionRound,
  INITIAL_TOURNAMENT_CANDIDATE_COUNT,
  ITERATION_CANDIDATE_COUNT,
  preserveBrainAfterFailedEvolution,
  scoreToPoints,
  shouldPromoteEvolutionWinner,
  startEvolutionRound,
} from './evolution'
import { buildRecommendations } from './recommendations'
import {
  createProjectBrain,
  selectActiveProjectVersion,
  serializeProjectBrain,
} from './project-brain'
import { MAX_REPAIR_ATTEMPTS_PER_CANDIDATE } from './repair'
import type { ApplicationPlan } from './plan'
import type { Verdict } from './tournament'
import { VARIANTS } from './tournament'
import type { VerificationResult } from './verification'

const FIXED_NOW = '2026-08-15T12:00:00.000Z'

function samplePlan(): ApplicationPlan {
  return {
    applicationType: 'utility',
    complexity: 'simple',
    productName: 'Attendance Manager',
    productGoal: 'Manage student attendance for teachers.',
    targetUsers: 'Teachers',
    problemStatement: 'Manual attendance is error-prone.',
    primaryUserGoal: 'Mark attendance quickly',
    coreFeatures: ['Student management', 'Attendance tracking'],
    secondaryFeatures: [],
    outOfScope: ['Payroll'],
    pages: [{ name: 'Home', path: '/', purpose: 'Dashboard' }],
    userFlows: ['Open → mark → review'],
    dataApproach: 'localStorage',
    needsAuth: false,
    needsBackend: false,
    architectureRequirements: architecturePreset('calculator'),
    architectureSummary: 'Frontend only',
    designDirection: {
      tone: 'calm',
      typography: 'sans',
      colorApproach: 'neutral',
      componentStyle: 'compact',
      interactionStyle: 'direct',
    },
    sampleDataNotes: 'Realistic names',
    mustHaveInteractions: ['Mark attendance'],
    interactionContracts: [],
    documentation: 'none',
  }
}

function baselineFragment() {
  return {
    title: 'Attendance Manager',
    template: 'nextjs-developer',
    file_path: 'pages/index.tsx',
    commentary: 'v1 app',
    description: 'Attendance',
    architecture: 'local state',
    additional_dependencies: [] as string[],
    has_additional_dependencies: false,
    install_dependencies_command: '',
    port: 3000,
    code: [
      {
        file_path: 'pages/index.tsx',
        file_content:
          'export default function Page(){ return <main>Attendance</main> }',
      },
    ],
  }
}

function passed(): VerificationResult {
  return {
    status: 'passed',
    filesWritten: true,
    dependenciesInstalled: true,
    processStarted: true,
    previewReachable: true,
    errors: [],
    warnings: [],
    durationMs: 100,
  }
}

function failed(): VerificationResult {
  return {
    status: 'failed',
    filesWritten: true,
    dependenciesInstalled: true,
    processStarted: false,
    previewReachable: false,
    errors: ['boot failed'],
    warnings: [],
    durationMs: 50,
  }
}

function tournamentBrain() {
  return createProjectBrain({
    plan: samplePlan(),
    fragment: baselineFragment() as any,
    winnerId: 'rich',
    verification: passed(),
    verdict: {
      winnerId: 'rich',
      reasoning: 'Premium craft wins tournament',
      scores: [
        {
          id: 'minimal',
          clarity: 0.8,
          fit: 0.8,
          polish: 0.75,
          composite: 0.78,
          comment: 'solid',
        },
        {
          id: 'rich',
          clarity: 0.85,
          fit: 0.84,
          polish: 0.83,
          composite: 0.84,
          comment: 'best',
        },
        {
          id: 'playful',
          clarity: 0.7,
          fit: 0.72,
          polish: 0.8,
          composite: 0.74,
          comment: 'noisy',
        },
      ],
    },
    now: FIXED_NOW,
  })
}

function activeBrain(candidateId: 'minimal' | 'rich' | 'playful' = 'rich') {
  return selectActiveProjectVersion(tournamentBrain(), {
    candidateId,
    fragment: baselineFragment() as any,
    verification: passed(),
    scoreComposite: 0.84,
    summary: 'Premium is now your active version.',
    now: FIXED_NOW,
  })
}

// 1. Initial tournament still creates exactly 3 candidates
{
  assert.equal(VARIANTS.length, INITIAL_TOURNAMENT_CANDIDATE_COUNT)
  assert.equal(INITIAL_TOURNAMENT_CANDIDATE_COUNT, 3)
  assert.deepEqual(
    VARIANTS.map((v) => v.id),
    ['minimal', 'rich', 'playful'],
  )
}

// 2–3. User can select any candidate as active → activeVersion
{
  for (const id of ['minimal', 'rich', 'playful'] as const) {
    const brain = selectActiveProjectVersion(tournamentBrain(), {
      candidateId: id,
      fragment: baselineFragment() as any,
      scoreComposite: 0.8,
      now: FIXED_NOW,
    })
    assert.equal(brain.activeCandidateId, id)
    assert.equal(brain.activeVersion, 1)
    assert.equal(brain.currentVersion, 1)
    assert.equal(brain.versions[0]?.winnerId, id)
  }
}

// 4–5. Improvements use ONLY activeVersion; one request → exactly ONE candidate
{
  const brain = activeBrain('rich')
  const round = createEvolutionRound({
    brain,
    userRequest: 'Add dark mode',
    now: FIXED_NOW,
  })
  assert.equal(round.candidateMode, 'single')
  assert.equal(round.activeVariantId, 'rich')
  assert.equal(round.candidates.length, ITERATION_CANDIDATE_COUNT)
  assert.equal(ITERATION_CANDIDATE_COUNT, 1)
  assert.equal(round.candidates[0]?.id, 'rich')
  assert.equal(round.parentVersion, 1)

  const payload = buildEvolutionApiPayload(
    buildIterationContext({
      brain,
      userRequest: 'Add dark mode',
      baselineFragment: baselineFragment() as any,
    }),
    baselineFragment() as any,
  )
  assert.equal(payload.candidateMode, 'single')
  assert.equal(payload.activeVariantId, 'rich')
}

// 6. Repeated improvements chain v1 → v2 → v3 → v4
{
  let brain = activeBrain('rich')
  assert.equal(brain.activeVersion, 1)

  const requests = ['Add dark mode', 'Add analytics', 'Make mobile navigation better']
  for (const req of requests) {
    let round = createEvolutionRound({
      brain,
      userRequest: req,
      now: FIXED_NOW,
    })
    assert.equal(round.candidates.length, 1)
    assert.equal(round.parentVersion, brain.activeVersion)
    const verdict = buildSingleIterationVerdict({
      id: 'rich',
      verification: passed(),
      architecture: { status: 'passed' },
      smoke: { status: 'passed' },
      previousScore: scoreToPoints(
        brain.versions[brain.versions.length - 1]?.compositeScore,
      ),
      userRequest: req,
    })
    round = completeEvolutionRound(round, {
      verdict,
      candidates: [{ id: 'rich', finalVerification: passed() }],
      now: FIXED_NOW,
    })
    brain = applyEvolutionToBrain(brain, round, {
      verdict,
      fragment: baselineFragment() as any,
      verification: {
        status: 'passed',
        previewReachable: true,
        errors: [],
        warnings: [],
        durationMs: 1,
      },
      now: FIXED_NOW,
    })
  }
  assert.equal(brain.currentVersion, 4)
  assert.equal(brain.activeVersion, 4)
  assert.equal(brain.activeCandidateId, 'rich')
  assert.equal(brain.versions.length, 4)
  assert.equal(brain.versions[1]?.parentVersion, 1)
  assert.equal(brain.versions[2]?.parentVersion, 2)
  assert.equal(brain.versions[3]?.parentVersion, 3)
}

// 7. Failed improvement preserves active version
{
  const brain = activeBrain('rich')
  const before = brain.currentVersion
  const active = brain.activeCandidateId
  let round = createEvolutionRound({
    brain,
    userRequest: 'Break everything',
    now: FIXED_NOW,
  })
  round = failEvolutionRound(round, 'Generation failed')
  const kept = preserveBrainAfterFailedEvolution(brain, round)
  assert.equal(kept.currentVersion, before)
  assert.equal(kept.activeCandidateId, active)
  assert.equal(kept.activeVersion, before)

  assert.equal(
    shouldPromoteEvolutionWinner({
      verdict: buildSingleIterationVerdict({
        id: 'rich',
        verification: failed(),
      }),
      candidates: [{ id: 'rich', fragment: {}, finalVerification: failed() }],
    }),
    false,
  )
}

// 8. Repair remains maximum one attempt
{
  assert.equal(MAX_REPAIR_ATTEMPTS_PER_CANDIDATE, 1)
}

// 9. No automatic improvement loops (API is explicitly user-triggered; round starts pending)
{
  const brain = activeBrain('rich')
  const round = createEvolutionRound({
    brain,
    userRequest: 'Add dark mode',
    now: FIXED_NOW,
  })
  assert.equal(round.status, 'pending')
  assert.equal(startEvolutionRound(round).status, 'running')
}

// 10. Recommendations require zero provider calls — covered in recommendations.test.ts
{
  const recs = buildRecommendations({ brain: activeBrain('rich') })
  assert.ok(recs.length <= 3)
}

// 11. Existing initial tournament behavior unchanged (size 3)
{
  assert.equal(VARIANTS.length, 3)
}

// 12. No API keys/secrets enter Project Brain
{
  let brain = activeBrain('rich')
  let round = createEvolutionRound({
    brain,
    userRequest: 'Polish UI with sk-secretKEY1234567890abcdef',
    now: FIXED_NOW,
  })
  const verdict = buildSingleIterationVerdict({
    id: 'rich',
    verification: passed(),
    previousScore: 84,
  })
  round = completeEvolutionRound(round, { verdict, now: FIXED_NOW })
  brain = applyEvolutionToBrain(brain, round, { verdict, now: FIXED_NOW })
  const raw = serializeProjectBrain(brain)
  assert.ok(!raw.includes('sk-secretKEY1234567890abcdef'))
  assert.ok(!/"apiKey"\s*:/.test(raw))
}

// Score helpers still work
{
  assert.equal(scoreToPoints(0.84), 84)
  assert.equal(computeImprovementDelta(84, 91), 7)
}

// Missing active candidate cannot start single evolution
{
  const brain = tournamentBrain()
  assert.throws(() =>
    createEvolutionRound({
      brain,
      userRequest: 'Add dark mode',
      now: FIXED_NOW,
    }),
  )
}

console.log('evolution.test.ts: all tests passed')

/**
 * Deterministic recommendations tests — must never call providers.
 * Run: npm run test:recommendations
 */
import assert from 'node:assert/strict'
import { architecturePreset } from './architecture'
import { createProjectBrain, selectActiveProjectVersion } from './project-brain'
import { buildRecommendations } from './recommendations'
import type { ApplicationPlan } from './plan'

function plan(): ApplicationPlan {
  return {
    applicationType: 'utility',
    complexity: 'simple',
    productName: 'Attendance Manager',
    productGoal: 'Manage attendance',
    targetUsers: 'Teachers',
    problemStatement: 'Manual',
    primaryUserGoal: 'Mark',
    coreFeatures: ['Attendance tracking', 'Dashboard stats'],
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
    mustHaveInteractions: [],
    interactionContracts: [
      {
        id: 'mark_attendance',
        name: 'Mark attendance',
        purpose: 'Record presence',
        route: '/',
        priority: 'critical',
        action: 'Click mark present',
        expectedOutcome: 'Student marked present',
        steps: [
          {
            action: 'click',
            target: 'Mark present',
            expected: 'marked',
          },
        ],
      } as any,
    ],
    documentation: 'none',
  }
}

{
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
    smoke: {
      status: 'failed',
      tests: [],
      durationMs: 1,
      summary: 'contract failed',
    },
    architectureCompliance: {
      status: 'failed',
      summary: 'missing persistence',
      checks: [],
    } as any,
  })
  brain = selectActiveProjectVersion(brain, {
    candidateId: 'rich',
    scoreComposite: 0.84,
  })

  const recs = buildRecommendations({ brain })
  assert.ok(recs.length <= 3)
  assert.ok(recs.length >= 1)
  assert.ok(recs.every((r) => r.improveRequest.trim().length > 10))
  assert.ok(recs.some((r) => r.id === 'fix-architecture' || r.id === 'fix-smoke'))
  // Zero provider calls by construction — pure function.
  assert.equal(typeof buildRecommendations, 'function')
}

{
  const brain = createProjectBrain({ plan: plan() })
  const recs = buildRecommendations({ brain })
  assert.equal(recs.length, 3)
}

console.log('recommendations.test.ts: all tests passed')

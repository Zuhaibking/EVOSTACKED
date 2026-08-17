/**
 * Deterministic Part 5 browser-smoke tests (no Playwright / E2B / LLM).
 * Run: npx tsx lib/smoke.test.ts
 */
import assert from 'node:assert/strict'
import type { ApplicationPlan } from './plan'
import {
  deriveSmokeTests,
  formatSmokeForJudge,
  isBrowserTestableTemplate,
  normalizeRoutePath,
  notTestableSuite,
  preferReliableWinner,
  shouldSmokeTest,
  validateSmokeSuiteResult,
  type SmokeSuiteResult,
} from './smoke'
import type { VerificationResult } from './verification'

function makePlan(overrides: Partial<ApplicationPlan> = {}): ApplicationPlan {
  return {
    applicationType: 'productivity tool',
    complexity: 'medium',
    productName: 'TaskFlow',
    productGoal: 'Help teams track tasks',
    targetUsers: 'Project managers',
    problemStatement: 'Tasks get lost',
    primaryUserGoal: 'Create and complete tasks',
    coreFeatures: ['create tasks', 'complete tasks', 'filter tasks'],
    secondaryFeatures: [],
    outOfScope: ['billing'],
    pages: [
      { name: 'Dashboard', path: '/', purpose: 'Overview' },
      { name: 'Tasks', path: '/tasks', purpose: 'Task list' },
    ],
    userFlows: ['Dashboard → Create task → Complete task'],
    dataApproach: 'in-memory',
    needsAuth: false,
    needsBackend: false,
    architectureSummary: 'Client state with mock data.',
    designDirection: {
      tone: 'sharp',
      typography: 'sans',
      colorApproach: 'neutral with accent',
      componentStyle: 'dense borders',
      interactionStyle: 'snappy',
    },
    sampleDataNotes: 'Realistic task titles and owners',
    mustHaveInteractions: ['add task', 'mark complete'],
    interactionContracts: [],
    documentation: 'none',
    ...overrides,
  }
}

function runtime(
  status: VerificationResult['status'],
  extras: Partial<VerificationResult> = {},
): VerificationResult {
  return {
    status,
    filesWritten: true,
    dependenciesInstalled: status !== 'failed',
    processStarted: true,
    previewReachable: status !== 'failed',
    errors: status === 'failed' ? ['boom'] : [],
    warnings: status === 'partial' ? ['slow'] : [],
    durationMs: 1000,
    ...extras,
  }
}

function suite(
  status: SmokeSuiteResult['status'],
  extras: Partial<SmokeSuiteResult> = {},
): SmokeSuiteResult {
  return {
    status,
    tests: [
      {
        status,
        testName: 'Open primary route',
        durationMs: 120,
        completedActions: status === 'passed' ? 2 : 0,
        error: status === 'passed' ? undefined : 'expected heading missing',
        evidence: status === 'passed' ? 'OK' : 'fail',
      },
    ],
    durationMs: 120,
    summary:
      status === 'passed' ? '1 smoke test(s) passed' : '0/1 smoke tests passed',
    ...extras,
  }
}

let passed = 0
function test(name: string, fn: () => void) {
  try {
    fn()
    passed++
    console.log(`✓ ${name}`)
  } catch (e) {
    console.error(`✗ ${name}`)
    console.error(e)
    process.exitCode = 1
  }
}

test('valid smoke result parses', () => {
  const ok = validateSmokeSuiteResult(suite('passed'))
  assert.equal(ok.ok, true)
  if (ok.ok) assert.equal(ok.result.status, 'passed')
})

test('failed smoke result parses', () => {
  const ok = validateSmokeSuiteResult(suite('failed'))
  assert.equal(ok.ok, true)
  if (ok.ok) assert.equal(ok.result.status, 'failed')
})

test('timeout smoke result parses', () => {
  const ok = validateSmokeSuiteResult(suite('timeout'))
  assert.equal(ok.ok, true)
  if (ok.ok) assert.equal(ok.result.status, 'timeout')
})

test('not_testable smoke result parses', () => {
  const ok = validateSmokeSuiteResult(notTestableSuite('interpreter'))
  assert.equal(ok.ok, true)
  if (ok.ok) assert.equal(ok.result.status, 'not_testable')
})

test('malformed smoke result rejected', () => {
  const bad = validateSmokeSuiteResult({
    status: 'weird',
    tests: 'nope',
    durationMs: 'x',
  })
  assert.equal(bad.ok, false)
})

test('shouldSmokeTest only for passed/partial without compile overlay', () => {
  assert.equal(shouldSmokeTest(runtime('passed')), true)
  assert.equal(shouldSmokeTest(runtime('partial')), true)
  assert.equal(shouldSmokeTest(runtime('failed')), false)
  assert.equal(shouldSmokeTest(undefined), false)
  assert.equal(
    shouldSmokeTest({
      ...runtime('partial'),
      errors: [
        "Parsing ecmascript source code failed Unexpected token 'section'. Expected jsx identifier",
      ],
    }),
    false,
  )
  assert.equal(
    shouldSmokeTest({
      ...runtime('partial'),
      errors: [
        'Hydration failed because the initial UI does not match what was rendered on the server.',
      ],
    }),
    false,
  )
})

test('interpreter template is not browser-testable', () => {
  assert.equal(isBrowserTestableTemplate('code-interpreter-v1'), false)
  assert.equal(isBrowserTestableTemplate('nextjs-developer'), true)
  assert.equal(isBrowserTestableTemplate('vue-developer'), true)
  assert.equal(isBrowserTestableTemplate(undefined), false)
})

test('normalizeRoutePath handles file-ish paths', () => {
  assert.equal(normalizeRoutePath('pages/contacts.tsx'), '/contacts')
  assert.equal(normalizeRoutePath('/dashboard'), '/dashboard')
  assert.equal(normalizeRoutePath('app/tasks/page.tsx'), '/tasks')
})

test('deriveSmokeTests yields 1–3 flows from plan', () => {
  const tests = deriveSmokeTests(makePlan())
  assert.ok(tests.length >= 1 && tests.length <= 3)
  assert.equal(tests[0].name, 'Open primary route')
  assert.ok(tests.some((t) => /create|primary record/i.test(t.name)))
})

test('calculator plan derives calculation smoke', () => {
  const tests = deriveSmokeTests(
    makePlan({
      applicationType: 'utility',
      productGoal: 'Simple calculator',
      coreFeatures: ['arithmetic'],
      mustHaveInteractions: ['calculate'],
      pages: [{ name: 'Calc', path: '/', purpose: 'Calc' }],
    }),
  )
  assert.ok(tests.some((t) => /calculation/i.test(t.name)))
  assert.ok(tests.length <= 3)
})

test('null plan still yields a primary-route smoke', () => {
  const tests = deriveSmokeTests(null)
  assert.equal(tests.length, 1)
  assert.equal(tests[0].route, '/')
})

test('landing plan can add CTA smoke', () => {
  const tests = deriveSmokeTests(
    makePlan({
      applicationType: 'landing page',
      productGoal: 'Marketing landing',
      coreFeatures: ['hero', 'cta'],
      mustHaveInteractions: ['click get started'],
      pages: [{ name: 'Home', path: '/', purpose: 'Landing' }],
      userFlows: ['Landing → Sign up'],
    }),
  )
  assert.ok(tests.length >= 1 && tests.length <= 3)
})

test('formatSmokeForJudge includes statuses', () => {
  const text = formatSmokeForJudge(suite('failed'))
  assert.match(text, /FAILED/)
  assert.match(text, /Open primary route/)
  assert.match(formatSmokeForJudge(null), /not run/)
})

test('preferReliableWinner keeps smoke-passing winner', () => {
  const winner = preferReliableWinner('rich', [
    {
      id: 'minimal',
      verification: runtime('passed'),
      smoke: suite('failed'),
    },
    {
      id: 'rich',
      verification: runtime('passed'),
      smoke: suite('passed'),
    },
    {
      id: 'playful',
      verification: runtime('failed'),
      smoke: null,
    },
  ])
  assert.equal(winner, 'rich')
})

test('preferReliableWinner overrides smoke-failed winner', () => {
  const winner = preferReliableWinner('minimal', [
    {
      id: 'minimal',
      verification: runtime('passed'),
      smoke: suite('failed'),
    },
    {
      id: 'rich',
      verification: runtime('passed'),
      smoke: suite('passed'),
    },
    {
      id: 'playful',
      verification: runtime('partial'),
      smoke: suite('timeout'),
    },
  ])
  assert.equal(winner, 'rich')
})

test('preferReliableWinner does not pick runtime-failed over smoke peers', () => {
  const winner = preferReliableWinner('playful', [
    {
      id: 'minimal',
      verification: runtime('passed'),
      smoke: suite('passed'),
    },
    {
      id: 'rich',
      verification: runtime('partial'),
      smoke: suite('not_testable'),
    },
    {
      id: 'playful',
      verification: runtime('failed'),
      smoke: null,
    },
  ])
  assert.equal(winner, 'minimal')
})

test('tournament continuation model: one smoke fail still yields a winner', () => {
  // Simulates Phase 2c continuing after one candidate fails browser tests.
  const candidates = [
    {
      id: 'minimal' as const,
      verification: runtime('passed'),
      smoke: suite('passed'),
    },
    {
      id: 'rich' as const,
      verification: runtime('passed'),
      smoke: suite('failed'),
    },
    {
      id: 'playful' as const,
      verification: runtime('failed'),
      smoke: null,
    },
  ]
  const judged = 'rich'
  const enforced = preferReliableWinner(judged, candidates)
  assert.equal(enforced, 'minimal')
  assert.ok(candidates.every((c) => c.id)) // all three still present
})

test('candidate with no browser-testable route → not_testable suite helper', () => {
  const s = notTestableSuite('Missing preview URL for browser smoke testing')
  assert.equal(s.status, 'not_testable')
  assert.equal(shouldSmokeTest(runtime('failed')), false)
})

console.log(`\n${passed} tests passed`)
if (process.exitCode) process.exit(process.exitCode)

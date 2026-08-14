/**
 * Deterministic Part 6 interaction-contract tests (no Playwright / E2B / LLM).
 * Run: npx tsx lib/contracts.test.ts
 */
import assert from 'node:assert/strict'
import {
  applicationPlanSchema,
  formatContractsForJudge,
  formatInteractionContractsForGeneration,
  formatPlanForJudge,
  interactionContractSchema,
  normalizeApplicationPlan,
  validateInteractionContract,
  type ApplicationPlan,
  type InteractionContract,
} from './plan'
import {
  contractStepToSmokeAction,
  contractsToSmokeTests,
  deriveSmokeTests,
  formatSmokeForJudge,
  preferReliableWinner,
  type SmokeSuiteResult,
} from './smoke'
import type { VerificationResult } from './verification'

function makeContract(
  overrides: Partial<InteractionContract> &
    Pick<InteractionContract, 'id' | 'steps'> ,
): InteractionContract {
  return {
    name: overrides.name || overrides.id,
    purpose: overrides.purpose || 'Test purpose',
    route: overrides.route || '/',
    priority: overrides.priority || 'critical',
    action: overrides.action || 'Do the thing',
    expectedOutcome: overrides.expectedOutcome || 'Thing happened',
    ...overrides,
  }
}

function makePlan(overrides: Partial<ApplicationPlan> = {}): ApplicationPlan {
  return {
    applicationType: 'productivity tool',
    complexity: 'medium',
    productName: 'TaskFlow',
    productGoal: 'Help teams track tasks',
    targetUsers: 'PMs',
    problemStatement: 'Tasks get lost',
    primaryUserGoal: 'Create and complete tasks',
    coreFeatures: ['create tasks', 'complete tasks'],
    secondaryFeatures: [],
    outOfScope: ['billing'],
    pages: [
      { name: 'Tasks', path: '/tasks', purpose: 'Task list' },
    ],
    userFlows: ['Create task → Complete task'],
    dataApproach: 'in-memory',
    needsAuth: false,
    needsBackend: false,
    architectureSummary: 'Client state',
    designDirection: {
      tone: 'sharp',
      typography: 'sans',
      colorApproach: 'neutral',
      componentStyle: 'dense',
      interactionStyle: 'snappy',
    },
    sampleDataNotes: 'Realistic tasks',
    mustHaveInteractions: ['create task', 'complete task'],
    interactionContracts: [],
    documentation: 'none',
    ...overrides,
  }
}

function runtime(status: VerificationResult['status']): VerificationResult {
  return {
    status,
    filesWritten: true,
    dependenciesInstalled: status !== 'failed',
    processStarted: true,
    previewReachable: status !== 'failed',
    errors: status === 'failed' ? ['x'] : [],
    warnings: [],
    durationMs: 100,
  }
}

function suiteFrom(
  results: Array<{
    contractId: string
    priority: 'critical' | 'high' | 'medium'
    status: 'passed' | 'failed' | 'timeout'
  }>,
): SmokeSuiteResult {
  const tests = results.map((r) => ({
    status: r.status,
    testName: r.contractId,
    durationMs: 50,
    completedActions: r.status === 'passed' ? 3 : 1,
    contractId: r.contractId,
    priority: r.priority,
    error: r.status === 'passed' ? undefined : 'failed',
  }))
  const allPass = tests.every((t) => t.status === 'passed')
  return {
    status: allPass ? 'passed' : 'failed',
    tests,
    durationMs: 100,
    summary: `${tests.filter((t) => t.status === 'passed').length}/${tests.length} passed`,
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

test('valid interaction contract schema', () => {
  const c = makeContract({
    id: 'create_task',
    route: '/tasks',
    steps: [
      { type: 'goto', path: '/tasks' },
      { type: 'fill', role: 'textbox', name: 'Task title', value: 'Ship contracts' },
      { type: 'click', role: 'button', name: 'Create task' },
      { type: 'expect_text', text: 'Ship contracts' },
    ],
  })
  const ok = validateInteractionContract(c)
  assert.equal(ok.ok, true)
})

test('malformed contract rejected (bad id)', () => {
  const bad = validateInteractionContract({
    id: 'Create Task!',
    name: 'x',
    purpose: 'x',
    route: '/',
    priority: 'critical',
    action: 'x',
    expectedOutcome: 'x',
    steps: [{ type: 'goto', path: '/' }],
  })
  assert.equal(bad.ok, false)
})

test('contract with invalid action/step rejected', () => {
  const bad = interactionContractSchema.safeParse({
    id: 'create_task',
    name: 'Create',
    purpose: 'p',
    route: '/tasks',
    priority: 'critical',
    action: 'a',
    expectedOutcome: 'o',
    steps: [{ type: 'teleport', where: 'mars' }],
  })
  assert.equal(bad.success, false)
})

test('plan containing contracts parses', () => {
  const plan = makePlan({
    interactionContracts: [
      makeContract({
        id: 'create_item',
        priority: 'critical',
        steps: [
          { type: 'fill', role: 'textbox', name: 'Item', value: 'Alpha' },
          { type: 'click', role: 'button', name: 'Create item' },
          { type: 'expect_text', text: 'Alpha' },
        ],
      }),
      makeContract({
        id: 'complete_item',
        priority: 'high',
        steps: [
          { type: 'click', role: 'checkbox', name: 'Alpha' },
          { type: 'expect_text', text: 'completed' },
        ],
      }),
    ],
  })
  const parsed = applicationPlanSchema.safeParse(plan)
  assert.equal(parsed.success, true)
  if (parsed.success) {
    assert.equal(parsed.data.interactionContracts.length, 2)
  }
})

test('legacy plan without contracts normalizes safely', () => {
  const legacy = makePlan()
  delete (legacy as any).interactionContracts
  const normalized = normalizeApplicationPlan({
    ...legacy,
    interactionContracts: undefined as any,
  })
  assert.deepEqual(normalized.interactionContracts, [])
  // deriveSmokeTests must not throw
  const tests = deriveSmokeTests(normalized)
  assert.ok(tests.length >= 1)
})

test('contract → smoke conversion preserves names and values', () => {
  const tests = contractsToSmokeTests([
    makeContract({
      id: 'create_task',
      name: 'Create task',
      route: '/tasks',
      priority: 'critical',
      expectedOutcome: 'Task appears',
      steps: [
        { type: 'goto', path: '/tasks' },
        {
          type: 'fill',
          role: 'textbox',
          name: 'Task title',
          value: 'Smoke Test Item',
        },
        { type: 'click', role: 'button', name: 'Create task' },
        { type: 'expect_text', text: 'Smoke Test Item' },
      ],
    }),
  ])
  assert.equal(tests.length, 1)
  assert.equal(tests[0].contractId, 'create_task')
  assert.equal(tests[0].priority, 'critical')
  assert.ok(
    tests[0].actions.some(
      (a) => a.type === 'clickRole' && a.name === 'Create task',
    ),
  )
  assert.ok(
    tests[0].actions.some(
      (a) => a.type === 'fillRole' && a.value === 'Smoke Test Item',
    ),
  )
})

test('missing route defaults via normalize in conversion', () => {
  const tests = contractsToSmokeTests([
    makeContract({
      id: 'open_home',
      route: '',
      steps: [{ type: 'expect_heading' }],
    }),
  ])
  assert.equal(tests.length, 1)
  assert.equal(tests[0].route, '/')
  assert.equal(tests[0].actions[0].type, 'goto')
})

test('calculator contract converts to 2+2→4 flow', () => {
  const tests = contractsToSmokeTests([
    makeContract({
      id: 'perform_calculation',
      name: 'Perform calculation',
      priority: 'critical',
      steps: [
        { type: 'click_text', text: '2' },
        { type: 'click_text', text: '+' },
        { type: 'click_text', text: '2' },
        { type: 'click_text', text: '=' },
        { type: 'expect_text', text: '4' },
      ],
    }),
  ])
  assert.equal(tests[0].actions.filter((a) => a.type === 'clickText').length, 4)
  assert.ok(
    tests[0].actions.some((a) => a.type === 'expectText' && a.text === '4'),
  )
})

test('landing CTA contract converts', () => {
  const tests = contractsToSmokeTests([
    makeContract({
      id: 'primary_cta_navigation',
      route: '/',
      steps: [
        { type: 'click', role: 'link', name: 'Get started' },
        { type: 'expect_url', includes: '/signup' },
      ],
    }),
  ])
  assert.equal(tests[0].contractId, 'primary_cta_navigation')
  assert.ok(
    tests[0].actions.some(
      (a) => a.type === 'clickRole' && a.name === 'Get started',
    ),
  )
})

test('CRM contracts create + search', () => {
  const tests = contractsToSmokeTests([
    makeContract({
      id: 'create_contact',
      priority: 'critical',
      route: '/contacts',
      steps: [
        { type: 'fill', role: 'textbox', name: 'Name', value: 'Ada Lovelace' },
        { type: 'click', role: 'button', name: 'Create contact' },
        { type: 'expect_text', text: 'Ada Lovelace' },
      ],
    }),
    makeContract({
      id: 'search_contacts',
      priority: 'high',
      route: '/contacts',
      steps: [
        { type: 'fill', role: 'searchbox', name: 'Search', value: 'Ada' },
        { type: 'expect_text', text: 'Ada Lovelace' },
      ],
    }),
  ])
  assert.equal(tests.length, 2)
  assert.equal(tests[0].contractId, 'create_contact')
  assert.equal(tests[1].contractId, 'search_contacts')
})

test('deriveSmokeTests prefers contracts over heuristics', () => {
  const plan = makePlan({
    applicationType: 'calculator',
    interactionContracts: [
      makeContract({
        id: 'perform_calculation',
        steps: [
          { type: 'click_text', text: '2' },
          { type: 'click_text', text: '+' },
          { type: 'click_text', text: '2' },
          { type: 'click_text', text: '=' },
          { type: 'expect_text', text: '4' },
        ],
      }),
    ],
  })
  const tests = deriveSmokeTests(plan)
  assert.equal(tests.length, 1)
  assert.equal(tests[0].contractId, 'perform_calculation')
})

test('priority ordering: critical before medium', () => {
  const tests = contractsToSmokeTests([
    makeContract({
      id: 'wishlist',
      priority: 'medium',
      steps: [{ type: 'click', role: 'button', name: 'Wishlist' }],
    }),
    makeContract({
      id: 'checkout',
      priority: 'critical',
      steps: [{ type: 'click', role: 'button', name: 'Checkout' }],
    }),
  ])
  assert.equal(tests[0].contractId, 'checkout')
  assert.equal(tests[1].contractId, 'wishlist')
})

test('contractStepToSmokeAction maps click_testid', () => {
  const a = contractStepToSmokeAction({
    type: 'click_testid',
    testId: 'complete-btn',
  })
  assert.deepEqual(a, { type: 'clickTestId', testId: 'complete-btn' })
})

test('judge formatting includes contracts and priorities', () => {
  const plan = makePlan({
    interactionContracts: [
      makeContract({
        id: 'create_task',
        priority: 'critical',
        steps: [{ type: 'click', role: 'button', name: 'Create task' }],
      }),
    ],
  })
  assert.match(formatPlanForJudge(plan), /create_task\[critical\]/)
  assert.match(formatContractsForJudge(plan.interactionContracts), /create_task/)
  assert.match(
    formatInteractionContractsForGeneration(plan.interactionContracts),
    /Create task/,
  )

  const smoke = suiteFrom([
    { contractId: 'create_task', priority: 'critical', status: 'passed' },
    { contractId: 'complete_task', priority: 'high', status: 'failed' },
  ])
  const judge = formatSmokeForJudge(smoke)
  assert.match(judge, /create_task/)
  assert.match(judge, /complete_task/)
  assert.match(judge, /\[critical\]/)
})

test('preferReliableWinner penalizes critical contract failure', () => {
  const winner = preferReliableWinner('rich', [
    {
      id: 'minimal',
      verification: runtime('passed'),
      smoke: suiteFrom([
        { contractId: 'create_task', priority: 'critical', status: 'passed' },
        { contractId: 'complete_task', priority: 'high', status: 'passed' },
      ]),
    },
    {
      id: 'rich',
      verification: runtime('passed'),
      smoke: suiteFrom([
        { contractId: 'create_task', priority: 'critical', status: 'failed' },
        { contractId: 'complete_task', priority: 'high', status: 'passed' },
      ]),
    },
    {
      id: 'playful',
      verification: runtime('passed'),
      smoke: suiteFrom([
        { contractId: 'create_task', priority: 'critical', status: 'passed' },
        { contractId: 'complete_task', priority: 'high', status: 'failed' },
      ]),
    },
  ])
  assert.equal(winner, 'minimal')
})

test('multiple contract results: medium fail does not beat critical pass peer casually', () => {
  const winner = preferReliableWinner('playful', [
    {
      id: 'minimal',
      verification: runtime('passed'),
      smoke: suiteFrom([
        { contractId: 'add_to_cart', priority: 'critical', status: 'passed' },
        { contractId: 'wishlist', priority: 'medium', status: 'failed' },
      ]),
    },
    {
      id: 'rich',
      verification: runtime('failed'),
      smoke: null,
    },
    {
      id: 'playful',
      verification: runtime('passed'),
      smoke: suiteFrom([
        { contractId: 'add_to_cart', priority: 'critical', status: 'failed' },
        { contractId: 'wishlist', priority: 'medium', status: 'passed' },
      ]),
    },
  ])
  assert.equal(winner, 'minimal')
})

console.log(`\n${passed} tests passed`)
if (process.exitCode) process.exit(process.exitCode)

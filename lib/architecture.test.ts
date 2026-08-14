/**
 * Deterministic Part 7 architecture decision tests (no LLM / E2B).
 * Run: npx tsx lib/architecture.test.ts
 */
import assert from 'node:assert/strict'
import {
  architecturePreset,
  formatArchitectureForGeneration,
  formatArchitectureForJudge,
  inferArchitectureRequirements,
  normalizeArchitectureRequirements,
  validateArchitectureConsistency,
  type ArchitectureRequirements,
} from './architecture'
import {
  applicationPlanSchema,
  formatPlanForJudge,
  normalizeApplicationPlan,
  type ApplicationPlan,
} from './plan'

function makePlan(overrides: Partial<ApplicationPlan> = {}): ApplicationPlan {
  return {
    applicationType: 'utility',
    complexity: 'simple',
    productName: 'Demo',
    productGoal: 'Demo app',
    targetUsers: 'Users',
    problemStatement: 'Need a demo',
    primaryUserGoal: 'Use the app',
    coreFeatures: ['core'],
    secondaryFeatures: [],
    outOfScope: [],
    pages: [{ name: 'Home', path: '/', purpose: 'Main' }],
    userFlows: ['Open app'],
    dataApproach: 'in-memory',
    needsAuth: false,
    needsBackend: false,
    architectureSummary: 'Simple UI',
    designDirection: {
      tone: 'clean',
      typography: 'sans',
      colorApproach: 'neutral',
      componentStyle: 'simple',
      interactionStyle: 'snappy',
    },
    sampleDataNotes: 'n/a',
    mustHaveInteractions: ['use app'],
    interactionContracts: [],
    documentation: 'none',
    ...overrides,
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

test('calculator: no db/backend/auth', () => {
  const a = architecturePreset('calculator')
  assert.equal(a.database.required, false)
  assert.equal(a.backend.required, false)
  assert.equal(a.authentication.required, false)
  assert.equal(a.persistence.strategy, 'none')
  assert.equal(validateArchitectureConsistency(a).ok, true)
})

test('portfolio: no db/backend/auth', () => {
  const a = architecturePreset('portfolio')
  assert.equal(a.database.required, false)
  assert.equal(a.backend.required, false)
  assert.equal(a.authentication.required, false)
})

test('personal todo: local persistence, no db/backend', () => {
  const a = architecturePreset('personal_todo')
  assert.equal(a.persistence.required, true)
  assert.equal(a.persistence.strategy, 'local')
  assert.equal(a.database.required, false)
  assert.equal(a.backend.required, false)
  assert.equal(a.authentication.required, false)
})

test('gym: db + backend + auth + roles', () => {
  const a = architecturePreset('gym')
  assert.equal(a.database.required, true)
  assert.equal(a.backend.required, true)
  assert.equal(a.authentication.required, true)
  assert.equal(a.authorization.required, true)
  assert.ok(a.authorization.roles.includes('admin'))
  assert.ok(a.authorization.roles.includes('trainer'))
  assert.ok(a.entities.includes('Member'))
  assert.equal(a.persistence.strategy, 'server')
  assert.equal(validateArchitectureConsistency(a).ok, true)
})

test('ecommerce: db + backend + auth + orders persistence', () => {
  const a = architecturePreset('ecommerce')
  assert.equal(a.database.required, true)
  assert.equal(a.backend.required, true)
  assert.equal(a.authentication.required, true)
  assert.equal(a.persistence.required, true)
  assert.ok(a.entities.includes('Order'))
  assert.ok(a.externalServices.services.includes('payments'))
})

test('public landing: no db/backend/auth', () => {
  const a = architecturePreset('landing')
  assert.equal(a.database.required, false)
  assert.equal(a.backend.required, false)
  assert.equal(a.authentication.required, false)
  assert.equal(a.persistence.strategy, 'none')
})

test('invalid: database without persistence is flagged then normalized', () => {
  const bad: ArchitectureRequirements = {
    ...architecturePreset('calculator'),
    database: {
      required: true,
      type: 'none',
      reason: 'wrong',
    },
    persistence: {
      required: false,
      strategy: 'none',
      reason: 'wrong',
    },
    backend: { required: false, reason: 'wrong' },
  }
  const before = validateArchitectureConsistency(bad)
  assert.equal(before.ok, false)
  assert.ok(before.issues.some((i) => i.code === 'db_without_persistence'))

  const fixed = normalizeArchitectureRequirements(bad)
  assert.equal(fixed.persistence.required, true)
  assert.equal(fixed.persistence.strategy, 'server')
  assert.equal(fixed.backend.required, true)
  assert.equal(fixed.database.type, 'relational')
  assert.equal(validateArchitectureConsistency(fixed).ok, true)
})

test('invalid: authz without authn is normalized', () => {
  const bad: ArchitectureRequirements = {
    ...architecturePreset('calculator'),
    authentication: { required: false, reason: 'no' },
    authorization: {
      required: true,
      roles: [],
      reason: 'roles needed',
    },
  }
  assert.equal(validateArchitectureConsistency(bad).ok, false)
  const fixed = normalizeArchitectureRequirements(bad)
  assert.equal(fixed.authentication.required, true)
  assert.ok(fixed.authorization.roles.length > 0)
})

test('legacy plan without architectureRequirements infers safely', () => {
  const legacy = makePlan({
    applicationType: 'calculator',
    productGoal: 'Simple calculator',
    needsAuth: false,
    needsBackend: false,
  })
  delete (legacy as any).architectureRequirements
  const normalized = normalizeApplicationPlan(legacy)
  assert.ok(normalized.architectureRequirements)
  assert.equal(normalized.architectureRequirements!.database.required, false)
  assert.equal(normalized.architectureRequirements!.backend.required, false)
  assert.equal(normalized.needsBackend, false)
})

test('legacy needsBackend=true infers server architecture', () => {
  const inferred = inferArchitectureRequirements({
    needsBackend: true,
    needsAuth: true,
    applicationType: 'SaaS CRM',
    productGoal: 'Multi-user CRM',
  })
  assert.equal(inferred.backend.required, true)
  assert.equal(inferred.database.required, true)
  assert.equal(inferred.authentication.required, true)
  assert.equal(inferred.persistence.strategy, 'server')
})

test('plan schema accepts architectureRequirements', () => {
  const plan = makePlan({
    architectureRequirements: architecturePreset('gym'),
    needsAuth: true,
    needsBackend: true,
    complexity: 'complex',
    applicationType: 'gym management',
    documentation: 'readme_and_env',
  })
  const parsed = applicationPlanSchema.safeParse(plan)
  assert.equal(parsed.success, true)
})

test('normalize upgrades documentation for full-stack', () => {
  const plan = normalizeApplicationPlan(
    makePlan({
      documentation: 'none',
      architectureRequirements: architecturePreset('gym'),
    }),
  )
  assert.equal(plan.documentation, 'readme_and_env')
  assert.equal(plan.needsAuth, true)
  assert.equal(plan.needsBackend, true)
})

test('generation + judge formatting include architecture decisions', () => {
  const arch = architecturePreset('gym')
  const gen = formatArchitectureForGeneration(arch)
  assert.match(gen, /Database: REQUIRED/)
  assert.match(gen, /admin/)
  assert.match(gen, /MUST NOT|NOT required|do NOT/i)

  const judge = formatArchitectureForJudge(arch)
  assert.match(judge, /relational/)
  assert.match(judge, /mock-only/i)

  const plan = normalizeApplicationPlan(
    makePlan({
      architectureRequirements: arch,
      applicationType: 'gym management',
    }),
  )
  assert.match(formatPlanForJudge(plan), /backend=true/)
})

test('personal todo inference from domain hints', () => {
  const a = inferArchitectureRequirements({
    applicationType: 'todo',
    productGoal: 'Personal todo list with local persistence',
    dataApproach: 'localStorage',
  })
  assert.equal(a.persistence.strategy, 'local')
  assert.equal(a.database.required, false)
  assert.equal(a.backend.required, false)
})

console.log(`\n${passed} tests passed`)
if (process.exitCode) process.exit(process.exitCode)

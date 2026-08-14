import type { ArchitectureComplianceResult } from '@/lib/architecture-compliance'
import {
  architectureComplianceRankDelta,
  hasCriticalArchitectureFailure,
} from '@/lib/architecture-compliance'
import {
  ApplicationPlan,
  ContractPriority,
  ContractStep,
  InteractionContract,
  normalizeApplicationPlan,
} from '@/lib/plan'
import { getTemplateId } from '@/lib/templates'
import { VerificationResult } from '@/lib/verification'
import { z } from 'zod'

export const smokeStatusSchema = z.enum([
  'passed',
  'failed',
  'timeout',
  'not_testable',
])

export type SmokeStatus = z.infer<typeof smokeStatusSchema>

export const smokeActionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('goto'),
    path: z.string(),
  }),
  z.object({
    type: z.literal('clickRole'),
    role: z.string(),
    name: z.string().optional(),
  }),
  z.object({
    type: z.literal('fillRole'),
    role: z.string(),
    name: z.string().optional(),
    value: z.string(),
    placeholder: z.string().optional(),
  }),
  z.object({
    type: z.literal('clickText'),
    text: z.string(),
  }),
  z.object({
    type: z.literal('press'),
    key: z.string(),
  }),
  z.object({
    type: z.literal('expectText'),
    text: z.string(),
  }),
  z.object({
    type: z.literal('expectUrl'),
    includes: z.string(),
  }),
  z.object({
    type: z.literal('expectHeading'),
    text: z.string().optional(),
  }),
  z.object({
    type: z.literal('clickTestId'),
    testId: z.string(),
  }),
])

export type SmokeAction = z.infer<typeof smokeActionSchema>

export const smokePrioritySchema = z.enum(['critical', 'high', 'medium'])

export const smokeTestSchema = z.object({
  name: z.string(),
  route: z.string(),
  actions: z.array(smokeActionSchema).min(1).max(12),
  expectedOutcome: z.string(),
  contractId: z.string().optional(),
  priority: smokePrioritySchema.optional(),
})

export type SmokeTest = z.infer<typeof smokeTestSchema>

export const smokeTestResultSchema = z.object({
  status: smokeStatusSchema,
  testName: z.string(),
  durationMs: z.number(),
  completedActions: z.number(),
  failedAction: z.string().optional(),
  error: z.string().optional(),
  evidence: z.string().optional(),
  contractId: z.string().optional(),
  priority: smokePrioritySchema.optional(),
})

export type SmokeTestResult = z.infer<typeof smokeTestResultSchema>

export const smokeSuiteResultSchema = z.object({
  status: smokeStatusSchema,
  tests: z.array(smokeTestResultSchema),
  durationMs: z.number(),
  summary: z.string(),
})

export type SmokeSuiteResult = z.infer<typeof smokeSuiteResultSchema>

/** Only runnable final verifications enter browser smoke testing. */
export function shouldSmokeTest(verification?: VerificationResult): boolean {
  return (
    !!verification &&
    (verification.status === 'passed' || verification.status === 'partial')
  )
}

export function isBrowserTestableTemplate(templateId?: string): boolean {
  if (!templateId) return false
  const id = getTemplateId(templateId)
  return id !== 'code-interpreter-v1'
}

/** Normalize plan page paths like pages/contacts.tsx → /contacts */
export function normalizeRoutePath(path: string): string {
  let p = (path || '/').trim()
  if (!p) return '/'
  p = p.replace(/\\/g, '/')
  // File-ish paths
  p = p.replace(/^pages\//, '/').replace(/^app\//, '/')
  p = p.replace(/\/page\.(tsx|jsx|ts|js)$/i, '')
  p = p.replace(/\.(tsx|jsx|ts|js|vue)$/i, '')
  p = p.replace(/\/index$/i, '/')
  if (!p.startsWith('/')) p = `/${p}`
  p = p.replace(/\/+/g, '/')
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1)
  return p || '/'
}

const PRIORITY_ORDER: Record<ContractPriority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
}

export function contractStepToSmokeAction(step: ContractStep): SmokeAction {
  switch (step.type) {
    case 'goto':
      return { type: 'goto', path: normalizeRoutePath(step.path) }
    case 'click':
      return { type: 'clickRole', role: step.role, name: step.name }
    case 'fill':
      return {
        type: 'fillRole',
        role: step.role ?? 'textbox',
        name: step.name,
        value: step.value,
        placeholder: step.placeholder,
      }
    case 'click_text':
      return { type: 'clickText', text: step.text }
    case 'press':
      return { type: 'press', key: step.key }
    case 'expect_text':
      return { type: 'expectText', text: step.text }
    case 'expect_url':
      return { type: 'expectUrl', includes: step.includes }
    case 'expect_heading':
      return { type: 'expectHeading', text: step.text }
    case 'click_testid':
      return { type: 'clickTestId', testId: step.testId }
    default: {
      const _exhaustive: never = step
      throw new Error(`Unknown contract step ${(_exhaustive as ContractStep).type}`)
    }
  }
}

/**
 * Convert shared InteractionContracts → deterministic SmokeTests.
 * Skips malformed contracts rather than crashing the tournament.
 */
export function contractsToSmokeTests(
  contracts: InteractionContract[] | undefined | null,
): SmokeTest[] {
  if (!contracts?.length) return []

  const sorted = [...contracts].sort(
    (a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority],
  )

  const tests: SmokeTest[] = []
  for (const c of sorted.slice(0, 5)) {
    if (!c.id || !c.steps?.length) continue
    const route = normalizeRoutePath(c.route || '/')
    const actions: SmokeAction[] = []

    // Ensure the flow starts on the contract route unless steps already goto.
    if (c.steps[0]?.type !== 'goto') {
      actions.push({ type: 'goto', path: route })
    }

    let invalid = false
    for (const step of c.steps) {
      try {
        actions.push(contractStepToSmokeAction(step))
      } catch {
        invalid = true
        break
      }
    }
    if (invalid || actions.length === 0) continue
    if (actions.length > 12) continue

    tests.push({
      name: c.name || c.id,
      route,
      actions,
      expectedOutcome: c.expectedOutcome || c.purpose || c.name,
      contractId: c.id,
      priority: c.priority,
    })
  }
  return tests
}

function blob(plan: ApplicationPlan): string {
  return [
    plan.applicationType,
    plan.productGoal,
    plan.primaryUserGoal,
    ...plan.coreFeatures,
    ...plan.mustHaveInteractions,
    ...plan.userFlows,
  ]
    .join(' ')
    .toLowerCase()
}

function looksLike(plan: ApplicationPlan, ...needles: string[]): boolean {
  const b = blob(plan)
  return needles.some((n) => b.includes(n.toLowerCase()))
}

/**
 * Legacy heuristic smoke flows when a plan has no interactionContracts.
 * Kept for backward compatibility only.
 */
function deriveHeuristicSmokeTests(plan: ApplicationPlan | null): SmokeTest[] {
  const tests: SmokeTest[] = []

  const homeRoute =
    plan?.pages?.[0] != null
      ? normalizeRoutePath(plan.pages[0].path)
      : '/'

  tests.push({
    name: 'Open primary route',
    route: homeRoute,
    expectedOutcome: 'Page loads with visible content (not a blank/error shell)',
    priority: 'critical',
    actions: [
      { type: 'goto', path: homeRoute },
      { type: 'expectHeading' },
    ],
  })

  if (!plan) {
    return tests.slice(0, 1)
  }

  if (looksLike(plan, 'calculator', 'calc', 'arithmetic')) {
    tests.push({
      name: 'Perform a calculation',
      route: homeRoute,
      expectedOutcome: 'Entering 2 + 2 yields a visible result',
      priority: 'critical',
      actions: [
        { type: 'goto', path: homeRoute },
        { type: 'clickText', text: '2' },
        { type: 'clickText', text: '+' },
        { type: 'clickText', text: '2' },
        { type: 'clickText', text: '=' },
        { type: 'expectText', text: '4' },
      ],
    })
    return tests.slice(0, 3)
  }

  if (
    looksLike(
      plan,
      'todo',
      'task',
      'crm',
      'contact',
      'project',
      'add item',
      'create',
    )
  ) {
    const sample =
      looksLike(plan, 'contact', 'crm')
        ? 'Smoke Test Contact'
        : looksLike(plan, 'project')
          ? 'Smoke Test Project'
          : 'Smoke Test Item'

    tests.push({
      name: 'Create a primary record',
      route: homeRoute,
      expectedOutcome: `Can add "${sample}" and see it appear`,
      priority: 'critical',
      actions: [
        { type: 'goto', path: homeRoute },
        {
          type: 'fillRole',
          role: 'textbox',
          value: sample,
        },
        {
          type: 'clickRole',
          role: 'button',
          name: '(add|create|save|submit|new)',
        },
        { type: 'expectText', text: sample },
      ],
    })
  }

  const secondary = plan.pages.find((p, i) => {
    if (i === 0) return false
    const route = normalizeRoutePath(p.path)
    return route !== homeRoute && route !== '/'
  })
  if (secondary && tests.length < 3) {
    const route = normalizeRoutePath(secondary.path)
    tests.push({
      name: `Open ${secondary.name}`,
      route,
      expectedOutcome: `${secondary.name} route is reachable`,
      priority: 'high',
      actions: [
        { type: 'goto', path: route },
        { type: 'expectUrl', includes: route === '/' ? '' : route },
        { type: 'expectHeading', text: secondary.name.split(' ')[0] },
      ],
    })
  }

  if (
    tests.length < 3 &&
    looksLike(plan, 'landing', 'marketing', 'portfolio', 'homepage')
  ) {
    tests.push({
      name: 'Primary CTA is interactive',
      route: homeRoute,
      expectedOutcome: 'A primary button/link can be activated',
      priority: 'critical',
      actions: [
        { type: 'goto', path: homeRoute },
        {
          type: 'clickRole',
          role: 'link',
          name: '(get started|sign up|learn more|start|demo|try)',
        },
      ],
    })
  }

  if (tests.length === 1) {
    tests.push({
      name: 'Primary control responds',
      route: homeRoute,
      expectedOutcome: 'A main button can be clicked without crashing the page',
      priority: 'medium',
      actions: [
        { type: 'goto', path: homeRoute },
        {
          type: 'clickRole',
          role: 'button',
        },
        { type: 'expectHeading' },
      ],
    })
  }

  return tests.slice(0, 3)
}

/**
 * Prefer plan.interactionContracts → SmokeTests.
 * Fall back to heuristics when contracts are missing (legacy plans).
 */
export function deriveSmokeTests(plan: ApplicationPlan | null): SmokeTest[] {
  if (!plan) return deriveHeuristicSmokeTests(null)

  const normalized = normalizeApplicationPlan(plan)
  const fromContracts = contractsToSmokeTests(normalized.interactionContracts)
  if (fromContracts.length > 0) {
    return fromContracts.slice(0, 5)
  }
  return deriveHeuristicSmokeTests(normalized)
}

export function validateSmokeSuiteResult(
  value: unknown,
):
  | { ok: true; result: SmokeSuiteResult }
  | { ok: false; error: string } {
  const parsed = smokeSuiteResultSchema.safeParse(value)
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues
        .slice(0, 3)
        .map((i) => i.message)
        .join('; '),
    }
  }
  return { ok: true, result: parsed.data }
}

export function formatSmokeForJudge(suite?: SmokeSuiteResult | null): string {
  if (!suite) return 'Browser smoke: (not run)'
  const lines = suite.tests.map((t) => {
    const err = t.error ? ` — ${t.error}` : ''
    const id = t.contractId ? ` (${t.contractId})` : ''
    const pri = t.priority ? ` [${t.priority}]` : ''
    return `- ${t.testName}${id}${pri}: ${t.status.toUpperCase()}${err}`
  })
  const criticalFails = suite.tests.filter(
    (t) =>
      t.priority === 'critical' &&
      (t.status === 'failed' || t.status === 'timeout'),
  )
  const criticalNote = criticalFails.length
    ? `\nCRITICAL contract failures: ${criticalFails.map((t) => t.contractId || t.testName).join(', ')}`
    : ''
  return `Browser smoke: ${suite.status.toUpperCase()} (${suite.durationMs}ms)
${suite.summary}${criticalNote}
${lines.join('\n') || '- (no tests)'}`
}

export function smokePassCount(suite?: SmokeSuiteResult | null): {
  passed: number
  total: number
} {
  if (!suite?.tests?.length) return { passed: 0, total: 0 }
  const total = suite.tests.length
  const passed = suite.tests.filter((t) => t.status === 'passed').length
  return { passed, total }
}

export function notTestableSuite(reason: string): SmokeSuiteResult {
  return {
    status: 'not_testable',
    tests: [
      {
        status: 'not_testable',
        testName: 'Browser smoke',
        durationMs: 0,
        completedActions: 0,
        error: reason,
        evidence: reason,
      },
    ],
    durationMs: 0,
    summary: reason,
  }
}

function smokeRankDelta(suite?: SmokeSuiteResult | null): number {
  if (!suite || suite.status === 'not_testable') return 1
  if (!suite.tests.length) {
    if (suite.status === 'passed') return 3
    if (suite.status === 'failed' || suite.status === 'timeout') return -2
    return 0
  }

  let score = 0
  for (const t of suite.tests) {
    const weight =
      t.priority === 'critical' ? 3 : t.priority === 'high' ? 2 : 1
    if (t.status === 'passed') score += weight
    else if (t.status === 'failed' || t.status === 'timeout') score -= weight * 2
  }
  return score
}

function hasCriticalSmokeFailure(suite?: SmokeSuiteResult | null): boolean {
  if (!suite) return false
  return suite.tests.some(
    (t) =>
      t.priority === 'critical' &&
      (t.status === 'failed' || t.status === 'timeout'),
  )
}

/** Extend preferRunnableWinner with smoke + architecture compliance evidence. */
export function preferReliableWinner<T extends { id: string }>(
  winnerId: T['id'],
  candidates: Array<{
    id: T['id']
    verification?: VerificationResult
    smoke?: SmokeSuiteResult | null
    architectureCompliance?: ArchitectureComplianceResult | null
  }>,
): T['id'] {
  const byId = new Map(candidates.map((c) => [c.id, c]))
  const current = byId.get(winnerId)

  const runtimeOk = (v?: VerificationResult) =>
    !!v && (v.status === 'passed' || v.status === 'partial')

  const smokeAcceptable = (s?: SmokeSuiteResult | null) =>
    !s ||
    s.status === 'passed' ||
    s.status === 'not_testable' ||
    (!hasCriticalSmokeFailure(s) && s.status !== 'timeout')

  const archOk = (a?: ArchitectureComplianceResult | null) =>
    !a || !hasCriticalArchitectureFailure(a)

  if (
    current &&
    runtimeOk(current.verification) &&
    smokeAcceptable(current.smoke) &&
    !hasCriticalSmokeFailure(current.smoke) &&
    archOk(current.architectureCompliance)
  ) {
    // Still prefer a peer that passed more critical contracts if current has any fail.
    if (
      (current.smoke?.status === 'failed' ||
        hasCriticalArchitectureFailure(current.architectureCompliance)) &&
      candidates.some(
        (c) =>
          c.id !== winnerId &&
          runtimeOk(c.verification) &&
          c.smoke?.status === 'passed' &&
          archOk(c.architectureCompliance),
      )
    ) {
      // fall through to ranking
    } else {
      return winnerId
    }
  }

  const rank = (c: (typeof candidates)[number]) => {
    let score = 0
    if (c.verification?.status === 'passed') score += 4
    else if (c.verification?.status === 'partial') score += 3
    score += smokeRankDelta(c.smoke)
    if (hasCriticalSmokeFailure(c.smoke)) score -= 4
    score += architectureComplianceRankDelta(c.architectureCompliance)
    if (hasCriticalArchitectureFailure(c.architectureCompliance)) score -= 4
    return score
  }

  const runnable = candidates.filter((c) => runtimeOk(c.verification))
  if (runnable.length === 0) return winnerId

  const best = [...runnable].sort((a, b) => rank(b) - rank(a))[0]
  return best.id
}

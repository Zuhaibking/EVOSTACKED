import {
  ArchitectureRequirements,
  architectureRequirementsSchema,
  formatArchitectureForGeneration,
  formatArchitectureForJudge,
  inferArchitectureRequirements,
  normalizeArchitectureRequirements,
} from '@/lib/architecture'
import { z } from 'zod'

export type { ArchitectureRequirements }
export {
  architectureRequirementsSchema,
  formatArchitectureForGeneration,
  formatArchitectureForJudge,
  inferArchitectureRequirements,
  normalizeArchitectureRequirements,
} from '@/lib/architecture'

/**
 * Shared, testable interaction contracts.
 * Planner, generator, Playwright smoke, and judge all consume the same objects.
 */
export const contractPrioritySchema = z.enum(['critical', 'high', 'medium'])

export type ContractPriority = z.infer<typeof contractPrioritySchema>

/**
 * Deterministic browser steps. Prefer accessible role + name.
 * Use testId only when semantic selectors are genuinely insufficient.
 */
export const contractStepSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('goto'),
    path: z.string().describe('Route to open, e.g. / or /tasks'),
  }),
  z.object({
    type: z.literal('click'),
    role: z
      .enum(['button', 'link', 'menuitem', 'tab', 'checkbox', 'radio', 'switch'])
      .describe('ARIA role of the control'),
    name: z
      .string()
      .describe(
        'Exact accessible name every candidate MUST expose (aria-label or visible text). Case-insensitive match.',
      ),
  }),
  z.object({
    type: z.literal('fill'),
    role: z
      .enum(['textbox', 'searchbox', 'spinbutton'])
      .default('textbox')
      .describe('ARIA role of the input'),
    name: z
      .string()
      .optional()
      .describe('Accessible name / label every candidate MUST expose for this field'),
    placeholder: z
      .string()
      .optional()
      .describe('Optional placeholder fallback if name alone is insufficient'),
    value: z.string().describe('Exact sample value the smoke test will type'),
  }),
  z.object({
    type: z.literal('click_text'),
    text: z
      .string()
      .describe('Exact visible text to click (e.g. calculator digit "2")'),
  }),
  z.object({
    type: z.literal('press'),
    key: z.string().describe('Keyboard key, e.g. Enter'),
  }),
  z.object({
    type: z.literal('expect_text'),
    text: z
      .string()
      .describe('Text that must become visible after the action'),
  }),
  z.object({
    type: z.literal('expect_url'),
    includes: z.string().describe('Substring the URL must include'),
  }),
  z.object({
    type: z.literal('expect_heading'),
    text: z
      .string()
      .optional()
      .describe('Optional heading accessible name; omit to accept any heading/body content'),
  }),
  z.object({
    type: z.literal('click_testid'),
    testId: z
      .string()
      .describe(
        'data-testid value. Use ONLY when role+name cannot express the control. Generator must set the same data-testid.',
      ),
  }),
])

export type ContractStep = z.infer<typeof contractStepSchema>

export const interactionContractSchema = z.object({
  id: z
    .string()
    .regex(/^[a-z][a-z0-9_]*$/, 'id must be snake_case')
    .describe('Stable id, e.g. create_task, perform_calculation, primary_cta_navigation'),
  name: z.string().describe('Short human label, e.g. Create task'),
  purpose: z.string().describe('Why this interaction exists for the product'),
  route: z
    .string()
    .describe('Primary route where the interaction starts (e.g. /, /tasks)'),
  priority: contractPrioritySchema.describe(
    'critical = must work for a viable product; high = core; medium = secondary',
  ),
  action: z
    .string()
    .describe(
      'Human description of the user journey, e.g. "Open create control → enter title → submit"',
    ),
  expectedOutcome: z
    .string()
    .describe('Observable result, e.g. "New task appears in the list"'),
  steps: z
    .array(contractStepSchema)
    .min(1)
    .max(12)
    .describe(
      'Deterministic browser steps shared by all candidates. Accessible names in steps are LAW for UI labels.',
    ),
})

export type InteractionContract = z.infer<typeof interactionContractSchema>

/**
 * Shared product plan produced once per tournament (and optionally for heavy chat).
 * Feeds all 3 candidates so they implement the same requirements with different
 * product interpretations — not three independent guesses.
 */
export const applicationPlanSchema = z.object({
  applicationType: z
    .string()
    .describe(
      'Short classification, e.g. landing page, dashboard, SaaS, CRM, e-commerce, portfolio, utility, AI app, admin panel, productivity tool, data viz, game, other.',
    ),
  complexity: z
    .enum(['simple', 'medium', 'complex'])
    .describe(
      'simple = calculator/landing/portfolio; medium = dashboard/task manager/blog; complex = CRM/SaaS/e-commerce/AI workspace. Prefer the lowest complexity that still fulfills the brief.',
    ),
  productName: z
    .string()
    .describe('Plausible product name (2–4 words).'),
  productGoal: z
    .string()
    .describe('One sentence: what is being built and why it exists.'),
  targetUsers: z
    .string()
    .describe('Who this is for (roles / personas).'),
  problemStatement: z
    .string()
    .describe('The user problem this product solves.'),
  primaryUserGoal: z
    .string()
    .describe('The single most important job the user must complete.'),
  coreFeatures: z
    .array(z.string())
    .describe(
      'Must-have features every candidate must implement. Be concrete and testable. Keep the list tight.',
    ),
  secondaryFeatures: z
    .array(z.string())
    .describe(
      'Nice-to-have features only if complexity allows. Empty for simple apps.',
    ),
  outOfScope: z
    .array(z.string())
    .describe(
      'Explicit non-goals to prevent overengineering (e.g. real payments, production auth, multi-tenant billing).',
    ),
  pages: z
    .array(
      z.object({
        name: z.string().describe('Page or screen name.'),
        path: z
          .string()
          .describe(
            'Route or entry hint appropriate to the template (e.g. /, /dashboard, pages/contacts.tsx).',
          ),
        purpose: z.string().describe('Why this screen exists.'),
      }),
    )
    .describe(
      'Only screens the product actually needs. A calculator may be one screen; a SaaS may have several.',
    ),
  userFlows: z
    .array(z.string())
    .describe(
      'Primary journeys as short arrows, e.g. "Landing → Dashboard → Create project → Add task → Complete task".',
    ),
  dataApproach: z
    .string()
    .describe(
      'How data works in this sandbox app: in-memory state, mock modules, localStorage, etc. Prefer mock/local unless a real backend is essential and feasible in-template.',
    ),
  needsAuth: z
    .boolean()
    .describe(
      'Legacy mirror of architectureRequirements.authentication.required. Keep consistent with architectureRequirements.',
    ),
  needsBackend: z
    .boolean()
    .describe(
      'Legacy mirror of architectureRequirements.backend.required. Keep consistent with architectureRequirements.',
    ),
  architectureRequirements: architectureRequirementsSchema
    .optional()
    .describe(
      'Minimum architecture that fully satisfies the product. Do NOT overengineer: calculator=frontend+state; personal todo=local persistence; gym/e-commerce=backend+DB+auth(+roles). Every significant decision needs a reason.',
    ),
  architectureSummary: z
    .string()
    .describe(
      '2–4 sentences: folders/modules, state placement, and how pages share components/data — aligned with architectureRequirements.',
    ),
  designDirection: z
    .object({
      tone: z
        .string()
        .describe('Overall product feel (e.g. calm fintech, sharp developer tool).'),
      typography: z.string().describe('Type approach (display + body pairing intent).'),
      colorApproach: z
        .string()
        .describe('Palette strategy tied to the product domain — not random purple gradients.'),
      componentStyle: z
        .string()
        .describe('Borders, radius, density, elevation — keep one coherent system.'),
      interactionStyle: z
        .string()
        .describe('How interactions feel (snappy, restrained, playful) without clutter.'),
    })
    .describe('Shared design system constraints all candidates should respect as a baseline.'),
  sampleDataNotes: z
    .string()
    .describe(
      'Guidance for realistic seed data (names, amounts, statuses) that demonstrates the product. No "User 1" / lorem ipsum.',
    ),
  mustHaveInteractions: z
    .array(z.string())
    .describe(
      'Concrete working interactions every candidate must implement (e.g. "Add contact form validates and appends to list", "Search filters table rows").',
    ),
  interactionContracts: z
    .array(interactionContractSchema)
    .max(5)
    .default([])
    .describe(
      '1–5 shared interaction contracts (fewer for simple apps). Same contracts for all 3 candidates. Each must include deterministic steps with exact accessible names the UI will expose.',
    ),
  documentation: z
    .enum(['none', 'readme', 'readme_and_env'])
    .describe(
      'none for simple utilities; readme for medium; readme_and_env when config is needed. README must be project-specific.',
    ),
})

export type ApplicationPlan = z.infer<typeof applicationPlanSchema>

function documentationForArchitecture(
  current: ApplicationPlan['documentation'],
  arch: ArchitectureRequirements,
): ApplicationPlan['documentation'] {
  const needsEnv =
    arch.backend.required ||
    arch.database.required ||
    arch.authentication.required ||
    arch.externalServices.required ||
    arch.fileStorage.required
  if (needsEnv) return 'readme_and_env'
  if (current === 'none' && arch.persistence.strategy === 'local') return 'readme'
  return current
}

function dataApproachFromArchitecture(arch: ArchitectureRequirements): string {
  if (arch.database.required) {
    return `Server/database persistence (${arch.database.type}); entities: ${arch.entities.join(', ') || 'see architecture'}.`
  }
  if (arch.persistence.strategy === 'local') {
    return 'Browser local persistence (localStorage/IndexedDB); no server database.'
  }
  if (arch.persistence.strategy === 'server') {
    return 'Server-backed persistence without necessarily a full DB (follow architectureRequirements).'
  }
  return 'In-memory / ephemeral client state only — no durable storage.'
}

/** Soft-parse / legacy plans missing contracts or architectureRequirements. */
export function normalizeApplicationPlan(plan: ApplicationPlan): ApplicationPlan {
  const interactionContracts = Array.isArray(plan.interactionContracts)
    ? plan.interactionContracts
    : []

  const rawArch =
    plan.architectureRequirements ??
    inferArchitectureRequirements({
      needsAuth: plan.needsAuth,
      needsBackend: plan.needsBackend,
      dataApproach: plan.dataApproach,
      complexity: plan.complexity,
      applicationType: plan.applicationType,
      productGoal: plan.productGoal,
    })

  const architectureRequirements =
    normalizeArchitectureRequirements(rawArch)

  return {
    ...plan,
    interactionContracts,
    architectureRequirements,
    needsAuth: architectureRequirements.authentication.required,
    needsBackend: architectureRequirements.backend.required,
    dataApproach:
      plan.dataApproach?.trim() ||
      dataApproachFromArchitecture(architectureRequirements),
    documentation: documentationForArchitecture(
      plan.documentation,
      architectureRequirements,
    ),
    architectureSummary:
      plan.architectureSummary?.trim() ||
      architectureRequirements.summary,
  }
}

export function validateInteractionContract(
  value: unknown,
):
  | { ok: true; contract: InteractionContract }
  | { ok: false; error: string } {
  const parsed = interactionContractSchema.safeParse(value)
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; '),
    }
  }
  return { ok: true, contract: parsed.data }
}

export const PLANNING_SYSTEM_PROMPT = `You are a product architect planning a runnable sandbox application.

Analyze the user's request and produce a precise ApplicationPlan in ONE response (product + contracts + architecture).

Rules:
- Match complexity to the request. Do not inflate a simple ask into a SaaS.
- Prefer the fewest pages/features that still deliver a coherent product.
- Every coreFeature and mustHaveInteraction must be implementable without inventing unpaid external services.
- Design direction must fit the product domain (finance ≠ portfolio ≠ developer tool).
- Forbid generic AI UI defaults as the plan's intent: no random purple gradients, glassmorphism for its own sake, fake KPI walls, or decorative cards with no job.
- Sample data notes must be realistic and domain-specific.

## Architecture requirements (CRITICAL — minimum that satisfies the product)
Fill architectureRequirements with reasons for every significant decision.
Principle: THE SIMPLEST ARCHITECTURE THAT FULLY SATISFIES THE USER'S REQUIREMENTS.

Decision guide:
- Persistence: Does data need to survive refresh/sessions? If no → strategy=none. If personal single-user → local. If shared/multi-user/business records → server (+ usually database).
- Backend: required only for shared multi-user data, protected ops, secrets, payments, DB access, webhooks, privileged integrations. Otherwise false.
- Database: only when structured/shared durable data needs one. Never because the app "feels complex." Prefer relational for related business records; document when that fits better; type=none when not required.
- Authentication: only for accounts, private data, staff/admin, protected resources. Never on a public landing/calculator/portfolio.
- Authorization: only when roles differ (e.g. admin/receptionist/trainer). Include roles[]. Never invent roles.
- File storage / external services: only if genuinely required. Never invent integrations. No real secrets — placeholders only later.

Examples:
- Calculator / portfolio / public landing → no backend, no database, no auth; persistence none (calculator may use component state).
- Personal todo → local persistence; no backend/database/auth.
- Gym management → backend + relational DB + authentication + authorization roles (admin, receptionist, trainer) + entities (Member, Membership, Payment, Attendance, Trainer).
- E-commerce → backend + DB + auth + orders; external payments service if checkout is in scope.

Consistency:
- database.required ⇒ persistence.required + persistence.strategy=server + backend.required
- authorization.required ⇒ authentication.required + non-empty roles
- Keep needsAuth/needsBackend mirrors consistent with architectureRequirements
- Set documentation to readme_and_env when backend/db/auth/external config is needed; simpler apps may use readme or none

If infrastructure cannot be fully provisioned in a sandbox, still REQUIRE the correct architecture layers and note limitations in sampleDataNotes/outOfScope — do NOT silently downgrade a gym system to mock-only.

## Interaction contracts (CRITICAL)
- Produce 1–5 interactionContracts covering the product's most important user-facing behaviors.
- simple apps: usually 1–2 contracts. medium: 2–4. complex: up to 5. Never invent dozens.
- Examples: calculator → perform_calculation; todo → create_item + complete_item; CRM → create_contact + search_contacts; landing → primary_cta_navigation; gym → create_member / record_attendance.
- All three tournament candidates will receive THESE SAME contracts — they must be product requirements, not candidate-specific.
- For each contract, write deterministic steps that a browser test can execute:
  - Prefer role + accessible name (button/link/textbox).
  - Accessible names in steps are LAW: every candidate MUST expose those exact labels (case-insensitive).
  - Include sample fill values and expect_text outcomes that prove the behavior worked.
  - Use click_testid ONLY when semantic selectors cannot express the control.
- Mark priority: critical for make-or-break flows, high for core, medium for secondary.
- Do NOT put secrets, API keys, or credentials in contracts.

Output only fields in the schema. Be concrete, not vague.`

/** Compact spec injected into each candidate's system prompt. */
export function formatApplicationPlan(plan: ApplicationPlan): string {
  const pages = plan.pages
    .map((p) => `- ${p.name} (${p.path}): ${p.purpose}`)
    .join('\n')
  const bullets = (items: string[]) =>
    items.length ? items.map((i) => `- ${i}`).join('\n') : '- (none)'

  return `## SHARED PRODUCT SPEC (mandatory for every candidate)
All three tournament specimens must satisfy this same specification.
Differentiate on product interpretation / UX craft — never by omitting core requirements.

### Product
- Type: ${plan.applicationType}
- Complexity: ${plan.complexity}
- Name: ${plan.productName}
- Goal: ${plan.productGoal}
- Users: ${plan.targetUsers}
- Problem: ${plan.problemStatement}
- Primary user goal: ${plan.primaryUserGoal}

### Core features (MUST implement)
${bullets(plan.coreFeatures)}

### Secondary features (only if they fit complexity)
${bullets(plan.secondaryFeatures)}

### Out of scope (do NOT build)
${bullets(plan.outOfScope)}

### Pages / screens
${pages || '- (derive minimal set)'}

### User flows
${bullets(plan.userFlows)}

### Data & systems
- Data approach: ${plan.dataApproach}
- Needs auth: ${plan.needsAuth ? 'yes' : 'no'}
- Needs backend: ${plan.needsBackend ? 'yes' : 'no'}
- Architecture summary: ${plan.architectureSummary}

${
  plan.architectureRequirements
    ? formatArchitectureForGeneration(plan.architectureRequirements)
    : '### Architecture requirements\n- (infer minimum architecture; do not overengineer)'
}

### Design system baseline
- Tone: ${plan.designDirection.tone}
- Typography: ${plan.designDirection.typography}
- Color: ${plan.designDirection.colorApproach}
- Components: ${plan.designDirection.componentStyle}
- Interaction: ${plan.designDirection.interactionStyle}

### Realistic sample data
${plan.sampleDataNotes}

### Must-have working interactions
${bullets(plan.mustHaveInteractions)}

### Interaction contracts (SHARED — implement exactly; all candidates get the same)
${formatInteractionContractsForGeneration(plan.interactionContracts ?? [])}

### Documentation
- Level: ${plan.documentation}
${
  plan.documentation === 'none'
    ? '- Skip README/.env.example unless truly needed.'
    : plan.documentation === 'readme'
      ? '- Include a project-specific README.md (purpose, stack, structure, how to extend).'
      : '- Include README.md and .env.example with placeholder values only.'
}
`
}

/** Instruct the generator how to satisfy shared contracts with accessible UI. */
export function formatInteractionContractsForGeneration(
  contracts: InteractionContract[],
): string {
  if (!contracts.length) {
    return `- (none specified — still implement must-have interactions with clear accessible labels)`
  }

  return contracts
    .map((c) => {
      const steps = c.steps
        .map((s, i) => `  ${i + 1}. ${formatContractStepBrief(s)}`)
        .join('\n')
      return `#### Contract \`${c.id}\` [${c.priority}] — ${c.name}
- Purpose: ${c.purpose}
- Route: ${c.route}
- Action: ${c.action}
- Expected outcome: ${c.expectedOutcome}
- REQUIRED accessible UI (smoke tests use these exact names/values):
${steps}
- Implement this behavior. You may choose layout/visual craft freely, but controls MUST expose the accessible names above (aria-label or visible label text). Prefer semantic HTML. Use data-testid only if a contract step explicitly requires click_testid.`
    })
    .join('\n\n')
}

function formatContractStepBrief(step: ContractStep): string {
  switch (step.type) {
    case 'goto':
      return `navigate to ${step.path}`
    case 'click':
      return `click role=${step.role} name="${step.name}"`
    case 'fill':
      return `fill role=${step.role}${step.name ? ` name="${step.name}"` : ''}${step.placeholder ? ` placeholder="${step.placeholder}"` : ''} value="${step.value}"`
    case 'click_text':
      return `click text "${step.text}"`
    case 'press':
      return `press ${step.key}`
    case 'expect_text':
      return `then visible text must include "${step.text}"`
    case 'expect_url':
      return `then URL must include "${step.includes}"`
    case 'expect_heading':
      return step.text
        ? `then heading "${step.text}" visible`
        : `then a heading or substantial body content is visible`
    case 'click_testid':
      return `click data-testid="${step.testId}" (must set this test id)`
    default: {
      const _exhaustive: never = step
      return String((_exhaustive as ContractStep).type)
    }
  }
}

export function formatPlanForJudge(plan: ApplicationPlan): string {
  const contracts = plan.interactionContracts ?? []
  const contractLine = contracts.length
    ? contracts
        .map((c) => `${c.id}[${c.priority}]@${c.route}`)
        .join('; ')
    : 'n/a'
  const arch = plan.architectureRequirements
  const archLine = arch
    ? `persist=${arch.persistence.strategy}; backend=${arch.backend.required}; db=${arch.database.required ? arch.database.type : 'none'}; authn=${arch.authentication.required}; authz=${arch.authorization.required}`
    : 'n/a'
  return `SHARED REQUIREMENTS (score FIT against these):
type=${plan.applicationType}; complexity=${plan.complexity}; goal=${plan.productGoal}
core: ${plan.coreFeatures.join('; ')}
pages: ${plan.pages.map((p) => p.name).join(', ')}
interactions: ${plan.mustHaveInteractions.join('; ')}
contracts: ${contractLine}
architecture: ${archLine}
outOfScope: ${plan.outOfScope.join('; ') || 'n/a'}

${formatArchitectureForJudge(arch)}`
}

export function formatContractsForJudge(
  contracts?: InteractionContract[] | null,
): string {
  if (!contracts?.length) return 'Interaction contracts: (none)'
  return `Interaction contracts (shared product requirements):
${contracts
  .map(
    (c) =>
      `- ${c.id} [${c.priority}] ${c.name} @ ${c.route} → ${c.expectedOutcome}`,
  )
  .join('\n')}`
}

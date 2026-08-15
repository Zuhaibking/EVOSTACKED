/**
 * Deterministic Ask EvoStack tests — no LLM / provider / E2B / network.
 * Run: npm run test:ask-evostack
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  applyAskQuickAction,
  applyDesignStarter,
  ASK_QUICK_ACTIONS,
  askEvoStackCostCopy,
  buildAskEvoStackIterationContext,
  canSubmitAskEvoStack,
  composeAskEvoStackRequest,
  DESIGN_STARTER_PROMPTS,
  formatActiveVersionLabel,
  IMPROVEMENT_FOCUS,
  prepareAskEvoStackSubmit,
} from './ask-evostack'
import { architecturePreset } from './architecture'
import {
  createEvolutionRound,
  failEvolutionRound,
  ITERATION_CANDIDATE_COUNT,
  preserveBrainAfterFailedEvolution,
} from './evolution'
import { buildEvolutionPrompt } from './prompt'
import {
  createProjectBrain,
  selectActiveProjectVersion,
} from './project-brain'
import type { ApplicationPlan } from './plan'
import templates from './templates'

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

function tournamentBrain() {
  return createProjectBrain({
    plan: samplePlan(),
    fragment: baselineFragment() as any,
    winnerId: 'rich',
    now: '2026-08-15T12:00:00.000Z',
  })
}

function activeBrain() {
  const selected = selectActiveProjectVersion(tournamentBrain(), {
    candidateId: 'rich',
    fragment: baselineFragment() as any,
    summary: 'Active attendance app',
    now: '2026-08-15T12:00:00.000Z',
  })
  return {
    ...selected,
    currentVersion: 4,
    activeVersion: 4,
    activeCandidateId: 'rich' as const,
    versions: [
      {
        version: 1,
        label: 'rich selected',
        createdAt: '2026-08-15T12:00:00.000Z',
      },
      {
        version: 2,
        label: 'v2',
        createdAt: '2026-08-15T12:01:00.000Z',
      },
      {
        version: 3,
        label: 'v3',
        createdAt: '2026-08-15T12:02:00.000Z',
      },
      {
        version: 4,
        label: 'v4',
        createdAt: '2026-08-15T12:03:00.000Z',
      },
    ],
  }
}

function baselineFragment() {
  return {
    title: 'Attendance Manager',
    template: 'nextjs-developer' as const,
    file_path: 'pages/index.tsx',
    commentary: 'v4',
    description: 'Attendance',
    architecture: 'local',
    additional_dependencies: [] as string[],
    has_additional_dependencies: false,
    install_dependencies_command: '',
    port: 3000,
    code: [
      {
        file_path: 'pages/index.tsx',
        file_content: 'export default function Page(){ return <main>Ok</main> }',
      },
    ],
  }
}

// 1. General request builds correct iteration context
{
  const brain = activeBrain()
  const { context, composed, generationCount } = buildAskEvoStackIterationContext({
    brain,
    kind: 'general',
    text: 'Add a monthly attendance chart.',
    baselineFragment: baselineFragment(),
  })
  assert.equal(composed.kind, 'general')
  assert.match(context.userRequest, /GENERAL:/)
  assert.match(context.userRequest, /monthly attendance chart/)
  assert.equal(context.parentVersion, brain.currentVersion)
  assert.equal(context.activeCandidateId, 'rich')
  assert.equal(generationCount, 1)
  assert.ok(context.baselineFiles.length >= 1)
}

// 2. Design request adds design-specific instructions
{
  const composed = composeAskEvoStackRequest({
    kind: 'design',
    text: 'Use a dark glassmorphism style.',
  })
  assert.match(composed.userRequest, /DESIGN:/)
  assert.match(composed.userRequest, /visual hierarchy|typography|spacing|polish/i)
  assert.match(composed.userRequest, /dark glassmorphism/)
  const prompt = buildEvolutionPrompt({
    template: templates,
    plan: samplePlan(),
    userRequest: composed.userRequest,
    parentVersion: 4,
    productName: 'Attendance Manager',
  })
  assert.match(prompt, /DESIGN:/)
  assert.match(prompt, /glassmorphism/)
  assert.match(prompt, /EVOLUTION MODE/)
}

// 3. Mobile request adds responsive instructions
{
  const composed = composeAskEvoStackRequest({
    kind: 'mobile',
    text: 'Fix overflow on small screens.',
  })
  assert.match(composed.userRequest, /MOBILE:/)
  assert.match(composed.userRequest, /responsive|touch targets|mobile usability/i)
  assert.match(composed.userRequest, /overflow/)
}

// 4. UX request adds interaction instructions
{
  const composed = composeAskEvoStackRequest({
    kind: 'ux',
    text: 'Improve empty and loading states.',
  })
  assert.match(composed.userRequest, /UX:/)
  assert.match(composed.userRequest, /interaction flow|feedback|empty\/loading/i)
}

// 5. Feature request preserves architecture constraints
{
  const composed = composeAskEvoStackRequest({
    kind: 'feature',
    text: 'Add CSV export for attendance.',
  })
  assert.match(composed.userRequest, /FEATURE:/)
  assert.match(composed.userRequest, /preserving existing functionality and architecture/i)
  const prompt = buildEvolutionPrompt({
    template: templates,
    plan: samplePlan(),
    userRequest: composed.userRequest,
    parentVersion: 4,
  })
  assert.match(prompt, /Preserve working behavior|MODIFY the existing app/i)
  assert.match(prompt, /ApplicationPlan|architecture/i)
}

// 6. Ask EvoStack uses active version
{
  const brain = activeBrain()
  const { context } = buildAskEvoStackIterationContext({
    brain,
    kind: 'general',
    text: 'Polish the dashboard.',
    baselineFragment: baselineFragment(),
  })
  assert.equal(context.activeVersion ?? context.parentVersion, 4)
  assert.equal(
    formatActiveVersionLabel({
      version: brain.activeVersion,
      productName: brain.plan?.productName,
    }),
    'Active: v4 · Attendance Manager',
  )
}

// 7. No active version prevents submission
{
  const gate = canSubmitAskEvoStack({
    hasActiveVersion: false,
    text: 'Make it prettier',
  })
  assert.equal(gate.ok, false)
  assert.match(gate.reason || '', /select an application|Generate/i)

  const prep = prepareAskEvoStackSubmit({
    hasActiveVersion: false,
    text: 'Make it prettier',
    kind: 'design',
  })
  assert.equal(prep.ok, false)
  assert.equal(prep.generationCount, 0)
  assert.equal(prep.composed, undefined)
}

// 8. Quick actions do not trigger API calls automatically
{
  for (const action of ASK_QUICK_ACTIONS) {
    const applied = applyAskQuickAction(action.id)
    assert.equal(applied.autoSubmit, false)
    assert.ok(applied.seedText.length > 0)
  }
  for (const starter of DESIGN_STARTER_PROMPTS) {
    const applied = applyDesignStarter(starter)
    assert.equal(applied.autoSubmit, false)
    assert.equal(applied.kind, 'design')
    assert.equal(applied.seedText, starter)
  }
}

// 9. Submit triggers exactly one existing improvement operation
{
  const prep = prepareAskEvoStackSubmit({
    hasActiveVersion: true,
    text: 'Add a monthly attendance chart and make the dashboard more professional.',
    kind: 'general',
  })
  assert.equal(prep.ok, true)
  assert.equal(prep.generationCount, ITERATION_CANDIDATE_COUNT)
  assert.equal(prep.generationCount, 1)
  assert.equal(prep.composed?.generationCount, 1)
  assert.equal(prep.composed?.autoSubmit, false)

  // Simulate UI: one explicit submit callback
  let evolveCalls = 0
  const handleEvolve = (_req: string) => {
    evolveCalls += 1
  }
  if (prep.composed) handleEvolve(prep.composed.userRequest)
  assert.equal(evolveCalls, 1)

  const cost = askEvoStackCostCopy()
  assert.equal(cost.generations, 1)
  assert.match(cost.detail, /1 generation/)
}

// 10. Failed improvement preserves active version
{
  const brain = activeBrain()
  const before = brain.activeVersion
  const round = failEvolutionRound(
    createEvolutionRound({
      brain,
      userRequest: 'Break UI',
      candidateMode: 'single',
      activeVariantId: 'rich',
    }),
    'generation failed',
  )
  const kept = preserveBrainAfterFailedEvolution(brain, round)
  assert.equal(kept.activeVersion, before)
  assert.equal(kept.activeCandidateId, 'rich')
  assert.equal(kept.currentVersion, brain.currentVersion)
}

// 11. No new provider/API/E2B calls were introduced
{
  const src = fs.readFileSync(
    path.join(__dirname, 'ask-evostack.ts'),
    'utf8',
  )
  assert.doesNotMatch(src, /\bfetch\s*\(/)
  assert.doesNotMatch(src, /from ['"]@e2b/)
  assert.doesNotMatch(src, /openai|anthropic|createOpenAI|generateText|streamObject/i)
  assert.doesNotMatch(src, /setInterval|setTimeout\s*\(\s*[^,]+,\s*\d+/)
  // Focus table covers all kinds
  for (const kind of Object.keys(IMPROVEMENT_FOCUS)) {
    assert.ok(IMPROVEMENT_FOCUS[kind as keyof typeof IMPROVEMENT_FOCUS].length > 20)
  }
}

console.log('ask-evostack.test.ts: all tests passed')

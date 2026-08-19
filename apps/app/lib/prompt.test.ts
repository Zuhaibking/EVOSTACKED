/**
 * Generation / repair prompt hardening — no provider calls.
 * Run: npm run test:prompt
 */
import assert from 'node:assert/strict'
import { implementationChecklistPrompt, systemRulesPrompt, buildGenerationPrompt, buildEvolutionPrompt } from './prompt'
import {
  PLANNING_SYSTEM_PROMPT,
  buildFallbackApplicationPlan,
} from './plan'
import { formatMemoryForPrompt } from './memory-prompt'
import { REPAIR_SYSTEM_PROMPT } from './repair'
import { VARIANTS } from './tournament'
import templates from './templates'
import fs from 'node:fs'
import path from 'node:path'

{
  const rules = systemRulesPrompt()
  assert.match(rules, /@import must appear before ordinary CSS rules/)
  assert.match(rules, /@layer, @theme, @custom-variant/)
  assert.match(rules, /Do not emit truncated source/)
  assert.match(rules, /Never a generic SaaS card grid/)
  assert.match(rules, /Never wrap file_content in markdown fences/)
  assert.match(rules, /already renders an <a>/)
  const checklist = implementationChecklistPrompt()
  assert.match(checklist, /@import/)
  assert.match(checklist, /@layer\/@theme\/@plugin/)
  assert.match(checklist, /nested <a>/)
  assert.match(checklist, /empty, loading, and error\/feedback/)
  assert.match(checklist, /barren single-column stubs/)
  assert.match(checklist, /named people, statuses/)
}

{
  assert.match(REPAIR_SYSTEM_PROMPT, /If fixing CSS/)
  assert.match(REPAIR_SYSTEM_PROMPT, /Do not delete fonts, animations/)
  assert.match(REPAIR_SYSTEM_PROMPT, /never nest <a>/i)
}

{
  const morph = fs.readFileSync(
    path.join(process.cwd(), '../api/src/generation/morph.runner.ts'),
    'utf8',
  )
  assert.match(morph, /@import before ordinary rules/)
  assert.doesNotMatch(morph, /coffee shop|AquaClub/i)
}

{
  assert.match(VARIANTS[0].systemSuffix, /internal tool/)
  assert.match(VARIANTS[1].systemSuffix, /signature motif/)
  assert.match(VARIANTS[1].systemSuffix, /empty, loading, and error\/feedback/)
  assert.match(VARIANTS[1].systemSuffix, /Dense realistic content/)
  assert.match(VARIANTS[2].systemSuffix, /information architecture/)
}

{
  assert.match(PLANNING_SYSTEM_PROMPT, /enough screens\/sections/)
  assert.match(PLANNING_SYSTEM_PROMPT, /empty\/loading\/error/)
  const fallback = buildFallbackApplicationPlan(
    'Team kanban board for sprint tasks',
  )
  assert.equal(fallback.complexity, 'medium')
  assert.ok(fallback.coreFeatures.length >= 3)
  assert.match(fallback.sampleDataNotes, /empty|loading|error/i)
  assert.ok(fallback.interactionContracts.length >= 1)
}

{
  const memory = formatMemoryForPrompt({
    memoryItems: [
      {
        id: '1',
        kind: 'user_request',
        text: 'Build a gym membership dashboard',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: '2',
        kind: 'file_summary',
        text: 'pages/index.tsx: membership list + add member form',
        createdAt: '2026-01-02T00:00:00.000Z',
      },
    ],
    brain: {
      improvements: [
        { request: 'Make the add-member form validate email', note: 'Keep existing list' },
      ],
      fileTree: ['pages/index.tsx', 'components/MemberForm.tsx'],
    },
  })
  assert.match(memory, /Project memory/)
  assert.match(memory, /gym membership dashboard/)
  assert.match(memory, /add-member form/)
  assert.match(memory, /pages\/index\.tsx/)
  const gen = buildGenerationPrompt({
    template: templates,
    memoryContext: memory,
  })
  assert.match(gen, /Project memory/)
  assert.match(gen, /gym membership dashboard/)
  const evo = buildEvolutionPrompt({
    template: templates,
    memoryContext: memory,
    userRequest: 'Tighten spacing',
    parentVersion: 1,
  })
  assert.match(evo, /Project memory/)
  assert.match(evo, /EVOLUTION MODE/)
}

{
  const nextKey = Object.keys(templates).find((k) => k.includes('nextjs'))!
  const one = { [nextKey]: templates[nextKey as keyof typeof templates] } as typeof templates
  const gen = buildGenerationPrompt({
    template: one,
    variantDirection: 'VARIANT_STYLE_MARKER',
  })
  const guardAt = gen.indexOf('Stack guardrails')
  const styleAt = gen.indexOf('VARIANT_STYLE_MARKER')
  assert.ok(guardAt >= 0, 'expected stack guardrails')
  assert.ok(styleAt > guardAt, 'guardrails must precede variant style')
  assert.match(gen, /npx next --turbo/)
  assert.match(gen, /Pages Router/)
  assert.match(gen, /MUST generate this candidate using ONLY this template/)
  const evo = buildEvolutionPrompt({
    template: one,
    variantDirection: 'VARIANT_STYLE_MARKER',
    userRequest: 'Polish spacing',
    parentVersion: 1,
  })
  assert.ok(
    evo.indexOf('Stack guardrails') < evo.indexOf('VARIANT_STYLE_MARKER'),
  )
}

console.log('prompt.test.ts: all tests passed')

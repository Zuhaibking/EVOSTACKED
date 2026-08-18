/**
 * Generation / repair prompt hardening — no provider calls.
 * Run: npm run test:prompt
 */
import assert from 'node:assert/strict'
import { implementationChecklistPrompt, systemRulesPrompt } from './prompt'
import {
  PLANNING_SYSTEM_PROMPT,
  buildFallbackApplicationPlan,
} from './plan'
import { REPAIR_SYSTEM_PROMPT } from './repair'
import { VARIANTS } from './tournament'
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

console.log('prompt.test.ts: all tests passed')

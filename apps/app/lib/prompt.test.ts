/**
 * Generation / repair prompt hardening — no provider calls.
 * Run: npm run test:prompt
 */
import assert from 'node:assert/strict'
import { implementationChecklistPrompt, systemRulesPrompt } from './prompt'
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
  assert.match(VARIANTS[2].systemSuffix, /information architecture/)
}

console.log('prompt.test.ts: all tests passed')

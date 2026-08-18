/**
 * Landing product-demo timeline — zero network / Arena runtime.
 * Run: npm run test:product-demo
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  DEMO_CANDIDATES,
  DEMO_CYCLE_MS,
  DEMO_PROMPT,
  DEMO_TABS,
  DEMO_TAGLINE,
  demoClock,
  demoPhaseAt,
} from './landing-product-demo'

{
  assert.equal(demoPhaseAt(0), 'idle')
  assert.equal(demoPhaseAt(3_000), 'typing')
  assert.equal(demoPhaseAt(6_500), 'submit')
  assert.equal(demoPhaseAt(8_000), 'planning')
  assert.equal(demoPhaseAt(11_000), 'generating')
  assert.equal(demoPhaseAt(15_000), 'verifying')
  assert.equal(demoPhaseAt(18_000), 'switching')
  assert.equal(demoPhaseAt(22_000), 'ready')
}

{
  const typing = demoClock(3_200)
  assert.ok(typing.typed.length > 8)
  assert.notEqual(typing.typed, DEMO_PROMPT)
  assert.equal(typing.docked, false)
  assert.equal(typing.previewReady, false)
}

{
  const gen = demoClock(11_200)
  assert.equal(gen.statuses.minimal, 'Generating')
  assert.equal(gen.statuses.rich, 'Generating')
  assert.equal(gen.statuses.playful, 'Generating')
  assert.ok(gen.docked)
}

{
  const ready = demoClock(DEMO_CYCLE_MS - 200)
  assert.equal(ready.phase, 'ready')
  assert.equal(ready.statuses.minimal, 'Ready')
  assert.equal(ready.statuses.rich, 'Ready')
  assert.equal(ready.statuses.playful, 'Ready')
  assert.equal(ready.previewReady, true)
  assert.equal(ready.tab, 'Preview')
  assert.equal(ready.selected, 'rich')
}

{
  const wrap = demoClock(DEMO_CYCLE_MS + 400)
  assert.equal(wrap.phase, 'idle')
  assert.equal(wrap.previewReady, false)
}

{
  const sw = demoClock(17_200)
  assert.equal(sw.selected, 'rich')
  assert.equal(sw.statuses.minimal, 'Ready')
  assert.equal(sw.previewReady, true)
}

{
  assert.equal(
    DEMO_TAGLINE,
    'Describe it. EvoStack builds it. Three candidates. One working product.',
  )
  assert.deepEqual(
    DEMO_CANDIDATES.map((c) => c.label),
    ['Product', 'Premium', 'Innovate'],
  )
  assert.deepEqual([...DEMO_TABS], ['Preview', 'Design', 'Code', 'Database'])
}

{
  const page = fs.readFileSync(
    path.join(process.cwd(), 'app/page.tsx'),
    'utf8',
  )
  const demo = fs.readFileSync(
    path.join(process.cwd(), 'components/landing/product-demo.tsx'),
    'utf8',
  )
  assert.match(page, /ProductDemo/)
  assert.match(demo, /DEMO_TAGLINE/)
  assert.doesNotMatch(demo, /tournament\.runner|verify-candidate|handleTournament/)
}

console.log('landing-product-demo.test.ts: all tests passed')

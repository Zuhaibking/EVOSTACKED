/**
 * Deterministic hydration-safety tests — zero provider / E2B / network.
 * Run: npm run test:hydration-safety
 */
import assert from 'node:assert/strict'
import {
  detectHydrationRisksInSource,
  maskClientEffectBodies,
  shouldScanFileForHydration,
} from './hydration-safety'
import { validateFragmentIntegrity } from './fragment-integrity'
import type { FragmentSchema } from './schema'

// 1. Countdown with Date.now in render / useState — UNSAFE
{
  const unsafe = `
export default function Countdown({ end }: { end: number }) {
  const [left, setLeft] = useState(Math.max(0, end - Date.now()))
  return <span>{left}</span>
}
`
  const risks = detectHydrationRisksInSource(unsafe, {
    filePath: 'components/Countdown.tsx',
  })
  assert.ok(risks.some((r) => r.code === 'render_time_now'))
  assert.ok(risks.some((r) => r.severity === 'error'))
}

// 2. Safe countdown — Date.now only inside useEffect
{
  const safe = `
import { useEffect, useState } from 'react'
export default function Countdown({ end }: { end: number }) {
  const [left, setLeft] = useState<number | null>(null)
  useEffect(() => {
    const tick = () => setLeft(Math.max(0, end - Date.now()))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [end])
  if (left === null) return <span>00:00:00</span>
  return <span>{left}</span>
}
`
  const risks = detectHydrationRisksInSource(safe, {
    filePath: 'components/Countdown.tsx',
  })
  assert.equal(
    risks.filter((r) => r.severity === 'error').length,
    0,
    JSON.stringify(risks),
  )
}

// 3. new Date() no-args unsafe; fixed ISO date OK
{
  assert.ok(
    detectHydrationRisksInSource(`export const x = new Date()`, {
      filePath: 'a.tsx',
    }).some((r) => r.code === 'render_new_date'),
  )
  assert.equal(
    detectHydrationRisksInSource(
      `export const start = new Date('2026-12-01T00:00:00Z')`,
      { filePath: 'a.tsx' },
    ).filter((r) => r.code === 'render_new_date').length,
    0,
  )
}

// 4. Math.random in render unsafe; inside useEffect OK
{
  assert.ok(
    detectHydrationRisksInSource(
      `export default function X(){ return <p>{Math.random()}</p> }`,
      { filePath: 'x.tsx' },
    ).some((r) => r.code === 'render_random'),
  )
  assert.equal(
    detectHydrationRisksInSource(
      `useEffect(() => { const id = Math.random(); setId(id) }, [])`,
      { filePath: 'x.tsx' },
    ).filter((r) => r.code === 'render_random').length,
    0,
  )
}

// 5. localStorage in render unsafe
{
  assert.ok(
    detectHydrationRisksInSource(
      `const v = localStorage.getItem('k')`,
      { filePath: 'x.tsx' },
    ).some((r) => r.code === 'render_browser_api'),
  )
}

// 6. maskClientEffectBodies preserves non-effect Date.now
{
  const src = `const a = Date.now(); useEffect(() => { const b = Date.now() }, [])`
  const masked = maskClientEffectBodies(src)
  assert.match(masked, /const a = Date\.now/)
  assert.doesNotMatch(masked, /const b = Date\.now/)
}

// 7. Integrity integrates hydration errors
{
  const frag: FragmentSchema = {
    commentary: 'x',
    template: 'nextjs-developer',
    title: 'Event',
    description: 'x',
    architecture: 'pages',
    additional_dependencies: [],
    has_additional_dependencies: false,
    install_dependencies_command: '',
    port: 3000,
    file_path: 'pages/index.tsx',
    code: [
      {
        file_path: 'pages/index.tsx',
        file_content: `import { useState } from 'react'
export default function Home(){
  const [n] = useState(Date.now())
  return <main>{n}</main>
}`,
      },
    ],
  }
  const result = validateFragmentIntegrity(frag)
  assert.equal(result.ok, false)
  assert.ok(result.issues.some((i) => i.code === 'hydration_risk'))
}

// 8. Safe countdown fragment passes integrity
{
  const frag: FragmentSchema = {
    commentary: 'x',
    template: 'nextjs-developer',
    title: 'Event',
    description: 'x',
    architecture: 'pages',
    additional_dependencies: [],
    has_additional_dependencies: false,
    install_dependencies_command: '',
    port: 3000,
    file_path: 'pages/index.tsx',
    code: [
      {
        file_path: 'pages/index.tsx',
        file_content: `import { useEffect, useState } from 'react'
const END = new Date('2026-12-01T00:00:00Z').getTime()
export default function Home(){
  const [left, setLeft] = useState<number | null>(null)
  useEffect(() => {
    const tick = () => setLeft(Math.max(0, END - Date.now()))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [])
  return <main>{left === null ? '—' : left}</main>
}`,
      },
    ],
  }
  const result = validateFragmentIntegrity(frag)
  assert.equal(result.ok, true, JSON.stringify(result.issues))
}

// 9. shouldScanFileForHydration
{
  assert.equal(shouldScanFileForHydration('components/Hero.tsx'), true)
  assert.equal(shouldScanFileForHydration('styles.css'), false)
}

console.log('hydration-safety.test.ts: all tests passed')

/**
 * Deterministic hydration-safety tests — zero provider / E2B / network.
 * Run: npm run test:hydration-safety
 */
import assert from 'node:assert/strict'
import {
  detectHydrationRisksInSource,
  formatHydrationRepairHints,
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

// 10. Nested <a> inside Next.js Link is a hydration error
{
  const nested = `
import Link from 'next/link'
import { motion } from 'framer-motion'
export default function Card() {
  return (
    <Link href="/events">
      <motion.a whileHover={{ scale: 1.02 }} className="block">
        Open event
      </motion.a>
    </Link>
  )
}
`
  const risks = detectHydrationRisksInSource(nested, {
    filePath: 'components/EventCard.tsx',
  })
  assert.ok(
    risks.some((r) => r.code === 'nested_anchor' && r.severity === 'error'),
    JSON.stringify(risks),
  )
}

// 11. Link wrapping a native <a> is unsafe; legacyBehavior is allowed
{
  const nestedA = `
import Link from 'next/link'
export default function Nav() {
  return (
    <Link href="/about">
      <a className="nav">About</a>
    </Link>
  )
}
`
  assert.ok(
    detectHydrationRisksInSource(nestedA, { filePath: 'Nav.tsx' }).some(
      (r) => r.code === 'nested_anchor',
    ),
  )
  const legacy = `
import Link from 'next/link'
export default function Nav() {
  return (
    <Link href="/about" legacyBehavior>
      <a className="nav">About</a>
    </Link>
  )
}
`
  assert.equal(
    detectHydrationRisksInSource(legacy, { filePath: 'Nav.tsx' }).filter(
      (r) => r.code === 'nested_anchor',
    ).length,
    0,
    'legacyBehavior nested <a> is valid on Pages router',
  )
}

// 12. Safe Link (text / span / motion.div) is OK; wrapping Link in <a> is not
{
  const safe = `
import Link from 'next/link'
import { motion } from 'framer-motion'
export default function Nav() {
  return (
    <nav>
      <Link href="/about" className="nav">About</Link>
      <Link href="/blog"><span>Blog</span></Link>
      <motion.div whileHover={{ scale: 1.02 }}>
        <Link href="/x">X</Link>
      </motion.div>
    </nav>
  )
}
`
  assert.equal(
    detectHydrationRisksInSource(safe, { filePath: 'Nav.tsx' }).filter(
      (r) => r.code === 'nested_anchor',
    ).length,
    0,
    JSON.stringify(detectHydrationRisksInSource(safe, { filePath: 'Nav.tsx' })),
  )
  const wrap = `
import Link from 'next/link'
export default function Nav() {
  return (
    <a href="/dup">
      <Link href="/dup">Dup</Link>
    </a>
  )
}
`
  assert.ok(
    detectHydrationRisksInSource(wrap, { filePath: 'Nav.tsx' }).some(
      (r) => r.code === 'nested_anchor',
    ),
  )
}

// 13. Integrity flags nested anchors; repair hints mention Link
{
  const frag: FragmentSchema = {
    commentary: 'x',
    template: 'nextjs-developer',
    title: 'Events',
    description: 'x',
    architecture: 'pages',
    additional_dependencies: ['framer-motion'],
    has_additional_dependencies: true,
    install_dependencies_command: 'npm install framer-motion',
    port: 3000,
    file_path: 'pages/index.tsx',
    code: [
      {
        file_path: 'pages/index.tsx',
        file_content: `import Link from 'next/link'
import { motion } from 'framer-motion'
export default function Home(){
  return (
    <Link href="/tix">
      <motion.a className="card">Tickets</motion.a>
    </Link>
  )
}`,
      },
    ],
  }
  const result = validateFragmentIntegrity(frag)
  assert.equal(result.ok, false)
  assert.ok(result.issues.some((i) => i.code === 'hydration_risk'))
  const hints = formatHydrationRepairHints(
    detectHydrationRisksInSource(frag.code[0].file_content, {
      filePath: 'pages/index.tsx',
    }),
  )
  assert.match(hints, /motion\(Link\)|legacyBehavior|already renders/i)
}

console.log('hydration-safety.test.ts: all tests passed')

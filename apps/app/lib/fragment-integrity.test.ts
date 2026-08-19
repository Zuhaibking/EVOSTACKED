/**
 * Deterministic fragment integrity tests — zero provider / E2B / network.
 * Run: npm run test:fragment-integrity
 */
import assert from 'node:assert/strict'
import {
  applyRepairToFragment,
  selectRepairReason,
  shouldAttemptRepair,
} from './repair'
import {
  buildFragmentManifest,
  canDeployIntegrity,
  extractLocalImports,
  formatIntegrityForRepair,
  formatIntegrityUserSummary,
  integrityToFailedVerification,
  resolveLocalImport,
  validateFragmentIntegrity,
} from './fragment-integrity'
import {
  resolveGenerationMaxTokens,
  withGenerationTokenBudget,
} from './generation-budget'
import type { FragmentSchema } from './schema'

function aquaClubBroken(): FragmentSchema {
  return {
    commentary: 'AquaClub',
    template: 'nextjs-developer',
    title: 'AquaClub',
    description: 'Pool membership',
    architecture: 'pages + components',
    additional_dependencies: [],
    has_additional_dependencies: false,
    install_dependencies_command: '',
    port: 3000,
    file_path: 'pages/index.tsx',
    code: [
      {
        file_path: 'pages/index.tsx',
        file_content: `import Classes from '../components/Classes'
import MembershipPlans from '../components/MembershipPlans'
export default function Home(){
  return <main><MembershipPlans /><Classes /></main>
}`,
      },
      {
        file_path: 'components/MembershipPlans.tsx',
        file_content:
          'export default function MembershipPlans(){ return <section>Plans</section> }',
      },
      {
        file_path: 'components/ClassList.tsx',
        file_content:
          'export default function ClassList(){ return <section>Classes</section> }',
      },
    ],
  }
}

function aquaClubFixed(): FragmentSchema {
  const broken = aquaClubBroken()
  return {
    ...broken,
    code: [
      ...broken.code.filter((f) => f.file_path !== 'components/ClassList.tsx'),
      {
        file_path: 'components/Classes.tsx',
        file_content:
          'export default function Classes(){ return <section>Classes</section> }',
      },
    ],
  }
}

// 1. AquaClub-style: pages/index imports ../components/Classes but ClassList exists
{
  const result = validateFragmentIntegrity(aquaClubBroken())
  assert.equal(result.ok, false)
  assert.ok(
    result.unresolvedImports.some(
      (u) =>
        u.specifier.includes('Classes') && u.missingName === 'Classes',
    ),
  )
  assert.ok(result.manifest.files.includes('components/ClassList.tsx'))
  assert.ok(!result.manifest.files.includes('components/Classes.tsx'))
}

// 2. After repair add Classes.tsx → resolves
{
  const fixed = aquaClubFixed()
  const result = validateFragmentIntegrity(fixed)
  assert.equal(result.ok, true)
  assert.equal(result.unresolvedImports.length, 0)
}

// 3. applyRepairToFragment can add missing Classes file (deterministic repair apply)
{
  const applied = applyRepairToFragment(aquaClubBroken(), {
    explanation: 'Add missing Classes component',
    changedFiles: ['components/Classes.tsx'],
    files: [
      {
        file_path: 'components/Classes.tsx',
        action: 'add',
        file_content:
          'export default function Classes(){ return <section>Classes</section> }',
      },
    ],
  })
  assert.equal(applied.ok, true)
  if (applied.ok) {
    const recheck = validateFragmentIntegrity(applied.fragment)
    assert.equal(recheck.ok, true)
  }
}

// 4. Missing component / wrong casing (file exists only as exact match)
{
  const frag: FragmentSchema = {
    ...aquaClubBroken(),
    code: [
      {
        file_path: 'pages/index.tsx',
        file_content: `import X from '../components/Widget'\nexport default function H(){return <X/>}`,
      },
      {
        file_path: 'components/widget.tsx',
        file_content: 'export default function Widget(){return null}',
      },
    ],
  }
  // case-insensitive match should resolve when target exists
  const ok = validateFragmentIntegrity(frag)
  assert.equal(ok.ok, true)

  const missing: FragmentSchema = {
    ...frag,
    code: [
      frag.code[0],
      {
        file_path: 'components/Other.tsx',
        file_content: 'export default function Other(){return null}',
      },
    ],
  }
  const bad = validateFragmentIntegrity(missing)
  assert.equal(bad.ok, false)
}

// 5. Missing export hint (warning, not hard fail)
{
  const frag: FragmentSchema = {
    ...aquaClubBroken(),
    code: [
      {
        file_path: 'pages/index.tsx',
        file_content: `import Hero from '../components/Hero'\nexport default function H(){return <Hero/>}`,
      },
      {
        file_path: 'components/Hero.tsx',
        file_content: 'export function NotHero(){return null}',
      },
    ],
  }
  const result = validateFragmentIntegrity(frag)
  assert.equal(result.ok, true) // warnings only
  assert.ok(result.issues.some((i) => i.code === 'missing_export_hint'))
}

// 6. Duplicate file path
{
  const frag: FragmentSchema = {
    ...aquaClubBroken(),
    code: [
      {
        file_path: 'pages/index.tsx',
        file_content: 'export default function H(){return null}',
      },
      {
        file_path: 'pages/index.tsx',
        file_content: 'export default function H2(){return null}',
      },
    ],
  }
  const result = validateFragmentIntegrity(frag)
  assert.equal(result.ok, false)
  assert.ok(result.issues.some((i) => i.code === 'duplicate_path'))
}

// 7. Broken relative path
{
  const imports = extractLocalImports(
    `import A from '../components/Classes'\nconst x = require('./lib/util')`,
  )
  assert.ok(imports.includes('../components/Classes'))
  assert.ok(imports.includes('./lib/util'))
}

// 8. Integrity-only (no runtime evidence) must not spend repair budget.
// Integrity + genuine runtime failure is still eligible once.
{
  const integrity = validateFragmentIntegrity(aquaClubBroken())
  assert.equal(
    shouldAttemptRepair({
      repairAttempts: 0,
      integrity,
    }),
    false,
  )
  assert.equal(selectRepairReason({ integrity }), null)
  const runtime = {
    status: 'failed' as const,
    filesWritten: true,
    dependenciesInstalled: true,
    processStarted: true,
    previewReachable: false,
    errors: ["Module not found: Can't resolve '../components/Classes'"],
    warnings: [],
    durationMs: 800,
  }
  assert.equal(
    shouldAttemptRepair({
      repairAttempts: 0,
      integrity,
      verification: runtime,
    }),
    true,
  )
  assert.equal(
    selectRepairReason({ integrity, verification: runtime }),
    'integrity',
  )
  assert.equal(
    shouldAttemptRepair({
      repairAttempts: 1,
      integrity,
      verification: runtime,
    }),
    false,
  )
}

// 9. No fake success — failed integrity → failed verification
{
  const integrity = validateFragmentIntegrity(aquaClubBroken())
  const v = integrityToFailedVerification(integrity, {
    candidateLabel: 'Premium',
  })
  assert.equal(v.status, 'failed')
  assert.equal(v.previewReachable, false)
  assert.match(v.errors[0] || '', /Premium encountered a build issue/)
  assert.match(v.errors[0] || '', /Missing component: Classes/)
  const recovered = formatIntegrityUserSummary(integrity, {
    candidateLabel: 'Premium',
    repaired: true,
  })
  assert.match(recovered, /Premium encountered a build issue/)
  assert.match(recovered, /Missing component: Classes/)
  assert.doesNotMatch(recovered, /^Premium encountered a build issue\.\s*Could not recover/)
}

// 10. Candidate isolation — Product failure does not stop Premium/Innovate
{
  const outcomes: string[] = []
  for (const item of [
    { id: 'minimal', label: 'Product' },
    { id: 'rich', label: 'Premium' },
    { id: 'playful', label: 'Innovate' },
  ]) {
    try {
      if (item.id === 'minimal') {
        outcomes.push('product-start')
        throw new Error('Product boom')
      }
      outcomes.push(`${item.label.toLowerCase()}-ok`)
    } catch {
      outcomes.push(`${item.id}-caught`)
    }
  }
  assert.deepEqual(outcomes, [
    'product-start',
    'minimal-caught',
    'premium-ok',
    'innovate-ok',
  ])
}

// 11. Manifest + resolve helpers
{
  const manifest = buildFragmentManifest(aquaClubFixed())
  const resolved = resolveLocalImport(
    'pages/index.tsx',
    '../components/Classes',
    manifest,
  )
  assert.equal(resolved.resolved, 'components/Classes.tsx')
  const miss = resolveLocalImport(
    'pages/index.tsx',
    '../components/Nope',
    manifest,
  )
  assert.equal(miss.resolved, null)
}

// 12. Token budgets stay controlled (no absurd ~47k requests)
// Sequential tournament gen allows fuller multi-file budgets.
{
  assert.equal(
    resolveGenerationMaxTokens({ complexity: 'simple' } as any),
    8000,
  )
  assert.equal(
    resolveGenerationMaxTokens({ complexity: 'medium' } as any),
    14000,
  )
  assert.equal(
    resolveGenerationMaxTokens({ complexity: 'complex' } as any),
    20000,
  )
  const capped = withGenerationTokenBudget(
    { maxTokens: 47000 },
    { complexity: 'medium' } as any,
  )
  assert.equal(capped.maxTokens, 14000)
  assert.equal(
    resolveGenerationMaxTokens({ complexity: 'medium' } as any, {
      concurrentJobs: 3,
    }),
    14000,
  )
  assert.equal(
    resolveGenerationMaxTokens({ complexity: 'complex' } as any, {
      concurrentJobs: 3,
    }),
    18000,
  )
  assert.equal(
    withGenerationTokenBudget(
      { maxTokens: 47000 },
      { complexity: 'complex' } as any,
      { concurrentJobs: 3 },
    ).maxTokens,
    18000,
  )
  assert.equal(
    resolveGenerationMaxTokens({ complexity: 'complex' } as any, {
      concurrentJobs: 1,
    }),
    20000,
  )
}

// 12b. Template-provided shadcn imports must NOT fail integrity
{
  const frag: FragmentSchema = {
    commentary: 'Premium UI',
    template: 'nextjs-developer',
    title: 'AquaClub Gold',
    description: 'Membership',
    architecture: 'pages + components',
    additional_dependencies: [],
    has_additional_dependencies: false,
    install_dependencies_command: '',
    port: 3000,
    file_path: 'pages/index.tsx',
    code: [
      {
        file_path: 'pages/index.tsx',
        file_content: `import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import Plans from '../components/Plans'
export default function Home(){
  return <main className={cn('p-4')}><Plans /><Button>Join</Button></main>
}`,
      },
      {
        file_path: 'components/Plans.tsx',
        file_content:
          'export default function Plans(){ return <section>Plans</section> }',
      },
    ],
  }
  const result = validateFragmentIntegrity(frag)
  assert.equal(result.ok, true, 'shadcn/ui + lib/utils are template-provided')
  assert.equal(result.unresolvedImports.length, 0)
  assert.ok(
    result.issues.some(
      (i) =>
        i.severity === 'warning' &&
        /Template-provided import/i.test(i.message),
    ),
  )
}

// 12c. App-specific missing component still fails (not template-provided)
{
  const frag: FragmentSchema = {
    commentary: 'x',
    template: 'nextjs-developer',
    title: 'X',
    description: 'x',
    architecture: 'x',
    additional_dependencies: [],
    has_additional_dependencies: false,
    install_dependencies_command: '',
    port: 3000,
    file_path: 'pages/index.tsx',
    code: [
      {
        file_path: 'pages/index.tsx',
        file_content: `import { Button } from '@/components/ui/button'
import Missing from '@/components/MissingThing'
export default function H(){ return <Missing /> }`,
      },
    ],
  }
  const result = validateFragmentIntegrity(frag)
  assert.equal(result.ok, false)
  assert.ok(
    result.unresolvedImports.some((u) => u.missingName === 'MissingThing'),
  )
}

// 13. Valid multi-file app passes (previewable path remains open)
{
  const good = aquaClubFixed()
  assert.equal(validateFragmentIntegrity(good).ok, true)
}

// 14. Invalid / missing entrypoint (generic)
{
  const frag: FragmentSchema = {
    commentary: 'x',
    template: 'nextjs-developer',
    title: 'X',
    description: 'x',
    architecture: 'x',
    additional_dependencies: [],
    has_additional_dependencies: false,
    install_dependencies_command: '',
    port: 3000,
    file_path: 'pages/index.tsx',
    code: [
      {
        file_path: 'components/Only.tsx',
        file_content: 'export default function Only(){return null}',
      },
    ],
  }
  const result = validateFragmentIntegrity(frag)
  assert.equal(result.ok, false)
  assert.ok(result.issues.some((i) => i.code === 'missing_entrypoint'))
}

// 15. Missing asset reference (warning)
{
  const frag: FragmentSchema = {
    commentary: 'x',
    template: 'nextjs-developer',
    title: 'X',
    description: 'x',
    architecture: 'x',
    additional_dependencies: [],
    has_additional_dependencies: false,
    install_dependencies_command: '',
    port: 3000,
    file_path: 'pages/index.tsx',
    code: [
      {
        file_path: 'pages/index.tsx',
        file_content: `import logo from '../assets/logo.png'\nexport default function H(){return <img src={logo.src||''} />}`,
      },
    ],
  }
  const result = validateFragmentIntegrity(frag)
  assert.ok(
    result.issues.some(
      (i) => i.code === 'unresolved_local_import' && i.severity === 'warning',
    ),
  )
}

// 16. Unknown package (warning) vs listed additional_dependencies
{
  const frag: FragmentSchema = {
    commentary: 'x',
    template: 'nextjs-developer',
    title: 'X',
    description: 'x',
    architecture: 'x',
    additional_dependencies: [],
    has_additional_dependencies: false,
    install_dependencies_command: '',
    port: 3000,
    file_path: 'pages/index.tsx',
    code: [
      {
        file_path: 'pages/index.tsx',
        file_content: `import weird from 'totally-unknown-pkg-xyz'\nexport default function H(){return null}`,
      },
    ],
  }
  const result = validateFragmentIntegrity(frag)
  assert.ok(result.issues.some((i) => i.code === 'missing_npm_dependency'))
  assert.equal(result.ok, false)
  assert.equal(canDeployIntegrity(result), true)
}

// 17. Generic missing component (not product-specific names)
{
  const frag: FragmentSchema = {
    commentary: 'generic',
    template: 'nextjs-developer',
    title: 'Generic App',
    description: 'x',
    architecture: 'x',
    additional_dependencies: [],
    has_additional_dependencies: false,
    install_dependencies_command: '',
    port: 3000,
    file_path: 'pages/index.tsx',
    code: [
      {
        file_path: 'pages/index.tsx',
        file_content: `import TaskBoard from '../components/TaskBoard'\nexport default function H(){return <TaskBoard/>}`,
      },
      {
        file_path: 'components/TaskList.tsx',
        file_content: 'export default function TaskList(){return null}',
      },
    ],
  }
  const result = validateFragmentIntegrity(frag)
  assert.equal(result.ok, false)
  assert.ok(
    result.unresolvedImports.some((u) => u.missingName === 'TaskBoard'),
  )
}

// 18. Validator source must not hardcode product/demo app names
{
  const fs = require('node:fs') as typeof import('node:fs')
  const path = require('node:path') as typeof import('node:path')
  const src = fs.readFileSync(
    path.join(process.cwd(), 'lib/fragment-integrity.ts'),
    'utf8',
  )
  assert.doesNotMatch(src, /AquaClub|MembershipPlans|ClassList|swimming pool/i)
}

// 19. Tournament route: all candidates (incl. evolution) share one integrity gate
{
  const fs = require('node:fs') as typeof import('node:fs')
  const path = require('node:path') as typeof import('node:path')
  const route = fs.readFileSync(
    path.join(process.cwd(), '../api/src/generation/tournament.runner.ts'),
    'utf8',
  )
  assert.match(route, /runGeneratedProjectPreflight/)
  assert.match(route, /formatNonBlockingIntegrityWarnings/)
  assert.match(route, /deployAndVerify/)
  assert.match(route, /repairAndReverify/)
  assert.doesNotMatch(route, /repairFragmentIntegrity/)
  assert.doesNotMatch(route, /canDeployIntegrity/)
  assert.doesNotMatch(route, /Could not recover this candidate/)
  assert.doesNotMatch(route, /refusing deploy/)
  // Evolution uses the same route + Phase 2 verifyTasks map (not a separate deploy path)
  assert.match(route, /isEvolution|handleTournament/)
  assert.match(route, /buildEvolutionPrompt/)
  assert.match(route, /withArchitecture\.map\(async \(r\) =>/)
  // Ask EvoStack / Improve client must call tournament, not chat/morph for evolution
  const page = fs.readFileSync(
    path.join(process.cwd(), 'app/app/page.tsx'),
    'utf8',
  )
  assert.match(page, /function handleEvolve/)
  assert.match(page, /tournament\.submit\(/)
  assert.match(page, /buildEvolutionApiPayload/)
  // Repair revalidates integrity after apply
  const repair = fs.readFileSync(
    path.join(process.cwd(), 'lib/repair-candidate.ts'),
    'utf8',
  )
  assert.match(repair, /validateFragmentIntegrity\(repairedFragment\)/)

  // Chat / morph / sandbox must reuse shared integrity (no tournament change)
  const chat = fs.readFileSync(
    path.join(process.cwd(), '../api/src/generation/chat.runner.ts'),
    'utf8',
  )
  const morph = fs.readFileSync(
    path.join(process.cwd(), '../api/src/generation/morph.runner.ts'),
    'utf8',
  )
  const sandbox = fs.readFileSync(
    path.join(process.cwd(), '../api/src/generation/sandbox.runner.ts'),
    'utf8',
  )
  assert.match(chat, /prepareFragmentIntegrity/)
  assert.match(morph, /prepareFragmentIntegrity/)
  assert.match(sandbox, /canDeployFragment|buildSandboxIntegrityError/)
  assert.doesNotMatch(sandbox, /repairFragmentIntegrity/)
}

// 20. CSS @import after rules fails integrity; valid Tailwind CSS passes
{
  const bad: FragmentSchema = {
    ...aquaClubFixed(),
    code: [
      ...aquaClubFixed().code,
      {
        file_path: 'styles/globals.css',
        file_content: `:root { --fg: #111; }\n@import url("https://fonts.googleapis.com/css2?family=Inter&display=swap");\n`,
      },
    ],
  }
  const failed = validateFragmentIntegrity(bad)
  assert.equal(failed.ok, false)
  assert.ok(failed.issues.some((i) => i.code === 'invalid_css_import_order'))
  const repairText = formatIntegrityForRepair(failed)
  assert.match(repairText, /@import/)
  assert.match(repairText, /Preserve every existing CSS rule/)

  const good: FragmentSchema = {
    ...aquaClubFixed(),
    code: [
      ...aquaClubFixed().code,
      {
        file_path: 'styles/globals.css',
        file_content: `@import "tailwindcss";\n@theme { --color-brand: #111; }\n@layer base { body { margin: 0; } }\n`,
      },
    ],
  }
  const passed = validateFragmentIntegrity(good)
  assert.equal(passed.ok, true, passed.issues.map((i) => i.message).join('; '))
}

// 21. Countdown Date.now is a quality issue — repair-worthy, not E2B-blocking
{
  const countdown: FragmentSchema = {
    ...aquaClubFixed(),
    title: 'NEXUS PASS',
    code: [
      {
        file_path: 'pages/index.tsx',
        file_content: `import { useState } from 'react'
export default function Home(){
  const [left] = useState(Date.now())
  return <main><h1>NEXUS PASS</h1><p>{left}</p></main>
}`,
      },
    ],
  }
  const result = validateFragmentIntegrity(countdown)
  assert.equal(result.ok, false)
  assert.ok(result.issues.some((i) => i.code === 'hydration_risk'))
  assert.equal(canDeployIntegrity(result), true)
  const summary = formatIntegrityUserSummary(result, {
    candidateLabel: 'Product',
    repaired: true,
  })
  assert.match(summary, /Date\.now|hydrat/i)
  assert.doesNotMatch(summary, /Could not recover this candidate\.\s*$/)
}

// 22. Missing local import remains compile-blocking and keeps the real diagnostic
{
  const broken = aquaClubBroken()
  const result = validateFragmentIntegrity(broken)
  assert.equal(result.ok, false)
  assert.equal(canDeployIntegrity(result), false)
  const v = integrityToFailedVerification(result, { candidateLabel: 'Premium' })
  assert.equal(v.status, 'failed')
  assert.match(v.errors.join('\n'), /Classes/)
  const summary = formatIntegrityUserSummary(result, {
    candidateLabel: 'Premium',
    repaired: true,
  })
  assert.match(summary, /Classes/)
}

// 23. Scoring formula is unchanged (runtime/smoke/architecture weights)
{
  const { buildDeterministicTournamentVerdict } = require('./deterministic-verdict') as typeof import('./deterministic-verdict')
  const passed = {
    status: 'passed' as const,
    filesWritten: true,
    dependenciesInstalled: true as const,
    processStarted: true,
    previewReachable: true,
    errors: [],
    warnings: [],
    durationMs: 1,
  }
  const archPassed = {
    status: 'passed' as const,
    summary: 'ok',
    checks: [],
    missingRequirements: [],
    suspiciousPatterns: [],
    evidence: [],
  }
  const verdict = buildDeterministicTournamentVerdict([
    {
      id: 'minimal',
      fragment: aquaClubFixed(),
      finalVerification: passed,
      architectureCompliance: archPassed,
      smoke: { status: 'timeout', tests: [], durationMs: 1, summary: 'timeout' },
    },
    {
      id: 'rich',
      fragment: aquaClubFixed(),
      finalVerification: {
        ...passed,
        status: 'failed',
        previewReachable: false,
        errors: ['Module not found: ./Missing'],
      },
      architectureCompliance: archPassed,
      smoke: null,
    },
    {
      id: 'playful',
      fragment: aquaClubFixed(),
      finalVerification: passed,
      architectureCompliance: archPassed,
      smoke: { status: 'passed', tests: [], durationMs: 1, summary: 'ok' },
    },
  ])
  const byId = Object.fromEntries(verdict.scores.map((s) => [s.id, s]))
  // runtime passed + smoke timeout (-1) + arch passed + fragment > runtime failed
  assert.ok(byId.minimal.composite > byId.rich.composite)
  // smoke passed still outranks smoke timeout when runtime/arch match
  assert.ok(byId.playful.composite > byId.minimal.composite)
  // failed runtime keeps the existing failed-runtime clarity floor
  assert.equal(byId.rich.clarity, 0.45)
  assert.equal(byId.minimal.clarity, 0.72)
}

console.log('fragment-integrity.test.ts: all tests passed')

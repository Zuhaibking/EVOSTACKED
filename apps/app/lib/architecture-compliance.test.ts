/**
 * Deterministic Part 8 architecture-compliance tests (no LLM / E2B).
 * Run: npx tsx lib/architecture-compliance.test.ts
 */
import assert from 'node:assert/strict'
import { architecturePreset } from './architecture'
import {
  checkArchitectureCompliance,
  formatArchitectureComplianceForJudge,
  hasCriticalArchitectureFailure,
  type ArchitectureComplianceResult,
} from './architecture-compliance'
import { preferReliableWinner } from './smoke'
import type { FragmentSchema } from './schema'
import type { VerificationResult } from './verification'

function frag(
  files: Array<{ file_path: string; file_content: string }>,
  extras: Partial<FragmentSchema> = {},
): FragmentSchema {
  return {
    commentary: 'test',
    template: 'nextjs-developer',
    title: 'Test',
    description: 'Test app',
    architecture: 'test',
    additional_dependencies: [],
    has_additional_dependencies: false,
    install_dependencies_command: '',
    port: 3000,
    file_path: files[0]?.file_path || 'pages/index.tsx',
    code: files,
    ...extras,
  }
}

function runtime(status: VerificationResult['status']): VerificationResult {
  return {
    status,
    filesWritten: true,
    dependenciesInstalled: true,
    processStarted: true,
    previewReachable: status !== 'failed',
    errors: status === 'failed' ? ['x'] : [],
    warnings: [],
    durationMs: 10,
  }
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

function checkStatus(
  result: ArchitectureComplianceResult,
  id: string,
): string | undefined {
  return result.checks.find((c) => c.id === id)?.status
}

test('1. Calculator with no backend/database → PASS', () => {
  const result = checkArchitectureCompliance({
    architecture: architecturePreset('calculator'),
    fragment: frag([
      {
        file_path: 'pages/index.tsx',
        file_content: `
export default function Calc() {
  const [v, setV] = React.useState('0')
  return <button onClick={() => setV('4')}>{v}</button>
}`,
      },
    ]),
  })
  assert.equal(result.status, 'passed')
  assert.equal(checkStatus(result, 'database'), 'not_applicable')
  assert.equal(checkStatus(result, 'backend'), 'not_applicable')
})

test('2. Portfolio with no backend/database → PASS', () => {
  const result = checkArchitectureCompliance({
    architecture: architecturePreset('portfolio'),
    fragment: frag([
      {
        file_path: 'pages/index.tsx',
        file_content:
          'export default function Home(){ return <main><h1>Portfolio</h1></main> }',
      },
    ]),
  })
  assert.equal(result.status, 'passed')
})

test('3. Personal todo with local persistence → PASS', () => {
  const result = checkArchitectureCompliance({
    architecture: architecturePreset('personal_todo'),
    fragment: frag([
      {
        file_path: 'pages/index.tsx',
        file_content: `
import { useState, useEffect } from 'react'
export default function Todo() {
  const [items, setItems] = useState([])
  useEffect(() => {
    const raw = localStorage.getItem('todos')
    if (raw) setItems(JSON.parse(raw))
  }, [])
  return <div>{items.length}</div>
}`,
      },
    ]),
  })
  assert.equal(result.status, 'passed')
  assert.equal(checkStatus(result, 'persistence_local'), 'pass')
  assert.equal(checkStatus(result, 'database'), 'not_applicable')
})

test('4. Gym with real DB/backend/auth → PASS', () => {
  const result = checkArchitectureCompliance({
    architecture: architecturePreset('gym'),
    fragment: frag(
      [
        {
          file_path: 'pages/index.tsx',
          file_content:
            'export default function App(){ const [x,setX]=useState(0); return <div>Gym</div> }',
        },
        {
          file_path: 'pages/api/members/index.ts',
          file_content: `
import { prisma } from '@/lib/db'
import { requireRole } from '@/lib/auth'
export async function GET(req) {
  requireRole(req, 'admin')
  return Response.json(await prisma.member.findMany())
}
export async function POST(req) {
  requireRole(req, ['admin','receptionist'])
  const body = await req.json()
  return Response.json(await prisma.member.create({ data: body }))
}`,
        },
        {
          file_path: 'lib/db.ts',
          file_content: `import { PrismaClient } from '@prisma/client'
export const prisma = new PrismaClient()`,
        },
        {
          file_path: 'prisma/schema.prisma',
          file_content: `
model Member {
  id String @id
  payments Payment[]
  attendance Attendance[]
  membership Membership?
  trainer Trainer? @relation(fields: [trainerId], references: [id])
  trainerId String?
}
model Payment { id String @id memberId String member Member @relation(fields: [memberId], references: [id]) }
model Attendance { id String @id memberId String member Member @relation(fields: [memberId], references: [id]) }
model Membership { id String @id memberId String member Member @relation(fields: [memberId], references: [id]) }
model Trainer { id String @id members Member[] }
`,
        },
        {
          file_path: 'lib/auth.ts',
          file_content: `
import { getServerSession } from 'next-auth'
export async function requireRole(req, roles) {
  const session = await getServerSession()
  if (!session) throw new Error('unauthorized')
  if (!roles.includes(session.user.role)) throw new Error('forbidden')
}
export { getServerSession }
`,
        },
        {
          file_path: '.env.example',
          file_content: 'DATABASE_URL=\nNEXTAUTH_SECRET=\n',
        },
        {
          file_path: 'README.md',
          file_content:
            '# Gym\nSet DATABASE_URL, run migrations, seed, npm run dev',
        },
      ],
      { additional_dependencies: ['@prisma/client', 'prisma', 'next-auth'] },
    ),
  })
  assert.equal(result.status, 'passed', result.summary)
  assert.equal(checkStatus(result, 'backend'), 'pass')
  assert.equal(checkStatus(result, 'database'), 'pass')
  assert.equal(checkStatus(result, 'authentication'), 'pass')
  assert.equal(checkStatus(result, 'authorization'), 'pass')
})

test('5. Gym with mock-only data → FAIL', () => {
  const result = checkArchitectureCompliance({
    architecture: architecturePreset('gym'),
    fragment: frag([
      {
        file_path: 'pages/index.tsx',
        file_content: `
import { MOCK_MEMBERS } from '../lib/mock-data'
export default function App(){
  const [isLoggedIn, setIsLoggedIn] = useState(true)
  const [members, setMembers] = useState(MOCK_MEMBERS)
  const addMember = () => setMembers([...members, { id: 1, name: 'Ada' }])
  return <button onClick={addMember}>Add</button>
}`,
      },
      {
        file_path: 'lib/mock-data.ts',
        file_content: `export const MOCK_MEMBERS = [{ id: 1, name: 'Ada' }, { id: 2, name: 'Bob' }]
export const FAKE_DB = { members: MOCK_MEMBERS }`,
      },
    ]),
  })
  assert.equal(result.status, 'failed')
  assert.ok(hasCriticalArchitectureFailure(result))
  assert.ok(
    result.missingRequirements.some((m) => /database|backend|mock/i.test(m)),
  )
})

test('6. Gym with backend but no database → FAIL', () => {
  const result = checkArchitectureCompliance({
    architecture: architecturePreset('gym'),
    fragment: frag([
      {
        file_path: 'pages/index.tsx',
        file_content:
          'export default function App(){ const [x,setX]=useState(0); return <div/> }',
      },
      {
        file_path: 'pages/api/members.ts',
        file_content: `
import { getServerSession } from 'next-auth'
export async function GET() {
  const session = await getServerSession()
  const members = [{ id: 1 }]
  return Response.json(members)
}`,
      },
      {
        file_path: 'lib/auth.ts',
        file_content:
          'export async function requireRole(){}\nexport { getServerSession } from "next-auth"',
      },
    ]),
  })
  assert.equal(result.status, 'failed')
  assert.equal(checkStatus(result, 'backend'), 'pass')
  assert.equal(checkStatus(result, 'database'), 'fail')
})

test('7. Gym with auth but no authorization → FAIL/PARTIAL', () => {
  const result = checkArchitectureCompliance({
    architecture: architecturePreset('gym'),
    fragment: frag([
      {
        file_path: 'pages/index.tsx',
        file_content: `
export default function App(){
  return <select><option>admin</option><option>trainer</option></select>
}`,
      },
      {
        file_path: 'pages/api/members.ts',
        file_content: `
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
export async function GET(){ return Response.json(await prisma.member.findMany()) }`,
      },
      {
        file_path: 'prisma/schema.prisma',
        file_content:
          'model Member { id String @id payments Payment[] }\nmodel Payment { id String @id }',
      },
      {
        file_path: 'lib/auth.ts',
        file_content:
          'import { getServerSession } from "next-auth"\nexport async function auth(){ return getServerSession() }',
      },
    ]),
  })
  // Auth present, authz missing/client-only → fail on authorization (high) → overall failed or partial
  assert.ok(result.status === 'failed' || result.status === 'partial')
  assert.equal(checkStatus(result, 'authentication'), 'pass')
  assert.equal(checkStatus(result, 'authorization'), 'fail')
})

test('8. E-commerce with missing persistence → FAIL', () => {
  const result = checkArchitectureCompliance({
    architecture: architecturePreset('ecommerce'),
    fragment: frag([
      {
        file_path: 'pages/index.tsx',
        file_content: `
export default function Shop(){
  const [cart, setCart] = useState([])
  return <div>Shop</div>
}`,
      },
    ]),
  })
  assert.equal(result.status, 'failed')
  assert.ok(result.missingRequirements.includes('backend'))
  assert.ok(result.missingRequirements.includes('database'))
})

test('9. Unnecessary database on simple app → warning, NOT failure', () => {
  const result = checkArchitectureCompliance({
    architecture: architecturePreset('calculator'),
    fragment: frag([
      {
        file_path: 'pages/index.tsx',
        file_content:
          'export default function Calc(){ const [v,setV]=useState(0); return <div>{v}</div> }',
      },
      {
        file_path: 'lib/db.ts',
        file_content:
          'import { PrismaClient } from "@prisma/client"\nexport const prisma = new PrismaClient()',
      },
      {
        file_path: 'prisma/schema.prisma',
        file_content: 'model Useless { id String @id }',
      },
    ]),
  })
  assert.notEqual(result.status, 'failed')
  assert.equal(checkStatus(result, 'database'), 'warning')
  assert.ok(result.suspiciousPatterns.includes('unnecessary-database'))
})

test('10. Missing .env.example for required infrastructure → warning', () => {
  const result = checkArchitectureCompliance({
    architecture: architecturePreset('gym'),
    fragment: frag([
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
export async function GET(req){ requireRole(req, 'admin'); return Response.json(await prisma.member.findMany()) }`,
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
export function requireRole(req, role){ const s = getServerSession(); if (!s) throw new Error('no') }
`,
      },
      {
        file_path: 'README.md',
        file_content: '# Gym setup',
      },
    ]),
  })
  assert.equal(checkStatus(result, 'env_example'), 'warning')
  // Should not be a critical-only fail solely due to env
  assert.ok(result.status === 'passed' || result.status === 'partial')
})

test('11. Legacy plan without architecture → normalized safely', () => {
  const result = checkArchitectureCompliance({
    plan: {
      applicationType: 'calculator',
      complexity: 'simple',
      productName: 'Calc',
      productGoal: 'Simple calculator',
      targetUsers: 'Anyone',
      problemStatement: 'Math',
      primaryUserGoal: 'Compute',
      coreFeatures: ['calculate'],
      secondaryFeatures: [],
      outOfScope: [],
      pages: [{ name: 'Home', path: '/', purpose: 'Calc' }],
      userFlows: ['Open'],
      dataApproach: 'in-memory',
      needsAuth: false,
      needsBackend: false,
      architectureSummary: 'UI',
      designDirection: {
        tone: 'a',
        typography: 'b',
        colorApproach: 'c',
        componentStyle: 'd',
        interactionStyle: 'e',
      },
      sampleDataNotes: 'n/a',
      mustHaveInteractions: ['calc'],
      interactionContracts: [],
      documentation: 'none',
    } as any,
    fragment: frag([
      {
        file_path: 'pages/index.tsx',
        file_content:
          'export default function C(){ const [v,setV]=useState(0); return <div/> }',
      },
    ]),
  })
  assert.equal(result.status, 'passed')
})

test('12. Malformed architecture → rejected/normalized safely', () => {
  const result = checkArchitectureCompliance({
    architecture: {
      ...architecturePreset('calculator'),
      database: { required: true, type: 'none', reason: 'bad' },
      persistence: { required: false, strategy: 'none', reason: 'bad' },
      backend: { required: false, reason: 'bad' },
    },
    fragment: frag([
      {
        file_path: 'pages/index.tsx',
        file_content:
          'export default function C(){ const [v,setV]=useState(0); return <div/> }',
      },
    ]),
  })
  // Normalized to require DB → fails without DB layer
  assert.equal(result.status, 'failed')
  assert.equal(checkStatus(result, 'database'), 'fail')
})

test('13. Mock seed data alongside real DB → PASS', () => {
  const result = checkArchitectureCompliance({
    architecture: architecturePreset('gym'),
    fragment: frag([
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
          'model Member { id String @id payments Payment[] attendance Attendance[] membership Membership? }\nmodel Payment { id String @id memberId String member Member @relation(fields:[memberId], references:[id]) }\nmodel Attendance { id String @id memberId String member Member @relation(fields:[memberId], references:[id]) }\nmodel Membership { id String @id memberId String member Member @relation(fields:[memberId], references:[id]) }\nmodel Trainer { id String @id }',
      },
      {
        file_path: 'lib/auth.ts',
        file_content: `
import { getServerSession } from 'next-auth'
export function requireRole(req, role){ const s = getServerSession(); if(!s) throw new Error('x') }
`,
      },
      {
        file_path: 'prisma/seed.ts',
        file_content:
          'export const MOCK_MEMBERS = [{ id: "1", name: "Ada" }]\n// seed for prisma',
      },
      {
        file_path: '.env.example',
        file_content: 'DATABASE_URL=',
      },
      { file_path: 'README.md', file_content: '# Gym' },
    ]),
  })
  assert.equal(result.status, 'passed', result.summary)
  assert.equal(checkStatus(result, 'database'), 'pass')
})

test('14. Dependency present but unused → insufficient evidence', () => {
  const result = checkArchitectureCompliance({
    architecture: architecturePreset('gym'),
    fragment: frag(
      [
        {
          file_path: 'pages/index.tsx',
          file_content:
            'export default function App(){ const [x,setX]=useState(0); return <div/> }',
        },
        {
          file_path: 'pages/api/health.ts',
          file_content:
            'import { getServerSession } from "next-auth"\nexport async function GET(){ return Response.json({ok:true}) }',
        },
        {
          file_path: 'lib/auth.ts',
          file_content:
            'export { getServerSession } from "next-auth"\nexport function requireRole(){}',
        },
      ],
      { additional_dependencies: ['prisma', '@prisma/client', 'pg'] },
    ),
  })
  assert.equal(checkStatus(result, 'database'), 'fail')
  assert.ok(result.suspiciousPatterns.includes('dependency-without-usage'))
})

test('15. Multiple entities and relationships → detected correctly', () => {
  const result = checkArchitectureCompliance({
    architecture: architecturePreset('gym'),
    fragment: frag([
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
export async function GET(req){ requireRole(req,'receptionist'); return Response.json(await prisma.member.findMany()) }`,
      },
      {
        file_path: 'lib/db.ts',
        file_content:
          'import { PrismaClient } from "@prisma/client"; export const prisma = new PrismaClient()',
      },
      {
        file_path: 'prisma/schema.prisma',
        file_content: `
model Member { id String @id payments Payment[] attendance Attendance[] membership Membership? }
model Payment { id String @id memberId String member Member @relation(fields: [memberId], references: [id]) }
model Attendance { id String @id memberId String member Member @relation(fields: [memberId], references: [id]) }
model Membership { id String @id memberId String member Member @relation(fields: [memberId], references: [id]) }
model Trainer { id String @id }
`,
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
    ]),
  })
  assert.equal(checkStatus(result, 'entities'), 'pass')
  assert.equal(checkStatus(result, 'relationships'), 'pass')
  assert.match(formatArchitectureComplianceForJudge(result), /PASSED|PARTIAL/i)
})

test('winner guard: architecture FAIL cannot casually beat architecture PASS', () => {
  const fail = checkArchitectureCompliance({
    architecture: architecturePreset('gym'),
    fragment: frag([
      {
        file_path: 'pages/index.tsx',
        file_content:
          'import { MOCK_MEMBERS } from "./mock-data"\nexport default function A(){ const [isLoggedIn]=useState(true); return <div/> }',
      },
      {
        file_path: 'lib/mock-data.ts',
        file_content: 'export const MOCK_MEMBERS = [{id:1}]',
      },
    ]),
  })
  const ok = checkArchitectureCompliance({
    architecture: architecturePreset('gym'),
    fragment: frag([
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
    ]),
  })
  assert.equal(fail.status, 'failed')
  assert.equal(ok.status, 'passed')

  const winner = preferReliableWinner('minimal', [
    {
      id: 'minimal',
      verification: runtime('passed'),
      smoke: null,
      architectureCompliance: fail,
    },
    {
      id: 'rich',
      verification: runtime('passed'),
      smoke: null,
      architectureCompliance: ok,
    },
    {
      id: 'playful',
      verification: runtime('failed'),
      smoke: null,
      architectureCompliance: null,
    },
  ])
  assert.equal(winner, 'rich')
})

console.log(`\n${passed} tests passed`)
if (process.exitCode) process.exit(process.exitCode)

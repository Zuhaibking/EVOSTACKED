/**
 * Deterministic provider-integrity tests — zero provider / E2B.
 * Run: npm run test:provider-integrity
 */
import assert from 'node:assert/strict'
import {
  detectProviderIssues,
  repairFragmentProviders,
} from './provider-integrity'
import {
  canDeployIntegrity,
  validateFragmentIntegrity,
} from './fragment-integrity'
import {
  canDeployFragment,
  runGeneratedProjectPreflight,
} from './prepare-fragment-integrity'
import type { FragmentSchema } from './schema'

function sessionModule() {
  return `import { createContext, useContext } from 'react'

const SessionContext = createContext(null)

export function useSession() {
  return useContext(SessionContext)
}
`
}

function unwrapped(): FragmentSchema {
  return {
    commentary: 'x',
    template: 'nextjs-developer',
    title: 'Auth',
    description: 'x',
    architecture: 'pages',
    additional_dependencies: [],
    has_additional_dependencies: false,
    install_dependencies_command: '',
    port: 3000,
    file_path: 'pages/index.tsx',
    code: [
      { file_path: 'lib/session.tsx', file_content: sessionModule() },
      {
        file_path: 'pages/index.tsx',
        file_content: `import { useSession } from '../lib/session'

export default function Home() {
  const { session } = useSession()
  return <main>{session ? 'in' : 'out'}</main>
}
`,
      },
    ],
  }
}

function wrapped(): FragmentSchema {
  return {
    commentary: 'x',
    template: 'nextjs-developer',
    title: 'Auth',
    description: 'x',
    architecture: 'pages',
    additional_dependencies: [],
    has_additional_dependencies: false,
    install_dependencies_command: '',
    port: 3000,
    file_path: 'pages/index.tsx',
    code: [
      {
        file_path: 'lib/session.tsx',
        file_content: `import { createContext, useContext } from 'react'

const SessionContext = createContext(null)

export function SessionProvider({ children }: { children?: any }) {
  return (
    <SessionContext.Provider value={{ session: null }}>
      {children}
    </SessionContext.Provider>
  )
}

export function useSession() {
  return useContext(SessionContext)
}
`,
      },
      {
        file_path: 'pages/index.tsx',
        file_content: `import { useSession } from '../lib/session'

export default function Home() {
  const { session } = useSession()
  return <main>{session ? 'in' : 'out'}</main>
}
`,
      },
      {
        file_path: 'pages/_app.tsx',
        file_content: `import type { AppProps } from 'next/app'
import { SessionProvider } from '../lib/session'

export default function App({ Component, pageProps }: AppProps) {
  return (
    <SessionProvider>
      <Component {...pageProps} />
    </SessionProvider>
  )
}
`,
      },
    ],
  }
}

{
  const issues = detectProviderIssues(unwrapped())
  assert.ok(
    issues.some((i) => i.code === 'missing_provider' && i.hookName === 'useSession'),
    JSON.stringify(issues),
  )
  const raw = validateFragmentIntegrity(unwrapped())
  assert.equal(raw.ok, false)
  assert.ok(raw.issues.some((i) => i.code === 'missing_provider'))
  assert.equal(canDeployIntegrity(raw), true)
}

{
  const repaired = repairFragmentProviders(unwrapped())
  assert.equal(repaired.repaired, true)
  assert.ok(repaired.changedFiles.some((f) => f.includes('_app')))
  const app = repaired.fragment.code.find((f) => /_app\.(tsx|jsx)$/.test(f.file_path))
  assert.ok(app)
  assert.match(app!.file_content, /SessionProvider/)
  const after = detectProviderIssues(repaired.fragment)
  assert.equal(after.length, 0, JSON.stringify(after))
  assert.equal(canDeployIntegrity(validateFragmentIntegrity(repaired.fragment)), true)
}

{
  const issues = detectProviderIssues(wrapped())
  assert.equal(issues.length, 0, JSON.stringify(issues))
  const integrity = validateFragmentIntegrity(wrapped())
  assert.equal(
    integrity.issues.filter((i) => i.code === 'missing_provider').length,
    0,
  )
  assert.equal(canDeployIntegrity(integrity), true)
}

{
  const pre = runGeneratedProjectPreflight(unwrapped())
  assert.equal(canDeployIntegrity(pre.integrity), true, JSON.stringify(pre.integrity.issues))
  assert.ok(pre.fragment.code.some((f) => /_app\.(tsx|jsx)$/.test(f.file_path)))
  const gate = canDeployFragment(unwrapped())
  assert.equal(gate.ok, true)
}

{
  const nextAuth: FragmentSchema = {
    commentary: 'x',
    template: 'nextjs-developer',
    title: 'Auth',
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
        file_content: `import { useSession } from 'next-auth/react'
export default function Home() {
  const { data } = useSession()
  return <main>{data?.user?.name}</main>
}
`,
      },
    ],
  }
  assert.ok(detectProviderIssues(nextAuth).some((i) => i.hookName === 'useSession'))
  const pre = runGeneratedProjectPreflight(nextAuth)
  assert.ok(pre.fragment.additional_dependencies.includes('next-auth'))
  const app = pre.fragment.code.find((f) => /_app\.(tsx|jsx)$/.test(f.file_path))
  assert.ok(app)
  assert.match(app!.file_content, /SessionProvider/)
  assert.match(app!.file_content, /next-auth\/react/)
  assert.equal(canDeployIntegrity(pre.integrity), true, JSON.stringify(pre.integrity.issues))
}

console.log('provider-integrity.test.ts: all tests passed')

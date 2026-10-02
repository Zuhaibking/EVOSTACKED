import assert from 'node:assert/strict'
import { Sandbox } from 'e2b'
import { POST } from '../app/api/sandbox/route'
import type { ExecutionResultWeb } from './types'

async function check() {
  const originalCreate = Sandbox.create
  const originalFetch = globalThis.fetch
  const writes = new Map<string, string>()
  const commands: string[] = []
  let indexWrites = 0
  let rejectTypes = false
  let repairExport = false
  let requests = 0
  let creates = 0
  try {
    Sandbox.create = async () => {
      creates++
      return ({
      sandboxId: 'local-fixture',
      getHost: () => 'fixture.invalid',
      files: {
        write: async (path: string | { path: string; data: string }[], content?: string) => {
          const save = (filePath: string, data: string) => {
            if (filePath === 'pages/index.tsx') indexWrites++
            writes.set(filePath, data)
          }
          if (Array.isArray(path)) for (const file of path) save(file.path, file.data)
          else save(path, content!)
        },
        read: async (path: string) => { if (!writes.has(path)) throw new Error('Missing fixture file'); return writes.get(path)! },
      },
      commands: {
        run: async (command: string) => {
          commands.push(command)
          if (command.includes('/tsc')) {
            assert.match(command, /--project \.\/tsconfig.json/)
            assert.match(command, /--incremental false/)
            assert.doesNotMatch(command, /--target|npx/)
            if (repairExport) {
              repairExport = false
              throw Object.assign(new Error('Command exited with code 2'), { exitCode: 2, stdout: 'pages/index.tsx(1,1): Missing default export', stderr: '' })
            }
            if (rejectTypes) throw Object.assign(new Error('Command exited with code 2'), { exitCode: 2, stdout: "pages/index.tsx(2,3): error TS2322: Type 'number' is not assignable to type 'string'.", stderr: '' })
            return { exitCode: 0, stdout: '', stderr: '' }
          }
          return { exitCode: 0, stdout: 'react,next,typescript', stderr: '' }
        },
      },
    }) as unknown as Sandbox
    }
    globalThis.fetch = async () => {
      requests++
      return new Response('<html><body>FreshersParty</body></html>', { status: 200 })
    }
    const fragment = {
      commentary: '', template: 'nextjs-developer', title: 'FreshersParty', description: '',
      additional_dependencies: [], has_additional_dependencies: false, install_dependencies_command: '', port: 3000,
      file_path: './pages/index.tsx',
      code: `import React, { useState } from 'react'; export default function Page() { const [theme, setTheme] = useState(() => typeof window === 'undefined' ? 'light' : localStorage.getItem('theme') || 'light'); return <button>{theme === 'dark' ? '☀️' : '🌙'}</button> }`,
      files: [
        { file_path: 'components/Hero.tsx', file_content: 'export default function Hero(){ return <h1>Welcome</h1> }' },
        { file_path: 'styles/Hero.module.css', file_content: '.hero { color: lime; }' },
        { file_path: 'data/site.json', file_content: '{"title":"Welcome"}' },
      ],
    }
    const submit = async (runtimeError?: string) => (await (await POST(new Request('http://fixture.invalid/api/sandbox', { method: 'POST', body: JSON.stringify({ fragment, runtimeError }) }))).json()) as ExecutionResultWeb
    const ready = await submit()
    assert.equal(ready.fragment?.file_path, 'pages/index.tsx')
    assert.equal(ready.fragment?.code, writes.get('pages/index.tsx'))
    assert.match(ready.fragment!.code, /__evoHydrationReact.useEffect/)
    assert.notEqual(ready.fragment?.code, fragment.code)
    assert.deepEqual(ready.fragment?.files, fragment.files)
    for (const file of fragment.files) assert.equal(writes.get(file.file_path), file.file_content)
    assert.deepEqual(ready.recoveryFragment?.files, fragment.files)
    assert.equal(ready.health?.verified, false)
    assert.equal(ready.health?.runtimeStatus, 'skipped')
    assert.equal(ready.health?.buildStatus, 'passed')
    assert.equal(ready.health?.repaired, false)
    assert.equal(indexWrites, 1, 'A passing probe is not written twice')
    assert.ok(ready.health?.log.includes('[EvoStack][TYPECHECK] PASS'))
    assert.equal(requests, 1)
    rejectTypes = true
    const broken = await submit()
    assert.equal(broken.health?.state, 'FAILED')
    assert.ok(broken.health?.log.some((line) => line.includes('TYPESCRIPT_ERROR')))
    assert.ok(broken.health?.log.some((line) => line.includes('[FILE] pages/index.tsx')))
    assert.equal(requests, 1, 'Do not preview code that fails TypeScript')
    rejectTypes = false
    const runtime = await submit('Hydration failed because the server HTML did not match')
    assert.equal(runtime.health?.state, 'FAILED')
    assert.ok(runtime.health?.log.some((line) => line.includes('HYDRATION_ERROR')))
    assert.equal(requests, 1, 'Captured runtime errors must enter repair before an HTTP preview')
    assert.equal(commands.filter((command) => command.includes('/tsc')).length, 3)
    indexWrites = 0
    repairExport = true
    const exportFragment = { ...fragment, code: 'export function Page(){ return <h1>Hi</h1> }' }
    const repaired = await (await POST(new Request('http://fixture.invalid/api/sandbox', { method: 'POST', body: JSON.stringify({ fragment: exportFragment }) }))).json() as ExecutionResultWeb
    assert.equal(repaired.health?.repaired, true)
    assert.match(writes.get('pages/index.tsx') || '', /export default Page/)
    assert.equal(indexWrites, 3, 'A repair writes the probe and the repaired bytes')
    for (const path of ['../outside.ts', '/tmp/outside.ts', 'package.json', './pages/index.tsx']) {
      const response = await POST(new Request('http://fixture.invalid/api/sandbox', { method: 'POST', body: JSON.stringify({ fragment: { ...fragment, files: [{ file_path: path, file_content: 'unsafe' }] } }) }))
      assert.equal(response.status, 400)
    }
    assert.equal(creates, 4, 'Invalid project paths are rejected before paid provisioning')
    console.log('sandbox-route-check ok: complete source writes/returns, early safe-path validation, compiler diagnostics, runtime repair, honest health')
  } finally {
    Sandbox.create = originalCreate
    globalThis.fetch = originalFetch
  }
}

void check().catch((error) => { console.error(error); process.exitCode = 1 })

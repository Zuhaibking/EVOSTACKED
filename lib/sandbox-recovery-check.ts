import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { NotFoundError, Sandbox as WebSandbox } from 'e2b'
import { Sandbox as InterpreterSandbox } from '@e2b/code-interpreter'
import type { ExecutionResultWeb } from './types'

async function check() {
  const fixture = {
    userId: 'verified-user' as string | null,
    ownerId: 'verified-user',
    state: 'running',
    failure: null as Error | null,
    connectFailure: null as Error | null,
    httpStatus: 200,
    creates: [] as { template: string; options: Record<string, any> }[],
    connections: [] as { id: string; options: Record<string, any> }[],
    images: 0,
  }
  const globals = globalThis as typeof globalThis & { __evoSandboxFixture?: typeof fixture }
  globals.__evoSandboxFixture = fixture
  const bundled = await build({
    entryPoints: ['app/api/sandbox/route.ts'], absWorkingDir: process.cwd(),
    platform: 'node', format: 'cjs', bundle: true, packages: 'external', write: false,
    define: { 'import.meta.url': JSON.stringify(pathToFileURL(resolve('lib/sandbox-recovery-check.ts')).href) },
    plugins: [{ name: 'server-fixtures', setup(b) {
      b.onResolve({ filter: /^(@clerk\/nextjs\/server|@\/lib\/images)$/ }, args => ({ path: args.path, namespace: 'fixture' }))
      b.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ loader: 'js', contents: args.path === '@clerk/nextjs/server'
        ? `export async function auth(){return {userId:globalThis.__evoSandboxFixture.userId}}`
        : `export const IMAGE_DIR='public/evo-images',IMAGE_PUBLIC='/evo-images';export async function resolveImages(files){globalThis.__evoSandboxFixture.images++;const photo=files.some(f=>f.file_content.includes('evo-image://campus courtyard'));const manifest=photo?[{file:'campus.jpg',query:'campus courtyard',source:'https://fixture.invalid/photo.jpg'}]:[];return {files:files.map(f=>({...f,file_content:f.file_content.replaceAll('evo-image://campus courtyard','/evo-images/campus.jpg')})),binaries:photo?[{file_path:'public/evo-images/campus.jpg',data:new ArrayBuffer(2)}]:[],manifest,assets:[]}}` }))
    } }],
  })
  const fixtureModule = { exports: {} as { POST: (req: Request) => Promise<Response> } }
  new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(createRequire(resolve('lib/sandbox-recovery-check.ts')), fixtureModule, fixtureModule.exports)
  const { POST } = fixtureModule.exports
  const actualCode = `export default function Page(){return <img src="/evo-images/campus.jpg" alt="Our campus"/>}`
  const fragment = {
    commentary: '', template: 'nextjs-developer', title: 'Campus welcome', description: '',
    additional_dependencies: [], has_additional_dependencies: false, install_dependencies_command: '', port: 3000,
    file_path: 'pages/index.tsx', code: actualCode,
    files: [
      { file_path: 'components/Hero.tsx', file_content: 'export default function Hero(){return <img src="/evo-images/campus.jpg" alt="Courtyard"/>}' },
      { file_path: 'styles/Hero.module.css', file_content: '.hero { background: url("/evo-images/campus.jpg"); }' },
      { file_path: 'data/photos.json', file_content: '{"photo":"/evo-images/campus.jpg"}' },
    ],
  }
  const cached: ExecutionResultWeb = {
    sbxId: 'saved-fixture', template: 'nextjs-developer', url: 'https://untrusted-client-url.invalid', fragment,
  }
  const files = new Map<string, string | ArrayBuffer>([
    ['pages/index.tsx', actualCode],
    ['public/evo-images/manifest.json', JSON.stringify([{ file: 'campus.jpg', query: 'campus courtyard' }])],
    ...fragment.files.map(file => [file.file_path, file.file_content] as [string, string]),
  ])
  const sandbox = (id: string) => ({
    sandboxId: id,
    getHost: (port: number) => `${port}-${id}.fixture.invalid`,
    getInfo: async () => ({ endAt: new Date(Date.now() + 600_000) }),
    files: {
      write: async (path: string | { path: string; data: string | ArrayBuffer }[], data?: string | ArrayBuffer) => {
        if (Array.isArray(path)) for (const file of path) files.set(file.path, file.data)
        else files.set(path, data!)
      },
      read: async (path: string) => { const value = files.get(path); if (typeof value !== 'string') throw new Error('Missing fixture file'); return value },
    },
    commands: { run: async (command: string) => ({ exitCode: 0, stdout: command.includes('/tsc') ? '' : 'react,next,typescript', stderr: '' }) },
    runCode: async () => ({ logs: { stdout: ['ok'], stderr: [] }, results: [], error: undefined }),
  })
  const original = { create: WebSandbox.create, info: WebSandbox.getInfo, connect: WebSandbox.connect, interpreter: InterpreterSandbox.create, fetch: globalThis.fetch, timeout: globalThis.setTimeout }
  try {
    WebSandbox.getInfo = async () => {
      if (fixture.failure) throw fixture.failure
      return { sandboxId: 'saved-fixture', templateId: 'nextjs-fixture', startedAt: new Date(), cpuCount: 2, memoryMB: 512, envdVersion: '0.1.0', metadata: { userID: fixture.ownerId, template: 'nextjs-developer', projectID: 'project-fixture', candidateID: 'minimal' }, state: fixture.state as 'running' | 'paused', endAt: new Date(Date.now() + 600_000) }
    }
    WebSandbox.connect = (async (id: string, options: Record<string, any>) => {
      fixture.connections.push({ id, options })
      if (fixture.connectFailure) throw fixture.connectFailure
      return sandbox(id)
    }) as typeof WebSandbox.connect
    WebSandbox.create = (async (template: string, options: Record<string, any>) => {
      fixture.creates.push({ template, options }); return sandbox('rebuilt-fixture')
    }) as typeof WebSandbox.create
    let pythonCreates = 0
    InterpreterSandbox.create = (async () => { pythonCreates++; return sandbox('python-fixture') }) as typeof InterpreterSandbox.create
    globalThis.fetch = async (url) => {
      assert.match(String(url), /^https:\/\/3000-(saved|rebuilt)-fixture\.fixture\.invalid$/)
      return new Response('<html><body>Campus welcome</body></html>', { status: fixture.httpStatus })
    }
    // Retry timing is shortened only inside this mocked process.
    globalThis.setTimeout = ((callback: (...args: any[]) => void, delay?: number, ...args: any[]) => original.timeout(callback, (delay || 0) >= 60_000 ? delay : Math.min(delay || 0, 1), ...args)) as typeof globalThis.setTimeout
    const request = async (extra: Record<string, unknown> = {}) => POST(new Request('http://fixture.invalid/api/sandbox', { method: 'POST', body: JSON.stringify({ fragment, cachedResult: cached, userID: 'forged-client-user', projectID: 'project-fixture', candidateID: 'minimal', ...extra }) }))

    assert.equal((await request({ fragment: { ...fragment, code: {} } })).status, 400)
    assert.equal((await request({ cachedResult: { ...cached, sbxId: '../invalid' } })).status, 400)
    fixture.userId = null
    assert.equal((await request()).status, 401)
    fixture.userId = 'verified-user'; fixture.ownerId = 'another-user'
    assert.equal((await request()).status, 403)
    assert.equal(fixture.connections.length, 0)
    assert.equal(fixture.creates.length, 0)
    fixture.ownerId = 'verified-user'
    assert.equal((await request({ fragment: { ...fragment, code: 'export default function AnotherVersion(){return <h1>Different version</h1>}' } })).status, 409)
    assert.equal(fixture.creates.length, 0, 'Version mismatch must not silently provision or reuse stale code')
    assert.equal((await request({ fragment: { ...fragment, files: fragment.files.map((file, index) => index === 0 ? { ...file, file_content: file.file_content.replace('Courtyard', 'Updated version') } : file) } })).status, 409, 'A changed supporting file cannot reconnect an old preview')

    for (const state of ['running', 'paused']) {
      fixture.state = state
      const response = await request()
      assert.equal(response.status, 200)
      const result = await response.json() as ExecutionResultWeb
      assert.equal(result.sbxId, 'saved-fixture')
      assert.equal(result.url, 'https://3000-saved-fixture.fixture.invalid')
      assert.equal(result.fragment?.code, actualCode)
      assert.match(result.recoveryFragment!.code, /evo-image:\/\/campus courtyard/)
      assert.deepEqual(result.fragment?.files, fragment.files)
      for (const file of result.recoveryFragment!.files!) assert.match(file.file_content, /evo-image:\/\/campus courtyard/, file.file_path)
      assert.deepEqual(result.imageQueries, [{ file: 'campus.jpg', query: 'campus courtyard' }])
      assert.ok(result.expiresAt! > Date.now())
      assert.equal(result.health?.verified, false)
      assert.equal(result.health?.runtimeStatus, 'skipped')
      assert.equal(fixture.connections.at(-1)!.options.timeoutMs, 600_000)
      assert.equal(fixture.creates.length, 0)
    }
    const legacy = await (await request({ cachedResult: { sbxId: cached.sbxId, template: cached.template, url: cached.url } })).json() as ExecutionResultWeb
    assert.equal(legacy.fragment?.code, actualCode)
    assert.match(legacy.recoveryFragment!.code, /evo-image:\/\/campus courtyard/)
    assert.deepEqual(legacy.fragment?.files, fragment.files)
    assert.deepEqual(legacy.imageQueries, [{ file: 'campus.jpg', query: 'campus courtyard' }])
    for (const status of [403, 429, 503]) {
      fixture.failure = Object.assign(new Error('Fixture provider failure'), { status })
      assert.equal((await request()).status, status)
      assert.equal(fixture.creates.length, 0, `${status} must not provision replacement sandboxes`)
    }
    fixture.failure = new Error('Fixture network timeout')
    assert.equal((await request()).status, 503)
    assert.equal(fixture.creates.length, 0)
    fixture.failure = null; fixture.connectFailure = new Error('Fixture connect timeout')
    assert.equal((await request()).status, 503)
    assert.equal(fixture.creates.length, 0)
    fixture.connectFailure = null; fixture.httpStatus = 503
    assert.equal((await request()).status, 503)
    assert.equal(fixture.creates.length, 0)
    fixture.httpStatus = 200

    fixture.failure = new NotFoundError('Fixture sandbox no longer exists')
    const rebuilt = await (await request({ cachedResult: { ...cached, recoveryFragment: legacy.recoveryFragment } })).json() as ExecutionResultWeb
    assert.equal(rebuilt.sbxId, 'rebuilt-fixture')
    assert.equal(fixture.creates.length, 1)
    assert.deepEqual(fixture.creates[0].options.lifecycle, { onTimeout: 'pause', autoResume: true })
    assert.equal(fixture.creates[0].options.secure, false, 'Legacy hosted templates do not support secured envd access')
    assert.equal(fixture.creates[0].options.metadata.userID, 'verified-user')
    assert.equal(fixture.creates[0].options.metadata.projectID, 'project-fixture')
    assert.equal(rebuilt.fragment?.code, actualCode)
    assert.deepEqual(rebuilt.fragment?.files, fragment.files)
    for (const file of rebuilt.fragment!.files!) assert.equal(files.get(file.file_path), file.file_content)
    for (const file of rebuilt.recoveryFragment!.files!) assert.match(file.file_content, /evo-image:\/\/campus courtyard/, file.file_path)
    assert.match(rebuilt.recoveryFragment!.code, /evo-image:\/\/campus courtyard/)
    assert.deepEqual(rebuilt.imageQueries, [{ file: 'campus.jpg', query: 'campus courtyard' }])
    assert.ok(files.get('public/evo-images/campus.jpg') instanceof ArrayBuffer)
    assert.equal(rebuilt.health?.verified, false)
    assert.equal(rebuilt.health?.buildStatus, 'passed')
    fixture.failure = null
    const python = await request({ cachedResult: undefined, fragment: { ...fragment, template: 'code-interpreter-v1', file_path: 'main.py', code: 'print("ok")', port: null } })
    assert.equal(python.status, 200)
    assert.equal(pythonCreates, 1)
    assert.equal(fixture.creates.length, 1, 'Python must retain the interpreter SDK')
    console.log('sandbox-recovery-check ok: full-project ownership/version matching, running/paused reuse, component/CSS/JSON image recovery, 404 rebuild, no replacements on provider failures, Python SDK')
  } finally {
    WebSandbox.create = original.create; WebSandbox.getInfo = original.info; WebSandbox.connect = original.connect
    InterpreterSandbox.create = original.interpreter; globalThis.fetch = original.fetch; globalThis.setTimeout = original.timeout
    delete globals.__evoSandboxFixture
  }
}

void check().catch(error => { console.error(error); process.exitCode = 1 })

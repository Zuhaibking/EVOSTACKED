import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { NotFoundError, Sandbox as WebSandbox } from 'e2b'
import { Sandbox as InterpreterSandbox } from '@e2b/code-interpreter'

async function check() {
  const fixture = {
    userId: 'owner-a' as string | null, creates: 0, pythonCreates: 0, fail: false, gate: Promise.resolve(),
    writes: [] as string[], commands: [] as string[], typecheckFails: false,
    modelCalls: 0, modelSignal: undefined as AbortSignal | undefined, modelGate: Promise.resolve({ text: '' }),
  }
  const globals = globalThis as typeof globalThis & { __evoDedupeFixture?: typeof fixture }
  globals.__evoDedupeFixture = fixture
  const bundled = await build({
    entryPoints: ['app/api/sandbox/route.ts'], absWorkingDir: process.cwd(),
    platform: 'node', format: 'cjs', bundle: true, packages: 'external', write: false,
    define: { 'import.meta.url': JSON.stringify(pathToFileURL(resolve('lib/sandbox-dedupe-check.ts')).href) },
    plugins: [{ name: 'server-fixtures', setup(b) {
      const mocks: Record<string, string> = {
        '@clerk/nextjs/server': `export async function auth(){return {userId:globalThis.__evoDedupeFixture.userId}}`,
        '@/lib/images': `export const IMAGE_DIR='public/evo-images',IMAGE_PUBLIC='/evo-images';export async function resolveImages(files){return {files,binaries:[],manifest:[],assets:[]}}`,
        '@/lib/models': `export function getModelClient(){return 'fixture-model'}`,
        ai: `export async function generateText(args){const f=globalThis.__evoDedupeFixture;f.modelCalls++;f.modelSignal=args.abortSignal;return f.modelGate}`,
      }
      b.onResolve({ filter: /^(@clerk\/nextjs\/server|@\/lib\/(images|models)|ai)$/ }, args => ({ path: args.path, namespace: 'fixture' }))
      b.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ loader: 'js', contents: mocks[args.path] }))
    } }],
  })
  const loaded = { exports: {} as { POST: (req: Request) => Promise<Response> } }
  new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(createRequire(resolve('lib/sandbox-dedupe-check.ts')), loaded, loaded.exports)
  const fragment = {
    commentary: '', template: 'nextjs-developer', title: 'Dedupe fixture', description: '',
    additional_dependencies: [], has_additional_dependencies: false, install_dependencies_command: '', port: 3000,
    file_path: 'index.html', code: '<!doctype html><html><body>Hello</body></html>',
  }
  const sandbox = (id: string) => ({
    sandboxId: id, getHost: (port: number) => `${port}-${id}.fixture.invalid`,
    files: { write: async () => { fixture.writes.push(id) }, read: async () => { throw new Error('No fixture file') } },
    commands: { run: async (command: string) => {
      fixture.commands.push(`${id}:${command}`)
      if (command.includes('./node_modules/.bin/tsc') && fixture.typecheckFails) return { exitCode: 1, stdout: "pages/index.tsx(1,30): error TS2322: Type 'number' is not assignable to type 'string'.", stderr: '' }
      return { exitCode: 0, stdout: command.includes('p.devDependencies') ? 'react,next' : '', stderr: '' }
    } },
    runCode: async () => ({ logs: { stdout: ['ok'], stderr: [] }, results: [], error: undefined }),
  })
  const original = {
    create: WebSandbox.create, info: WebSandbox.getInfo, interpreter: InterpreterSandbox.create, fetch: globalThis.fetch,
    publishable: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY, secret: process.env.CLERK_SECRET_KEY,
  }
  let release = () => {}
  const originalSetTimeout = globalThis.setTimeout, originalClearTimeout = globalThis.clearTimeout, originalNow = Date.now
  const timers = new Map<ReturnType<typeof setTimeout>, { delay: number; fire: () => void }>()
  const cleanup: (() => void)[] = []
  const unhandled: unknown[] = []
  const observeUnhandled = (reason: unknown) => unhandled.push(reason)
  try {
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = 'fixture'
    process.env.CLERK_SECRET_KEY = 'fixture'
    WebSandbox.create = (async () => {
      const id = `created-${++fixture.creates}`
      await fixture.gate
      if (fixture.fail) throw new Error('Fixture creation failed')
      return sandbox(id)
    }) as typeof WebSandbox.create
    InterpreterSandbox.create = (async () => sandbox(`python-${++fixture.pythonCreates}`)) as typeof InterpreterSandbox.create
    globalThis.fetch = async () => { throw new Error('Unexpected external request') }
    const request = (extra: Record<string, unknown> = {}) => loaded.exports.POST(new Request('http://fixture.invalid/api/sandbox', {
      method: 'POST', body: JSON.stringify({ fragment, userID: 'untrusted-body-owner', projectID: 'project-a', candidateID: 'minimal', runID: 'run-a', ...extra }),
    }))
    const waitCreates = async (count: number) => {
      for (let i = 0; i < 100 && fixture.creates < count; i++) await new Promise<void>(resolve => setImmediate(resolve))
      assert.equal(fixture.creates, count)
    }

    fixture.gate = new Promise<void>(resolve => { release = resolve })
    const first = request(), second = request()
    await waitCreates(1)
    release()
    const responses = await Promise.all([first, second])
    const values = await Promise.all(responses.map(response => response.json()))
    assert.equal(values[0].sbxId, values[1].sbxId, 'Concurrent refresh requests must await the same paid creation')
    assert.equal(fixture.creates, 1)
    assert.equal((await (await request()).json()).sbxId, values[0].sbxId, 'Completed successes remain reusable briefly')
    assert.equal(fixture.creates, 1)
    fixture.gate = Promise.resolve()

    const changed = await (await request({ fragment: { ...fragment, code: fragment.code.replace('Hello', 'Updated') } })).json()
    assert.notEqual(changed.sbxId, values[0].sbxId)
    const withSupport = { ...fragment, files: [{ file_path: 'styles/site.css', file_content: 'body { color: lime; }' }] }
    const support = await (await request({ fragment: withSupport })).json()
    const changedSupport = await (await request({ fragment: { ...withSupport, files: [{ file_path: 'styles/site.css', file_content: 'body { color: gold; }' }] } })).json()
    assert.notEqual(support.sbxId, changedSupport.sbxId, 'Supporting source changes must create a distinct preview')
    fixture.userId = 'owner-b'
    const otherOwner = await (await request()).json()
    assert.notEqual(otherOwner.sbxId, values[0].sbxId, 'Verified owners cannot share another account\'s preview')
    fixture.userId = 'owner-a'
    const newRun = await (await request({ runID: 'run-b' })).json()
    assert.notEqual(newRun.sbxId, values[0].sbxId)
    const repaired = await (await request({ runtimeError: 'Fixture hydration failure' })).json()
    assert.notEqual(repaired.sbxId, values[0].sbxId)

    const beforeFailure = fixture.creates
    fixture.fail = true
    await assert.rejects(request({ projectID: 'failed-project' }), /Fixture creation failed/)
    fixture.fail = false
    assert.equal((await request({ projectID: 'failed-project' })).status, 200)
    assert.equal(fixture.creates, beforeFailure + 2, 'A failed creation must allow an explicit retry')

    WebSandbox.getInfo = async () => { throw new NotFoundError('Fixture preview expired') }
    const cachedResult = { sbxId: 'expired-fixture', template: 'nextjs-developer', url: 'https://fixture.invalid', fragment }
    const beforeRebuild = fixture.creates
    fixture.gate = new Promise<void>(resolve => { release = resolve })
    const rebuilds = [request({ cachedResult, projectID: 'rebuild-project' }), request({ cachedResult, projectID: 'rebuild-project' })]
    await waitCreates(beforeRebuild + 1)
    release()
    const rebuilt = await Promise.all((await Promise.all(rebuilds)).map(response => response.json()))
    assert.equal(rebuilt[0].sbxId, rebuilt[1].sbxId, 'Concurrent 404 replacements also share one creation')
    fixture.gate = Promise.resolve()
    WebSandbox.getInfo = async () => { throw Object.assign(new Error('Fixture reconnect unavailable'), { status: 503 }) }
    assert.equal((await request({ cachedResult })).status, 503)
    assert.equal(fixture.creates, beforeRebuild + 1, 'Reconnect failures must not enter the creation cache')

    const beforeQuota = fixture.creates
    fixture.gate = new Promise<void>(resolve => { release = resolve })
    const active = Array.from({ length: 8 }, (_, index) => request({ projectID: `quota-${index}` }))
    await waitCreates(beforeQuota + 8)
    assert.equal((await request({ projectID: 'quota-overflow' })).status, 429)
    release()
    assert.ok((await Promise.all(active)).every(response => response.status === 200))
    fixture.gate = Promise.resolve()

    const pythonFragment = { ...fragment, template: 'code-interpreter-v1', file_path: 'main.py', code: 'print("ok")', port: null }
    await Promise.all([request({ fragment: pythonFragment }), request({ fragment: pythonFragment })])
    assert.equal(fixture.pythonCreates, 2, 'Python execution preserves its existing per-request behavior')

    // Fire only the route's explicit deadlines; ordinary async scheduling stays real.
    let now = originalNow()
    Date.now = () => now
    globalThis.setTimeout = ((callback: (...args: any[]) => void, delay?: number, ...args: any[]) => {
      const timer = originalSetTimeout(callback, delay, ...args)
      if (delay === 300_000 || delay === 60_000) timers.set(timer, { delay, fire: () => callback(...args) })
      return timer
    }) as typeof setTimeout
    globalThis.clearTimeout = ((timer: ReturnType<typeof setTimeout>) => { timers.delete(timer); originalClearTimeout(timer) }) as typeof clearTimeout
    const fireDeadline = (delay: number) => {
      const timer = [...timers].reverse().find(([, value]) => value.delay === delay)
      assert.ok(timer, `Expected an active ${delay}ms deadline`)
      originalClearTimeout(timer[0]); timers.delete(timer[0]); timer[1].fire()
    }
    const turn = () => new Promise<void>(resolve => setImmediate(resolve))
    process.on('unhandledRejection', observeUnhandled)

    let releaseOld!: () => void
    fixture.gate = new Promise<void>(resolve => { releaseOld = resolve }); cleanup.push(releaseOld)
    const beforeTimeout = fixture.creates
    const oldId = `created-${beforeTimeout + 1}`
    const stalled = request({ projectID: 'timeout-create' })
    await waitCreates(beforeTimeout + 1)
    fireDeadline(300_000)
    const terminal = await stalled
    assert.equal(terminal.status, 504)
    assert.equal((await terminal.json()).code, 'PREVIEW_TIMEOUT')
    assert.equal((await request({ projectID: 'timeout-create' })).status, 504)
    assert.equal(fixture.creates, beforeTimeout + 1, 'Refresh reuses the timed-out paid request for 30 seconds')
    assert.ok(!fixture.writes.includes(oldId))

    let releaseQuota!: () => void
    fixture.gate = new Promise<void>(resolve => { releaseQuota = resolve }); cleanup.push(releaseQuota)
    const timeoutQuota = Array.from({ length: 8 }, (_, index) => request({ projectID: `timeout-quota-${index}` }))
    await waitCreates(beforeTimeout + 9)
    assert.equal((await request({ projectID: 'timeout-quota-overflow' })).status, 429)
    releaseQuota()
    assert.ok((await Promise.all(timeoutQuota)).every(response => response.status === 200), 'A timeout releases its active quota slot')

    now += 30_001
    let releaseNew!: () => void
    fixture.gate = new Promise<void>(resolve => { releaseNew = resolve }); cleanup.push(releaseNew)
    const fresh = request({ projectID: 'timeout-create' })
    await waitCreates(beforeTimeout + 10)
    releaseOld()
    await turn(); await turn()
    assert.ok(!fixture.writes.includes(oldId), 'Ignored cancellation cannot let late creation write remote files')
    assert.ok(!fixture.commands.some(command => command.startsWith(`${oldId}:`)), 'Late creation cannot proceed to commands/probes')
    const sharedNew = request({ projectID: 'timeout-create' })
    await turn()
    assert.equal(fixture.creates, beforeTimeout + 10, 'Late completion cannot evict the newer active dedupe job')
    releaseNew()
    const newValues = await Promise.all((await Promise.all([fresh, sharedNew])).map(response => response.json()))
    assert.equal(newValues[0].sbxId, newValues[1].sbxId)
    assert.notEqual(newValues[0].sbxId, oldId)
    assert.equal((await (await request({ projectID: 'timeout-create' })).json()).sbxId, newValues[0].sbxId)
    fixture.gate = Promise.resolve()

    let releaseModel!: (value: { text: string }) => void
    fixture.modelGate = new Promise(resolve => { releaseModel = resolve })
    cleanup.push(() => releaseModel({ text: '' }))
    fixture.typecheckFails = true
    const nextFragment = { ...fragment, file_path: 'pages/index.tsx', code: 'export default function Page(){return <main>Fixture</main>}' }
    const modelRequest = { projectID: 'timeout-model', fragment: nextFragment, model: { id: 'fixture' }, config: { model: 'fixture' } }
    const repairing = request(modelRequest)
    for (let i = 0; i < 100 && fixture.modelCalls < 1; i++) await turn()
    assert.equal(fixture.modelCalls, 1)
    const writesAtModel = fixture.writes.length, commandsAtModel = fixture.commands.length, createsAtModel = fixture.creates
    fireDeadline(60_000)
    const repairTerminal = await repairing
    assert.equal(repairTerminal.status, 504)
    assert.equal((await repairTerminal.json()).code, 'PREVIEW_TIMEOUT')
    assert.ok(fixture.modelSignal?.aborted)
    assert.equal((await request(modelRequest)).status, 504)
    assert.equal(fixture.creates, createsAtModel)
    assert.equal(fixture.modelCalls, 1)
    releaseModel({ text: JSON.stringify({ files: [{ file_path: nextFragment.file_path, file_content: nextFragment.code.replace('Fixture', 'Late result') }] }) })
    await turn(); await turn()
    assert.equal(fixture.writes.length, writesAtModel, 'Late model response must never write repaired files')
    assert.equal(fixture.commands.length, commandsAtModel, 'Late model response must never run another compiler/probe')
    assert.equal(fixture.modelCalls, 1)
    assert.equal(unhandled.length, 0, 'Timeout races must not leave unhandled promise rejections')
    fixture.typecheckFails = false
    fixture.userId = null
    assert.equal((await request()).status, 401, 'Auth failures must never read a completed shared preview')
    console.log('sandbox-dedupe-check ok: shared creation, source/owner/run isolation, retry/quota/auth, 300s creation and 60s repair deadlines, 30s timeout replay, late result isolation')
  } finally {
    release()
    cleanup.forEach(resolve => resolve())
    for (const timer of timers.keys()) originalClearTimeout(timer)
    globalThis.setTimeout = originalSetTimeout; globalThis.clearTimeout = originalClearTimeout; Date.now = originalNow
    process.removeListener('unhandledRejection', observeUnhandled)
    WebSandbox.create = original.create; WebSandbox.getInfo = original.info; InterpreterSandbox.create = original.interpreter; globalThis.fetch = original.fetch
    for (const [key, value] of [['NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', original.publishable], ['CLERK_SECRET_KEY', original.secret]]) {
      if (value === undefined) delete process.env[key!]
      else process.env[key!] = value
    }
    delete globals.__evoDedupeFixture
  }
}

void check().catch(error => { console.error(error); process.exitCode = 1 })

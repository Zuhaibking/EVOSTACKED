import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { NotFoundError, Sandbox as WebSandbox } from 'e2b'
import { Sandbox as InterpreterSandbox } from '@e2b/code-interpreter'

async function check() {
  const fixture = { userId: 'owner-a' as string | null, creates: 0, pythonCreates: 0, fail: false, gate: Promise.resolve() }
  const globals = globalThis as typeof globalThis & { __evoDedupeFixture?: typeof fixture }
  globals.__evoDedupeFixture = fixture
  const bundled = await build({
    entryPoints: ['app/api/sandbox/route.ts'], absWorkingDir: process.cwd(),
    platform: 'node', format: 'cjs', bundle: true, packages: 'external', write: false,
    define: { 'import.meta.url': JSON.stringify(pathToFileURL(resolve('lib/sandbox-dedupe-check.ts')).href) },
    plugins: [{ name: 'server-fixtures', setup(b) {
      b.onResolve({ filter: /^(@clerk\/nextjs\/server|@\/lib\/images)$/ }, args => ({ path: args.path, namespace: 'fixture' }))
      b.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ loader: 'js', contents: args.path === '@clerk/nextjs/server'
        ? `export async function auth(){return {userId:globalThis.__evoDedupeFixture.userId}}`
        : `export const IMAGE_DIR='public/evo-images',IMAGE_PUBLIC='/evo-images';export async function resolveImages(files){return {files,binaries:[],manifest:[],assets:[]}}` }))
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
    files: { write: async () => {}, read: async () => { throw new Error('No fixture file') } },
    commands: { run: async () => ({ exitCode: 0, stdout: '', stderr: '' }) },
    runCode: async () => ({ logs: { stdout: ['ok'], stderr: [] }, results: [], error: undefined }),
  })
  const original = {
    create: WebSandbox.create, info: WebSandbox.getInfo, interpreter: InterpreterSandbox.create, fetch: globalThis.fetch,
    publishable: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY, secret: process.env.CLERK_SECRET_KEY,
  }
  let release = () => {}
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
    fixture.userId = null
    assert.equal((await request()).status, 401, 'Auth failures must never read a completed shared preview')
    console.log('sandbox-dedupe-check ok: fresh/404 concurrent sharing, source/owner/run/runtime isolation, retry after failure, reconnect exclusion, active quota, Python bypass, auth gate')
  } finally {
    release()
    WebSandbox.create = original.create; WebSandbox.getInfo = original.info; InterpreterSandbox.create = original.interpreter; globalThis.fetch = original.fetch
    for (const [key, value] of [['NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', original.publishable], ['CLERK_SECRET_KEY', original.secret]]) {
      if (value === undefined) delete process.env[key!]
      else process.env[key!] = value
    }
    delete globals.__evoDedupeFixture
  }
}

void check().catch(error => { console.error(error); process.exitCode = 1 })

import assert from 'node:assert/strict'
import { createSandbox } from './sandbox-client'

async function check() {
  const original = globalThis.fetch
  const originalTimeout = AbortSignal.timeout
  try {
    let started = 0
    const release: (() => void)[] = []
    globalThis.fetch = async (_url, options) => {
      const index = started++
      assert.equal(options?.headers && (options.headers as Record<string, string>)['Content-Type'], 'application/json')
      await new Promise<void>((resolve) => release.push(resolve))
      return index === 1
        ? new Response(JSON.stringify({ error: 'TypeScript compilation failed' }), { status: 422 })
        : new Response(JSON.stringify({ sbxId: `sandbox-${index}`, template: 'nextjs-developer', url: `https://preview-${index}.e2b.app` }))
    }
    const running = Promise.allSettled([0, 1, 2].map(() => createSandbox({ fragment: {} })))
    assert.equal(started, 3, 'All three requests must start without waiting for each other')
    release.forEach((resolve) => resolve())
    const results = await running
    assert.deepEqual(results.map((r) => r.status), ['fulfilled', 'rejected', 'fulfilled'])
    assert.match((results[1] as PromiseRejectedResult).reason.message, /TypeScript/)
    globalThis.fetch = async () => new Response('<html>Broken</html>', { status: 500 })
    await assert.rejects(createSandbox({}), /Broken/)
    globalThis.fetch = async () => new Response(JSON.stringify({ sbxId: 'x', template: 'nextjs-developer', url: 'https://x.e2b.app', health: { state: 'FAILED', log: ['Hydration failed'] } }))
    await assert.rejects(createSandbox({}), /Hydration failed/)
    const unconfirmed = { sbxId: 'unconfirmed', template: 'nextjs-developer', url: 'https://fixture.invalid', health: { state: 'UNVERIFIED', log: ['[EvoStack][RESULT] UNVERIFIED'] } }
    globalThis.fetch = async () => new Response(JSON.stringify(unconfirmed))
    await assert.rejects(createSandbox({}), /server did not respond/, 'A timed-out HTTP check cannot become a ready preview')
    globalThis.fetch = async () => new Response(JSON.stringify({ ...unconfirmed, health: { ...unconfirmed.health, log: ['[EvoStack][HTTP] PASS'] } }))
    assert.equal((await createSandbox({})).sbxId, 'unconfirmed', 'HTTP success may remain unverified until browser interactions are checked')
    globalThis.fetch = async () => new Response(JSON.stringify({ ...unconfirmed, health: { ...unconfirmed.health, log: ['[EvoStack][PREVIEW] Saved sandbox reconnected; HTTP responded.'] } }))
    assert.equal((await createSandbox({})).sbxId, 'unconfirmed')
    globalThis.fetch = async () => new Response(JSON.stringify({ error: 'Unexpected shape' }))
    await assert.rejects(createSandbox({}), /could not be created/)
    const source = { code: 'saved source', template: 'nextjs-developer', file_path: 'pages/index.tsx' }
    const cached = { sbxId: 'saved', template: source.template, url: 'https://saved.e2b.app', fragment: source, recoveryFragment: { ...source, code: 'portable source' }, imageQueries: [{ file: 'campus.jpg', query: 'campus courtyard' }] }
    let sent: any
    globalThis.fetch = async (_url, options) => {
      sent = JSON.parse(String(options?.body))
      return new Response(JSON.stringify(cached))
    }
    await createSandbox({ fragment: source, cachedResult: cached })
    assert.equal(sent.fragment.code, 'portable source', 'Matching cache must retain portable assets for recovery')
    assert.equal(sent.cachedResult.sbxId, 'saved')
    await createSandbox({ fragment: { ...source, code: 'new inspector edit' }, cachedResult: cached })
    assert.equal(sent.fragment.code, 'new inspector edit', 'Saved edits must not be replaced by old cached source')
    assert.equal(sent.cachedResult, undefined, 'Changed source must create the selected version instead of reconnecting older code')
    await createSandbox({ fragment: { ...source, code: 'new edit with /evo-images/campus.jpg' }, cachedResult: cached })
    assert.equal(sent.fragment.code, 'new edit with evo-image://campus courtyard', 'Edited source must keep its photos portable')
    assert.equal(sent.cachedResult, undefined)
    await createSandbox({ fragment: source, cachedResult: cached, runtimeError: 'Hydration failed' })
    assert.equal(sent.fragment.code, 'portable source')
    assert.equal(sent.cachedResult, undefined, 'Runtime repair must run against the source, not reconnect the broken app')
    const multi = { ...source, files: [
      { file_path: 'components/Hero.tsx', file_content: 'export default function Hero() { return <img src="/evo-images/campus.jpg" /> }' },
      { file_path: 'styles/Home.module.css', file_content: '.hero { background: url("/evo-images/campus.jpg") }' },
    ] }
    const multiCache = { ...cached, fragment: multi, recoveryFragment: { ...multi, files: multi.files.map((file) => ({ ...file, file_content: file.file_content.replace('/evo-images/campus.jpg', 'evo-image://campus courtyard') })) } }
    await createSandbox({ fragment: multi, cachedResult: multiCache })
    assert.equal(sent.cachedResult.sbxId, 'saved')
    assert.match(sent.fragment.files[0].file_content, /evo-image:\/\/campus courtyard/)
    const editedMulti = { ...multi, files: [{ ...multi.files[0], file_content: multi.files[0].file_content.replace('Hero()', 'EditedHero()') }, multi.files[1]] }
    await createSandbox({ fragment: editedMulti, cachedResult: multiCache })
    assert.equal(sent.cachedResult, undefined, 'An edit in a supporting component must invalidate the old preview')
    assert.match(sent.fragment.files[0].file_content, /EditedHero/)
    assert.match(sent.fragment.files[0].file_content, /evo-image:\/\/campus courtyard/)
    assert.match(sent.fragment.files[1].file_content, /evo-image:\/\/campus courtyard/)
    assert.equal(sent.fragment.code, source.code, 'Portable asset recovery must preserve the entry source')
    await createSandbox({ fragment: { ...multi, files: [...multi.files].reverse() }, cachedResult: multiCache })
    assert.equal(sent.cachedResult.sbxId, 'saved', 'File order alone does not change a project')
    AbortSignal.timeout = () => originalTimeout(5)
    globalThis.fetch = async (_url, options) => {
      const signal = options!.signal!
      await new Promise<void>((_resolve, reject) => {
        if (signal.aborted) reject(signal.reason)
        else signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
      throw new Error('Unreachable')
    }
    const keepAlive = setTimeout(() => {}, 100)
    try {
      await assert.rejects(createSandbox({}), /preparation timed out/)
      const controller = new AbortController()
      controller.abort(new Error('User canceled preview'))
      await assert.rejects(createSandbox({}, controller.signal), /User canceled preview/)
      globalThis.fetch = async (_url, options) => new Response(new ReadableStream({
        start(controller) { options!.signal!.addEventListener('abort', () => controller.error(options!.signal!.reason), { once: true }) },
      }))
      await assert.rejects(createSandbox({}), /preparation timed out/, 'A stalled response body must also stop waiting')
    } finally { clearTimeout(keepAlive) }
    console.log('sandbox-client-check ok: parallel requests, isolated failures, invalid responses, fetch/body deadlines, user cancellation')
  } finally {
    globalThis.fetch = original
    AbortSignal.timeout = originalTimeout
  }
}
void check().catch((error) => { console.error(error); process.exitCode = 1 })

import assert from 'node:assert/strict'
import { createSandbox } from './sandbox-client'

async function check() {
  const original = globalThis.fetch
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
    console.log('sandbox-client-check ok: parallel requests, isolated failures, invalid responses')
  } finally {
    globalThis.fetch = original
  }
}
void check().catch((error) => { console.error(error); process.exitCode = 1 })

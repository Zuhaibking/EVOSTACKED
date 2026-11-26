import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { build } from 'esbuild'
import type { FragmentSchema } from './schema'

async function check() {
  type Variant = 'minimal' | 'rich' | 'playful'
  const fragment = (id: Variant): FragmentSchema => ({
    commentary: '', template: 'nextjs-developer', title: id, description: '',
    additional_dependencies: [], has_additional_dependencies: false, install_dependencies_command: '', port: 3000,
    file_path: 'pages/index.tsx', code: `import Hero from '../components/Hero'; export default function Page(){return <Hero/>}`,
    files: [
      { file_path: 'components/Hero.tsx', file_content: `import { title } from '../data/site'; export default function Hero(){return <main>{title}</main>}` },
      { file_path: 'data/site.ts', file_content: `export const title = '${id}'` },
    ],
  })
  const streams: { id: Variant; signal: AbortSignal; release: () => void }[] = []
  const fixture = {
    userId: 'owner-fixture' as string | null,
    rateCalls: 0,
    judges: 0,
    stream(args: { system: string; abortSignal: AbortSignal }) {
      const id: Variant = args.system.includes('editorial density') ? 'rich' : args.system.includes('vivid personality') ? 'playful' : 'minimal'
      let release!: () => void
      const ready = new Promise<void>(resolve => { release = resolve })
      const entry = { id, signal: args.abortSignal, release }
      streams.push(entry)
      args.abortSignal.addEventListener('abort', release, { once: true })
      return {
        partialObjectStream: (async function* () {
          await ready
          if (args.abortSignal.aborted) throw new Error('Generation stopped')
          yield { title: id, code: '' }
          yield fragment(id)
        })(),
        object: ready.then(() => fragment(id)),
      }
    },
    async judge() {
      fixture.judges++
      return { object: { winnerId: 'minimal', reasoning: 'Fixture judgment', scores: ['minimal', 'rich', 'playful'].map(id => ({ id, clarity: .9, fit: .9, polish: .9, composite: .9, comment: 'Fixture' })) } }
    },
  }
  type Job = { done: boolean; completedAt?: number; abort: AbortController; subscribers: Set<unknown>; latest: Map<string, unknown> }
  const globals = globalThis as typeof globalThis & { __evoTournamentFixture?: typeof fixture; __evoTournamentJobs?: Map<string, Job> }
  globals.__evoTournamentFixture = fixture
  globals.__evoTournamentJobs = new Map()
  const bundle = await build({
    entryPoints: ['app/api/tournament/route.ts'], absWorkingDir: process.cwd(), platform: 'node', format: 'cjs', bundle: true, packages: 'external', write: false,
    plugins: [{ name: 'job-fixtures', setup(b) {
      const mocks: Record<string, string> = {
        '@clerk/nextjs/server': `export async function auth(){return {userId:globalThis.__evoTournamentFixture.userId}}`,
        '@/lib/models': `export function getModelClient(){return 'fixture-model'};export function modelRejection(){return null};export function hasOwnApiKey(c){return Boolean(c&&typeof c.apiKey==='string'&&c.apiKey.trim())};export function sanitizeModelParams(){return {}}`,
        '@/lib/prompt': `export function toPrompt(){return 'Fixture template'}`,
        '@/lib/ratelimit': `export default async function ratelimit(){globalThis.__evoTournamentFixture.rateCalls++;return false};export const OWN_KEY_LIMIT_MULTIPLIER=10;export function rateLimitKey(){return 'fixture'}`,
        // streamObject is synchronous in ai v7 (the route no longer awaits it); generateObject stays async.
        ai: `export function streamObject(args){return globalThis.__evoTournamentFixture.stream(args)};export async function generateObject(){return globalThis.__evoTournamentFixture.judge()}`,
      }
      b.onResolve({ filter: /^(@clerk\/nextjs\/server|@\/lib\/(models|prompt|ratelimit)|ai)$/ }, args => ({ path: args.path, namespace: 'fixture' }))
      b.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: mocks[args.path], loader: 'js' }))
    } }],
  })
  const fixtureModule = { exports: {} as Record<'POST' | 'GET' | 'DELETE', (req: Request) => Promise<Response>> }
  new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(resolve('lib/tournament-job-check.ts')), fixtureModule, fixtureModule.exports)
  const api = fixtureModule.exports
  const body = { projectID: 'project-fixture', runID: 'run-fixture', messages: [{ role: 'user', content: 'Personal portfolio' }], template: {}, model: { id: 'fixture' }, config: { model: 'fixture' } }
  const post = (extra: Record<string, unknown> = {}) => api.POST(new Request('http://fixture.invalid/api/tournament', { method: 'POST', body: JSON.stringify({ ...body, ...extra }) }))
  const action = (method: 'GET' | 'DELETE', runID = body.runID) => api[method](new Request(`http://fixture.invalid/api/tournament?projectID=${body.projectID}&runID=${runID}`, { method }))
  const events = (text: string) => text.trim().split('\n\n').filter(Boolean).map(line => JSON.parse(line.replace(/^data: /, '')))
  const settle = async () => { for (const stream of streams) stream.release(); await new Promise(resolve => setTimeout(resolve, 0)) }
  const originalTimer = globalThis.setTimeout
  const deadlines: (() => void)[] = []
  globalThis.setTimeout = ((callback: (...args: any[]) => void, delay?: number, ...args: any[]) => {
    if (delay === 300_000) deadlines.push(() => callback(...args))
    return originalTimer(callback, delay, ...args)
  }) as typeof globalThis.setTimeout
  try {
    fixture.userId = null
    assert.equal((await post()).status, 401)
    fixture.userId = 'owner-fixture'
    assert.equal((await post({ runID: '../bad' })).status, 400)
    assert.equal((await action('GET', 'missing-run')).status, 404)
    assert.equal(streams.length, 0)

    const first = await post()
    assert.equal(first.status, 200)
    assert.equal(streams.length, 3)
    assert.equal(fixture.rateCalls, 1)
    const reader = first.body!.getReader()
    const firstEvent = await reader.read()
    assert.match(new TextDecoder().decode(firstEvent.value), /candidate_start/)
    await reader.cancel()
    assert.ok(streams.every(s => !s.signal.aborted), 'Browser detach must not cancel the paid generation')
    const duplicate = await post({ messages: undefined, config: undefined })
    assert.equal(duplicate.status, 200, 'Existing job replay precedes new input/rate/model work')
    await duplicate.body!.cancel()
    assert.equal(streams.length, 3)
    assert.equal(fixture.rateCalls, 1)
    fixture.userId = 'another-owner'
    assert.equal((await action('GET')).status, 404)
    assert.equal((await action('DELETE')).status, 404)
    fixture.userId = 'owner-fixture'
    const resumed = await action('GET')
    const resumedText = resumed.text()
    await settle()
    const completed = events(await resumedText)
    assert.equal(completed.filter(e => e.type === 'candidate_done').length, 3)
    assert.ok(completed.some(e => e.type === 'verdict'))
    assert.equal(completed.at(-1).type, 'tournament_done')
    assert.equal(streams.length, 3, 'Resume must use the original three model calls')
    assert.equal(fixture.judges, 1)
    const replay = events(await (await action('GET')).text())
    assert.equal(replay.length, 5, 'Completed replay retains only final candidates, verdict, and terminal event')
    assert.equal(replay.filter(e => e.type === 'candidate_chunk').length, 0)

    const stopped = await post({ runID: 'stop-fixture' })
    await stopped.body!.cancel()
    assert.equal(streams.length, 6)
    assert.equal((await action('DELETE', 'stop-fixture')).status, 200)
    assert.ok(streams.slice(3).every(s => s.signal.aborted), 'Only explicit DELETE aborts model work')
    const canceled = events(await (await action('GET', 'stop-fixture')).text())
    assert.equal(canceled.filter(e => e.type === 'candidate_error').length, 3)
    assert.equal(canceled.at(-1).type, 'tournament_done')

    assert.equal((await post({ runID: 'seed-fixture', seedCandidates: { minimal: { ...fragment('minimal'), code: {} } } })).status, 400)
    const seeded = await post({ runID: 'seed-fixture', seedCandidates: { minimal: fragment('minimal') } })
    const seededText = seeded.text()
    assert.equal(streams.length, 8, 'A completed seed avoids generating that variant again')
    await settle()
    const seededEvents = events(await seededText)
    assert.equal(seededEvents.filter(e => e.type === 'candidate_done').length, 3)
    assert.ok(seededEvents.some(e => e.type === 'verdict'))
    assert.equal(fixture.judges, 2)
    const allSeeded = await post({ runID: 'all-seed-fixture', seedCandidates: Object.fromEntries(['minimal', 'rich', 'playful'].map(id => [id, fragment(id as Variant)])) })
    assert.equal(events(await allSeeded.text()).filter(e => e.type === 'candidate_done').length, 3)
    assert.equal(streams.length, 8)

    const timedOut = await post({ runID: 'timeout-fixture' })
    const timeoutText = timedOut.text()
    assert.equal(streams.length, 11)
    deadlines.at(-1)!()
    const timedOutEvents = events(await timeoutText)
    assert.equal(timedOutEvents.filter(e => e.type === 'candidate_error' && /timed out/.test(e.error)).length, 3)
    assert.equal(timedOutEvents.at(-1).type, 'tournament_done')
    assert.ok(streams.slice(8).every(s => s.signal.aborted), 'The bounded server deadline aborts hung model requests')

    const registry = globals.__evoTournamentJobs!
    const completedJob = registry.get(JSON.stringify(['owner-fixture', body.projectID, body.runID]))!
    completedJob.completedAt = Date.now() - 3_600_001
    assert.equal((await action('GET')).status, 404, 'Completed entries expire after the bounded TTL')
    const sample = [...registry.values()][0]
    registry.clear()
    for (let i = 0; i < 32; i++) registry.set(`busy-${i}`, { ...sample, done: false, completedAt: undefined, abort: new AbortController(), subscribers: new Set() })
    assert.equal((await post({ runID: 'over-capacity' })).status, 429)
    assert.equal(streams.length, 11, 'Capacity rejection must not start model calls')
    console.log('tournament-job-check ok: verified owner, refresh replay, no duplicate calls, explicit stop, completed seeds, timeout, TTL and capacity')
  } finally {
    globalThis.setTimeout = originalTimer
    for (const job of globals.__evoTournamentJobs?.values() || []) job.abort.abort()
    delete globals.__evoTournamentJobs
    delete globals.__evoTournamentFixture
  }
}

void check().catch(error => { console.error(error); process.exitCode = 1 })

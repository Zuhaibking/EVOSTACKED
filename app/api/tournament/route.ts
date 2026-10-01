import { createRateLimitResponse } from '@/lib/api-errors'
import { auth } from '@clerk/nextjs/server'
import { Duration } from '@/lib/duration'
import { getModelClient, LLMModel, LLMModelConfig } from '@/lib/models'
import { toPrompt } from '@/lib/prompt'
import ratelimit from '@/lib/ratelimit'
import { assertGeneratedFragment, fragmentCodeText, fragmentSchema as schema, fragmentSourceText, generatedFragmentSchema, type FragmentSchema } from '@/lib/schema'
import { Templates } from '@/lib/templates'
import {
  VARIANTS,
  VariantId,
  TournamentEvent,
  verdictSchema,
} from '@/lib/tournament'
import {
  CoreMessage,
  LanguageModel,
  generateObject,
  streamObject,
} from 'ai'

export const maxDuration = 300

const rateLimitMaxRequests = process.env.RATE_LIMIT_MAX_REQUESTS
  ? parseInt(process.env.RATE_LIMIT_MAX_REQUESTS)
  : 10
const ratelimitWindow = process.env.RATE_LIMIT_WINDOW
  ? (process.env.RATE_LIMIT_WINDOW as Duration)
  : '1d'

type RunArgs = {
  messages: CoreMessage[]
  template: Templates
  model: LLMModel
  config: LLMModelConfig
  seedCandidates?: Partial<Record<VariantId, FragmentSchema>>
}
type Subscriber = { send: (event: TournamentEvent) => void; close: () => void }
type TournamentJob = {
  latest: Map<VariantId, TournamentEvent>
  verdict?: Extract<TournamentEvent, { type: 'verdict' }>
  done: boolean
  completedAt?: number
  abort: AbortController
  subscribers: Set<Subscriber>
}
// ponytail: this cache survives refresh in one local server process only.
// Upgrade: use a durable worker/store before running across restarts or hosts.
const processState = globalThis as typeof globalThis & { __evoTournamentJobs?: Map<string, TournamentJob> }
const jobs = processState.__evoTournamentJobs ??= new Map<string, TournamentJob>()
const JOB_TTL = 60 * 60 * 1000
const JOB_LIMIT = 32
const ID = /^[A-Za-z0-9_-]{1,128}$/

function pruneJobs() {
  const expired = Date.now() - JOB_TTL
  for (const [key, job] of jobs) if (job.completedAt && job.completedAt <= expired) jobs.delete(key)
}

async function identity(projectID: unknown, runID: unknown) {
  let owner: string | null = null
  try { owner = (await auth()).userId } catch { /* No verified session. */ }
  if (!owner) return { response: Response.json({ error: 'Sign in to build or reopen a project.' }, { status: 401 }) }
  if (typeof projectID !== 'string' || !ID.test(projectID) || typeof runID !== 'string' || !ID.test(runID)) {
    return { response: Response.json({ error: 'Invalid project or generation ID.' }, { status: 400 }) }
  }
  return { key: JSON.stringify([owner, projectID, runID]) }
}

export async function GET(req: Request) {
  const query = new URL(req.url).searchParams
  const access = await identity(query.get('projectID'), query.get('runID'))
  if (access.response) return access.response
  pruneJobs()
  const job = jobs.get(access.key!)
  return job ? subscribe(job) : Response.json({ error: 'This generation is no longer available. Start a new run to continue building.' }, { status: 404 })
}

export async function DELETE(req: Request) {
  const query = new URL(req.url).searchParams
  const access = await identity(query.get('projectID'), query.get('runID'))
  if (access.response) return access.response
  pruneJobs()
  const job = jobs.get(access.key!)
  if (!job) return Response.json({ error: 'Generation not found.' }, { status: 404 })
  if (!job.done) {
    job.abort.abort()
    for (const variant of VARIANTS) {
      const latest = job.latest.get(variant.id)
      if (latest?.type !== 'candidate_done' && latest?.type !== 'candidate_error') {
        emit(job, { type: 'candidate_error', id: variant.id, error: 'Generation stopped.' })
      }
    }
    finish(job)
  }
  return Response.json({ stopped: true })
}

export async function POST(req: Request) {
  let body: Record<string, unknown>
  try { body = await req.json(); if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Invalid body') }
  catch { return Response.json({ error: 'Invalid generation request.' }, { status: 400 }) }
  const access = await identity(body.projectID, body.runID)
  if (access.response) return access.response
  pruneJobs()
  const existing = jobs.get(access.key!)
  if (existing) return subscribe(existing)
  if (!Array.isArray(body.messages) || !body.model || typeof body.model !== 'object' || !body.config || typeof body.config !== 'object' || !body.template || typeof body.template !== 'object') {
    return Response.json({ error: 'Invalid generation input.' }, { status: 400 })
  }
  const args = body as unknown as RunArgs
  if (body.seedCandidates !== undefined) {
    if (!body.seedCandidates || typeof body.seedCandidates !== 'object' || Array.isArray(body.seedCandidates)) return Response.json({ error: 'Invalid completed candidates.' }, { status: 400 })
    const seed: Partial<Record<VariantId, FragmentSchema>> = {}
    for (const [id, value] of Object.entries(body.seedCandidates)) {
      if (!VARIANTS.some(v => v.id === id)) return Response.json({ error: 'Invalid completed candidate ID.' }, { status: 400 })
      const parsed = schema.safeParse(value)
      if (!parsed.success || !fragmentCodeText(parsed.data.code).trim()) return Response.json({ error: 'Invalid completed candidate source.' }, { status: 400 })
      seed[id as VariantId] = parsed.data
    }
    args.seedCandidates = seed
  }
  const limit = !args.config.apiKey
    ? await ratelimit(req.headers.get('x-forwarded-for'), rateLimitMaxRequests, ratelimitWindow)
    : false
  // Another request may have registered this run during the rate-limit await.
  const raced = jobs.get(access.key!)
  if (raced) return subscribe(raced)
  if (limit) return createRateLimitResponse(limit)
  if (jobs.size >= JOB_LIMIT) {
    const oldestDone = [...jobs].filter(([, job]) => job.done).sort((a, b) => (a[1].completedAt || 0) - (b[1].completedAt || 0))[0]
    if (oldestDone) jobs.delete(oldestDone[0])
    else return Response.json({ error: 'Too many builds are running. Wait for a build to finish or stop one.' }, { status: 429 })
  }
  const job: TournamentJob = { latest: new Map(), done: false, abort: new AbortController(), subscribers: new Set() }
  jobs.set(access.key!, job)
  void runJob(job, args)
  return subscribe(job)
}

function emit(job: TournamentJob, event: TournamentEvent) {
  if (job.done) return
  if ('id' in event) job.latest.set(event.id, event)
  if (event.type === 'verdict') job.verdict = event
  for (const subscriber of job.subscribers) subscriber.send(event)
}

function finish(job: TournamentJob) {
  if (job.done) return
  emit(job, { type: 'tournament_done' })
  job.done = true
  job.completedAt = Date.now()
  for (const subscriber of [...job.subscribers]) subscriber.close()
  job.subscribers.clear()
}

function subscribe(job: TournamentJob) {
  const encoder = new TextEncoder()
  let subscriber: Subscriber
  const stream = new ReadableStream({
    start(controller) {
      subscriber = {
        send(event) {
          try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`)) }
          catch { job.subscribers.delete(subscriber) }
        },
        close() { job.subscribers.delete(subscriber); try { controller.close() } catch { /* Detached browser. */ } },
      }
      for (const variant of VARIANTS) {
        const latest = job.latest.get(variant.id)
        if (latest) subscriber.send(latest)
      }
      if (job.verdict) subscriber.send(job.verdict)
      if (job.done) { subscriber.send({ type: 'tournament_done' }); subscriber.close() }
      else job.subscribers.add(subscriber)
    },
    cancel() { job.subscribers.delete(subscriber) },
  })
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' } })
}

async function runJob(job: TournamentJob, args: RunArgs) {
  const send = (event: TournamentEvent) => emit(job, event)
  const { messages, template, model, config } = args
  const deadline = setTimeout(() => {
    job.abort.abort()
    for (const variant of VARIANTS) {
      const latest = job.latest.get(variant.id)
      if (latest?.type !== 'candidate_done' && latest?.type !== 'candidate_error') {
        send({ type: 'candidate_error', id: variant.id, error: 'Generation timed out. Start a new run to continue building.' })
      }
    }
    finish(job)
  }, maxDuration * 1000)
  deadline.unref?.()
  try {
    const { model: _modelNameString, apiKey: _apiKey, ...modelParams } = config
    const modelClient = getModelClient(model, config)
    const baseSystem = toPrompt(template)
      const tasks = VARIANTS.map(async (variant) => {
        const seed = args.seedCandidates?.[variant.id]
        if (seed) {
          send({ type: 'candidate_done', id: variant.id, fragment: seed })
          return { id: variant.id as VariantId, fragment: seed, error: null }
        }
        send({
          type: 'candidate_start',
          id: variant.id,
          label: variant.label,
          sigil: variant.sigil,
        })

        try {
          const result = await streamObject({
            model: modelClient as LanguageModel,
            schema: generatedFragmentSchema,
            system: `${baseSystem}\n\nDesign direction for this specimen: ${variant.systemSuffix}`,
            messages,
            maxRetries: 0,
            ...modelParams,
            temperature: variant.temperature,
            abortSignal: job.abort.signal,
          })
          const { partialObjectStream, object } = result

          let last: any = undefined
          for await (const partial of partialObjectStream) {
            last = partial
            send({ type: 'candidate_chunk', id: variant.id, fragment: partial })
          }
          const final = assertGeneratedFragment((await object) ?? last)
          send({ type: 'candidate_done', id: variant.id, fragment: final })
          return { id: variant.id as VariantId, fragment: final, error: null }
        } catch (e: any) {
          send({
            type: 'candidate_error',
            id: variant.id,
            error: e?.message ?? 'unknown error',
          })
          return {
            id: variant.id as VariantId,
            fragment: null,
            error: e?.message ?? 'unknown error',
          }
        }
      })

      const results = await Promise.all(tasks)
      if (job.abort.signal.aborted) return
      const successful = results.filter((r) => r.fragment && !r.error)

      if (successful.length === 0) {
        return
      }

      // Judge phase — fast LLM verdict, with heuristic fallback.
      try {
        const briefMessage = messages
          .map((m) =>
            typeof m.content === 'string'
              ? m.content
              : Array.isArray(m.content)
                ? m.content
                    .map((c: any) =>
                      c.type === 'text' ? c.text : c.type === 'image' ? '[image]' : '',
                    )
                    .join('\n')
                : '',
          )
          .join('\n')
          .slice(0, 2000)

        const judgePrompt = `You are the chief editor of a tournament that judges three competing implementations of a user brief. Score each candidate 0–1 on three axes: clarity (is the code coherent and readable), fit (does it match the brief), polish (is the visual / structural craft strong). Composite is the mean. Pick exactly one winner. Be terse and editorial.

USER BRIEF:
${briefMessage}

CANDIDATES:
${successful
  .map((r) => {
    const f: any = r.fragment ?? {}
    const code = fragmentSourceText(f)
    return `--- ${r.id.toUpperCase()} (${VARIANTS.find((v) => v.id === r.id)?.label}) ---
title: ${f.title ?? ''}
description: ${f.description ?? ''}
file: ${f.file_path ?? ''}
code:
${code}`
  })
  .join('\n\n')}`

        const judgeResult = await generateObject({
          model: modelClient as LanguageModel,
          schema: verdictSchema,
          prompt: judgePrompt,
          maxRetries: 0,
          temperature: 0.2,
          abortSignal: job.abort.signal,
        })

        // Ensure winner is one that actually succeeded
        let verdict = judgeResult.object
        if (!successful.find((r) => r.id === verdict.winnerId)) {
          verdict = { ...verdict, winnerId: successful[0].id }
        }
        send({ type: 'verdict', verdict })
      } catch {
        // Heuristic fallback
        const scores = successful.map((r) => {
          const f: any = r.fragment ?? {}
          const len = fragmentSourceText(f).length
          const fit = Math.min(1, len / 4000)
          return {
            id: r.id,
            clarity: 0.7,
            fit,
            polish: 0.7,
            composite: (0.7 + fit + 0.7) / 3,
            comment: 'Heuristic score — judge unavailable.',
          }
        })
        const winner = scores.reduce((a, b) =>
          a.composite >= b.composite ? a : b,
        )
        send({
          type: 'verdict',
          verdict: {
            winnerId: winner.id,
            reasoning: 'Heuristic verdict by code completeness.',
            scores,
          },
        })
      }



  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 1000) : 'Generation failed.'
    for (const variant of VARIANTS) if (job.latest.get(variant.id)?.type !== 'candidate_done') send({ type: 'candidate_error', id: variant.id, error: message })
  } finally {
    clearTimeout(deadline)
    finish(job)
  }
}

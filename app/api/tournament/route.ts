import { createRateLimitResponse } from '@/lib/api-errors'
import { Duration } from '@/lib/duration'
import { getModelClient, LLMModel, LLMModelConfig, modelRejection, hasOwnApiKey, sanitizeModelParams } from '@/lib/models'
import { projectSpecSchema, type ProjectSpec } from '@/lib/platform/types'
import { getUserId } from '@/lib/server-auth'
import { toPrompt } from '@/lib/prompt'
import ratelimit, { OWN_KEY_LIMIT_MULTIPLIER, rateLimitKey } from '@/lib/ratelimit'
import { assertGeneratedFragment, fragmentCodeText, fragmentSchema as schema, fragmentSourceText, generatedFragmentSchema, type FragmentSchema } from '@/lib/schema'
import { Templates } from '@/lib/templates'
import {
  VARIANTS,
  VariantId,
  TournamentEvent,
  verdictSchema,
  battleAttempts,
  pickJudge,
  publicModel,
  JUDGE_RETRY,
  type BattleModel,
  type CandidateModel,
  type Verdict,
} from '@/lib/tournament'
import {
  ModelMessage,
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
  messages: ModelMessage[]
  template: Templates
  model: LLMModel
  config: LLMModelConfig
  seedCandidates?: Partial<Record<VariantId, FragmentSchema>>
  spec: ProjectSpec | null
  battle: boolean
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
  const owner = await getUserId()
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
  // A malformed spec degrades to a spec-less run instead of failing a paid build.
  const spec = body.spec == null ? null : projectSpecSchema.safeParse(body.spec)
  args.spec = spec && spec.success ? spec.data : null
  args.battle = body.battle === true
  // Battle mode ignores the client model (server lineup); otherwise reject non-allowlisted models up front.
  if (!args.battle) {
    const rejected = modelRejection(body.model, body.config as LLMModelConfig)
    if (rejected) return rejected
  }
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
  // Always rate-limit (own keys get a roomier, separate bucket) and key by the signed-in user.
  const ownKey = !args.battle && hasOwnApiKey(args.config)
  const limit = await ratelimit(
    rateLimitKey(req, await getUserId(), ownKey),
    ownKey ? rateLimitMaxRequests * OWN_KEY_LIMIT_MULTIPLIER : rateLimitMaxRequests,
    ratelimitWindow,
  )
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

type Outcome = { id: VariantId; fragment: FragmentSchema | null; error: string | null; model: CandidateModel | null }

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e ?? 'unknown error')).slice(0, 600)

function briefText(messages: ModelMessage[], spec: ProjectSpec | null) {
  const chat = messages
    .map((m) => typeof m.content === 'string'
      ? m.content
      : Array.isArray(m.content)
        ? m.content.map((c: any) => c.type === 'text' ? c.text : c.type === 'image' ? '[image]' : '').join('\n')
        : '')
    .join('\n')
    .slice(0, 2000)
  if (!spec) return chat
  const must = spec.features.filter((f) => f.priority === 'must').map((f) => f.name).slice(0, 10).join(', ')
  return `${chat}\n\nSPEC: ${spec.name} (${spec.projectType}) — ${spec.summary.slice(0, 400)}${must ? `\nMust-have features: ${must}` : ''}`
}

async function runJob(job: TournamentJob, args: RunArgs) {
  const send = (event: TournamentEvent) => emit(job, event)
  const { messages, template, model, config, spec, battle } = args
  const startedAt = Date.now()
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
    // Battle runs on server-chosen models with server keys only; never forward client sampling/keys there.
    const modelParams = sanitizeModelParams(config) // never spread raw client config into SDK calls
    const userModel: BattleModel = { id: model.id, name: model.name, provider: model.provider, providerId: model.providerId }
    const baseSystem = toPrompt(template, spec)
    const competitorIds = new Set<string>()

    const tasks = VARIANTS.map(async (variant): Promise<Outcome> => {
      const seed = args.seedCandidates?.[variant.id]
      if (seed) {
        send({ type: 'candidate_done', id: variant.id, fragment: seed })
        return { id: variant.id, fragment: seed, error: null, model: null }
      }
      const attempts: BattleModel[] = battle ? battleAttempts(variant.id) : [{ ...userModel, temperature: variant.temperature }]
      let lastError = 'unknown error'
      let lastModel: CandidateModel | null = null
      for (let i = 0; i < attempts.length; i++) {
        const slot = attempts[i]
        const shown = publicModel(slot)
        lastModel = shown
        competitorIds.add(slot.id)
        send({
          type: 'candidate_start',
          id: variant.id,
          label: variant.label,
          sigil: variant.sigil,
          model: shown,
          ...(i > 0 ? { note: `${attempts[i - 1].name} failed — switched to ${slot.name}.` } : {}),
        })
        try {
          const client = battle ? getModelClient(slot, {}) : getModelClient(model, config)
          const result = streamObject({
            model: client as LanguageModel,
            schema: generatedFragmentSchema,
            system: `${baseSystem}\n\nDesign direction for this specimen: ${variant.systemSuffix}`,
            messages,
            maxRetries: battle ? 1 : 0,
            ...(battle ? {} : modelParams),
            temperature: slot.temperature ?? variant.temperature,
            abortSignal: job.abort.signal,
          })
          let last: any = undefined
          for await (const partial of result.partialObjectStream) {
            last = partial
            send({ type: 'candidate_chunk', id: variant.id, fragment: partial, model: shown })
          }
          const final = assertGeneratedFragment((await result.object) ?? last)
          send({ type: 'candidate_done', id: variant.id, fragment: final, model: shown })
          return { id: variant.id, fragment: final, error: null, model: shown }
        } catch (e) {
          lastError = errorText(e)
          console.warn(`[tournament] ${variant.id} on ${slot.providerId}/${slot.id} failed: ${lastError.slice(0, 200)}`)
          // Fall back only while there is room for a full second generation.
          if (job.abort.signal.aborted || Date.now() - startedAt > (maxDuration - 120) * 1000) break
        }
      }
      send({ type: 'candidate_error', id: variant.id, error: lastError, ...(lastModel ? { model: lastModel } : {}) })
      return { id: variant.id, fragment: null, error: lastError, model: lastModel }
    })

    const results = await Promise.all(tasks)
    if (job.abort.signal.aborted) return
    const successful = results.filter((r) => r.fragment && !r.error)
    if (successful.length === 0) return

    send({ type: 'verdict', verdict: await judge(job, successful, briefText(messages, spec), competitorIds) })
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 1000) : 'Generation failed.'
    for (const variant of VARIANTS) if (job.latest.get(variant.id)?.type !== 'candidate_done') send({ type: 'candidate_error', id: variant.id, error: message })
  } finally {
    clearTimeout(deadline)
    finish(job)
  }
}

/** Neutral judge (not a competitor when possible) → one retry on gpt-4.1 → provisional verdict with null scores. Never fabricates numbers. */
async function judge(job: TournamentJob, successful: Outcome[], brief: string, competitorIds: Set<string>): Promise<Verdict> {
  const prompt = `You are the chief editor of a tournament that judges competing implementations of a user brief. Score each candidate 0–1 on three axes: clarity (is the code coherent, readable, and likely to run), fit (does it match the brief — including real working forms for the key actions when the brief needs them), polish (is the visual / structural craft strong). Composite is the mean. Pick exactly one winner among the listed candidates. Be terse and editorial.

USER BRIEF:
${brief}

CANDIDATES:
${successful.map((r) => {
  const f: any = r.fragment ?? {}
  return `--- ${r.id.toUpperCase()} (${VARIANTS.find((v) => v.id === r.id)?.label}) ---
title: ${f.title ?? ''}
description: ${f.description ?? ''}
file: ${f.file_path ?? ''}
code:
${fragmentSourceText(f).slice(0, 60_000)}`
}).join('\n\n')}`

  // Neutral seat first, then exactly one retry on gpt-4.1.
  const attempts = [pickJudge(competitorIds), JUDGE_RETRY]
  const ids = new Set(successful.map((r) => r.id))
  const clamp = (n: unknown) => typeof n === 'number' && Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0
  for (const seat of attempts) {
    if (job.abort.signal.aborted) break
    try {
      const reasoning = /^(gpt-5|o\d)/.test(seat.id)
      const { object } = await generateObject({
        model: getModelClient(seat, {}) as LanguageModel,
        schema: verdictSchema,
        prompt,
        maxRetries: 0,
        ...(reasoning ? { providerOptions: { openai: { reasoningEffort: 'low' } } } : { temperature: 0.2 }),
        abortSignal: AbortSignal.any([job.abort.signal, AbortSignal.timeout(90_000)]),
      })
      const seen = new Set<string>()
      const scores = object.scores
        .filter((s) => {
          if (!ids.has(s.id) || seen.has(s.id)) return false
          seen.add(s.id)
          return true
        })
        .map((s) => {
          const clarity = clamp(s.clarity), fit = clamp(s.fit), polish = clamp(s.polish)
          return { id: s.id, clarity, fit, polish, composite: Math.round(((clarity + fit + polish) / 3) * 1000) / 1000, comment: s.comment }
        })
      if (!scores.length) throw new Error('Judge returned no scores for the finished candidates.')
      // Winner = highest recomputed composite; the judge's own pick breaks ties.
      const best = scores.reduce((a, b) => (b.composite > a.composite || (b.composite === a.composite && b.id === object.winnerId) ? b : a))
      return { winnerId: best.id, reasoning: object.reasoning, scores, provisional: false, judge: publicModel(seat) }
    } catch (e) {
      console.warn(`[tournament] judge ${seat.id} failed: ${errorText(e).slice(0, 200)}`)
    }
  }
  return {
    winnerId: null,
    reasoning: 'Judge unavailable — no scores were invented. The winner will be decided by measured preview evidence.',
    scores: successful.map((r) => ({ id: r.id, clarity: null, fit: null, polish: null, composite: null, comment: 'Not judged — judge unavailable.' })),
    provisional: true,
    judge: null,
  }
}

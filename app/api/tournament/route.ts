import { createRateLimitResponse } from '@/lib/api-errors'
import { Duration } from '@/lib/duration'
import { appendGenerationLog } from '@/lib/generation-log'
import { getModelClient, LLMModel, LLMModelConfig } from '@/lib/models'
import { persistCandidateFiles } from '@/lib/persist-candidate'
import { toPrompt } from '@/lib/prompt'
import ratelimit from '@/lib/ratelimit'
import {
  isTransientProviderError,
  salvageFragment,
} from '@/lib/salvage-fragment'
import { applyValidatedImagesToFragment } from '@/lib/images-validate'
import { fragmentCodeText, fragmentSchema as schema } from '@/lib/schema'
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

/** Cap one hung provider so it cannot block A/B/C done + judge. */
const CANDIDATE_MS = 150_000
const JUDGE_MS = 45_000

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

export async function POST(req: Request) {
  const {
    messages,
    template,
    model,
    config,
    projectId,
  }: {
    messages: CoreMessage[]
    userID: string | undefined
    teamID: string | undefined
    template: Templates
    model: LLMModel
    config: LLMModelConfig
    projectId?: string
  } = await req.json()

  const limit = !config.apiKey
    ? await ratelimit(
        req.headers.get('x-forwarded-for'),
        rateLimitMaxRequests,
        ratelimitWindow,
      )
    : false

  if (limit) {
    return createRateLimitResponse(limit)
  }

  const { model: _modelNameString, apiKey: _apiKey, ...modelParams } = config
  const baseSystem = toPrompt(template)
  const runId = projectId || `tour-${Date.now()}`
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false
      const send = (event: TournamentEvent) => {
        if (closed) return
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
          )
        } catch {
          /* connection closed */
        }
      }

      const tasks = VARIANTS.map((variant, index) =>
        runCandidate({
          variant,
          staggerMs: index * 250,
          model,
          config,
          modelParams,
          baseSystem,
          messages,
          runId,
          projectId,
          send,
        }),
      )

      const settled = await Promise.allSettled(tasks)
      const results = settled.map((s, i) => {
        if (s.status === 'fulfilled') return s.value
        return {
          id: VARIANTS[i].id as VariantId,
          fragment: null as ReturnType<typeof salvageFragment>,
          error: s.reason?.message ?? 'unknown error',
        }
      })
      const successful = results.filter((r) => r.fragment && !r.error)

      if (successful.length === 0) {
        send({ type: 'tournament_done' })
        closed = true
        controller.close()
        return
      }

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
    const code = fragmentCodeText(f.code).slice(0, 1800)
    return `--- ${r.id.toUpperCase()} (${VARIANTS.find((v) => v.id === r.id)?.label}) ---
title: ${f.title ?? ''}
description: ${f.description ?? ''}
file: ${f.file_path ?? ''}
code:
${code}`
  })
  .join('\n\n')}`

        const judgeClient = getModelClient(model, config)
        const judgeCtrl = new AbortController()
        const judgeTimer = setTimeout(() => judgeCtrl.abort(), JUDGE_MS)
        try {
          const judgeResult = await generateObject({
            model: judgeClient as LanguageModel,
            schema: verdictSchema,
            prompt: judgePrompt,
            maxRetries: 0,
            temperature: 0.2,
            abortSignal: judgeCtrl.signal,
          })
          let verdict = judgeResult.object
          if (!successful.find((r) => r.id === verdict.winnerId)) {
            verdict = { ...verdict, winnerId: successful[0].id }
          }
          send({ type: 'verdict', verdict })
        } finally {
          clearTimeout(judgeTimer)
        }
      } catch {
        const scores = successful.map((r) => {
          const f: any = r.fragment ?? {}
          const len = fragmentCodeText(f.code).length
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

      send({ type: 'tournament_done' })
      closed = true
      controller.close()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  })
}

async function runCandidate(args: {
  variant: (typeof VARIANTS)[number]
  staggerMs: number
  model: LLMModel
  config: LLMModelConfig
  modelParams: Omit<LLMModelConfig, 'model' | 'apiKey'>
  baseSystem: string
  messages: CoreMessage[]
  runId: string
  projectId?: string
  send: (event: TournamentEvent) => void
}) {
  const { variant, send } = args
  const started = Date.now()
  send({
    type: 'candidate_start',
    id: variant.id,
    label: variant.label,
    sigil: variant.sigil,
  })
  await appendGenerationLog(args.runId, {
    candidateId: variant.id,
    stage: 'provider_start',
  })

  if (args.staggerMs) await sleep(args.staggerMs)

  let last: unknown
  let warning: string | undefined

  const attempt = async () => {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), CANDIDATE_MS)
    try {
      const modelClient = getModelClient(args.model, args.config)
      const result = await streamObject({
        model: modelClient as LanguageModel,
        schema,
        system: `${args.baseSystem}\n\nDesign direction for this specimen: ${variant.systemSuffix}`,
        messages: args.messages,
        maxRetries: 0,
        abortSignal: ctrl.signal,
        ...args.modelParams,
        temperature: variant.temperature,
      })
      for await (const partial of result.partialObjectStream) {
        last = partial
        send({ type: 'candidate_chunk', id: variant.id, fragment: partial })
      }
      try {
        const final = await result.object
        return salvageFragment(final) ?? salvageFragment(last)
      } catch (e: any) {
        warning = e?.message ?? 'final schema parse failed'
        return salvageFragment(last)
      }
    } finally {
      clearTimeout(timer)
    }
  }

  try {
    const fragment = await attempt()
    if (!fragment) {
      throw new Error(warning || 'No usable fragment streamed')
    }
    const ms = Date.now() - started
    if (warning) {
      await appendGenerationLog(args.runId, {
        candidateId: variant.id,
        stage: 'salvaged',
        ok: true,
        ms,
        error: warning,
      })
    } else {
      await appendGenerationLog(args.runId, {
        candidateId: variant.id,
        stage: 'provider_done',
        ok: true,
        ms,
      })
    }
    const fragmentOut = await applyValidatedImagesToFragment(fragment)
    send({ type: 'candidate_done', id: variant.id, fragment: fragmentOut })
    if (args.projectId) {
      try {
        await persistCandidateFiles({
          projectId: args.projectId,
          candidateId: variant.id,
          runId: args.runId,
          fragment: fragmentOut,
          label: variant.label,
        })
        await appendGenerationLog(args.runId, {
          candidateId: variant.id,
          stage: 'persist',
          ok: true,
        })
      } catch (e: any) {
        await appendGenerationLog(args.runId, {
          candidateId: variant.id,
          stage: 'persist_error',
          ok: false,
          error: e?.message ?? 'persist failed',
        })
      }
    }
    return { id: variant.id as VariantId, fragment: fragmentOut, error: null }
  } catch (first: any) {
    const salvaged = salvageFragment(last)
    if (salvaged) {
      const ms = Date.now() - started
      await appendGenerationLog(args.runId, {
        candidateId: variant.id,
        stage: 'salvaged',
        ok: true,
        ms,
        error: first?.message,
      })
      const salvagedOut = await applyValidatedImagesToFragment(salvaged)
      send({ type: 'candidate_done', id: variant.id, fragment: salvagedOut })
      if (args.projectId) {
        try {
          await persistCandidateFiles({
            projectId: args.projectId,
            candidateId: variant.id,
            runId: args.runId,
            fragment: salvagedOut,
            label: variant.label,
          })
        } catch {
          /* persist is best-effort here */
        }
      }
      return { id: variant.id as VariantId, fragment: salvagedOut, error: null }
    }

    if (!last && isTransientProviderError(first)) {
      last = undefined
      try {
        const fragment = await attempt()
        if (fragment) {
          const ms = Date.now() - started
          await appendGenerationLog(args.runId, {
            candidateId: variant.id,
            stage: 'provider_done',
            ok: true,
            ms,
            error: 'transient retry',
          })
          const retryOut = await applyValidatedImagesToFragment(fragment)
          send({ type: 'candidate_done', id: variant.id, fragment: retryOut })
          return { id: variant.id as VariantId, fragment: retryOut, error: null }
        }
      } catch (second: any) {
        const again = salvageFragment(last)
        if (again) {
          const againOut = await applyValidatedImagesToFragment(again)
          send({ type: 'candidate_done', id: variant.id, fragment: againOut })
          return { id: variant.id as VariantId, fragment: againOut, error: null }
        }
        first = second
      }
    }

    const error = first?.message ?? 'unknown error'
    await appendGenerationLog(args.runId, {
      candidateId: variant.id,
      stage: 'provider_error',
      ok: false,
      ms: Date.now() - started,
      error,
    })
    send({ type: 'candidate_error', id: variant.id, error })
    return { id: variant.id as VariantId, fragment: null, error }
  }
}

import { createRateLimitResponse } from '@/lib/api-errors'
import { Duration } from '@/lib/duration'
import { getModelClient, LLMModel, LLMModelConfig } from '@/lib/models'
import { toPrompt } from '@/lib/prompt'
import ratelimit from '@/lib/ratelimit'
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

export async function POST(req: Request) {
  const {
    messages,
    template,
    model,
    config,
  }: {
    messages: CoreMessage[]
    userID: string | undefined
    teamID: string | undefined
    template: Templates
    model: LLMModel
    config: LLMModelConfig
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
  const modelClient = getModelClient(model, config)
  const baseSystem = toPrompt(template)

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

      const tasks = VARIANTS.map(async (variant) => {
        send({
          type: 'candidate_start',
          id: variant.id,
          label: variant.label,
          sigil: variant.sigil,
        })

        try {
          const result = await streamObject({
            model: modelClient as LanguageModel,
            schema,
            system: `${baseSystem}\n\nDesign direction for this specimen: ${variant.systemSuffix}`,
            messages,
            maxRetries: 0,
            ...modelParams,
            temperature: variant.temperature,
          })
          const { partialObjectStream, object } = result

          let last: any = undefined
          for await (const partial of partialObjectStream) {
            last = partial
            send({ type: 'candidate_chunk', id: variant.id, fragment: partial })
          }
          const final = (await object) ?? last
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
      const successful = results.filter((r) => r.fragment && !r.error)

      if (successful.length === 0) {
        send({ type: 'tournament_done' })
        closed = true
        controller.close()
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
    const code = fragmentCodeText(f.code).slice(0, 1800)
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

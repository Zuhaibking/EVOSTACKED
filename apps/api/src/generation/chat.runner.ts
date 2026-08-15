import { handleAPIError, createRateLimitResponse } from '@/lib/api-errors'
import { Duration } from '@/lib/duration'
import { getModelClient, LLMModel, LLMModelConfig } from '@/lib/models'
import { buildGenerationPrompt } from '@/lib/prompt'
import { withGenerationTokenBudget } from '@/lib/generation-budget'
import { prepareFragmentIntegrity } from '@/lib/prepare-fragment-integrity'
import ratelimit from '@/lib/ratelimit'
import { FragmentSchema, fragmentSchema as schema } from '@/lib/schema'
import { Templates } from '@/lib/templates'
import { generateObject, LanguageModel, CoreMessage } from 'ai'

export const maxDuration = 300

const rateLimitMaxRequests = process.env.RATE_LIMIT_MAX_REQUESTS
  ? parseInt(process.env.RATE_LIMIT_MAX_REQUESTS)
  : 10
const ratelimitWindow = process.env.RATE_LIMIT_WINDOW
  ? (process.env.RATE_LIMIT_WINDOW as Duration)
  : '1d'

function fragmentJsonStream(fragment: FragmentSchema) {
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(JSON.stringify(fragment)))
      controller.close()
    },
  })
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
    },
  })
}

export async function handleChat(req: Request) {
  const {
    messages,
    userID,
    teamID,
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
  } = (await req.json()) as {
    messages: CoreMessage[]
    userID: string | undefined
    teamID: string | undefined
    template: Templates
    model: LLMModel
    config: LLMModelConfig
  }

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

  console.log('userID', userID)
  console.log('teamID', teamID)
  console.log('model', model)

  const { model: _modelNameString, apiKey: _modelApiKey, ...modelParams } =
    config

  try {
    // Catalog-validated client. Never remaps free → paid providers.
    const modelClient = getModelClient(model, config)

    // Follow-ups use the same quality rules + internal mental planning.
    // Full shared ApplicationPlan runs once in /api/tournament to avoid
    // duplicating expensive planning on every chat turn.
    const generated = await generateObject({
      model: modelClient as LanguageModel,
      schema,
      system: buildGenerationPrompt({ template }),
      messages,
      maxRetries: 0,
      ...withGenerationTokenBudget(modelParams as Record<string, unknown>),
    })

    const frag = generated.object as FragmentSchema

    // validate → targeted integrity repair (max 1, only if invalid) → re-validate
    // Valid fragments: zero extra LLM calls.
    const prepared = await prepareFragmentIntegrity({
      fragment: frag,
      repair: { model, config },
    })

    return fragmentJsonStream(prepared.fragment)
  } catch (error: any) {
    return handleAPIError(error, { hasOwnApiKey: !!config.apiKey })
  }
}

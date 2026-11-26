import { handleAPIError, createRateLimitResponse } from '@/lib/api-errors'
import { Duration } from '@/lib/duration'
import { getModelClient, hasOwnApiKey, LLMModel, LLMModelConfig, modelRejection, sanitizeModelParams } from '@/lib/models'
import { toPrompt } from '@/lib/prompt'
import ratelimit, { OWN_KEY_LIMIT_MULTIPLIER, rateLimitKey } from '@/lib/ratelimit'
import { requireUserId } from '@/lib/server-auth'
import { assertGeneratedFragment, generatedFragmentSchema as schema } from '@/lib/schema'
import { Templates } from '@/lib/templates'
import { streamObject, LanguageModel, ModelMessage } from 'ai'

export const maxDuration = 300

const rateLimitMaxRequests = process.env.RATE_LIMIT_MAX_REQUESTS
  ? parseInt(process.env.RATE_LIMIT_MAX_REQUESTS)
  : 10
const ratelimitWindow = process.env.RATE_LIMIT_WINDOW
  ? (process.env.RATE_LIMIT_WINDOW as Duration)
  : '1d'

export async function POST(req: Request) {
  const authz = await requireUserId()
  if ('response' in authz) return authz.response
  const {
    messages,
    template,
    model,
    config = {},
  }: {
    messages: ModelMessage[]
    template: Templates
    model: LLMModel
    config: LLMModelConfig
  } = await req.json()

  const ownKey = hasOwnApiKey(config)
  const rejected = modelRejection(model, config)
  if (rejected) return rejected

  const limit = await ratelimit(
    rateLimitKey(req, authz.userId, ownKey),
    ownKey ? rateLimitMaxRequests * OWN_KEY_LIMIT_MULTIPLIER : rateLimitMaxRequests,
    ratelimitWindow,
  )

  if (limit) {
    return createRateLimitResponse(limit)
  }

  console.log('userID', authz.userId)
  console.log('model', model)

  const modelParams = sanitizeModelParams(config)
  const modelClient = getModelClient(model, config)

  try {
    const stream = await streamObject({
      model: modelClient as LanguageModel,
      schema,
      system: toPrompt(template),
      messages,
      maxRetries: 0, // do not retry on errors
      ...modelParams,
    })

    const completed = stream.object.then(assertGeneratedFragment)
    // Observe rejection while text is still streaming; flush reports validation
    // failures to the client before onFinish can create an incomplete project.
    void completed.catch(() => {})
    const response = stream.toTextStreamResponse()
    return new Response(response.body!.pipeThrough(new TransformStream({
      async flush() { await completed },
    })), { headers: response.headers })
  } catch (error: any) {
    return handleAPIError(error, { hasOwnApiKey: ownKey })
  }
}

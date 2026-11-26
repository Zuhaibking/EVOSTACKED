import { createAnthropic } from '@ai-sdk/anthropic'
import { createFireworks } from '@ai-sdk/fireworks'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createVertex } from '@ai-sdk/google-vertex'
import { createMistral } from '@ai-sdk/mistral'
import { createOpenAI } from '@ai-sdk/openai'
import { createOllama } from 'ollama-ai-provider'
import modelsList from './models.json'

export type LLMModel = {
  id: string
  name: string
  provider: string
  providerId: string
}

export type LLMModelConfig = {
  model?: string
  apiKey?: string
  baseURL?: string
  temperature?: number
  topP?: number
  topK?: number
  frequencyPenalty?: number
  presencePenalty?: number
  maxTokens?: number
}

export class ModelNotAllowedError extends Error {
  readonly statusCode = 400
  constructor(message: string) {
    super(message)
    this.name = 'ModelNotAllowedError'
  }
}

export function hasOwnApiKey(config?: LLMModelConfig | null): boolean {
  return typeof config?.apiKey === 'string' && config.apiKey.trim().length > 0
}

// Vertex always authenticates with server credentials, so a client key never makes it "theirs".
function usesOwnKey(providerId: string, config?: LLMModelConfig | null) {
  return hasOwnApiKey(config) && providerId !== 'vertex'
}

export function isAllowedModel(model: { id: string; providerId: string }) {
  return (modelsList.models as { id: string; providerId: string }[]).some(
    (m) => m.id === model.id && m.providerId === model.providerId,
  )
}

/** Server keys only run models listed in lib/models.json; a client's own key may run any model. Throws ModelNotAllowedError (400). */
export function assertAllowedModel(
  model: unknown,
  config?: LLMModelConfig | null,
): asserts model is LLMModel {
  const m = model as Partial<LLMModel> | null
  if (!m || typeof m.id !== 'string' || typeof m.providerId !== 'string') {
    throw new ModelNotAllowedError('A model is required.')
  }
  if (usesOwnKey(m.providerId, config)) return
  if (!isAllowedModel({ id: m.id, providerId: m.providerId })) {
    throw new ModelNotAllowedError(
      `Model "${m.providerId}/${m.id}" is not available on EvoStack keys. Add your own API key to use it.`,
    )
  }
}

/** Route helper: a 400 response for a disallowed model, or null. */
export function modelRejection(model: unknown, config?: LLMModelConfig | null): Response | null {
  try {
    assertAllowedModel(model, config)
    return null
  } catch (error) {
    if (error instanceof ModelNotAllowedError) return Response.json({ error: error.message }, { status: 400 })
    throw error
  }
}

/** Only numeric sampling settings from the client reach SDK calls (never headers, retries, or provider options). */
export function sanitizeModelParams(config?: LLMModelConfig | null) {
  const pick = (value: unknown, min: number, max: number) =>
    typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : undefined
  const params = {
    temperature: pick(config?.temperature, 0, 2),
    topP: pick(config?.topP, 0, 1),
    topK: pick(config?.topK, 1, 1000),
    frequencyPenalty: pick(config?.frequencyPenalty, -2, 2),
    presencePenalty: pick(config?.presencePenalty, -2, 2),
  }
  return Object.fromEntries(Object.entries(params).filter(([, value]) => value !== undefined)) as Partial<typeof params>
}

const PRIVATE_HOST = /^(localhost|.*\.localhost|.*\.internal|0\.0\.0\.0|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|169\.254\.\d+\.\d+|\[.*\])$/i

// A custom endpoint must be http(s); outside development it must not be a loopback/private literal.
function clientBaseURL(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined
  try {
    const url = new URL(value.trim())
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined
    if (process.env.NODE_ENV === 'production' && PRIVATE_HOST.test(url.hostname)) return undefined
    return url.toString().replace(/\/$/, '')
  } catch {
    return undefined
  }
}

export function getModelClient(model: LLMModel, config: LLMModelConfig) {
  assertAllowedModel(model, config)
  const { id: modelNameString, providerId } = model
  // A client baseURL is honoured only with the client's own key; otherwise the
  // provider's default endpoint gets the server key (SDK env fallback).
  const ownKey = usesOwnKey(providerId, config)
  const apiKey = ownKey ? config.apiKey!.trim() : undefined
  const baseURL = ownKey ? clientBaseURL(config.baseURL) : undefined

  const providerConfigs = {
    anthropic: () => createAnthropic({ apiKey, baseURL })(modelNameString),
    openai: () => createOpenAI({ apiKey, baseURL })(modelNameString),
    google: () =>
      createGoogleGenerativeAI({ apiKey, baseURL })(modelNameString),
    mistral: () => createMistral({ apiKey, baseURL })(modelNameString),
    groq: () =>
      createOpenAI({
        apiKey: apiKey || process.env.GROQ_API_KEY,
        baseURL: baseURL || 'https://api.groq.com/openai/v1',
      }).chat(modelNameString),
    togetherai: () =>
      createOpenAI({
        apiKey: apiKey || process.env.TOGETHER_API_KEY,
        baseURL: baseURL || 'https://api.together.xyz/v1',
      }).chat(modelNameString),
    ollama: () => createOllama({ baseURL })(modelNameString),
    fireworks: () =>
      createFireworks({
        apiKey: apiKey || process.env.FIREWORKS_API_KEY,
        baseURL: baseURL || 'https://api.fireworks.ai/inference/v1',
      })(modelNameString),
    vertex: () =>
      createVertex({
        googleAuthOptions: {
          credentials: JSON.parse(
            process.env.GOOGLE_VERTEX_CREDENTIALS || '{}',
          ),
        },
      })(modelNameString),
    xai: () =>
      createOpenAI({
        apiKey: apiKey || process.env.XAI_API_KEY,
        baseURL: baseURL || 'https://api.x.ai/v1',
      }).chat(modelNameString),
    deepseek: () =>
      createOpenAI({
        apiKey: apiKey || process.env.DEEPSEEK_API_KEY,
        baseURL: baseURL || 'https://api.deepseek.com/v1',
      }).chat(modelNameString),
    // NVIDIA NIM (OpenAI-compatible chat completions; json_schema structured outputs verified).
    nvidia: () =>
      createOpenAI({
        apiKey: apiKey || process.env.NVIDIA_API_KEY,
        baseURL: baseURL || 'https://integrate.api.nvidia.com/v1',
      }).chat(modelNameString),
  }

  const createClient =
    providerConfigs[providerId as keyof typeof providerConfigs]

  if (!createClient) {
    throw new Error(`Unsupported provider: ${providerId}`)
  }

  return createClient()
}

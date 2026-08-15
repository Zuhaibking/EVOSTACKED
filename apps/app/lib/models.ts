import { createAnthropic } from '@ai-sdk/anthropic'
import { createFireworks } from '@ai-sdk/fireworks'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createVertex } from '@ai-sdk/google-vertex'
import { createMistral } from '@ai-sdk/mistral'
import { createOpenAI } from '@ai-sdk/openai'
import { createOllama } from 'ollama-ai-provider'
import {
  LLMModel,
  LLMModelConfig,
  OFFICIAL_PROVIDER_BASE_URLS,
  ProviderResolutionError,
  createNvidiaCredentialFetch,
  getNvidiaCredentialPool,
  nvidiaCredentialIndex,
  resolveCatalogModel,
  resolveProviderApiKey,
  resolveRequestBaseURL,
} from '@/lib/model-catalog'

// Re-export catalog/types so existing `from '@/lib/models'` imports keep working
// on the server. Client UI must import grouping helpers from `@/lib/model-catalog`
// to avoid bundling Node-only provider SDKs.
export type {
  LLMModel,
  LLMModelConfig,
  ModelCapabilities,
  ModelTier,
} from '@/lib/model-catalog'
export {
  createNvidiaCredentialFetch,
  findCatalogModel,
  getModelGroupLabel,
  getModelsCatalog,
  getNvidiaCredentialPool,
  isBlockedHost,
  isProductionRuntime,
  MODEL_GROUP_ORDER,
  nvidiaCredentialIndex,
  OFFICIAL_PROVIDER_BASE_URLS,
  OPENAI_COMPAT_PROVIDERS,
  ProviderResolutionError,
  resolveCatalogModel,
  resolveProviderApiKey,
  resolveRequestBaseURL,
  selectNvidiaCredential,
} from '@/lib/model-catalog'

function missingKeyMessage(label: string, providerId: string): string {
  if (providerId === 'openai' || providerId === 'anthropic') {
    return `${label} request unavailable: missing server API key for provider "${providerId}".`
  }
  return `${label} free-tier request unavailable: missing server API key for provider "${providerId}".`
}

/**
 * Build a Vercel AI SDK language model client.
 * Never remaps providers. Never falls back free → paid / OpenAI.
 *
 * Server-only — do not import this module from client components.
 */
export function getModelClient(
  model: LLMModel,
  config: LLMModelConfig,
): any {
  const catalogModel = resolveCatalogModel(model)
  const { id: modelNameString, providerId } = catalogModel
  const hasByokKey = !!config.apiKey?.trim()

  const baseURL = resolveRequestBaseURL({
    providerId,
    requestedBaseURL: config.baseURL,
    localOnly: !!catalogModel.localOnly,
    hasByokKey,
  })

  const apiKey = resolveProviderApiKey(providerId, config.apiKey)

  if (providerId === 'ollama') {
    return createOllama({ baseURL })(modelNameString)
  }

  if (providerId === 'vertex') {
    return createVertex({
      googleAuthOptions: {
        credentials: JSON.parse(
          process.env.GOOGLE_VERTEX_CREDENTIALS || '{}',
        ),
      },
    })(modelNameString)
  }

  switch (providerId) {
    case 'anthropic': {
      const key = apiKey
      if (!key) {
        throw new ProviderResolutionError(
          missingKeyMessage('Anthropic', providerId),
          { providerId, modelId: modelNameString, code: 'missing_api_key' },
        )
      }
      return createAnthropic({ apiKey: key, baseURL })(modelNameString)
    }
    case 'openai': {
      const key = apiKey
      if (!key) {
        throw new ProviderResolutionError(
          missingKeyMessage('OpenAI', providerId),
          { providerId, modelId: modelNameString, code: 'missing_api_key' },
        )
      }
      return createOpenAI({ apiKey: key, baseURL })(modelNameString)
    }
    case 'google': {
      const key = apiKey
      if (!key) {
        throw new ProviderResolutionError(
          missingKeyMessage('Gemini', providerId),
          { providerId, modelId: modelNameString, code: 'missing_api_key' },
        )
      }
      return createGoogleGenerativeAI({ apiKey: key, baseURL })(modelNameString)
    }
    case 'mistral': {
      const key = apiKey
      if (!key) {
        throw new ProviderResolutionError(
          missingKeyMessage('Mistral', providerId),
          { providerId, modelId: modelNameString, code: 'missing_api_key' },
        )
      }
      return createMistral({ apiKey: key, baseURL })(modelNameString)
    }
    case 'groq': {
      const key = apiKey
      if (!key) {
        throw new ProviderResolutionError(
          missingKeyMessage('Groq', providerId),
          { providerId, modelId: modelNameString, code: 'missing_api_key' },
        )
      }
      return createOpenAI({
        apiKey: key,
        baseURL: baseURL || OFFICIAL_PROVIDER_BASE_URLS.groq,
      })(modelNameString)
    }
    case 'cerebras': {
      const key = apiKey
      if (!key) {
        throw new ProviderResolutionError(
          missingKeyMessage('Cerebras', providerId),
          { providerId, modelId: modelNameString, code: 'missing_api_key' },
        )
      }
      return createOpenAI({
        apiKey: key,
        baseURL: baseURL || OFFICIAL_PROVIDER_BASE_URLS.cerebras,
      })(modelNameString)
    }
    case 'github': {
      const key = apiKey
      if (!key) {
        throw new ProviderResolutionError(
          missingKeyMessage('GitHub Models', providerId),
          { providerId, modelId: modelNameString, code: 'missing_api_key' },
        )
      }
      return createOpenAI({
        apiKey: key,
        baseURL: baseURL || OFFICIAL_PROVIDER_BASE_URLS.github,
      })(modelNameString)
    }
    case 'nvidia': {
      // BYOK: single client-supplied key (no server pool / no cross-provider).
      if (hasByokKey) {
        return createOpenAI({
          apiKey: config.apiKey!.trim(),
          baseURL: baseURL || OFFICIAL_PROVIDER_BASE_URLS.nvidia,
        })(modelNameString)
      }

      const pool = getNvidiaCredentialPool()
      if (pool.length === 0) {
        throw new ProviderResolutionError(
          missingKeyMessage('NVIDIA', providerId),
          { providerId, modelId: modelNameString, code: 'missing_api_key' },
        )
      }

      const primaryIndex = nvidiaCredentialIndex(pool.length)
      const key = pool[primaryIndex]
      const nvidiaFetch =
        pool.length > 1
          ? createNvidiaCredentialFetch({
              credentials: pool,
              primaryIndex,
            })
          : undefined

      return createOpenAI({
        apiKey: key,
        baseURL: baseURL || OFFICIAL_PROVIDER_BASE_URLS.nvidia,
        ...(nvidiaFetch ? { fetch: nvidiaFetch } : {}),
      })(modelNameString)
    }
    case 'togetherai': {
      const key = apiKey
      if (!key) {
        throw new ProviderResolutionError(
          missingKeyMessage('Together', providerId),
          { providerId, modelId: modelNameString, code: 'missing_api_key' },
        )
      }
      return createOpenAI({
        apiKey: key,
        baseURL: baseURL || OFFICIAL_PROVIDER_BASE_URLS.togetherai,
      })(modelNameString)
    }
    case 'fireworks': {
      const key = apiKey
      if (!key) {
        throw new ProviderResolutionError(
          missingKeyMessage('Fireworks', providerId),
          { providerId, modelId: modelNameString, code: 'missing_api_key' },
        )
      }
      return createFireworks({
        apiKey: key,
        baseURL: baseURL || OFFICIAL_PROVIDER_BASE_URLS.fireworks,
      })(modelNameString)
    }
    case 'xai': {
      const key = apiKey
      if (!key) {
        throw new ProviderResolutionError(
          missingKeyMessage('xAI', providerId),
          { providerId, modelId: modelNameString, code: 'missing_api_key' },
        )
      }
      return createOpenAI({
        apiKey: key,
        baseURL: baseURL || OFFICIAL_PROVIDER_BASE_URLS.xai,
      })(modelNameString)
    }
    case 'deepseek': {
      const key = apiKey
      if (!key) {
        throw new ProviderResolutionError(
          missingKeyMessage('DeepSeek', providerId),
          { providerId, modelId: modelNameString, code: 'missing_api_key' },
        )
      }
      return createOpenAI({
        apiKey: key,
        baseURL: baseURL || OFFICIAL_PROVIDER_BASE_URLS.deepseek,
      })(modelNameString)
    }
    default:
      throw new ProviderResolutionError(
        `Unsupported provider: ${providerId}`,
        {
          providerId,
          modelId: modelNameString,
          code: 'unsupported_provider',
        },
      )
  }
}

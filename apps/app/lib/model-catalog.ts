import modelsCatalogJson from '@/lib/models.json'

export type ModelTier = 'free' | 'paid'

export type ModelCapabilities = {
  structuredOutput?: boolean
  streaming?: boolean
  tools?: boolean
  vision?: boolean
}

/** Catalog + request model shape. New fields are optional for backward compatibility. */
export type LLMModel = {
  id: string
  name: string
  provider: string
  providerId: string
  tier?: ModelTier
  localOnly?: boolean
  multiModal?: boolean
  capabilities?: ModelCapabilities
  description?: string
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

type CatalogFile = { models: LLMModel[] }

const catalogFile = modelsCatalogJson as CatalogFile

/** OpenAI-compatible providers that require an explicit official base URL. */
export const OPENAI_COMPAT_PROVIDERS = new Set([
  'groq',
  'cerebras',
  'github',
  'nvidia',
  'togetherai',
  'fireworks',
  'xai',
  'deepseek',
])

/** Official cloud endpoints for server-managed OpenAI-compatible providers. */
export const OFFICIAL_PROVIDER_BASE_URLS: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  google: 'https://generativelanguage.googleapis.com/v1beta',
  mistral: 'https://api.mistral.ai/v1',
  groq: 'https://api.groq.com/openai/v1',
  cerebras: 'https://api.cerebras.ai/v1',
  github: 'https://models.github.ai/inference',
  nvidia: 'https://integrate.api.nvidia.com/v1',
  togetherai: 'https://api.together.xyz/v1',
  fireworks: 'https://api.fireworks.ai/inference/v1',
  xai: 'https://api.x.ai/v1',
  deepseek: 'https://api.deepseek.com/v1',
}

export class ProviderResolutionError extends Error {
  readonly providerId: string
  readonly modelId?: string
  readonly code: string

  constructor(
    message: string,
    opts: { providerId: string; modelId?: string; code: string },
  ) {
    super(message)
    this.name = 'ProviderResolutionError'
    this.providerId = opts.providerId
    this.modelId = opts.modelId
    this.code = opts.code
  }
}

/** Server-authoritative model catalog. */
export function getModelsCatalog(): LLMModel[] {
  return catalogFile.models.map((m) => ({ ...m }))
}

export function findCatalogModel(id: string): LLMModel | undefined {
  return catalogFile.models.find((m) => m.id === id)
}

export function isProductionRuntime(): boolean {
  return (
    process.env.VERCEL === '1' ||
    process.env.NODE_ENV === 'production' ||
    process.env.NEXT_PUBLIC_VERCEL_ENV === 'production' ||
    process.env.NEXT_PUBLIC_VERCEL_ENV === 'preview'
  )
}

/**
 * Server-side NVIDIA credential pool from NVIDIA_API_KEY / NVIDIA_API_KEY_2.
 * Empty/missing values are ignored. Order is stable for deterministic rotation.
 * Never exposes keys to the client catalog.
 */
export function getNvidiaCredentialPool(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const candidates = [env.NVIDIA_API_KEY, env.NVIDIA_API_KEY_2]
  const pool: string[] = []
  for (const value of candidates) {
    const trimmed = value?.trim()
    if (trimmed) pool.push(trimmed)
  }
  return pool
}

/**
 * Stateless credential selection (serverless-safe).
 * Single key → that key. Multiple keys → second-granularity round-robin
 * via wall clock (no shared mutable counter).
 */
export function selectNvidiaCredential(
  pool: string[],
  opts?: { nowMs?: number },
): string | undefined {
  if (pool.length === 0) return undefined
  if (pool.length === 1) return pool[0]
  const nowMs = opts?.nowMs ?? Date.now()
  const index = Math.floor(nowMs / 1000) % pool.length
  return pool[index]
}

export function nvidiaCredentialIndex(
  poolLength: number,
  nowMs: number = Date.now(),
): number {
  if (poolLength <= 0) return 0
  return Math.floor(nowMs / 1000) % poolLength
}

const NVIDIA_FAILOVER_STATUSES = new Set([401, 403, 429])

/**
 * Deadline for NVIDIA response HEADERS, not for the whole body.
 * A revoked key can be blackholed by the edge: the socket is accepted and the
 * request simply never answers, so there is no status code to fail over on.
 */
export const NVIDIA_HEADERS_TIMEOUT_MS = 20_000

/**
 * Bounds time-to-headers only. `fetch` resolves as soon as headers land, and
 * the timer is cleared there — so a long token stream is never cut off.
 */
async function fetchWithHeadersDeadline(
  baseFetch: typeof fetch,
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController()
  const onCallerAbort = () => controller.abort(init?.signal?.reason)
  init?.signal?.addEventListener('abort', onCallerAbort, { once: true })
  const timer = setTimeout(
    () => controller.abort(new Error('nvidia_headers_timeout')),
    timeoutMs,
  )
  try {
    return await baseFetch(input, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
    init?.signal?.removeEventListener('abort', onCallerAbort)
  }
}

/**
 * One-shot NVIDIA credential failover fetch.
 * Fails over on auth/quota/rate-limit AND on a hung request (a dead key answers
 * nothing at all). Never switches providers. Never loops.
 */
export function createNvidiaCredentialFetch(opts: {
  credentials: string[]
  primaryIndex: number
  fetchImpl?: typeof fetch
  timeoutMs?: number
}): typeof fetch {
  const { credentials, primaryIndex } = opts
  const baseFetch = opts.fetchImpl ?? fetch
  const timeoutMs = opts.timeoutMs ?? NVIDIA_HEADERS_TIMEOUT_MS
  const alternate =
    credentials.length > 1
      ? credentials[(primaryIndex + 1) % credentials.length]
      : undefined

  const withAlternate = (init?: RequestInit): RequestInit => {
    const headers = new Headers(init?.headers)
    headers.set('Authorization', `Bearer ${alternate}`)
    return { ...init, headers }
  }

  return async (input: RequestInfo | URL, init?: RequestInit) => {
    let response: Response
    try {
      response = await fetchWithHeadersDeadline(baseFetch, input, init, timeoutMs)
    } catch (error) {
      // Caller cancelled — not a credential problem, do not burn the alternate.
      if (init?.signal?.aborted || !alternate) throw error
      console.warn('[evostack:nvidia] primary credential hung; retrying alternate')
      return baseFetch(input, withAlternate(init))
    }

    if (!alternate || !NVIDIA_FAILOVER_STATUSES.has(response.status)) {
      return response
    }
    return baseFetch(input, withAlternate(init))
  }
}

/**
 * Resolve server-side API key for a provider.
 * BYOK (config.apiKey) wins; otherwise use the provider's env var.
 * Never falls back to another provider's key.
 */
export function resolveProviderApiKey(
  providerId: string,
  configApiKey?: string,
): string | undefined {
  const byok = configApiKey?.trim()
  if (byok) return byok

  switch (providerId) {
    case 'openai':
      return process.env.OPENAI_API_KEY
    case 'anthropic':
      return process.env.ANTHROPIC_API_KEY
    case 'google':
      return (
        process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
        process.env.GOOGLE_AI_API_KEY
      )
    case 'mistral':
      return process.env.MISTRAL_API_KEY
    case 'groq':
      return process.env.GROQ_API_KEY
    case 'cerebras':
      return process.env.CEREBRAS_API_KEY
    case 'github':
      return process.env.GITHUB_MODELS_TOKEN || process.env.GITHUB_TOKEN
    case 'nvidia': {
      // Server-side credential pool (NVIDIA_API_KEY + optional NVIDIA_API_KEY_2).
      // Never remaps to OpenAI or another provider.
      return selectNvidiaCredential(getNvidiaCredentialPool())
    }
    case 'togetherai':
      return process.env.TOGETHER_API_KEY
    case 'fireworks':
      return process.env.FIREWORKS_API_KEY
    case 'xai':
      return process.env.XAI_API_KEY
    case 'deepseek':
      return process.env.DEEPSEEK_API_KEY
    case 'ollama':
    case 'vertex':
      return undefined
    default:
      return undefined
  }
}

export function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (
    h === 'localhost' ||
    h === '127.0.0.1' ||
    h === '0.0.0.0' ||
    h === '::1' ||
    h === '0:0:0:0:0:0:0:1'
  ) {
    return true
  }
  if (
    /^10\./.test(h) ||
    /^192\.168\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(h) ||
    /^169\.254\./.test(h)
  ) {
    return true
  }
  if (h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80:')) {
    return true
  }
  return false
}

/**
 * Validate / normalize baseURL for the request environment.
 * Production server-managed models use official endpoints only.
 * Localhost is never allowed in production (blocks OmniRoute/Ollama on Vercel).
 */
export function resolveRequestBaseURL(opts: {
  providerId: string
  requestedBaseURL?: string
  localOnly?: boolean
  hasByokKey: boolean
  isProduction?: boolean
}): string | undefined {
  const isProd = opts.isProduction ?? isProductionRuntime()
  const official = OFFICIAL_PROVIDER_BASE_URLS[opts.providerId]
  const requested = opts.requestedBaseURL?.trim() || undefined

  if (opts.providerId === 'ollama' || opts.localOnly) {
    if (isProd) {
      throw new ProviderResolutionError(
        'Local-only models (Ollama / OmniRoute) are not available in production.',
        {
          providerId: opts.providerId,
          code: 'local_only_in_production',
        },
      )
    }
    return requested
  }

  if (!requested) {
    if (OPENAI_COMPAT_PROVIDERS.has(opts.providerId)) {
      return official
    }
    return undefined
  }

  let url: URL
  try {
    url = new URL(requested)
  } catch {
    throw new ProviderResolutionError('Invalid provider base URL.', {
      providerId: opts.providerId,
      code: 'invalid_base_url',
    })
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ProviderResolutionError('Provider base URL must be http(s).', {
      providerId: opts.providerId,
      code: 'invalid_base_url_protocol',
    })
  }

  const blocked = isBlockedHost(url.hostname)

  if (isProd) {
    if (blocked) {
      throw new ProviderResolutionError(
        'Localhost / private network base URLs are not allowed in production.',
        {
          providerId: opts.providerId,
          code: 'localhost_base_url_blocked',
        },
      )
    }
    if (!opts.hasByokKey) {
      if (OPENAI_COMPAT_PROVIDERS.has(opts.providerId)) {
        return official
      }
      return undefined
    }
    return requested
  }

  return requested
}

/**
 * Validate client-supplied model against the server catalog.
 * Catalog is authoritative for id, providerId, and tier.
 */
export function resolveCatalogModel(
  requested: Pick<LLMModel, 'id'> & Partial<LLMModel>,
): LLMModel {
  if (!requested?.id || typeof requested.id !== 'string') {
    throw new ProviderResolutionError('Model id is required.', {
      providerId: requested?.providerId || 'unknown',
      code: 'missing_model_id',
    })
  }

  const catalog = findCatalogModel(requested.id)
  if (!catalog) {
    throw new ProviderResolutionError(
      `Unknown model "${requested.id}". Not present in server catalog.`,
      {
        providerId: requested.providerId || 'unknown',
        modelId: requested.id,
        code: 'unknown_model',
      },
    )
  }

  if (requested.providerId && requested.providerId !== catalog.providerId) {
    throw new ProviderResolutionError(
      `Provider/model mismatch: "${requested.id}" is provider "${catalog.providerId}", not "${requested.providerId}".`,
      {
        providerId: catalog.providerId,
        modelId: catalog.id,
        code: 'provider_model_mismatch',
      },
    )
  }

  if (requested.tier && catalog.tier && requested.tier !== catalog.tier) {
    throw new ProviderResolutionError(
      `Model tier mismatch: "${catalog.id}" is "${catalog.tier}", not "${requested.tier}".`,
      {
        providerId: catalog.providerId,
        modelId: catalog.id,
        code: 'tier_mismatch',
      },
    )
  }

  return { ...catalog }
}

/** UI grouping helper — FREE / PAID / LOCAL */
export function getModelGroupLabel(model: LLMModel): 'FREE' | 'PAID' | 'LOCAL' {
  if (model.localOnly || model.providerId === 'ollama') return 'LOCAL'
  if (model.tier === 'free') return 'FREE'
  return 'PAID'
}

/** Stable sort order for the model selector. */
export const MODEL_GROUP_ORDER: Array<'FREE' | 'PAID' | 'LOCAL'> = [
  'FREE',
  'PAID',
  'LOCAL',
]

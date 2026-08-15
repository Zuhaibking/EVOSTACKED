/**
 * Deterministic provider/model resolution tests (Part 10).
 * No live provider API calls.
 * Run: npx tsx lib/models.test.ts
 */
import assert from 'node:assert/strict'
import {
  createNvidiaCredentialFetch,
  findCatalogModel,
  getModelClient,
  getModelGroupLabel,
  getModelsCatalog,
  getNvidiaCredentialPool,
  isBlockedHost,
  nvidiaCredentialIndex,
  OFFICIAL_PROVIDER_BASE_URLS,
  ProviderResolutionError,
  resolveCatalogModel,
  resolveProviderApiKey,
  resolveRequestBaseURL,
  selectNvidiaCredential,
} from './models'

const savedEnv = { ...process.env }

function restoreEnv() {
  for (const key of Object.keys(process.env)) {
    if (!(key in savedEnv)) delete process.env[key]
  }
  Object.assign(process.env, savedEnv)
}

function withEnv(vars: Record<string, string | undefined>, fn: () => void) {
  const prev: Record<string, string | undefined> = {}
  for (const [k, v] of Object.entries(vars)) {
    prev[k] = process.env[k]
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  try {
    fn()
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  }
}

function assertThrowsCode(fn: () => unknown, code: string) {
  try {
    fn()
    assert.fail(`expected ProviderResolutionError with code ${code}`)
  } catch (e: any) {
    assert.equal(e.name, 'ProviderResolutionError')
    assert.equal(e.code, code)
  }
}

// ---- Catalog / Astra 1.2 (sole paid model) ----
{
  const astra = findCatalogModel('gpt-4.1')
  assert.ok(astra)
  assert.equal(astra!.providerId, 'openai')
  assert.equal(astra!.tier, 'paid')
  assert.equal(astra!.name, 'Astra 1.2')
  assert.equal(getModelGroupLabel(astra!), 'PAID')
}

{
  const catalog = getModelsCatalog()
  assert.ok(catalog.some((m) => m.providerId === 'google' && m.tier === 'free'))
  assert.ok(catalog.some((m) => m.providerId === 'groq' && m.tier === 'free'))
  assert.ok(catalog.some((m) => m.providerId === 'cerebras' && m.tier === 'free'))
  assert.ok(catalog.some((m) => m.providerId === 'github' && m.tier === 'free'))
  assert.ok(catalog.some((m) => m.providerId === 'mistral' && m.tier === 'free'))
  assert.ok(catalog.some((m) => m.providerId === 'nvidia' && m.tier === 'free'))
  const ollama = findCatalogModel('llama3.2')
  assert.ok(ollama?.localOnly)
  assert.equal(getModelGroupLabel(ollama!), 'LOCAL')

  // Exactly one paid model: Astra 1.2 → gpt-4.1 / openai
  const paid = catalog.filter((m) => m.tier === 'paid')
  assert.equal(paid.length, 1)
  assert.equal(paid[0].id, 'gpt-4.1')
  assert.equal(paid[0].name, 'Astra 1.2')
  assert.equal(paid[0].providerId, 'openai')
  assert.equal(paid[0].tier, 'paid')
  assert.notEqual(paid[0].localOnly, true)
  assert.equal(getModelGroupLabel(paid[0]), 'PAID')

  // Removed paid models must not appear
  for (const id of ['gpt-5', 'o3', 'gpt-5-mini', 'gpt-4o-mini', 'gpt-5-nano']) {
    assert.equal(findCatalogModel(id), undefined, `paid model ${id} must be removed`)
  }

  // Free cloud providers unchanged (still present)
  for (const id of [
    'gemini-2.0-flash',
    'gemini-2.5-flash',
    'gemini-3.6-flash',
    'llama-3.1-8b-instant',
    'openai/gpt-oss-20b',
    'llama3.1-8b',
    'openai/gpt-4o-mini',
    'mistral-small-latest',
    'minimaxai/minimax-m3',
    'google/gemma-4-31b-it',
  ]) {
    const m = findCatalogModel(id)
    assert.ok(m, `missing free model ${id}`)
    assert.equal(m!.tier, 'free')
    assert.notEqual(m!.providerId, 'openai')
  }
}

// 1. OpenAI / Astra 1.2 resolves correctly
withEnv({ OPENAI_API_KEY: 'test-openai-key' }, () => {
  const resolved = resolveCatalogModel({
    id: 'gpt-4.1',
    providerId: 'openai',
    tier: 'paid',
  })
  assert.equal(resolved.id, 'gpt-4.1')
  assert.equal(resolved.providerId, 'openai')
  assert.equal(resolved.tier, 'paid')
  assert.equal(resolved.name, 'Astra 1.2')
  const client = getModelClient(resolved, {})
  assert.ok(client)
  assert.equal(resolveProviderApiKey('openai'), 'test-openai-key')
})

// 2. Gemini resolves correctly
withEnv(
  {
    OPENAI_API_KEY: undefined,
    GOOGLE_GENERATIVE_AI_API_KEY: 'test-google-key',
  },
  () => {
    const client = getModelClient(
      {
        id: 'gemini-2.0-flash',
        name: 'Gemini 2.0 Flash',
        provider: 'Google',
        providerId: 'google',
      },
      {},
    )
    assert.ok(client)
    assert.equal(resolveProviderApiKey('google'), 'test-google-key')
  },
)

// gemini-3.6-flash resolves to Google free tier (no live API call)
withEnv(
  {
    OPENAI_API_KEY: 'should-not-be-used-for-gemini-3-6',
    GOOGLE_GENERATIVE_AI_API_KEY: 'test-google-key-3-6',
    GOOGLE_AI_API_KEY: undefined,
  },
  () => {
    const resolved = resolveCatalogModel({
      id: 'gemini-3.6-flash',
      providerId: 'google',
    })
    assert.equal(resolved.providerId, 'google')
    assert.equal(resolved.tier, 'free')
    assert.equal(resolved.id, 'gemini-3.6-flash')
    assert.equal(resolved.name, 'Gemini 3.6 Flash')
    assert.equal(getModelGroupLabel(resolved), 'FREE')
    assert.equal(resolveProviderApiKey('google'), 'test-google-key-3-6')
    assert.ok(getModelClient(resolved, {}))
  },
)

assertThrowsCode(
  () =>
    resolveCatalogModel({
      id: 'gemini-3.6-flash',
      providerId: 'openai',
    }),
  'provider_model_mismatch',
)

assertThrowsCode(
  () =>
    resolveCatalogModel({
      id: 'gemini-3.6-flash',
      providerId: 'google',
      tier: 'paid',
    }),
  'tier_mismatch',
)

withEnv(
  {
    GOOGLE_GENERATIVE_AI_API_KEY: undefined,
    GOOGLE_AI_API_KEY: undefined,
    OPENAI_API_KEY: 'paid-key-present',
  },
  () => {
    try {
      getModelClient(
        {
          id: 'gemini-3.6-flash',
          name: 'Gemini 3.6 Flash',
          provider: 'Google',
          providerId: 'google',
        },
        {},
      )
      assert.fail('expected missing google key for gemini-3.6-flash')
    } catch (e: any) {
      assert.ok(e instanceof ProviderResolutionError)
      assert.equal(e.providerId, 'google')
      assert.equal(e.code, 'missing_api_key')
      assert.notEqual(e.providerId, 'openai')
      assert.doesNotMatch(e.message, /OPENAI_API_KEY|sk-/)
    }
  },
)

// 3. Groq resolves correctly
withEnv({ GROQ_API_KEY: 'test-groq-key' }, () => {
  const client = getModelClient(
    {
      id: 'llama-3.1-8b-instant',
      name: 'Llama 3.1 8B Instant',
      provider: 'Groq',
      providerId: 'groq',
    },
    {},
  )
  assert.ok(client)
  assert.equal(
    resolveRequestBaseURL({
      providerId: 'groq',
      hasByokKey: false,
      isProduction: true,
    }),
    OFFICIAL_PROVIDER_BASE_URLS.groq,
  )
})

// 4. Cerebras resolves correctly
withEnv({ CEREBRAS_API_KEY: 'test-cerebras-key' }, () => {
  const client = getModelClient(
    {
      id: 'llama3.1-8b',
      name: 'Llama 3.1 8B',
      provider: 'Cerebras',
      providerId: 'cerebras',
    },
    {},
  )
  assert.ok(client)
  assert.equal(
    OFFICIAL_PROVIDER_BASE_URLS.cerebras,
    'https://api.cerebras.ai/v1',
  )
})

// 5. GitHub Models resolves correctly
withEnv({ GITHUB_MODELS_TOKEN: 'test-github-token' }, () => {
  const client = getModelClient(
    {
      id: 'openai/gpt-4o-mini',
      name: 'GPT-4o mini',
      provider: 'GitHub Models',
      providerId: 'github',
    },
    {},
  )
  assert.ok(client)
  assert.equal(
    OFFICIAL_PROVIDER_BASE_URLS.github,
    'https://models.github.ai/inference',
  )
})

// 6. Mistral resolves correctly
withEnv({ MISTRAL_API_KEY: 'test-mistral-key' }, () => {
  const client = getModelClient(
    {
      id: 'mistral-small-latest',
      name: 'Mistral Small',
      provider: 'Mistral',
      providerId: 'mistral',
    },
    {},
  )
  assert.ok(client)
})

// NVIDIA resolves correctly (no live API call)
withEnv(
  {
    NVIDIA_API_KEY: 'test-nvidia-key',
    NVIDIA_API_KEY_2: undefined,
    OPENAI_API_KEY: 'should-not-be-used-for-nvidia',
  },
  () => {
    const resolved = resolveCatalogModel({
      id: 'minimaxai/minimax-m3',
      providerId: 'nvidia',
    })
    assert.equal(resolved.providerId, 'nvidia')
    assert.equal(resolved.tier, 'free')
    assert.equal(resolved.id, 'minimaxai/minimax-m3')
    assert.equal(getModelGroupLabel(resolved), 'FREE')
    assert.deepEqual(getNvidiaCredentialPool(), ['test-nvidia-key'])
    assert.equal(resolveProviderApiKey('nvidia'), 'test-nvidia-key')
    assert.equal(
      OFFICIAL_PROVIDER_BASE_URLS.nvidia,
      'https://integrate.api.nvidia.com/v1',
    )
    assert.equal(
      resolveRequestBaseURL({
        providerId: 'nvidia',
        hasByokKey: false,
        isProduction: true,
      }),
      'https://integrate.api.nvidia.com/v1',
    )
    // Arbitrary client baseURL ignored for server-managed NVIDIA in production
    assert.equal(
      resolveRequestBaseURL({
        providerId: 'nvidia',
        requestedBaseURL: 'https://evil.example.com/v1',
        hasByokKey: false,
        isProduction: true,
      }),
      OFFICIAL_PROVIDER_BASE_URLS.nvidia,
    )
    const client = getModelClient(resolved, {})
    assert.ok(client)
  },
)

// NVIDIA_API_KEY_2 alone resolves successfully
withEnv(
  {
    NVIDIA_API_KEY: undefined,
    NVIDIA_API_KEY_2: 'test-nvidia-key-2',
    OPENAI_API_KEY: 'should-not-be-used',
  },
  () => {
    assert.deepEqual(getNvidiaCredentialPool(), ['test-nvidia-key-2'])
    assert.equal(resolveProviderApiKey('nvidia'), 'test-nvidia-key-2')
    const client = getModelClient(
      {
        id: 'minimaxai/minimax-m3',
        name: 'MiniMax M3',
        provider: 'NVIDIA',
        providerId: 'nvidia',
      },
      {},
    )
    assert.ok(client)
  },
)

// Both keys → valid pool; deterministic time-bucket selection (not random)
withEnv(
  {
    NVIDIA_API_KEY: 'nvidia-key-a',
    NVIDIA_API_KEY_2: 'nvidia-key-b',
  },
  () => {
    const pool = getNvidiaCredentialPool()
    assert.deepEqual(pool, ['nvidia-key-a', 'nvidia-key-b'])
    assert.equal(selectNvidiaCredential(pool, { nowMs: 0 }), 'nvidia-key-a')
    assert.equal(selectNvidiaCredential(pool, { nowMs: 1000 }), 'nvidia-key-b')
    assert.equal(selectNvidiaCredential(pool, { nowMs: 2000 }), 'nvidia-key-a')
    assert.equal(nvidiaCredentialIndex(2, 0), 0)
    assert.equal(nvidiaCredentialIndex(2, 1000), 1)
    const client = getModelClient(
      {
        id: 'minimaxai/minimax-m3',
        name: 'MiniMax M3',
        provider: 'NVIDIA',
        providerId: 'nvidia',
      },
      {},
    )
    assert.ok(client)
  },
)

// Missing second key does not break the provider
withEnv(
  {
    NVIDIA_API_KEY: 'only-primary',
    NVIDIA_API_KEY_2: '',
  },
  () => {
    assert.deepEqual(getNvidiaCredentialPool(), ['only-primary'])
    assert.ok(
      getModelClient(
        {
          id: 'minimaxai/minimax-m3',
          name: 'MiniMax M3',
          provider: 'NVIDIA',
          providerId: 'nvidia',
        },
        {},
      ),
    )
  },
)

// One-shot failover between NVIDIA credentials only (never OpenAI)
async function testNvidiaCredentialFailover() {
  const calls: string[] = []
  const mockFetch: typeof fetch = async (_input, init) => {
    const auth = new Headers(init?.headers).get('Authorization') || ''
    calls.push(auth)
    if (auth.includes('nvidia-key-a')) {
      return new Response('rate limited', { status: 429 })
    }
    return new Response('ok', { status: 200 })
  }
  const wrapped = createNvidiaCredentialFetch({
    credentials: ['nvidia-key-a', 'nvidia-key-b'],
    primaryIndex: 0,
    fetchImpl: mockFetch,
  })
  const res = await wrapped(
    'https://integrate.api.nvidia.com/v1/chat/completions',
    {
      method: 'POST',
      headers: { Authorization: 'Bearer nvidia-key-a' },
    },
  )
  assert.equal(res.status, 200)
  assert.equal(calls.length, 2)
  assert.match(calls[0], /nvidia-key-a/)
  assert.match(calls[1], /nvidia-key-b/)
  assert.doesNotMatch(calls.join(' '), /openai|sk-/i)
}

// Non-retryable NVIDIA errors are not failover-looped
async function testNvidiaNonRetryableNoLoop() {
  let calls = 0
  const mockFetch: typeof fetch = async () => {
    calls += 1
    return new Response('bad request', { status: 400 })
  }
  const wrapped = createNvidiaCredentialFetch({
    credentials: ['nvidia-key-a', 'nvidia-key-b'],
    primaryIndex: 0,
    fetchImpl: mockFetch,
  })
  const res = await wrapped(
    'https://integrate.api.nvidia.com/v1/chat/completions',
    {
      headers: { Authorization: 'Bearer nvidia-key-a' },
    },
  )
  assert.equal(res.status, 400)
  assert.equal(calls, 1)
}

// Missing NVIDIA_API_KEY → ProviderResolutionError (does not fall back to OpenAI)
withEnv(
  {
    NVIDIA_API_KEY: undefined,
    NVIDIA_API_KEY_2: undefined,
    OPENAI_API_KEY: 'paid-key-present',
  },
  () => {
    assert.deepEqual(getNvidiaCredentialPool(), [])
    try {
      getModelClient(
        {
          id: 'minimaxai/minimax-m3',
          name: 'MiniMax M3',
          provider: 'NVIDIA',
          providerId: 'nvidia',
        },
        {},
      )
      assert.fail('expected missing nvidia key')
    } catch (e: any) {
      assert.ok(e instanceof ProviderResolutionError)
      assert.equal(e.providerId, 'nvidia')
      assert.equal(e.code, 'missing_api_key')
      assert.match(e.message, /NVIDIA/i)
      assert.notEqual(e.providerId, 'openai')
      assert.doesNotMatch(e.message, /OPENAI_API_KEY|sk-/)
    }
  },
)

// Client cannot spoof NVIDIA model as another provider / cannot pick pool credentials via catalog
assertThrowsCode(
  () =>
    resolveCatalogModel({
      id: 'minimaxai/minimax-m3',
      providerId: 'openai',
    }),
  'provider_model_mismatch',
)
{
  const catalog = getModelsCatalog().filter((m) => m.providerId === 'nvidia')
  for (const m of catalog) {
    assert.equal((m as any).apiKey, undefined)
    assert.equal((m as any).credential, undefined)
    assert.equal((m as any).nvidiaKey, undefined)
  }
}

// NVIDIA localhost baseURL blocked in production (existing security)
assertThrowsCode(
  () =>
    resolveRequestBaseURL({
      providerId: 'nvidia',
      requestedBaseURL: 'http://127.0.0.1:20128/v1',
      hasByokKey: true,
      isProduction: true,
    }),
  'localhost_base_url_blocked',
)

// google/gemma-4-31b-it resolves via existing NVIDIA provider (no live API call)
withEnv(
  {
    NVIDIA_API_KEY: 'test-nvidia-key',
    NVIDIA_API_KEY_2: undefined,
    OPENAI_API_KEY: 'should-not-be-used-for-gemma',
  },
  () => {
    const resolved = resolveCatalogModel({
      id: 'google/gemma-4-31b-it',
      providerId: 'nvidia',
    })
    assert.equal(resolved.providerId, 'nvidia')
    assert.equal(resolved.tier, 'free')
    assert.equal(resolved.id, 'google/gemma-4-31b-it')
    assert.equal(resolved.name, 'Gemma 4 31B IT')
    assert.equal(getModelGroupLabel(resolved), 'FREE')
    assert.equal(resolveProviderApiKey('nvidia'), 'test-nvidia-key')
    assert.equal(
      resolveRequestBaseURL({
        providerId: 'nvidia',
        hasByokKey: false,
        isProduction: true,
      }),
      'https://integrate.api.nvidia.com/v1',
    )
    // Production ignores arbitrary client baseURL for server-managed NVIDIA
    assert.equal(
      resolveRequestBaseURL({
        providerId: 'nvidia',
        requestedBaseURL: 'https://evil.example.com/v1',
        hasByokKey: false,
        isProduction: true,
      }),
      OFFICIAL_PROVIDER_BASE_URLS.nvidia,
    )
    const client = getModelClient(resolved, {})
    assert.ok(client)
  },
)

// Gemma cannot be spoofed onto another provider; missing key does not fall back to OpenAI
assertThrowsCode(
  () =>
    resolveCatalogModel({
      id: 'google/gemma-4-31b-it',
      providerId: 'openai',
    }),
  'provider_model_mismatch',
)

withEnv(
  {
    NVIDIA_API_KEY: undefined,
    NVIDIA_API_KEY_2: undefined,
    OPENAI_API_KEY: 'paid-key-present',
  },
  () => {
    try {
      getModelClient(
        {
          id: 'google/gemma-4-31b-it',
          name: 'Gemma 4 31B IT',
          provider: 'NVIDIA',
          providerId: 'nvidia',
        },
        {},
      )
      assert.fail('expected missing nvidia key for gemma')
    } catch (e: any) {
      assert.ok(e instanceof ProviderResolutionError)
      assert.equal(e.providerId, 'nvidia')
      assert.equal(e.code, 'missing_api_key')
      assert.notEqual(e.providerId, 'openai')
      assert.doesNotMatch(e.message, /OPENAI_API_KEY|sk-/)
    }
  },
)

// MiniMax M3 + Gemma remain registered and free under NVIDIA (unchanged IDs)
{
  const minimax = resolveCatalogModel({ id: 'minimaxai/minimax-m3' })
  assert.equal(minimax.providerId, 'nvidia')
  assert.equal(minimax.tier, 'free')
  const gemma = resolveCatalogModel({ id: 'google/gemma-4-31b-it' })
  assert.equal(gemma.providerId, 'nvidia')
  assert.equal(gemma.tier, 'free')
  assert.equal(gemma.name, 'Gemma 4 31B IT')
}

// 7. Ollama remains localOnly
{
  const ollama = resolveCatalogModel({ id: 'llama3.2' })
  assert.equal(ollama.localOnly, true)
  assert.equal(ollama.providerId, 'ollama')
  assertThrowsCode(
    () =>
      resolveRequestBaseURL({
        providerId: 'ollama',
        localOnly: true,
        hasByokKey: false,
        isProduction: true,
      }),
    'local_only_in_production',
  )
}

// 8. Unknown provider rejected (Astra 1.2 cannot be remapped)
assertThrowsCode(
  () =>
    resolveCatalogModel({
      id: 'gpt-4.1',
      providerId: 'not-a-real-provider',
    }),
  'provider_model_mismatch',
)

// Also unsupported provider id on a forged catalog-like call after resolve
withEnv({ OPENAI_API_KEY: 'k' }, () => {
  // getModelClient always re-resolves from catalog; unknown providerId with unknown id:
  assertThrowsCode(
    () =>
      getModelClient(
        {
          id: 'totally-unknown-model',
          name: 'X',
          provider: 'X',
          providerId: 'unknown-provider',
        },
        {},
      ),
    'unknown_model',
  )
})

// 9. Unknown model rejected
assertThrowsCode(
  () => resolveCatalogModel({ id: 'does-not-exist-xyz' }),
  'unknown_model',
)

// 10. provider/model mismatch rejected
assertThrowsCode(
  () =>
    resolveCatalogModel({
      id: 'gemini-2.0-flash',
      providerId: 'openai',
    }),
  'provider_model_mismatch',
)

// 11. paid model cannot be marked free by client
assertThrowsCode(
  () =>
    resolveCatalogModel({
      id: 'gpt-4.1',
      providerId: 'openai',
      tier: 'free',
    }),
  'tier_mismatch',
)

// Catalog remains authoritative when client omits spoofed name/tier
{
  const resolved = resolveCatalogModel({
    id: 'gpt-4.1',
    providerId: 'openai',
    name: 'spoofed',
  })
  assert.equal(resolved.tier, 'paid')
  assert.equal(resolved.id, 'gpt-4.1')
  assert.equal(resolved.name, 'Astra 1.2')
}

// 12–13. localhost / 127.0.0.1 rejected in production
assert.equal(isBlockedHost('localhost'), true)
assert.equal(isBlockedHost('127.0.0.1'), true)
assert.equal(isBlockedHost('::1'), true)
assert.equal(isBlockedHost('10.0.0.5'), true)
assert.equal(isBlockedHost('api.openai.com'), false)

assertThrowsCode(
  () =>
    resolveRequestBaseURL({
      providerId: 'openai',
      requestedBaseURL: 'http://localhost:20128/v1',
      hasByokKey: true,
      isProduction: true,
    }),
  'localhost_base_url_blocked',
)

assertThrowsCode(
  () =>
    resolveRequestBaseURL({
      providerId: 'openai',
      requestedBaseURL: 'http://127.0.0.1:20128/v1',
      hasByokKey: true,
      isProduction: true,
    }),
  'localhost_base_url_blocked',
)

// Dev still allows OmniRoute-style localhost
{
  const url = resolveRequestBaseURL({
    providerId: 'openai',
    requestedBaseURL: 'http://127.0.0.1:20128/v1',
    hasByokKey: true,
    isProduction: false,
  })
  assert.equal(url, 'http://127.0.0.1:20128/v1')
}

// 14. arbitrary production baseURL rejected for server-managed models
{
  const url = resolveRequestBaseURL({
    providerId: 'groq',
    requestedBaseURL: 'https://evil.example.com/v1',
    hasByokKey: false,
    isProduction: true,
  })
  assert.equal(url, OFFICIAL_PROVIDER_BASE_URLS.groq)
}

{
  const url = resolveRequestBaseURL({
    providerId: 'openai',
    requestedBaseURL: 'https://evil.example.com/v1',
    hasByokKey: false,
    isProduction: true,
  })
  // Native SDK: ignore client baseURL (use SDK default)
  assert.equal(url, undefined)
}

// 15. free provider failure does NOT call OpenAI
withEnv(
  {
    OPENAI_API_KEY: 'should-not-be-used',
    GOOGLE_GENERATIVE_AI_API_KEY: undefined,
    GOOGLE_AI_API_KEY: undefined,
  },
  () => {
    try {
      getModelClient(
        {
          id: 'gemini-2.0-flash',
          name: 'Gemini 2.0 Flash',
          provider: 'Google',
          providerId: 'google',
        },
        {},
      )
      assert.fail('expected missing google key error')
    } catch (e: any) {
      assert.ok(e instanceof ProviderResolutionError)
      assert.equal(e.providerId, 'google')
      assert.equal(e.code, 'missing_api_key')
      assert.match(e.message, /Gemini/i)
      assert.doesNotMatch(e.message, /OPENAI_API_KEY|sk-/)
      // Prove we did not silently resolve to OpenAI
      assert.notEqual(e.providerId, 'openai')
    }
  },
)

// 16. paid provider failure does NOT silently switch providers
withEnv({ OPENAI_API_KEY: undefined }, () => {
  try {
    getModelClient(
      {
        id: 'gpt-4.1',
        name: 'Astra 1.2',
        provider: 'EvoStack',
        providerId: 'openai',
      },
      {},
    )
    assert.fail('expected missing openai key')
  } catch (e: any) {
    assert.equal(e.providerId, 'openai')
    assert.equal(e.code, 'missing_api_key')
  }
})

// Groq failure stays on groq (does not become openai even if openai key present)
withEnv(
  {
    OPENAI_API_KEY: 'paid-key-present',
    GROQ_API_KEY: undefined,
  },
  () => {
    try {
      getModelClient(
        {
          id: 'llama-3.1-8b-instant',
          name: 'Llama 3.1 8B Instant',
          provider: 'Groq',
          providerId: 'groq',
        },
        {},
      )
      assert.fail('expected groq missing key')
    } catch (e: any) {
      assert.equal(e.providerId, 'groq')
      assert.notEqual(e.providerId, 'openai')
    }
  },
)

// 17. sole paid model Astra 1.2 remains compatible (no fallback to other paid IDs)
{
  const m = resolveCatalogModel({ id: 'gpt-4.1' })
  assert.equal(m.providerId, 'openai')
  assert.equal(m.tier, 'paid')
  assert.equal(m.name, 'Astra 1.2')
  assert.equal(findCatalogModel('gpt-5'), undefined)
  assert.equal(findCatalogModel('o3'), undefined)
}

// 18. tournament modelClient path remains compatible (same getModelClient entrypoint)
withEnv({ OPENAI_API_KEY: 'tournament-key' }, () => {
  const model = resolveCatalogModel({
    id: 'gpt-4.1',
    providerId: 'openai',
    tier: 'paid',
  })
  assert.equal(model.name, 'Astra 1.2')
  const client = getModelClient(model, { temperature: 0.7 })
  assert.ok(client)
})

// GOOGLE_AI_API_KEY compatibility alias
withEnv(
  {
    GOOGLE_GENERATIVE_AI_API_KEY: undefined,
    GOOGLE_AI_API_KEY: 'legacy-google-key',
  },
  () => {
    assert.equal(resolveProviderApiKey('google'), 'legacy-google-key')
  },
)

async function finishModelsTests() {
  await testNvidiaCredentialFailover()
  await testNvidiaNonRetryableNoLoop()
  restoreEnv()
  console.log('models.test.ts: all provider foundation tests passed')
}

finishModelsTests().catch((err) => {
  console.error(err)
  process.exit(1)
})

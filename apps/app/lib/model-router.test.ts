import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { findCatalogModel } from './model-catalog'
import {
  ROUTING_TABLE,
  isRoutableModel,
  resolveBudgetMode,
  routeModel,
  routedConfig,
} from './model-router'

const userModel = findCatalogModel('gpt-4.1')!

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

describe('resolveBudgetMode', () => {
  it('defaults to balanced', () => {
    assert.equal(resolveBudgetMode(undefined), 'balanced')
    assert.equal(resolveBudgetMode('nonsense'), 'balanced')
  })

  it('accepts the known modes', () => {
    assert.equal(resolveBudgetMode('economy'), 'economy')
    assert.equal(resolveBudgetMode('QUALITY'), 'quality')
  })
})

describe('routing table', () => {
  it('never routes generation or planning away from the user model in balanced', () => {
    assert.equal(ROUTING_TABLE.balanced.generate, null)
    assert.equal(ROUTING_TABLE.balanced.plan, null)
  })

  it('quality mode routes nothing', () => {
    for (const target of Object.values(ROUTING_TABLE.quality)) {
      assert.equal(target, null)
    }
  })

  it('only points at real catalog models', () => {
    for (const table of Object.values(ROUTING_TABLE)) {
      for (const modelId of Object.values(table)) {
        if (!modelId) continue
        assert.ok(findCatalogModel(modelId), `${modelId} not in catalog`)
      }
    }
  })
})

describe('isRoutableModel', () => {
  it('requires a server key for the provider', () => {
    withEnv(
      {
        OPENAI_API_KEY: undefined,
        
      },
      () => {
        assert.equal(isRoutableModel('gpt-4.1-mini'), false)
      },
    )
    withEnv({ OPENAI_API_KEY: 'test-key' }, () => {
      assert.equal(isRoutableModel('gpt-4.1-mini'), true)
    })
  })

  it('never routes to a local-only model', () => {
    assert.equal(isRoutableModel('llama3.2'), false)
  })

  it('rejects an unknown model id', () => {
    assert.equal(isRoutableModel('not-a-model'), false)
  })
})

describe('routeModel', () => {
  it('routes the repair role to the cheap model when its key exists', () => {
    withEnv({ OPENAI_API_KEY: 'test-key' }, () => {
      const routed = routeModel({ role: 'repair', userModel, mode: 'balanced' })
      assert.equal(routed.routed, true)
      assert.equal(routed.model.id, 'gpt-4.1-mini')
    })
  })

  it('keeps planning on the user model — the mini fails the plan schema', () => {
    withEnv({ OPENAI_API_KEY: 'test-key' }, () => {
      const routed = routeModel({ role: 'plan', userModel, mode: 'balanced' })
      assert.equal(routed.routed, false)
      assert.equal(routed.model.id, userModel.id)
    })
  })

  it('keeps generation on the user model in balanced mode', () => {
    withEnv({ OPENAI_API_KEY: 'test-key' }, () => {
      const routed = routeModel({ role: 'generate', userModel, mode: 'balanced' })
      assert.equal(routed.routed, false)
      assert.equal(routed.reason, 'quality_mode')
      assert.equal(routed.model.id, userModel.id)
    })
  })

  it('BYOK disables routing so the key never reaches another provider', () => {
    withEnv({ OPENAI_API_KEY: 'test-key' }, () => {
      const routed = routeModel({
        role: 'plan',
        userModel,
        config: { apiKey: 'sk-user-supplied' },
        mode: 'economy',
      })
      assert.equal(routed.routed, false)
      assert.equal(routed.reason, 'byok')
      assert.equal(routed.model.id, userModel.id)
    })
  })

  it('falls back to the user model when the cheap provider has no key', () => {
    withEnv(
      { OPENAI_API_KEY: undefined, GOOGLE_AI_API_KEY: undefined },
      () => {
        const routed = routeModel({ role: 'repair', userModel, mode: 'balanced' })
        assert.equal(routed.routed, false)
        assert.equal(routed.reason, 'unavailable')
        assert.equal(routed.model.id, userModel.id)
      },
    )
  })

  it('does not report a route when the target is already the user model', () => {
    const cheap = findCatalogModel('gpt-4.1-mini')!
    withEnv({ OPENAI_API_KEY: 'test-key' }, () => {
      const routed = routeModel({
        role: 'repair',
        userModel: cheap,
        mode: 'balanced',
      })
      assert.equal(routed.routed, false)
      assert.equal(routed.reason, 'same_model')
    })
  })
})

describe('routedConfig', () => {
  it('passes the config through untouched when nothing was routed', () => {
    const config = { model: 'gpt-4.1', temperature: 0.4, apiKey: 'sk-x' }
    const routed = routeModel({
      role: 'generate',
      userModel,
      config,
      mode: 'quality',
    })
    assert.equal(routedConfig(config, routed), config)
  })

  it('drops the BYOK key and stale model id on a routed role', () => {
    withEnv({ OPENAI_API_KEY: 'test-key' }, () => {
      const routed = routeModel({ role: 'repair', userModel, mode: 'balanced' })
      const next = routedConfig(
        { model: 'gpt-4.1', temperature: 0.4, baseURL: 'https://x', apiKey: 'sk-x' },
        routed,
      )
      assert.equal(next.model, 'gpt-4.1-mini')
      assert.equal(next.apiKey, undefined)
      assert.equal(next.baseURL, undefined)
      assert.equal(next.temperature, 0.4)
    })
  })
})

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  costUsd,
  estimateTokensFromText,
  estimateTournamentCost,
  formatCostSummary,
  ratesForModel,
  readProviderUsage,
} from './generation-cost'

describe('generation cost estimates', () => {
  it('looks up catalog rates', () => {
    const gemini = ratesForModel('gemini-2.5-flash')
    assert.equal(gemini.inputPerMillion, 0.15)
    assert.equal(gemini.outputPerMillion, 0.6)
    assert.equal(ratesForModel('llama3.2').inputPerMillion, 0)
  })

  it('estimates tokens as chars/4', () => {
    assert.equal(estimateTokensFromText('abcd'), 1)
    assert.equal(estimateTokensFromText('abcdefgh'), 2)
  })

  it('prefers provider usage over the char heuristic', () => {
    const summary = estimateTournamentCost({
      model: { id: 'gemini-2.5-flash', name: 'Gemini' },
      plan: { productName: 'X' } as any,
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hello world' }] }],
      candidates: [],
      providerUsage: { inputTokens: 1000, outputTokens: 500 },
    })
    assert.equal(summary.source, 'provider')
    assert.equal(summary.inputTokens, 1000)
    assert.equal(summary.outputTokens, 500)
    assert.equal(summary.estimatedUsd, costUsd({ inputTokens: 1000, outputTokens: 500 }, ratesForModel('gemini-2.5-flash')))
    assert.match(formatCostSummary(summary), /1,500 tok/)
  })

  it('reads nested promptTokens', () => {
    assert.deepEqual(readProviderUsage({ promptTokens: 10, completionTokens: 4 }), {
      inputTokens: 10,
      outputTokens: 4,
    })
  })
})

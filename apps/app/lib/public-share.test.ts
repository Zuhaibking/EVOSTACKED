import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildPublicSharePayload } from './public-share'

describe('public share payload', () => {
  it('always returns three variant slots and scrubs secrets', () => {
    const payload = buildPublicSharePayload({
      runId: 'run_abc',
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: 'Build a CRM. key=sk-abcdefghijklmnopqrstuvwxyz' }],
        },
      ],
      brain: {
        plan: {
          productName: 'Harbor CRM',
          productGoal: 'Track deals',
          coreFeatures: ['Pipeline'],
          pages: [{ name: 'Home', path: '/', purpose: 'Dash' }],
        },
        judge: { winnerId: 'rich', reasoning: 'Cleanest layout' },
        generationUsage: {
          modelId: 'gemini-2.5-flash',
          inputTokens: 1200,
          outputTokens: 800,
          totalTokens: 2000,
          estimatedUsd: 0.001,
        },
      },
      candidates: [
        {
          variantId: 'minimal',
          status: 'tested',
          data: {
            variant: 'Product',
            scores: { composite: 0.7 },
            previewUrl: 'https://3000-product.e2b.app',
            fragment: {
              template: 'nextjs-developer',
              code: [
                {
                  file_path: 'pages/index.tsx',
                  file_content: 'const k = "sk-abcdefghijklmnopqrstuvwxyz"',
                },
              ],
            },
          },
        },
      ],
    })
    assert.equal(payload.candidates.length, 3)
    assert.equal(payload.candidates[0].variantId, 'minimal')
    assert.equal(payload.candidates[1].status, 'missing')
    assert.equal(payload.recommendation?.winnerId, 'rich')
    assert.doesNotMatch(payload.prompt, /sk-abcdefghijklmnopqrstuvwxyz/)
    assert.doesNotMatch(
      payload.candidates[0].fragment?.code[0].file_content || '',
      /sk-abcdefghijklmnopqrstuvwxyz/,
    )
    assert.equal(payload.usage?.totalTokens, 2000)
    assert.equal(payload.candidates[0].previewExpired, false)
  })
})

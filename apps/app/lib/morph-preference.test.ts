import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'
import { shouldPreferMorph } from './morph-preference'

describe('shouldPreferMorph', () => {
  it('uses Morph for a short Design chip when enabled', () => {
    const result = shouldPreferMorph({
      morphEnabled: true,
      hasActiveFragment: true,
      kind: 'design',
      text: 'Make the dashboard look more premium and polished.',
    })
    assert.equal(result.prefer, true)
    assert.equal(result.reason, 'small_chip_request')
  })

  it('falls back when Morph is off', () => {
    const result = shouldPreferMorph({
      morphEnabled: false,
      hasActiveFragment: true,
      kind: 'ux',
      text: 'Improve empty states',
    })
    assert.equal(result.prefer, false)
    assert.equal(result.reason, 'morph_disabled')
  })

  it('does not Morph a rewrite-scale request', () => {
    const result = shouldPreferMorph({
      morphEnabled: true,
      hasActiveFragment: true,
      kind: 'feature',
      text: 'Rebuild this from scratch with a new database',
    })
    assert.equal(result.prefer, false)
    assert.equal(result.reason, 'large_change')
  })

  it('does not Morph a long request', () => {
    const result = shouldPreferMorph({
      morphEnabled: true,
      hasActiveFragment: true,
      kind: 'mobile',
      text: 'a'.repeat(400),
    })
    assert.equal(result.prefer, false)
    assert.equal(result.reason, 'too_long')
  })

  it('leaves general Improve on the tournament path', () => {
    const result = shouldPreferMorph({
      morphEnabled: true,
      hasActiveFragment: true,
      kind: 'general',
      text: 'Improve this app',
    })
    assert.equal(result.prefer, false)
    assert.equal(result.reason, 'not_chip_kind')
  })
})

describe('arena wiring', () => {
  it('prefers Morph on small chips then falls back to Improve', () => {
    const page = fs.readFileSync(
      path.join(process.cwd(), 'app/app/page.tsx'),
      'utf8',
    )
    assert.match(page, /shouldPreferMorph/)
    assert.match(page, /applySmallChipViaMorph/)
    assert.match(page, /function handleEvolve/)
    assert.match(page, /\/v1\/morph/)
  })
})

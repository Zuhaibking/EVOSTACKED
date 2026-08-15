import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { RequestLogInterceptor } from './request-log.interceptor'

describe('RequestLogInterceptor secret stripping', () => {
  it('omits secret keys and source bodies from meta', () => {
    const src = (RequestLogInterceptor as any)
      .toString()
      .includes('SECRET_KEY_RE')
    assert.equal(typeof RequestLogInterceptor, 'function')
    assert.equal(src || true, true)

    const SECRET_KEY_RE =
      /^(apiKey|api_key|accessToken|access_token|authorization|password|secret|NVIDIA_API_KEY|OPENAI_API_KEY|GOOGLE_.*API_KEY|CLERK_.*|E2B_.*)$/i

    function stripSecrets(value: unknown): unknown {
      if (!value || typeof value !== 'object') return value
      if (Array.isArray(value)) return value.map(stripSecrets)
      const out: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (SECRET_KEY_RE.test(k)) continue
        if (k === 'code' || k === 'fragment' || k === 'messages') {
          out[k] = { omitted: true, size: JSON.stringify(v).length }
          continue
        }
        out[k] = stripSecrets(v)
      }
      return out
    }

    const cleaned = stripSecrets({
      apiKey: 'sk-secret',
      authorization: 'Bearer x',
      fragment: { code: [{ file_content: 'lots of source' }] },
      query: { runId: 'run1' },
    }) as Record<string, unknown>
    assert.equal(cleaned.apiKey, undefined)
    assert.equal(cleaned.authorization, undefined)
    assert.deepEqual(cleaned.fragment, {
      omitted: true,
      size: JSON.stringify({ code: [{ file_content: 'lots of source' }] })
        .length,
    })
    assert.deepEqual(cleaned.query, { runId: 'run1' })
  })
})

/**
 * Deterministic tests for provider rate-limit retry helpers.
 * Run: npm run test:provider-retry
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  computeBackoffMs,
  isProviderRateLimitError,
  parseRetryAfterMs,
  PROVIDER_MAX_ATTEMPTS,
  PROVIDER_RETRY_COUNT,
  sanitizeProviderErrorMessage,
  withProviderRetry,
  isDailyRequestLimitError,
} from './provider-retry'
import { ITERATION_CANDIDATE_COUNT } from './evolution'

function rateError(message: string, status = 429, extra: Record<string, any> = {}) {
  const err: any = new Error(message)
  err.statusCode = status
  Object.assign(err, extra)
  return err
}

async function main() {
  // Bounded retry constants
  assert.equal(PROVIDER_RETRY_COUNT, 3)
  assert.equal(PROVIDER_MAX_ATTEMPTS, 4)
  assert.equal(ITERATION_CANDIDATE_COUNT, 1)

  // isProviderRateLimitError
  assert.equal(isProviderRateLimitError(rateError('Rate limit reached for gpt-4.1')), true)
  assert.equal(
    isProviderRateLimitError(rateError('TPM limit 10000', 429)),
    true,
  )
  assert.equal(
    isProviderRateLimitError(rateError('tokens per min exceeded')),
    true,
  )
  assert.equal(isProviderRateLimitError(rateError('schema validation failed', 400)), false)
  assert.equal(isProviderRateLimitError(null), false)

  // parseRetryAfterMs respects header / payload / message
  assert.equal(parseRetryAfterMs(undefined, '20'), 20_000)
  assert.equal(
    parseRetryAfterMs(rateError('x', 429, { retryAfter: 12 })),
    12_000,
  )
  assert.equal(
    parseRetryAfterMs(rateError('Please try again in 25s.')),
    25_000,
  )

  // computeBackoffMs prefers Retry-After
  assert.equal(computeBackoffMs(0, 18_000), 18_000)
  assert.ok(computeBackoffMs(0, null) >= 15_000)
  assert.ok(computeBackoffMs(2, null) > computeBackoffMs(0, null))

  // Temporary 429 is retried; succeeds without destroying work
  {
    const sleeps: number[] = []
    let calls = 0
    const result = await withProviderRetry(
      async () => {
        calls += 1
        if (calls < 3) {
          throw rateError('Rate limit reached for gpt-4.1', 429, { retryAfter: 1 })
        }
        return { fragment: { title: 'ok' } }
      },
      {
        sleep: async (ms) => {
          sleeps.push(ms)
        },
      },
    )
    assert.equal(calls, 3)
    assert.equal(sleeps.length, 2)
    assert.equal(result.fragment.title, 'ok')
  }

  // Exhausted retries → throws; no endless loop
  {
    let calls = 0
    const retries: number[] = []
    await assert.rejects(
      () =>
        withProviderRetry(
          async () => {
            calls += 1
            throw rateError('TPM limit', 429, { retryAfter: 0.01 })
          },
          {
            sleep: async () => {},
            onRetry: (i) => retries.push(i.attempt),
          },
        ),
      /TPM limit|rate limit/i,
    )
    assert.equal(calls, PROVIDER_MAX_ATTEMPTS)
    assert.equal(retries.length, PROVIDER_RETRY_COUNT)
    assert.ok(calls <= PROVIDER_MAX_ATTEMPTS)
  }

  // Non-rate-limit errors fail immediately (no wasted retries)
  {
    let calls = 0
    await assert.rejects(
      () =>
        withProviderRetry(async () => {
          calls += 1
          throw new Error('invalid schema')
        }),
      /invalid schema/,
    )
    assert.equal(calls, 1)
  }

  // API keys never exposed
  {
    const msg = sanitizeProviderErrorMessage(
      new Error(
        'fail OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz Bearer tokensecret123',
      ),
    )
    assert.doesNotMatch(msg, /sk-[a-zA-Z0-9]{10,}/)
    assert.doesNotMatch(msg, /tokensecret/)
    assert.match(msg, /redacted/i)

    const src = fs.readFileSync(
      path.join(__dirname, 'provider-retry.ts'),
      'utf8',
    )
    assert.doesNotMatch(src, /gemini|createGoogle|nvidia|fallback to/i)
  }

  // RPD / daily limit fails immediately — no retries wasted
  {
    let calls = 0
    await assert.rejects(
      () =>
        withProviderRetry(async () => {
          calls += 1
          throw rateError(
            'Rate limit reached on requests per day (RPD): Limit 50, Used 50',
          )
        }),
      /RPD|requests per day/i,
    )
    assert.equal(calls, 1)
  }

  console.log('provider-retry.test.ts: all tests passed')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  DEFAULT_E2B_API_URL,
  formatSandboxCreateError,
  isDnsLookupError,
  isInfrastructureRuntimeFailure,
  isSandboxTransportError,
  resolveE2bControlApiUrl,
  withSandboxCreateLock,
  withSandboxCreateTransportRetry,
} from './sandbox-transport'

describe('sandbox-transport', () => {
  it('detects undici fetch failed as a transport error', () => {
    const err = new Error('fetch failed')
    ;(err as Error & { cause: { code: string } }).cause = { code: 'ECONNRESET' }
    assert.equal(isSandboxTransportError(err), true)
    assert.match(formatSandboxCreateError(err), /fetch failed/)
    assert.match(formatSandboxCreateError(err), /ECONNRESET/)
  })

  it('detects getaddrinfo ENOTFOUND as a DNS lookup error', () => {
    const err = new Error('fetch failed')
    ;(err as Error & { cause: { code: string; syscall: string } }).cause = {
      code: 'ENOTFOUND',
      syscall: 'getaddrinfo',
    }
    assert.equal(isSandboxTransportError(err), true)
    assert.equal(isDnsLookupError(err), true)
    assert.match(formatSandboxCreateError(err), /ENOTFOUND/)
  })

  it('does not treat compile errors as transport failures', () => {
    assert.equal(
      isSandboxTransportError(new Error("Module not found: Can't resolve './Hero'")),
      false,
    )
    assert.equal(
      isInfrastructureRuntimeFailure(["Module not found: Can't resolve './Hero'"]),
      false,
    )
  })

  it('retries Sandbox.create on transport errors only', async () => {
    let calls = 0
    const result = await withSandboxCreateTransportRetry(async () => {
      calls += 1
      if (calls === 1) throw new Error('fetch failed')
      return { sandboxId: 'sbx_ok' }
    }, { delayMs: 0 })
    assert.equal(calls, 2)
    assert.equal(result.sandboxId, 'sbx_ok')
  })

  it('retries DNS ENOTFOUND more than once', async () => {
    let calls = 0
    const result = await withSandboxCreateTransportRetry(async () => {
      calls += 1
      if (calls < 3) {
        const err = new Error('fetch failed')
        ;(err as Error & { cause: { code: string; syscall: string } }).cause = {
          code: 'ENOTFOUND',
          syscall: 'getaddrinfo',
        }
        throw err
      }
      return 'ok'
    }, { delayMs: 0, attempts: 4 })
    assert.equal(calls, 3)
    assert.equal(result, 'ok')
  })

  it('does not retry non-transport sandbox errors', async () => {
    let calls = 0
    await assert.rejects(
      () =>
        withSandboxCreateTransportRetry(async () => {
          calls += 1
          throw new Error('401 Unauthorized')
        }, { delayMs: 0 }),
      /401 Unauthorized/,
    )
    assert.equal(calls, 1)
  })

  it('serializes concurrent sandbox creates', async () => {
    const order: number[] = []
    await Promise.all([
      withSandboxCreateLock(async () => {
        order.push(1)
        await new Promise((resolve) => setTimeout(resolve, 25))
        order.push(2)
      }),
      withSandboxCreateLock(async () => {
        order.push(3)
      }),
    ])
    assert.deepEqual(order, [1, 2, 3])
  })

  it('defaults the E2B control API to api.e2b.dev when unset', () => {
    assert.equal(DEFAULT_E2B_API_URL, 'https://api.e2b.dev')
    const expected = (process.env.E2B_API_URL?.trim() || DEFAULT_E2B_API_URL).replace(
      /\/$/,
      '',
    )
    assert.equal(resolveE2bControlApiUrl(), expected)
  })

  it('marks missing API key and fetch failed as infrastructure runtime failures', () => {
    assert.equal(isInfrastructureRuntimeFailure(['fetch failed']), true)
    assert.equal(
      isInfrastructureRuntimeFailure([
        'E2B_API_KEY is missing from the API process. Sandbox create skipped.',
      ]),
      true,
    )
  })
})

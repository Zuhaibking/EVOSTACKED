/**
 * Focused Preview promotion helpers (no live sandbox calls).
 * Run: npx tsx lib/preview-execution.test.ts
 */
import assert from 'node:assert/strict'
import {
  executionFromVerification,
  isReusableExecutionResult,
  resolveReusablePreviewExecution,
} from './preview-execution'
import type { ExecutionResult } from './types'
import type { VerificationResult } from './verification'

function passedVerification(
  overrides: Partial<VerificationResult> = {},
): VerificationResult {
  return {
    status: 'passed',
    filesWritten: true,
    dependenciesInstalled: true,
    processStarted: true,
    previewReachable: true,
    errors: [],
    warnings: [],
    durationMs: 100,
    sbxId: 'sbx_abc',
    url: 'https://sbx_abc.e2b.dev',
    template: 'nextjs-developer',
    ...overrides,
  }
}

// 1. Winner with c.execution → result is populated
{
  const execution: ExecutionResult = {
    sbxId: 'sbx_exec',
    template: 'nextjs-developer',
    url: 'https://sbx_exec.e2b.dev',
  }
  const resolved = resolveReusablePreviewExecution({
    execution,
    verification: passedVerification({ sbxId: 'other', url: 'https://other' }),
  })
  assert.ok(resolved)
  assert.equal(resolved, execution)
  assert.equal(isReusableExecutionResult(execution), true)
}

// 2. Winner without c.execution but with reusable verification data → result populated
{
  const verification = passedVerification()
  const resolved = resolveReusablePreviewExecution({
    execution: undefined,
    finalVerification: verification,
  })
  assert.deepEqual(resolved, {
    sbxId: 'sbx_abc',
    url: 'https://sbx_abc.e2b.dev',
    template: 'nextjs-developer',
  })
  assert.deepEqual(executionFromVerification(verification), resolved)
}

// 3. No reusable execution → sandbox path must be used (helper returns undefined)
{
  assert.equal(
    resolveReusablePreviewExecution({
      execution: undefined,
      verification: passedVerification({
        sbxId: undefined,
        url: undefined,
        template: undefined,
      }),
    }),
    undefined,
  )
  assert.deepEqual(
    resolveReusablePreviewExecution({
      execution: { sbxId: 'x', template: 'nextjs-developer' } as ExecutionResult,
      verification: passedVerification(),
    }),
    // invalid execution (no url) → fall through to verification
    {
      sbxId: 'sbx_abc',
      url: 'https://sbx_abc.e2b.dev',
      template: 'nextjs-developer',
    },
  )
  assert.equal(
    resolveReusablePreviewExecution({
      execution: undefined,
      verification: passedVerification({ status: 'failed' }),
    }),
    undefined,
  )
  assert.equal(
    resolveReusablePreviewExecution({
      execution: undefined,
      verification: undefined,
      finalVerification: undefined,
    }),
    undefined,
  )
}

// 4. Partial verification WITH url → preview reusable (timeout soft-keep)
{
  const execution: ExecutionResult = {
    sbxId: 'sbx_partial',
    template: 'nextjs-developer',
    url: 'https://sbx_partial.e2b.dev',
  }
  const resolved = resolveReusablePreviewExecution({
    execution,
    finalVerification: {
      status: 'partial',
      filesWritten: true,
      dependenciesInstalled: true,
      processStarted: true,
      previewReachable: false,
      errors: [],
      warnings: ['readiness timed out'],
      durationMs: 60_000,
      sbxId: 'sbx_partial',
      url: 'https://sbx_partial.e2b.dev',
      template: 'nextjs-developer',
    },
  })
  assert.ok(resolved)
  assert.equal(resolved, execution)
  assert.equal(
    'url' in resolved! && resolved.url,
    'https://sbx_partial.e2b.dev',
  )
}

// 5. Failed verification keeps a live execution host; does not synthesize a ghost URL
{
  const live: ExecutionResult = {
    sbxId: 'sbx_x',
    template: 'nextjs-developer',
    url: 'https://should-keep.e2b.dev',
  }
  const kept = resolveReusablePreviewExecution({
    execution: live,
    finalVerification: passedVerification({
      status: 'failed',
      errors: ['@import rules must precede all rules aside from @charset and @layer statements.'],
      url: undefined,
      sbxId: 'sbx_x',
    }),
  })
  assert.equal(kept, live)
  assert.equal(
    executionFromVerification(
      passedVerification({
        status: 'failed',
        url: 'https://ghost.e2b.dev',
        sbxId: 'sbx_ghost',
      }),
    ),
    undefined,
  )
  assert.equal(
    resolveReusablePreviewExecution({
      execution: undefined,
      finalVerification: passedVerification({
        status: 'failed',
        errors: ['Module not found: ./Missing'],
        url: 'https://ghost.e2b.dev',
        sbxId: 'sbx_ghost',
      }),
    }),
    undefined,
  )
}

// 6. Soft-accept style "passed" without url/sbx → unavailable (no fabricated URL)
{
  assert.equal(
    resolveReusablePreviewExecution({
      execution: undefined,
      finalVerification: {
        status: 'passed',
        filesWritten: false,
        dependenciesInstalled: 'not_required',
        processStarted: false,
        previewReachable: false,
        errors: [],
        warnings: ['Integrity recovered'],
        durationMs: 0,
      },
    }),
    undefined,
  )
}

console.log('preview-execution.test.ts: all tests passed')

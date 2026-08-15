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

console.log('preview-execution.test.ts: all tests passed')

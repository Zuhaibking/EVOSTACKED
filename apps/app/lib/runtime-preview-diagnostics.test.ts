/**
 * Runtime preview diagnostic helpers — zero network.
 */
import assert from 'node:assert/strict'
import {
  buildRuntimePreviewDiagnostic,
} from './runtime-preview-diagnostics'

{
  const d = buildRuntimePreviewDiagnostic({
    candidateId: 'rich',
    candidateLabel: 'Premium',
    verification: {
      status: 'failed',
      previewReachable: false,
      processStarted: true,
      errors: ['Module not found: ./Foo'],
      httpStatus: undefined,
    },
    execution: null,
    port: 3000,
  })
  assert.equal(d.candidateId, 'rich')
  assert.equal(d.hasExecutionUrl, false)
  assert.equal(d.runtimeStatus, 'failed')
  assert.match(d.runtimeError || '', /Module not found/)
  assert.equal(d.port, 3000)
  // Never embeds full secrets
  assert.doesNotMatch(JSON.stringify(d), /sk-|api[_-]?key/i)
}

{
  const d = buildRuntimePreviewDiagnostic({
    candidateId: 'minimal',
    candidateLabel: 'Product',
    verification: {
      status: 'passed',
      previewReachable: true,
      processStarted: true,
      url: 'https://abc123.e2b.dev',
    },
    execution: {
      sbxId: 'sbx_1',
      url: 'https://abc123.e2b.dev',
      template: 'nextjs-developer',
    },
    port: 3000,
  })
  assert.equal(d.hasExecution, true)
  assert.equal(d.hasExecutionUrl, true)
  assert.equal(d.executionUrlHost, 'abc123.e2b.dev')
  assert.equal(d.deploymentStatus, 'deployed')
}

console.log('runtime-preview-diagnostics.test.ts: all tests passed')

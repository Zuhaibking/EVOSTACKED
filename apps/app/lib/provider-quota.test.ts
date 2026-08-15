/**
 * Deterministic OpenAI quota / rate-limit tests — zero provider calls.
 * Run: npm run test:provider-quota
 */
import assert from 'node:assert/strict'
import {
  classifyProviderQuotaError,
  DAILY_LIMIT_USER_MESSAGE,
  planQuotaAbortForRemaining,
  providerBudgetLabel,
  quotaFailurePreservesSession,
  TPM_LIMIT_USER_MESSAGE,
} from './provider-quota'
import {
  isDailyRequestLimitError,
  PROVIDER_MAX_ATTEMPTS,
  withProviderRetry,
} from './provider-retry'
import {
  resolveCandidateIsolatedPreview,
  retainTournamentCandidates,
} from './tournament-candidates'
import type { Candidate } from './tournament-client'

function rateError(message: string, status = 429, extra: Record<string, any> = {}) {
  const err: any = new Error(message)
  err.statusCode = status
  Object.assign(err, extra)
  return err
}

const RPD_MSG =
  'Rate limit reached for gpt-4.1 on requests per day (RPD): Limit 50, Used 50, Requested 1.'
const TPM_MSG =
  'Rate limit reached for gpt-4.1 on tokens per min (TPM): Limit 10000, Used 10000, Requested 2000. Please try again in 20s.'

async function main() {
  const c1 = classifyProviderQuotaError(rateError(RPD_MSG))
  assert.equal(c1.kind, 'daily_limit')
  assert.equal(c1.budgetState, 'daily_limit_reached')
  assert.equal(c1.retryable, false)
  assert.equal(c1.abortTournament, true)
  assert.equal(c1.message, DAILY_LIMIT_USER_MESSAGE)
  assert.equal(providerBudgetLabel(c1.budgetState), 'DAILY LIMIT REACHED')
  assert.equal(isDailyRequestLimitError(rateError(RPD_MSG)), true)

  const c2 = classifyProviderQuotaError(rateError(TPM_MSG, 429, { retryAfter: 20 }))
  assert.equal(c2.kind, 'tpm')
  assert.equal(c2.budgetState, 'rate_limited')
  assert.equal(c2.retryable, true)
  assert.equal(c2.abortTournament, false)
  assert.equal(c2.message, TPM_LIMIT_USER_MESSAGE)
  assert.equal(c2.retryAfterMs, 20_000)
  assert.equal(providerBudgetLabel(c2.budgetState), 'RATE LIMITED')

  const c3 = classifyProviderQuotaError(
    rateError('Rate limit reached for gpt-4.1', 429, { retryAfter: 5 }),
  )
  assert.equal(c3.kind, 'temporary')
  assert.equal(c3.budgetState, 'temporarily_rate_limited')
  assert.equal(c3.retryable, true)
  assert.equal(providerBudgetLabel(c3.budgetState), 'TEMPORARILY RATE LIMITED')

  let calls = 0
  await assert.rejects(
    () =>
      withProviderRetry(async () => {
        calls += 1
        throw rateError(RPD_MSG)
      }),
    /requests per day|RPD|daily/i,
  )
  assert.equal(calls, 1)

  const sleeps: number[] = []
  calls = 0
  await assert.rejects(
    () =>
      withProviderRetry(
        async () => {
          calls += 1
          throw rateError(TPM_MSG, 429, { retryAfter: 2 })
        },
        { sleep: async (ms) => { sleeps.push(ms) } },
      ),
    /TPM|tokens per min/i,
  )
  assert.equal(calls, PROVIDER_MAX_ATTEMPTS)
  assert.equal(sleeps.length, PROVIDER_MAX_ATTEMPTS - 1)
  assert.ok(sleeps.every((ms) => ms === 2000))

  const abortPlan = planQuotaAbortForRemaining({
    classification: classifyProviderQuotaError(rateError(RPD_MSG)),
    failedId: 'rich',
    remainingIds: ['playful'],
  })
  assert.equal(abortPlan.abort, true)
  assert.deepEqual(abortPlan.skipIds, ['playful'])
  assert.match(abortPlan.message, /daily request limit/i)

  const tpmPlan = planQuotaAbortForRemaining({
    classification: classifyProviderQuotaError(rateError(TPM_MSG)),
    failedId: 'rich',
    remainingIds: ['playful'],
  })
  assert.equal(tpmPlan.abort, false)
  assert.deepEqual(tpmPlan.skipIds, [])

  const productUrl = 'https://3000-product.e2b.app'
  const product: Candidate = {
    id: 'minimal',
    label: 'Product',
    sigil: 'P',
    status: 'verified',
    fragment: {
      title: 'Product App',
      template: 'nextjs-developer',
      file_path: 'pages/index.tsx',
      code: [
        {
          file_path: 'pages/index.tsx',
          file_content: 'export default function H(){return <main>ok</main>}',
        },
      ],
    },
    finalVerification: {
      status: 'passed',
      filesWritten: true,
      dependenciesInstalled: true,
      processStarted: true,
      previewReachable: true,
      errors: [],
      warnings: [],
      durationMs: 1,
      sbxId: 'sbx_p',
      url: productUrl,
      template: 'nextjs-developer',
    },
    execution: { sbxId: 'sbx_p', url: productUrl, template: 'nextjs-developer' },
  }
  const retained = retainTournamentCandidates({
    minimal: product,
    rich: {
      id: 'rich',
      label: 'Premium',
      sigil: 'R',
      status: 'error',
      error: DAILY_LIMIT_USER_MESSAGE,
    },
    playful: {
      id: 'playful',
      label: 'Innovate',
      sigil: 'I',
      status: 'not_attempted',
      error: DAILY_LIMIT_USER_MESSAGE,
    },
  })
  assert.equal(Object.keys(retained).length, 3)
  assert.equal(retained.minimal.status, 'verified')
  assert.equal(retained.playful.status, 'not_attempted')
  const preview = resolveCandidateIsolatedPreview(retained.minimal)
  assert.equal(preview.available, true)
  assert.equal(
    preview.execution && 'url' in preview.execution && preview.execution.url,
    productUrl,
  )

  assert.equal(quotaFailurePreservesSession(rateError(RPD_MSG)), true)
  assert.equal(quotaFailurePreservesSession(rateError(TPM_MSG)), true)
  assert.equal(quotaFailurePreservesSession(new Error('schema boom')), false)

  const brain = { activeVersion: 3, activeCandidateId: 'minimal' as const }
  void classifyProviderQuotaError(rateError(RPD_MSG))
  assert.equal(brain.activeVersion, 3)
  assert.equal(brain.activeCandidateId, 'minimal')

  console.log('provider-quota.test.ts: all tests passed')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

/**
 * Smoke must not destroy healthy previews — zero provider / E2B.
 * Run: npm run test:candidate-smoke
 */
import assert from 'node:assert/strict'
import {
  applySmokeResultToCandidate,
  candidatePreviewIsHealthy,
} from './candidate-smoke'
import {
  candidateFailureReason,
  resolveCandidateIsolatedPreview,
  retainTournamentCandidates,
  previewsAreIsolated,
} from './tournament-candidates'
import type { Candidate } from './tournament-client'
import type { SmokeSuiteResult } from './smoke'

const productUrl = 'https://3000-product.e2b.app'
const premiumUrl = 'https://3000-premium.e2b.app'

function healthyCandidate(
  id: 'minimal' | 'rich' | 'playful',
  url: string,
): Candidate {
  return {
    id,
    label: id === 'minimal' ? 'Product' : id === 'rich' ? 'Premium' : 'Innovate',
    sigil: id[0].toUpperCase(),
    status: 'verified',
    fragment: {
      title: id,
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
      durationMs: 10_000,
      sbxId: `sbx_${id}`,
      url,
      template: 'nextjs-developer',
    },
    execution: {
      sbxId: `sbx_${id}`,
      url,
      template: 'nextjs-developer',
    },
  }
}

const smokeTimeout: SmokeSuiteResult = {
  status: 'timeout',
  tests: [
    {
      status: 'timeout',
      testName: 'Browse home',
      durationMs: 35_000,
      completedActions: 0,
      error: 'Test timeout',
    },
  ],
  durationMs: 90_000,
  summary: 'Smoke suite timed out',
}

const smokeFailed: SmokeSuiteResult = {
  status: 'failed',
  tests: [
    {
      status: 'failed',
      testName: 'Click CTA',
      durationMs: 2_000,
      completedActions: 1,
      error: 'Locator not found',
    },
  ],
  durationMs: 5_000,
  summary: '1/2 smoke tests failed',
}

// 1. Smoke timeout preserves execution URL
{
  const before = healthyCandidate('minimal', productUrl)
  assert.equal(candidatePreviewIsHealthy(before), true)
  const after = applySmokeResultToCandidate(before, smokeTimeout)
  assert.equal(after.status, 'tested')
  assert.equal(after.smoke?.status, 'timeout')
  assert.equal(
    after.execution && 'url' in after.execution && after.execution.url,
    productUrl,
  )
  assert.equal(after.fragment, before.fragment)
  assert.equal(after.finalVerification?.status, 'passed')
  // Soft diagnostic — do not overwrite error when preview healthy
  assert.equal(after.error, undefined)
  const preview = resolveCandidateIsolatedPreview(after)
  assert.equal(preview.available, true)
  assert.equal(
    preview.execution && 'url' in preview.execution && preview.execution.url,
    productUrl,
  )
}

// 2. Smoke failure with healthy runtime → still previewable; no failureReason gate
{
  const after = applySmokeResultToCandidate(
    healthyCandidate('rich', premiumUrl),
    smokeFailed,
  )
  assert.equal(after.status, 'tested')
  assert.equal(resolveCandidateIsolatedPreview(after).available, true)
  assert.equal(candidateFailureReason(after), undefined)
}

// 3. Candidate isolation: Product smoke fail does not touch Premium URL
{
  const product = applySmokeResultToCandidate(
    healthyCandidate('minimal', productUrl),
    smokeTimeout,
  )
  const premium = healthyCandidate('rich', premiumUrl)
  const retained = retainTournamentCandidates({
    minimal: product,
    rich: premium,
    playful: healthyCandidate('playful', 'https://3000-innovate.e2b.app'),
  })
  assert.equal(countKeys(retained), 3)
  assert.equal(
    retained.minimal.execution &&
      'url' in retained.minimal.execution &&
      retained.minimal.execution.url,
    productUrl,
  )
  assert.equal(
    retained.rich.execution &&
      'url' in retained.rich.execution &&
      retained.rich.execution.url,
    premiumUrl,
  )
  assert.ok(
    previewsAreIsolated(
      resolveCandidateIsolatedPreview(retained.minimal),
      resolveCandidateIsolatedPreview(retained.rich),
    ),
  )
}

// 4. Build/runtime failure stays isolated — other candidates keep URLs
{
  const failed: Candidate = {
    ...healthyCandidate('playful', 'https://dead.e2b.app'),
    finalVerification: {
      status: 'failed',
      filesWritten: false,
      dependenciesInstalled: 'not_required',
      processStarted: false,
      previewReachable: false,
      errors: ['Module not found'],
      warnings: [],
      durationMs: 100,
    },
    execution: undefined,
    status: 'verify_failed',
  }
  const retained = retainTournamentCandidates({
    minimal: healthyCandidate('minimal', productUrl),
    rich: healthyCandidate('rich', premiumUrl),
    playful: failed,
  })
  assert.equal(resolveCandidateIsolatedPreview(retained.minimal).available, true)
  assert.equal(resolveCandidateIsolatedPreview(retained.rich).available, true)
  assert.equal(resolveCandidateIsolatedPreview(retained.playful).available, false)
  assert.ok(retained.playful.fragment)
}

// 5. Smoke failure without a preview URL remains a hard smoke_failed
{
  const bare: Candidate = {
    id: 'minimal',
    label: 'Product',
    sigil: 'P',
    status: 'verified',
    fragment: {
      title: 'x',
      template: 'nextjs-developer',
      file_path: 'pages/index.tsx',
      code: [
        {
          file_path: 'pages/index.tsx',
          file_content: 'export default function H(){return <main/>}',
        },
      ],
    },
    finalVerification: {
      status: 'failed',
      filesWritten: false,
      dependenciesInstalled: 'not_required',
      processStarted: false,
      previewReachable: false,
      errors: ['Module not found: ./Missing'],
      warnings: [],
      durationMs: 10,
    },
    execution: undefined,
  }
  const after = applySmokeResultToCandidate(bare, smokeFailed)
  assert.equal(after.status, 'smoke_failed')
  assert.match(after.error || '', /Locator not found|smoke/i)
  assert.equal(resolveCandidateIsolatedPreview(after).available, false)
}

{
  const overlay = healthyCandidate('minimal', productUrl)
  overlay.finalVerification = {
    ...overlay.finalVerification!,
    status: 'partial',
    previewReachable: false,
    errors: [
      "Parsing ecmascript source code failed Unexpected token 'section'. Expected jsx identifier",
    ],
  }
  assert.equal(candidatePreviewIsHealthy(overlay), false)
}

{
  const hydration = healthyCandidate('rich', productUrl)
  hydration.finalVerification = {
    ...hydration.finalVerification!,
    status: 'partial',
    previewReachable: false,
    errors: [
      'Expected server HTML to contain a matching <a> in <a>. Hydration failed because the initial UI does not match what was rendered on the server.',
    ],
  }
  assert.equal(candidatePreviewIsHealthy(hydration), false)
}

function countKeys(o: object): number {
  return Object.keys(o).length
}

console.log('candidate-smoke.test.ts: all tests passed')

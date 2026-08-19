/**
 * Deterministic tournament retention + Preview isolation tests.
 * Run: npm run test:tournament-candidates
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  buildRetentionReport,
  canActivateCandidate,
  candidateFailureReason,
  countRetainedCandidates,
  pickInspectableCandidateId,
  previewsAreIsolated,
  recommendedFromVerdict,
  resolveCandidateIsolatedPreview,
  retainTournamentCandidates,
  smokeScoreLabel,
  TOURNAMENT_CANDIDATE_COUNT,
} from './tournament-candidates'
import { applySmokeResultToCandidate } from './candidate-smoke'
import { INITIAL_TOURNAMENT_CANDIDATE_COUNT, ITERATION_CANDIDATE_COUNT } from './evolution'
import { buildDeterministicTournamentVerdict } from './deterministic-verdict'
import {
  assertConcurrentGenerationPolicy,
  buildCandidateGenerationQueue,
  runParallelCandidateJobs,
} from './tournament-generation'
import type { Candidate } from './tournament-client'
import { VARIANTS, type VariantId } from './tournament'
import type { ExecutionResult } from './types'
import type { VerificationResult } from './verification'
import type { SmokeSuiteResult } from './smoke'
import { buildCandidateRecordData } from './tournament-candidate-record'

function frag(title: string) {
  return {
    title,
    template: 'nextjs-developer',
    file_path: 'pages/index.tsx',
    commentary: title,
    description: title,
    architecture: 'local',
    additional_dependencies: [] as string[],
    has_additional_dependencies: false,
    install_dependencies_command: '',
    port: 3000,
    code: [
      {
        file_path: 'pages/index.tsx',
        file_content: `export default function Page(){ return <main>${title}</main> }`,
      },
    ],
  }
}

function passed(url: string): VerificationResult {
  return {
    status: 'passed',
    filesWritten: true,
    dependenciesInstalled: true,
    processStarted: true,
    previewReachable: true,
    errors: [],
    warnings: [],
    durationMs: 50,
    sbxId: `sbx_${url}`,
    url,
    template: 'nextjs-developer',
  }
}

function failedRuntime(): VerificationResult {
  return {
    status: 'failed',
    filesWritten: true,
    dependenciesInstalled: true,
    processStarted: false,
    previewReachable: false,
    errors: ['boot failed'],
    warnings: [],
    durationMs: 40,
  }
}

function smokeFail(): SmokeSuiteResult {
  return {
    status: 'failed',
    tests: [
      {
        status: 'passed',
        testName: 'load',
        durationMs: 10,
        completedActions: 1,
      },
      {
        status: 'failed',
        testName: 'click',
        durationMs: 10,
        completedActions: 0,
        error: 'timeout',
      },
      {
        status: 'failed',
        testName: 'nav',
        durationMs: 10,
        completedActions: 0,
        error: 'missing',
      },
      {
        status: 'failed',
        testName: 'form',
        durationMs: 10,
        completedActions: 0,
        error: 'missing',
      },
    ],
    durationMs: 40,
    summary: '1/4 smoke tests passed',
  }
}

function baseCandidate(
  id: VariantId,
  extra: Partial<Candidate> = {},
): Candidate {
  const v = VARIANTS.find((x) => x.id === id)!
  return {
    id,
    label: v.label,
    sigil: v.sigil,
    status: 'tested',
    fragment: frag(v.label),
    ...extra,
  }
}

const productUrl = 'https://product.e2b.dev'
const premiumUrl = 'https://premium.e2b.dev'
const innovateUrl = 'https://innovate.e2b.dev'

function fullTournament(): Record<VariantId, Candidate> {
  return {
    minimal: baseCandidate('minimal', {
      finalVerification: passed(productUrl),
      execution: {
        sbxId: 'sbx_p',
        url: productUrl,
        template: 'nextjs-developer',
      } as ExecutionResult,
      smoke: {
        status: 'passed',
        tests: [
          { status: 'passed', testName: 'a', durationMs: 1, completedActions: 1 },
          { status: 'passed', testName: 'b', durationMs: 1, completedActions: 1 },
          { status: 'passed', testName: 'c', durationMs: 1, completedActions: 1 },
          { status: 'failed', testName: 'd', durationMs: 1, completedActions: 0 },
        ],
        durationMs: 10,
        summary: '3/4',
      },
      scoreComposite: 0.82,
      isWinner: true,
    }),
    rich: baseCandidate('rich', {
      finalVerification: passed(premiumUrl),
      execution: {
        sbxId: 'sbx_r',
        url: premiumUrl,
        template: 'nextjs-developer',
      } as ExecutionResult,
      smoke: smokeFail(),
      scoreComposite: 0.68,
    }),
    playful: baseCandidate('playful', {
      status: 'verify_failed',
      finalVerification: failedRuntime(),
      smoke: null,
      scoreComposite: 0,
      error: 'boot failed',
    }),
  }
}

// 1. Initial tournament always retains exactly 3 candidate records
{
  assert.equal(TOURNAMENT_CANDIDATE_COUNT, 3)
  assert.equal(INITIAL_TOURNAMENT_CANDIDATE_COUNT, 3)
  assert.equal(VARIANTS.length, 3)
  const retained = retainTournamentCandidates(fullTournament())
  assert.equal(countRetainedCandidates(retained), 3)
  assert.deepEqual(
    Object.keys(retained).sort(),
    ['minimal', 'playful', 'rich'],
  )
  assert.equal(pickInspectableCandidateId(retained), 'minimal')
  assert.equal(
    pickInspectableCandidateId({
      minimal: { ...retained.minimal, status: 'generating' },
      rich: retained.rich,
    }),
    'rich',
  )
}

// 2. Candidate A can fail smoke and still remain
{
  const t = fullTournament()
  t.minimal = {
    ...t.minimal,
    smoke: smokeFail(),
    status: 'smoke_failed',
    isWinner: false,
  }
  const report = buildRetentionReport(t)
  const product = report.candidates.find((c) => c.id === 'minimal')!
  assert.equal(product.hasArtifact, true)
  assert.equal(smokeScoreLabel(t.minimal.smoke), '1/4')
  assert.equal(report.candidates.length, 3)
}

// 3. Candidate B can fail runtime and still remain
{
  const t = fullTournament()
  t.rich = {
    ...t.rich,
    status: 'verify_failed',
    finalVerification: failedRuntime(),
    execution: undefined,
    error: 'runtime down',
  }
  const report = buildRetentionReport(t)
  assert.equal(report.candidates.find((c) => c.id === 'rich')?.hasArtifact, true)
  assert.equal(report.candidates.find((c) => c.id === 'rich')?.runtime, 'Failed')
  assert.equal(countRetainedCandidates(t), 3)
}

// 4. Candidate C can fail judge and still remain
{
  const t = fullTournament()
  t.playful = {
    ...t.playful,
    scoreComposite: 0,
    scoreComment: 'unreliable',
    isWinner: false,
    finalVerification: passed(innovateUrl),
    execution: {
      sbxId: 'sbx_i',
      url: innovateUrl,
      template: 'nextjs-developer',
    },
    status: 'tested',
    fragment: frag('Innovate'),
  }
  const report = buildRetentionReport(t, { recommendedWinnerId: 'minimal' })
  const innovate = report.candidates.find((c) => c.id === 'playful')!
  assert.equal(innovate.judgeScore, 0)
  assert.equal(innovate.hasArtifact, true)
  assert.equal(innovate.isRecommended, false)
}

// 5. Candidate source remains available after failure
{
  const t = fullTournament()
  assert.ok(t.playful.fragment)
  assert.equal(
    canActivateCandidate(t.playful).ok,
    true,
  )
  assert.match(
    canActivateCandidate(t.playful).reason || '',
    /Preview is unavailable|Runtime failed/i,
  )
}

// 6. A valid candidate execution produces its own Preview URL
{
  const preview = resolveCandidateIsolatedPreview(fullTournament().minimal)
  assert.equal(preview.available, true)
  assert.equal(preview.candidateId, 'minimal')
  assert.ok(preview.execution && 'url' in preview.execution)
  assert.equal(preview.execution.url, productUrl)
}

// 7–8. Preview Product never loads Premium's execution (and vice versa)
{
  const product = resolveCandidateIsolatedPreview(fullTournament().minimal)
  const premium = resolveCandidateIsolatedPreview(fullTournament().rich)
  assert.equal(product.execution && 'url' in product.execution && product.execution.url, productUrl)
  assert.equal(premium.execution && 'url' in premium.execution && premium.execution.url, premiumUrl)
  assert.ok(previewsAreIsolated(product, premium))
  assert.notEqual(
    product.execution && 'url' in product.execution ? product.execution.url : null,
    premium.execution && 'url' in premium.execution ? premium.execution.url : null,
  )
}

// 9–11. User can select Product / Premium / Innovate when artifact usable
{
  const t = fullTournament()
  assert.equal(canActivateCandidate(t.minimal).ok, true)
  assert.equal(canActivateCandidate(t.rich).ok, true)
  // Innovate has fragment despite runtime failure — still selectable
  assert.equal(canActivateCandidate(t.playful).ok, true)

  const innovateOk = baseCandidate('playful', {
    finalVerification: passed(innovateUrl),
    execution: {
      sbxId: 'sbx_i',
      url: innovateUrl,
      template: 'nextjs-developer',
    },
  })
  assert.equal(canActivateCandidate(innovateOk).ok, true)
  const innovatePreview = resolveCandidateIsolatedPreview(innovateOk)
  assert.equal(innovatePreview.available, true)
  assert.ok(innovatePreview.execution && 'url' in innovatePreview.execution)
  assert.equal(
    (innovatePreview.execution as { url: string }).url,
    innovateUrl,
  )
}

// 12. activeVersion remains null before selection
{
  const report = buildRetentionReport(fullTournament(), {
    recommendedWinnerId: 'minimal',
    activeCandidateId: null,
  })
  assert.equal(report.activeCandidate, null)
  assert.ok(report.candidates.every((c) => !c.isActive))
}

// 13. No candidate is automatically promoted
{
  const report = buildRetentionReport(fullTournament(), {
    recommendedWinnerId: 'minimal',
  })
  assert.equal(report.activeCandidate, null)
  const recommended = report.candidates.filter((c) => c.isRecommended)
  assert.equal(recommended.length, 1)
  assert.equal(recommended[0].id, 'minimal')
  assert.equal(recommended[0].isActive, false)
}

// 14. Judge winner is only marked as recommended
{
  assert.equal(
    recommendedFromVerdict({
      winnerId: 'rich',
      reasoning: 'best craft',
      scores: [],
    }),
    'rich',
  )
  const report = buildRetentionReport(fullTournament(), {
    recommendedWinnerId: 'rich',
    activeCandidateId: null,
  })
  assert.equal(report.recommendedWinner, 'rich')
  assert.equal(report.activeCandidate, null)
}

// 15. Failed / missing candidates are still visible (no fake "failed" invent)
{
  const partial = retainTournamentCandidates({
    minimal: fullTournament().minimal,
    // rich missing → pending slot, not invented failure
    playful: fullTournament().playful,
  })
  assert.equal(countRetainedCandidates(partial), 3)
  assert.equal(partial.rich.status, 'pending')
  assert.equal(partial.rich.error, undefined)
  const report = buildRetentionReport(partial)
  assert.equal(report.candidates.length, 3)
  assert.ok(report.candidates.every((c) => c.label.length > 0))
}

// 16. Existing single-candidate Improve flow remains unchanged
{
  assert.equal(ITERATION_CANDIDATE_COUNT, 1)
  assert.equal(INITIAL_TOURNAMENT_CANDIDATE_COUNT, 3)
}

// 17. Version Vault behavior remains unchanged (retention helpers don't touch vault)
{
  // Sanity: retention module does not import version-vault (no coupling).
  const src = fs.readFileSync(
    path.join(__dirname, 'tournament-candidates.ts'),
    'utf8',
  )
  assert.doesNotMatch(src, /version-vault/)
  assert.doesNotMatch(src, /\bfetch\s*\(/)
  assert.doesNotMatch(src, /@e2b/)
}

{
  const switcher = fs.readFileSync(
    path.join(process.cwd(), 'components/candidate-switcher.tsx'),
    'utf8',
  )
  assert.match(switcher, /stackLabel/)
  assert.match(switcher, /stackLabelForTemplate/)
  const picker = fs.readFileSync(
    path.join(process.cwd(), 'components/active-version-picker.tsx'),
    'utf8',
  )
  assert.match(picker, /stackLabel/)
}

{
  const row = buildCandidateRecordData({
    id: 'minimal',
    status: 'generating',
    template: 'streamlit-developer',
    stackLabel: 'Streamlit',
  })
  assert.equal(row.template, 'streamlit-developer')
  assert.equal(row.stackLabel, 'Streamlit')
  const fromFrag = buildCandidateRecordData({
    id: 'rich',
    status: 'error',
    fragment: { template: 'vue-developer' },
  })
  assert.equal(fromFrag.template, 'vue-developer')
  assert.equal(fromFrag.stackLabel, 'Vue/Nuxt')
  const repeat = buildCandidateRecordData({
    id: 'playful',
    status: 'generating',
    template: 'nextjs-developer',
    stackLabel: 'Next.js (repeat)',
  })
  assert.equal(repeat.stackLabel, 'Next.js (repeat)')
}

// Failed runtime preview is unavailable but candidate retained — real error shown
{
  const preview = resolveCandidateIsolatedPreview(fullTournament().playful)
  assert.equal(preview.available, false)
  assert.match(preview.reason || '', /boot failed/i)
  assert.equal(preview.execution, undefined)
  // Candidate still retained with source
  assert.ok(fullTournament().playful.fragment)
}

// URL survives retention / archive copy
{
  const retained = retainTournamentCandidates(fullTournament())
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
  // Failed Innovate still present, no fabricated URL
  assert.equal(retained.playful.execution, undefined)
  assert.equal(countRetainedCandidates(retained), 3)
}

// Soft-accept style passed-without-url → unavailable (no fake URL)
{
  const soft = baseCandidate('rich', {
    status: 'repaired',
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
    execution: undefined,
  })
  const preview = resolveCandidateIsolatedPreview(soft)
  assert.equal(preview.available, false)
  assert.equal(preview.execution, undefined)
}

// Partial + execution.url → preview available (isolated)
{
  const partial = baseCandidate('minimal', {
    finalVerification: {
      status: 'partial',
      filesWritten: true,
      dependenciesInstalled: true,
      processStarted: true,
      previewReachable: false,
      errors: [],
      warnings: ['readiness timed out'],
      durationMs: 60_000,
      sbxId: 'sbx_p',
      url: productUrl,
      template: 'nextjs-developer',
    },
    execution: {
      sbxId: 'sbx_p',
      url: productUrl,
      template: 'nextjs-developer',
    },
  })
  const preview = resolveCandidateIsolatedPreview(partial)
  assert.equal(preview.available, true)
  assert.equal(
    preview.execution && 'url' in preview.execution && preview.execution.url,
    productUrl,
  )
}

// Concurrent queue: Product → Premium → Innovate start together
{
  const policy = assertConcurrentGenerationPolicy()
  assert.equal(policy.concurrent, true)
  assert.equal(policy.queueSize, 3)
  assert.ok(policy.maxAttemptsPerCandidate >= 3)
  const queue = buildCandidateGenerationQueue()
  assert.deepEqual(
    queue.map((q) => q.id),
    ['minimal', 'rich', 'playful'],
  )
}

// Deterministic verdict never auto-promotes activeCandidate
{
  const verdict = buildDeterministicTournamentVerdict(
    Object.values(fullTournament()).map((c) => ({
      id: c.id,
      fragment: c.fragment,
      finalVerification: c.finalVerification,
      architectureCompliance: c.architectureCompliance,
      smoke: c.smoke,
    })),
  )
  assert.ok(verdict.winnerId)
  assert.equal(verdict.scores.length, 3)
  assert.match(verdict.reasoning, /you choose/i)
  const report = buildRetentionReport(fullTournament(), {
    recommendedWinnerId: verdict.winnerId,
    activeCandidateId: null,
  })
  assert.equal(report.activeCandidate, null)
}

// Smoke timeout must NOT hide a healthy preview or wipe URL
{
  const c = baseCandidate('minimal', {
    status: 'verified',
    finalVerification: {
      status: 'passed',
      filesWritten: true,
      dependenciesInstalled: true,
      processStarted: true,
      previewReachable: true,
      errors: [],
      warnings: [],
      durationMs: 12_000,
      sbxId: 'sbx_m',
      url: productUrl,
      template: 'nextjs-developer',
    },
    execution: {
      sbxId: 'sbx_m',
      url: productUrl,
      template: 'nextjs-developer',
    },
  })
  const after = applySmokeResultToCandidate(c, {
    status: 'timeout',
    tests: [
      {
        status: 'timeout',
        testName: 'home',
        durationMs: 35_000,
        completedActions: 0,
        error: 'timeout',
      },
    ],
    durationMs: 90_000,
    summary: 'timed out',
  })
  assert.equal(resolveCandidateIsolatedPreview(after).available, true)
  assert.equal(candidateFailureReason(after), undefined)
  assert.equal(
    after.execution && 'url' in after.execution && after.execution.url,
    productUrl,
  )
}

// Failed verification with a live host URL → preview stays available
{
  const compileFail = baseCandidate('minimal', {
    status: 'verify_failed',
    finalVerification: {
      status: 'failed',
      filesWritten: true,
      dependenciesInstalled: true,
      processStarted: true,
      previewReachable: false,
      errors: [
        'styles/globals.css:1785: @import rules must precede all rules aside from @charset and @layer statements.',
      ],
      warnings: [],
      durationMs: 8_000,
      sbxId: 'sbx_css',
      url: productUrl,
      template: 'nextjs-developer',
    },
    execution: {
      sbxId: 'sbx_css',
      url: productUrl,
      template: 'nextjs-developer',
    },
  })
  const preview = resolveCandidateIsolatedPreview(compileFail)
  assert.equal(preview.available, true)
  assert.equal(
    preview.execution && 'url' in preview.execution && preview.execution.url,
    productUrl,
  )
}

// One CSS-failed candidate does not destroy sibling preview URLs
{
  const product = baseCandidate('minimal', {
    status: 'verify_failed',
    finalVerification: {
      status: 'failed',
      filesWritten: true,
      dependenciesInstalled: true,
      processStarted: false,
      previewReachable: false,
      errors: ['styles/globals.css:12: @import after CSS rules'],
      warnings: [],
      durationMs: 20,
    },
    execution: undefined,
  })
  const premium = baseCandidate('rich', {
    finalVerification: passed(premiumUrl),
    execution: {
      sbxId: 'sbx_prem',
      url: premiumUrl,
      template: 'nextjs-developer',
    },
  })
  const innovate = baseCandidate('playful', {
    finalVerification: passed(innovateUrl),
    execution: {
      sbxId: 'sbx_inn',
      url: innovateUrl,
      template: 'nextjs-developer',
    },
  })
  const retained = retainTournamentCandidates({
    minimal: product,
    rich: premium,
    playful: innovate,
  })
  assert.equal(countRetainedCandidates(retained), 3)
  assert.equal(resolveCandidateIsolatedPreview(retained.minimal).available, false)
  const premiumPreview = resolveCandidateIsolatedPreview(retained.rich)
  const innovatePreview = resolveCandidateIsolatedPreview(retained.playful)
  assert.equal(
    premiumPreview.execution && 'url' in premiumPreview.execution
      ? premiumPreview.execution.url
      : undefined,
    premiumUrl,
  )
  assert.equal(
    innovatePreview.execution && 'url' in innovatePreview.execution
      ? innovatePreview.execution.url
      : undefined,
    innovateUrl,
  )
  assert.ok(
    previewsAreIsolated(
      resolveCandidateIsolatedPreview(retained.rich),
      resolveCandidateIsolatedPreview(retained.playful),
    ),
  )
}

async function assertParallelRunner() {
  const queue = buildCandidateGenerationQueue()
  const events: string[] = []
  const results = await runParallelCandidateJobs(queue, async (item) => {
    events.push(`start:${item.id}`)
    await Promise.resolve()
    events.push(`end:${item.id}`)
    if (item.id === 'rich') {
      throw new Error('premium isolated failure')
    }
    return item.id
  })

  const firstEnd = events.findIndex((e) => e.startsWith('end:'))
  const starts = events.filter((e) => e.startsWith('start:'))
  assert.equal(starts.length, 3)
  assert.ok(
    firstEnd >= 3,
    'all jobs must start before any completes',
  )
  assert.deepEqual(
    starts,
    ['start:minimal', 'start:rich', 'start:playful'],
  )

  const values = results.filter((r) => r.ok).map((r) => r.value)
  const failures = results.filter((r) => !r.ok)
  assert.equal(failures.length, 1)
  assert.equal(failures[0]?.item.id, 'rich')
  assert.deepEqual(values, ['minimal', 'playful'])
}

assertParallelRunner()
  .then(() => {
    console.log('tournament-candidates.test.ts: all tests passed')
  })
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })

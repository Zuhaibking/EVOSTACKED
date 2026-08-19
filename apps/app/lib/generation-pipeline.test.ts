/**
 * Generation pipeline policy tests — zero provider / E2B / paid runs.
 * Run: npm run test:generation-pipeline
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { applySmokeResultToCandidate } from './candidate-smoke'
import { resolveInstallCommand } from './dependency-closure'
import {
  canDeployIntegrity,
  validateFragmentIntegrity,
} from './fragment-integrity'
import { runGeneratedProjectPreflight } from './prepare-fragment-integrity'
import {
  hasGenuineRuntimeFailure,
  selectRepairReason,
  shouldAttemptRepair,
} from './repair'
import { isInfrastructureRuntimeFailure } from './sandbox-transport'
import {
  assertConcurrentGenerationPolicy,
  assignDiverseTemplates,
  buildCandidateGenerationQueue,
  catalogLooksLikeAuto,
  runParallelCandidateJobs,
} from './tournament-generation'
import templates, { getTemplateId } from './templates'
import { VARIANTS } from './tournament'
import { stablePromptHash } from './llm-cache'
import type { VerificationResult } from './verification'

type FragmentFile = { file_path: string; file_content: string }

function failed(
  errors: string[],
  extra: Partial<VerificationResult> = {},
): VerificationResult {
  return {
    status: 'failed',
    filesWritten: true,
    dependenciesInstalled: false,
    processStarted: false,
    previewReachable: false,
    errors,
    warnings: [],
    durationMs: 40,
    ...extra,
  }
}

function passed(): VerificationResult {
  return {
    status: 'passed',
    filesWritten: true,
    dependenciesInstalled: true,
    processStarted: true,
    previewReachable: true,
    errors: [],
    warnings: [],
    durationMs: 800,
    url: 'https://3000-product.e2b.app',
    sbxId: 'sbx_ok',
  }
}

function nextFrag(code: FragmentFile[]) {
  return {
    commentary: 't',
    template: 'nextjs-developer',
    title: 'T',
    description: 't',
    architecture: 'pages',
    additional_dependencies: [] as string[],
    has_additional_dependencies: false,
    install_dependencies_command: '',
    port: 3000,
    file_path: 'pages/index.tsx',
    code,
  }
}

async function main() {
  {
    const policy = assertConcurrentGenerationPolicy()
    assert.equal(policy.concurrent, true)
    assert.equal(policy.queueSize, 3)
    assert.equal(VARIANTS.length, 3)
    const queue = buildCandidateGenerationQueue()
    assert.deepEqual(
      queue.map((q) => q.id),
      ['minimal', 'rich', 'playful'],
    )
    assert.deepEqual(
      queue.map((q) => q.label),
      ['Product', 'Premium', 'Innovate'],
    )
  }

  {
    const queue = buildCandidateGenerationQueue()
    const started: string[] = []
    const results = await runParallelCandidateJobs(queue, async (item) => {
      started.push(item.id)
      if (item.id === 'rich') throw new Error('Premium isolated failure')
      return item.label
    })
    assert.deepEqual(started, ['minimal', 'rich', 'playful'])
    assert.equal(results.filter((r) => r.ok).length, 2)
    assert.equal(results.filter((r) => !r.ok).length, 1)
    assert.equal(results.find((r) => !r.ok)?.item.id, 'rich')
    assert.deepEqual(
      results.filter((r) => r.ok).map((r) => (r.ok ? r.value : null)),
      ['Product', 'Innovate'],
    )
  }

  {
    assert.equal(
      shouldAttemptRepair({
        repairAttempts: 0,
        verification: failed(['Module not found: recharts']),
      }),
      true,
    )
    assert.equal(
      shouldAttemptRepair({
        repairAttempts: 0,
        verification: passed(),
      }),
      false,
    )
    assert.equal(
      shouldAttemptRepair({
        repairAttempts: 0,
        integrity: validateFragmentIntegrity(
          nextFrag([
            {
              file_path: 'pages/index.tsx',
              file_content:
                "import Missing from '../components/Missing'\nexport default function H(){return <Missing/>}",
            },
          ]),
        ),
      }),
      false,
    )
  }

  {
    const infra = failed([
      'E2B_API_KEY is missing from the API process. Sandbox create skipped.',
    ])
    assert.equal(isInfrastructureRuntimeFailure(infra.errors), true)
    assert.equal(hasGenuineRuntimeFailure(infra), false)
    assert.equal(
      shouldAttemptRepair({ repairAttempts: 0, verification: infra }),
      false,
    )
    const dns = failed(['fetch failed · code=ENOTFOUND · getaddrinfo'])
    assert.equal(isInfrastructureRuntimeFailure(dns.errors), true)
    assert.equal(
      shouldAttemptRepair({ repairAttempts: 0, verification: dns }),
      false,
    )
  }

  {
    const timeout = applySmokeResultToCandidate(
      {
        status: 'verified',
        fragment: nextFrag([
          {
            file_path: 'pages/index.tsx',
            file_content: 'export default function H(){return <main>ok</main>}',
          },
        ]),
        finalVerification: passed(),
        execution: {
          sbxId: 'sbx_ok',
          url: 'https://3000-product.e2b.app',
          template: 'nextjs-developer',
        },
      },
      {
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
      },
    )
    assert.equal(timeout.status, 'tested')
    assert.notEqual(timeout.status, 'smoke_failed')
    assert.equal(timeout.finalVerification?.status, 'passed')
    assert.equal(
      timeout.execution && 'url' in timeout.execution && timeout.execution.url,
      'https://3000-product.e2b.app',
    )
  }

  {
    const hydration = validateFragmentIntegrity(
      nextFrag([
        {
          file_path: 'pages/index.tsx',
          file_content: `import { useState } from 'react'
export default function Home(){
  const [left] = useState(Date.now())
  return <main>{left}</main>
}`,
        },
      ]),
    )
    assert.ok(hydration.issues.some((i) => i.code === 'hydration_risk'))
    assert.equal(canDeployIntegrity(hydration), true)
    assert.equal(
      shouldAttemptRepair({
        repairAttempts: 0,
        integrity: hydration,
        verification: passed(),
      }),
      false,
    )
  }

  {
    const missingPkg = validateFragmentIntegrity(
      nextFrag([
        {
          file_path: 'pages/index.tsx',
          file_content:
            "import bcrypt from 'bcryptjs'\nexport default function H(){return null}",
        },
      ]),
    )
    assert.ok(missingPkg.issues.some((i) => i.code === 'missing_npm_dependency'))
    assert.equal(canDeployIntegrity(missingPkg), true)
    const pre = runGeneratedProjectPreflight(
      nextFrag([
        {
          file_path: 'pages/index.tsx',
          file_content:
            "import bcrypt from 'bcryptjs'\nexport default function H(){return null}",
        },
      ]),
    )
    assert.ok(pre.fragment.additional_dependencies.includes('bcryptjs'))
    assert.match(resolveInstallCommand(pre.fragment), /bcryptjs/)
  }

  {
    const overlay = failed(
      [
        "pages/index.tsx:5 Parsing ecmascript source code failed Unexpected token 'section'",
      ],
      { status: 'partial', processStarted: true },
    )
    assert.equal(hasGenuineRuntimeFailure(overlay), true)
    assert.equal(selectRepairReason({ verification: overlay }), 'runtime')
  }

  {
    const useful = "Module not found: Can't resolve ./Classes"
    assert.equal(
      shouldAttemptRepair({
        repairAttempts: 0,
        verification: failed([useful]),
      }),
      true,
    )
    assert.doesNotMatch(useful, /Could not recover/)
  }

  {
    const route = fs.readFileSync(
      path.join(process.cwd(), '../api/src/generation/tournament.runner.ts'),
      'utf8',
    )
    assert.match(route, /buildCandidateGenerationQueue/)
    assert.match(route, /Promise\.all/)
    assert.match(route, /deployAndVerify/)
    assert.match(route, /repairAndReverify/)
    assert.doesNotMatch(route, /repairFragmentIntegrity/)
    assert.doesNotMatch(route, /canDeployIntegrity/)
    assert.doesNotMatch(route, /Could not recover this candidate/)
    assert.match(route, /shouldAttemptRepair/)
    assert.match(route, /shouldSmokeTest/)
    assert.match(route, /variantsToGenerate = isSingleIteration/)
    assert.match(route, /candidate_start/)
    assert.match(route, /one failure never cancels siblings/)
    assert.match(route, /formatMemoryForPrompt/)
    assert.match(route, /readLlmCache/)
    assert.match(route, /assignDiverseTemplates/)
    assert.match(route, /stack-advisor|adviseStacks|prompt: brief/)
    assert.match(route, /persistCandidateRow/)
    assert.match(route, /stackLabel/)
    assert.match(route, /previewUrl/)
    assert.match(route, /readProviderUsage/)
    assert.match(route, /compactRepairNotes/)
  }

  {
    assert.equal(catalogLooksLikeAuto(templates), true)
    const assigned = assignDiverseTemplates({
      catalog: templates,
      variantIds: ['minimal', 'rich', 'playful'],
      prompt: 'A personal budget tracker',
    })
    const ids = VARIANTS.map((v) => getTemplateId(assigned[v.id].id))
    assert.equal(new Set(ids).size, 3)
    assert.deepEqual(ids.sort(), [
      'nextjs-developer',
      'streamlit-developer',
      'vue-developer',
    ])
    assert.ok(assigned.minimal.stackLabel)
    assert.equal(Object.keys(assigned.minimal.catalog).length, 1)
    const single = assignDiverseTemplates({
      catalog: {
        [Object.keys(templates)[0]]: templates[Object.keys(templates)[0] as keyof typeof templates],
      } as typeof templates,
      variantIds: ['minimal', 'rich', 'playful'],
    })
    assert.equal(single.minimal.id, single.rich.id)
    assert.equal(single.rich.id, single.playful.id)

    const webOnly = assignDiverseTemplates({
      catalog: templates,
      variantIds: ['minimal', 'rich', 'playful'],
      plan: {
        applicationType: 'CRM',
        architectureRequirements: {
          backend: { required: true },
          database: { required: true },
          authentication: { required: true },
        },
      } as any,
    })
    const webIds = VARIANTS.map((v) => getTemplateId(webOnly[v.id].id))
    assert.ok(webIds.every((id) => id === 'nextjs-developer' || id === 'vue-developer'))
    assert.ok(new Set(webIds).size >= 1)
    assert.ok(new Set(webIds).size <= 2)
  }

  {
    const a = stablePromptHash({
      kind: 'application_plan',
      model: 'nvidia:x',
      temperature: 0.2,
      brief: 'hello',
    })
    const b = stablePromptHash({
      kind: 'application_plan',
      model: 'nvidia:x',
      temperature: 0.2,
      brief: 'hello',
    })
    const c = stablePromptHash({
      kind: 'application_plan',
      model: 'nvidia:x',
      temperature: 0.7,
      brief: 'hello',
    })
    assert.equal(a, b)
    assert.notEqual(a, c)
    assert.equal(a.length, 32)
  }

  console.log('generation-pipeline.test.ts: all tests passed')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

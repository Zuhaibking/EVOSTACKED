/**
 * Model benchmark harness.
 *
 * Runs the REAL generation path (same system prompt, same schema, same token
 * budget) across a set of models and scores the output with the deterministic
 * checkers the tournament already uses. No LLM judge — the score is reproducible.
 *
 * The plan is generated once and shared by every model so the only variable is
 * the generation model itself.
 *
 * Deploy (E2B) is opt-in: a dry run costs LLM tokens only.
 */
import {
  checkArchitectureCompliance,
  type ArchitectureComplianceResult,
} from '@/lib/architecture-compliance'
import { costUsd, ratesForModel, readProviderUsage } from '@/lib/generation-cost'
import { validateFragmentIntegrity } from '@/lib/fragment-integrity'
import { withGenerationTokenBudget } from '@/lib/generation-budget'
import {
  findCatalogModel,
  type LLMModel,
  type LLMModelConfig,
} from '@/lib/model-catalog'
import { getModelClient } from '@/lib/models'
import {
  applicationPlanSchema,
  normalizeApplicationPlan,
  PLANNING_SYSTEM_PROMPT,
  type ApplicationPlan,
} from '@/lib/plan'
import { buildGenerationPrompt } from '@/lib/prompt'
import { fragmentSchema, type FragmentSchema } from '@/lib/schema'
import { classifyAppStack } from '@/lib/stack-advisor'
import templates, { type Templates } from '@/lib/templates'
import { deployAndVerify } from '@/lib/verify-candidate'
import type { VerificationResult } from '@/lib/verification'
import { generateObject, type LanguageModel } from 'ai'

export type BenchmarkTask = {
  id: string
  brief: string
  /** Restricts the template catalog so stacks stay comparable across models. */
  templateId?: string
}

/**
 * A provider with a bad key can accept the socket and never answer. Without a
 * deadline one dead model hangs the whole sweep, so every call gets one.
 */
export const BENCHMARK_TIMEOUT_MS = 180_000

/** Representative briefs, one per stack kind the advisor knows about. */
export const DEFAULT_SUITE: BenchmarkTask[] = [
  {
    id: 'landing',
    brief:
      'A landing page for a bank-grade expense tracking app for Indian freelancers. Pricing, testimonials, and a waitlist form.',
    templateId: 'nextjs-developer',
  },
  {
    id: 'dashboard',
    brief:
      'An analytics dashboard for a delivery fleet: live order volume, driver utilisation, late-delivery breakdown by city, and a sortable driver table.',
    templateId: 'nextjs-developer',
  },
  {
    id: 'app',
    brief:
      'A team task manager with projects, task list, filters by assignee and status, task detail view, and create/edit/delete flows.',
    templateId: 'nextjs-developer',
  },
]

export type BenchmarkRow = {
  modelId: string
  modelName: string
  taskId: string
  ok: boolean
  error?: string
  /** 0..1 deterministic composite. */
  quality: number
  integrityOk: boolean
  integrityIssues: number
  architectureStatus: ArchitectureComplianceResult['status'] | 'skipped'
  verificationStatus: VerificationResult['status'] | 'skipped'
  files: number
  chars: number
  latencyMs: number
  inputTokens: number
  outputTokens: number
  usd: number
}

export type BenchmarkSummary = {
  modelId: string
  modelName: string
  runs: number
  failures: number
  quality: number
  usd: number
  latencyMs: number
}

const STATUS_SCORE: Record<string, number> = {
  passed: 1,
  partial: 0.5,
  failed: 0,
}

/**
 * Composite from the deterministic checkers only.
 * Weights renormalize when deploy is skipped, so scores stay comparable within
 * a run but should not be compared across deploy/no-deploy runs.
 */
export function scoreCandidate(input: {
  integrityOk: boolean
  architectureStatus?: ArchitectureComplianceResult['status'] | null
  verificationStatus?: VerificationResult['status'] | null
}): number {
  const parts: Array<{ weight: number; value: number }> = [
    { weight: 0.4, value: input.integrityOk ? 1 : 0 },
  ]
  if (input.architectureStatus) {
    parts.push({
      weight: 0.3,
      value: STATUS_SCORE[input.architectureStatus] ?? 0,
    })
  }
  if (input.verificationStatus) {
    parts.push({
      weight: 0.3,
      value: STATUS_SCORE[input.verificationStatus] ?? 0,
    })
  }
  const total = parts.reduce((sum, p) => sum + p.weight, 0)
  if (!total) return 0
  const score = parts.reduce((sum, p) => sum + p.weight * p.value, 0) / total
  return Math.round(score * 1000) / 1000
}

function catalogFor(templateId?: string): Templates {
  const all = templates as Templates
  if (!templateId) return all
  const key = Object.keys(all).find((k) => k === templateId)
  return key ? ({ [key]: all[key as keyof Templates] } as Templates) : all
}

function requireModel(modelId: string): LLMModel {
  const model = findCatalogModel(modelId)
  if (!model) throw new Error(`Model "${modelId}" is not in lib/models.json`)
  return model
}

/** Shared plan so every model implements the same spec. */
export async function buildSharedPlan(opts: {
  brief: string
  plannerModelId: string
  config?: LLMModelConfig
}): Promise<ApplicationPlan> {
  const model = requireModel(opts.plannerModelId)
  const client = getModelClient(model, opts.config ?? {})
  const planned = await generateObject({
    model: client as LanguageModel,
    schema: applicationPlanSchema,
    system: PLANNING_SYSTEM_PROMPT,
    prompt: `User request / conversation brief:\n\n${opts.brief}\n\nProduce the shared ApplicationPlan that the implementation must satisfy.`,
    maxRetries: 0,
    temperature: 0.2,
    abortSignal: AbortSignal.timeout(BENCHMARK_TIMEOUT_MS),
  })
  return normalizeApplicationPlan(planned.object)
}

export async function runBenchmarkTask(opts: {
  modelId: string
  task: BenchmarkTask
  plan: ApplicationPlan
  config?: LLMModelConfig
  deploy?: boolean
  temperature?: number
}): Promise<BenchmarkRow> {
  const model = requireModel(opts.modelId)
  const config = opts.config ?? {}
  const catalog = catalogFor(opts.task.templateId)
  const started = Date.now()

  const base: BenchmarkRow = {
    modelId: model.id,
    modelName: model.name,
    taskId: opts.task.id,
    ok: false,
    quality: 0,
    integrityOk: false,
    integrityIssues: 0,
    architectureStatus: 'skipped',
    verificationStatus: 'skipped',
    files: 0,
    chars: 0,
    latencyMs: 0,
    inputTokens: 0,
    outputTokens: 0,
    usd: 0,
  }

  try {
    const client = getModelClient(model, config)
    const system = buildGenerationPrompt({
      template: catalog,
      plan: opts.plan,
      brief: opts.task.brief,
    })

    const generated = await generateObject({
      model: client as LanguageModel,
      schema: fragmentSchema,
      system,
      prompt: opts.task.brief,
      maxRetries: 0,
      temperature: opts.temperature ?? 0.5,
      abortSignal: AbortSignal.timeout(BENCHMARK_TIMEOUT_MS),
      ...withGenerationTokenBudget({}, opts.plan),
    })

    const fragment = generated.object as FragmentSchema
    const usage = readProviderUsage(generated.usage)
    const latencyMs = Date.now() - started
    const files = Array.isArray(fragment.code) ? fragment.code.length : 0
    const chars = (fragment.code || []).reduce(
      (sum, f) => sum + (f?.file_content?.length || 0),
      0,
    )

    const integrity = validateFragmentIntegrity(fragment)
    const architecture = checkArchitectureCompliance({
      fragment,
      plan: opts.plan,
    })

    let verificationStatus: BenchmarkRow['verificationStatus'] = 'skipped'
    if (opts.deploy) {
      try {
        const { verification } = await deployAndVerify(fragment, {})
        verificationStatus = verification.status
      } catch (err: any) {
        verificationStatus = 'failed'
      }
    }

    return {
      ...base,
      ok: true,
      quality: scoreCandidate({
        integrityOk: integrity.ok,
        architectureStatus: architecture.status,
        verificationStatus:
          verificationStatus === 'skipped' ? null : verificationStatus,
      }),
      integrityOk: integrity.ok,
      integrityIssues: integrity.issues.length,
      architectureStatus: architecture.status,
      verificationStatus,
      files,
      chars,
      latencyMs,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      usd: costUsd(usage, ratesForModel(model.id)),
    }
  } catch (error: any) {
    return {
      ...base,
      latencyMs: Date.now() - started,
      error: String(error?.message || error).slice(0, 300),
    }
  }
}

export function summarize(rows: BenchmarkRow[]): BenchmarkSummary[] {
  const byModel = new Map<string, BenchmarkRow[]>()
  for (const row of rows) {
    const list = byModel.get(row.modelId) || []
    list.push(row)
    byModel.set(row.modelId, list)
  }

  const out: BenchmarkSummary[] = []
  for (const [modelId, list] of byModel) {
    const runs = list.length
    const failures = list.filter((r) => !r.ok).length
    out.push({
      modelId,
      modelName: list[0]?.modelName || modelId,
      runs,
      failures,
      quality:
        Math.round((list.reduce((s, r) => s + r.quality, 0) / runs) * 1000) /
        1000,
      usd: Math.round(list.reduce((s, r) => s + r.usd, 0) * 10000) / 10000,
      latencyMs: Math.round(
        list.reduce((s, r) => s + r.latencyMs, 0) / runs,
      ),
    })
  }
  // Best quality first; cheaper wins ties. This ordering is the recommendation.
  return out.sort((a, b) => b.quality - a.quality || a.usd - b.usd)
}

export function formatTable(summaries: BenchmarkSummary[]): string {
  const header = ['model', 'quality', 'usd', 'avg ms', 'fail']
  const rows = summaries.map((s) => [
    `${s.modelName} (${s.modelId})`,
    s.quality.toFixed(3),
    `$${s.usd.toFixed(4)}`,
    String(s.latencyMs),
    `${s.failures}/${s.runs}`,
  ])
  const widths = header.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => r[i].length)),
  )
  const line = (cells: string[]) =>
    cells.map((c, i) => c.padEnd(widths[i])).join('  ')
  return [line(header), line(widths.map((w) => '-'.repeat(w))), ...rows.map(line)].join(
    '\n',
  )
}

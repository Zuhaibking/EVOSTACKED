import { createRateLimitResponse, handleAPIError } from '@/lib/api-errors'
import { Duration } from '@/lib/duration'
import {
  ArchitectureComplianceResult,
  checkArchitectureCompliance,
} from '@/lib/architecture-compliance'
import {
  ApplicationPlan,
  PLANNING_SYSTEM_PROMPT,
  applicationPlanSchema,
  buildFallbackApplicationPlan,
  normalizeApplicationPlan,
} from '@/lib/plan'
import { getModelClient, LLMModel, LLMModelConfig } from '@/lib/models'
import { buildEvolutionPrompt, buildGenerationPrompt } from '@/lib/prompt'
import { formatBaselineFilesForPrompt, buildSingleIterationVerdict } from '@/lib/evolution'
import { formatNonBlockingIntegrityWarnings } from '@/lib/fragment-integrity'
import { runGeneratedProjectPreflight } from '@/lib/prepare-fragment-integrity'
import { withGenerationTokenBudget } from '@/lib/generation-budget'
import ratelimit from '@/lib/ratelimit'
import { FragmentSchema, fragmentSchema as schema } from '@/lib/schema'
import { Templates } from '@/lib/templates'
import {
  VARIANTS,
  VariantId,
  TournamentEvent,
} from '@/lib/tournament'
import {
  RepairAttemptRecord,
  selectRepairReason,
  shouldAttemptRepair,
} from '@/lib/repair'
import { repairAndReverify } from '@/lib/repair-candidate'
import {
  shouldSmokeTest,
  SmokeSuiteResult,
} from '@/lib/smoke'
import { runSmokeSuite } from '@/lib/smoke-runner'
import { VerificationResult } from '@/lib/verification'
import { deployAndVerify } from '@/lib/verify-candidate'
import { ExecutionResult } from '@/lib/types'
import { buildDeterministicTournamentVerdict } from '@/lib/deterministic-verdict'
import {
  sanitizeProviderErrorMessage,
  withProviderRetry,
} from '@/lib/provider-retry'
import { classifyProviderQuotaError } from '@/lib/provider-quota'
import {
  applyAssignedTemplate,
  assignDiverseTemplates,
  buildCandidateGenerationQueue,
  catalogLooksLikeAuto,
  pickTemplateSubset,
  type AssignedVariantTemplate,
} from '@/lib/tournament-generation'
import { stackLabelForTemplate } from '@/lib/templates'
import { formatMemoryForPrompt } from '@/lib/memory-prompt'
import type { MemoryPack } from '@evostack/shared'
import {
  llmModelCacheId,
  readLlmCache,
  stablePromptHash,
  writeLlmCache,
  type LlmCacheLookup,
} from '@/lib/llm-cache'
import {
  buildCandidateRecordData,
  compactRepairNotes,
  scoresFromVerdict,
} from '@/lib/tournament-candidate-record'
import { readProviderUsage } from '@/lib/generation-cost'
import {
  buildRuntimePreviewDiagnostic,
  logRuntimePreviewDiagnostic,
} from '@/lib/runtime-preview-diagnostics'
import {
  CoreMessage,
  LanguageModel,
  generateObject,
  streamObject,
} from 'ai'

export const maxDuration = 300

export type TournamentRuntime = {
  llmCache?: LlmCacheLookup
  persistCandidate?: (row: {
    variantId: string
    status: string
    data: unknown
  }) => Promise<{ id: string } | void>
  updateCandidate?: (row: {
    id: string
    status: string
    data: unknown
  }) => Promise<void>
}

const rateLimitMaxRequests = process.env.RATE_LIMIT_MAX_REQUESTS
  ? parseInt(process.env.RATE_LIMIT_MAX_REQUESTS)
  : 10
const ratelimitWindow = process.env.RATE_LIMIT_WINDOW
  ? (process.env.RATE_LIMIT_WINDOW as Duration)
  : '1d'

function messagesToBrief(messages: CoreMessage[], max = 3500): string {
  return messages
    .map((m) =>
      typeof m.content === 'string'
        ? m.content
        : Array.isArray(m.content)
          ? m.content
              .map((c: any) =>
                c.type === 'text'
                  ? c.text
                  : c.type === 'image'
                    ? '[image]'
                    : '',
              )
              .join('\n')
          : '',
    )
    .join('\n')
    .slice(0, max)
}

function asFragment(fragment: any): FragmentSchema | null {
  if (!fragment) return null
  const parsed = schema.safeParse(fragment)
  if (parsed.success) return parsed.data
  // Soft accept near-complete streams that still have files.
  // Deploy still runs; E2B compile/runtime evidence is the source of truth.
  if (
    typeof fragment.template === 'string' &&
    typeof fragment.file_path === 'string' &&
    Array.isArray(fragment.code) &&
    fragment.code.length > 0
  ) {
    return fragment as FragmentSchema
  }
  return null
}

export async function handleTournament(
  req: Request,
  runtime: TournamentRuntime = {},
) {
  const {
    messages,
    template,
    model,
    config,
    userID,
    teamID,
    accessToken,
    runId,
    memoryVersion,
    memoryPack,
    evolution,
  }: {
    messages: CoreMessage[]
    userID: string | undefined
    teamID: string | undefined
    accessToken: string | undefined
    runId?: string
    memoryVersion?: number
    memoryPack?: MemoryPack
    template: Templates
    model: LLMModel
    config: LLMModelConfig
    evolution?: {
      mode: 'evolution'
      candidateMode?: 'single' | 'tournament'
      activeVariantId?: VariantId
      userRequest: string
      parentVersion: number
      previousScore?: number
      plan: ApplicationPlan
      baselineFragment: any
      iterationContext?: {
        knownIssues?: string[]
        fileTree?: string[]
        summary?: { productName?: string }
      }
    }
  } = (await req.json()) as {
    messages: CoreMessage[]
    userID: string | undefined
    teamID: string | undefined
    accessToken: string | undefined
    runId?: string
    memoryVersion?: number
    memoryPack?: MemoryPack
    template: Templates
    model: LLMModel
    config: LLMModelConfig
    evolution?: {
      mode: 'evolution'
      candidateMode?: 'single' | 'tournament'
      activeVariantId?: VariantId
      userRequest: string
      parentVersion: number
      previousScore?: number
      plan: ApplicationPlan
      baselineFragment: any
      iterationContext?: {
        knownIssues?: string[]
        fileTree?: string[]
        summary?: { productName?: string }
      }
    }
  }

  const isEvolution = evolution?.mode === 'evolution'
  const isSingleIteration =
    isEvolution && (evolution?.candidateMode || 'single') === 'single'
  if (isEvolution) {
    if (!evolution?.plan || !evolution?.userRequest?.trim()) {
      return new Response(
        JSON.stringify({
          error:
            'Evolution requires an existing ApplicationPlan and improvement request',
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      )
    }
    if (!evolution.baselineFragment) {
      return new Response(
        JSON.stringify({
          error: 'Evolution requires the current application baselineFragment',
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      )
    }
    if (isSingleIteration && !evolution.activeVariantId) {
      return new Response(
        JSON.stringify({
          error:
            'Single-candidate evolution requires activeVariantId (Use this version first)',
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      )
    }
  }

  const limit = !config.apiKey
    ? await ratelimit(
        req.headers.get('x-forwarded-for'),
        rateLimitMaxRequests,
        ratelimitWindow,
      )
    : false

  if (limit) {
    return createRateLimitResponse(limit)
  }

  const { model: _modelNameString, apiKey: _apiKey, ...modelParams } = config

  let modelClient
  try {
    // Single catalog-validated client for plan → gen → repair → judge.
    // Never remaps free providers to paid / OpenAI.
    modelClient = getModelClient(model, config)
  } catch (error: any) {
    return handleAPIError(error, { hasOwnApiKey: !!config.apiKey })
  }

  const brief = isEvolution
    ? evolution!.userRequest
    : messagesToBrief(messages)

  // Consumption-only: never writes memory. Empty string when the pack is blank.
  const memoryContext = formatMemoryForPrompt({
    memoryItems: memoryPack?.memoryItems,
    recentMessages: memoryPack?.recentMessages,
    brain: memoryPack?.brain,
  })
  const cacheModelId = llmModelCacheId(model)
  const planTemperature = 0.2
  const planningSystem = memoryContext
    ? `${PLANNING_SYSTEM_PROMPT}\n\n${memoryContext}`
    : PLANNING_SYSTEM_PROMPT

  const baselineFiles = isEvolution
    ? (() => {
        const frag = evolution!.baselineFragment
        const code = frag?.code
        if (Array.isArray(code)) {
          return code
            .filter(
              (f: any) =>
                f &&
                typeof f.file_path === 'string' &&
                typeof f.file_content === 'string',
            )
            .map((f: any) => ({
              file_path: f.file_path as string,
              file_content: f.file_content as string,
            }))
        }
        if (typeof code === 'string' && typeof frag?.file_path === 'string') {
          return [{ file_path: frag.file_path as string, file_content: code }]
        }
        return [] as Array<{ file_path: string; file_content: string }>
      })()
    : []

  const evolutionMessages: CoreMessage[] = isEvolution
    ? [
        {
          role: 'user',
          content: `IMPROVEMENT REQUEST:\n${evolution!.userRequest}\n\nEXISTING APPLICATION (modify these files — do not start from scratch):\n\n${formatBaselineFilesForPrompt(baselineFiles)}`,
        },
      ]
    : messages

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false
      const send = (event: TournamentEvent) => {
        if (closed) return
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
          )
        } catch {
          /* connection closed */
        }
      }

      // Candidates table is the server-side specimen log. Version Vault /
      // Project Brain stay client-activated snapshots and are not replaced here.
      const candidateRowIds = new Map<VariantId, string>()
      const candidateExtras = new Map<
        VariantId,
        {
          previewUrl?: string | null
          repairNotes?: string | null
          usage?: { inputTokens: number; outputTokens: number } | null
          template?: string | null
          stackLabel?: string | null
        }
      >()
      const persistCandidateRow = async (input: {
        id: VariantId
        status: string
        fragment?: unknown
        error?: string | null
        verification?: any
        smoke?: any
        architecture?: any
        scores?: ReturnType<typeof scoresFromVerdict>
        template?: string | null
        stackLabel?: string | null
        previewUrl?: string | null
        repairNotes?: string | null
        usage?: { inputTokens: number; outputTokens: number } | null
      }) => {
        if (!runtime.persistCandidate && !runtime.updateCandidate) return
        const prev = candidateExtras.get(input.id) || {}
        const extras = {
          previewUrl:
            input.previewUrl !== undefined ? input.previewUrl : prev.previewUrl,
          repairNotes:
            input.repairNotes !== undefined
              ? input.repairNotes
              : prev.repairNotes,
          usage: input.usage !== undefined ? input.usage : prev.usage,
          template: input.template !== undefined ? input.template : prev.template,
          stackLabel:
            input.stackLabel !== undefined ? input.stackLabel : prev.stackLabel,
        }
        candidateExtras.set(input.id, extras)
        const data = buildCandidateRecordData({
          id: input.id,
          status: input.status,
          fragment: input.fragment,
          error: input.error,
          verification: input.verification,
          smoke: input.smoke,
          architecture: input.architecture,
          scores: input.scores,
          template: extras.template,
          stackLabel: extras.stackLabel,
          previewUrl: extras.previewUrl,
          repairNotes: extras.repairNotes,
          usage: extras.usage,
        })
        const jsonSafe = JSON.parse(JSON.stringify(data)) as typeof data
        try {
          const existing = candidateRowIds.get(input.id)
          if (existing && runtime.updateCandidate) {
            await runtime.updateCandidate({
              id: existing,
              status: input.status,
              data: jsonSafe,
            })
            return
          }
          if (!runtime.persistCandidate) return
          const created = await runtime.persistCandidate({
            variantId: input.id,
            status: input.status,
            data: jsonSafe,
          })
          if (created?.id) candidateRowIds.set(input.id, created.id)
        } catch (err) {
          console.warn(
            '[evostack:candidates] persist failed',
            input.id,
            err instanceof Error ? err.message : err,
          )
        }
      }

      const persistSkipped = async (
        variants: ReadonlyArray<{ id: VariantId }>,
        message: string,
      ) => {
        for (const v of variants) {
          await persistCandidateRow({
            id: v.id,
            status: 'not_attempted',
            error: message,
          })
        }
      }

      // ---- Phase 0: shared product plan (once for all 3 candidates) ----
      // Evolution reuses the existing plan — no planning LLM call.
      let plan: ApplicationPlan | null = null
      if (isEvolution && evolution?.plan) {
        plan = normalizeApplicationPlan(evolution.plan)
        send({ type: 'plan', plan })
      } else {
        const planPrompt = `User request / conversation brief:\n\n${brief}\n\nProduce the shared ApplicationPlan that all three implementation candidates must satisfy.`
        const planHash = stablePromptHash({
          kind: 'application_plan',
          model: cacheModelId,
          temperature: planTemperature,
          brief: planPrompt,
          memoryVersion: memoryVersion ?? memoryPack?.memoryVersion ?? 0,
        })
        const runPlanOnce = () =>
          withProviderRetry(async () =>
            generateObject({
              model: modelClient as LanguageModel,
              schema: applicationPlanSchema,
              system: planningSystem,
              prompt: planPrompt,
              maxRetries: 0,
              temperature: planTemperature,
            }),
          )

        const cachedPlanRaw = await readLlmCache(runtime.llmCache, planHash)
        const cachedPlan = cachedPlanRaw
          ? applicationPlanSchema.safeParse(cachedPlanRaw)
          : null
        if (cachedPlan?.success) {
          console.log('[evostack:llm-cache] plan hit', {
            model: cacheModelId,
            promptHash: planHash,
            runId: runId || null,
          })
          plan = normalizeApplicationPlan(cachedPlan.data)
          send({ type: 'plan', plan })
        } else {
          try {
          const planned = await runPlanOnce()
          plan = normalizeApplicationPlan(planned.object)
          await writeLlmCache(runtime.llmCache, planHash, planned.object)
          console.log('[evostack:llm-cache] plan store', {
            model: cacheModelId,
            promptHash: planHash,
            runId: runId || null,
          })
          send({ type: 'plan', plan })
        } catch (planErr) {
          const quota = classifyProviderQuotaError(planErr)
          if (quota.abortTournament) {
            send({
              type: 'provider_quota',
              state: quota.budgetState,
              message: quota.message,
              retryAfterMs: quota.retryAfterMs ?? undefined,
            })
            const skipVariants = isSingleIteration
              ? VARIANTS.filter((v) => v.id === evolution!.activeVariantId)
              : [...VARIANTS]
            for (const v of skipVariants) {
              send({
                type: 'candidate_skipped',
                id: v.id,
                reason: 'daily_limit',
                message: quota.message,
              })
            }
            await persistSkipped(skipVariants, quota.message)
            send({ type: 'tournament_done' })
            closed = true
            controller.close()
            return
          }
          console.warn(
            '[evostack:plan] primary planning failed; retrying once',
            planErr instanceof Error ? planErr.message : planErr,
          )
          try {
            const retryPlanned = await runPlanOnce()
            plan = normalizeApplicationPlan(retryPlanned.object)
            await writeLlmCache(runtime.llmCache, planHash, retryPlanned.object)
            send({ type: 'plan', plan })
          } catch (retryErr) {
            const retryQuota = classifyProviderQuotaError(retryErr)
            if (retryQuota.abortTournament) {
              send({
                type: 'provider_quota',
                state: retryQuota.budgetState,
                message: retryQuota.message,
                retryAfterMs: retryQuota.retryAfterMs ?? undefined,
              })
              const skipVariants = isSingleIteration
                ? VARIANTS.filter((v) => v.id === evolution!.activeVariantId)
                : [...VARIANTS]
              for (const v of skipVariants) {
                send({
                  type: 'candidate_skipped',
                  id: v.id,
                  reason: 'daily_limit',
                  message: retryQuota.message,
                })
              }
              await persistSkipped(skipVariants, retryQuota.message)
              send({ type: 'tournament_done' })
              closed = true
              controller.close()
              return
            }
            console.warn(
              '[evostack:plan] planning retry failed; using fallback ApplicationPlan',
              retryErr instanceof Error ? retryErr.message : retryErr,
            )
            plan = buildFallbackApplicationPlan(brief)
            send({ type: 'plan', plan })
          }
        }
        }
      }

      // ---- Phase 1: CONCURRENT candidate generation ----
      // After PLAN, Product / Premium / Innovate start together.
      // Each job keeps its own retry/quota; one failure never cancels siblings.
      const variantsToGenerate = isSingleIteration
        ? VARIANTS.filter((v) => v.id === evolution!.activeVariantId)
        : [...VARIANTS]

      if (variantsToGenerate.length === 0) {
        send({ type: 'tournament_done' })
        closed = true
        controller.close()
        return
      }

      const generationQueue = buildCandidateGenerationQueue(
        variantsToGenerate.map((v) => v.id),
      )

      // Auto (full catalog) → prefer a different template per variant.
      // Evolution / Improve keeps the baseline stack so we don't rewrite the app.
      const baselineTemplateId =
        typeof evolution?.baselineFragment?.template === 'string'
          ? evolution.baselineFragment.template
          : undefined
      const templateAssignments: Record<VariantId, AssignedVariantTemplate> =
        isEvolution
          ? Object.fromEntries(
              variantsToGenerate.map((v) => {
                const subset =
                  (baselineTemplateId &&
                    pickTemplateSubset(template, baselineTemplateId)) ||
                  (catalogLooksLikeAuto(template)
                    ? pickTemplateSubset(
                        template,
                        Object.keys(template)[0] || '',
                      )
                    : template)
                const catalog = (subset || template) as Templates
                const id = Object.keys(catalog)[0] || baselineTemplateId || ''
                return [
                  v.id,
                  { id, catalog, stackLabel: stackLabelForTemplate(id) },
                ]
              }),
            ) as Record<VariantId, AssignedVariantTemplate>
          : assignDiverseTemplates({
              catalog: template,
              variantIds: variantsToGenerate.map((v) => v.id),
              plan,
              prompt: brief,
            })

      if (!isEvolution && catalogLooksLikeAuto(template)) {
        console.log(
          '[evostack:stack-advisor]',
          Object.fromEntries(
            variantsToGenerate.map((v) => [
              v.id,
              {
                template: templateAssignments[v.id]?.id || null,
                stack: templateAssignments[v.id]?.stackLabel || null,
              },
            ]),
          ),
        )
      }

      type GenResult = {
        id: VariantId
        fragment: any
        error: string | null
        skipped?: boolean
      }

      for (const item of generationQueue) {
        const variant = VARIANTS.find((v) => v.id === item.id)!
        const assigned = templateAssignments[variant.id]
        send({
          type: 'candidate_start',
          id: variant.id,
          label: variant.label,
          sigil: variant.sigil,
          template: assigned?.id || undefined,
          stackLabel: assigned?.stackLabel || undefined,
        })
        await persistCandidateRow({
          id: variant.id,
          status: 'generating',
          template: assigned?.id || null,
          stackLabel: assigned?.stackLabel || null,
        })
      }

      const genResults: GenResult[] = await Promise.all(
        generationQueue.map(async (item): Promise<GenResult> => {
          const variant = VARIANTS.find((v) => v.id === item.id)!
          const assigned = templateAssignments[variant.id]
          const candidateTemplate = assigned?.catalog || template
          try {
            const system = isEvolution
              ? buildEvolutionPrompt({
                  template: candidateTemplate,
                  plan,
                  variantDirection: variant.systemSuffix,
                  userRequest: evolution!.userRequest,
                  parentVersion: evolution!.parentVersion,
                  productName:
                    evolution?.iterationContext?.summary?.productName ||
                    plan?.productName,
                  knownIssues: evolution?.iterationContext?.knownIssues,
                  fileTree:
                    evolution?.iterationContext?.fileTree ||
                    baselineFiles.map((f) => f.file_path),
                  memoryContext,
                })
              : buildGenerationPrompt({
                  template: candidateTemplate,
                  plan,
                  variantDirection: variant.systemSuffix,
                  memoryContext,
                })

            const genParams = withGenerationTokenBudget(
              modelParams as Record<string, unknown>,
              plan,
              { concurrentJobs: generationQueue.length },
            )
            console.log('[evostack:gen-budget]', {
              candidateId: variant.id,
              modelId: model?.id,
              providerId: model?.providerId,
              planComplexity: plan?.complexity ?? null,
              concurrentJobs: generationQueue.length,
              maxTokens: genParams.maxTokens ?? null,
              templateId: assigned?.id || null,
            })

            let capturedUsage: {
              inputTokens: number
              outputTokens: number
            } | null = null
            const final = await withProviderRetry(async () => {
              const result = await streamObject({
                model: modelClient as LanguageModel,
                schema,
                system,
                messages: evolutionMessages,
                maxRetries: 0,
                ...genParams,
                temperature: variant.temperature,
              })
              const { partialObjectStream, object } = result

              let last: any = undefined
              for await (const partial of partialObjectStream) {
                last = partial
                send({
                  type: 'candidate_chunk',
                  id: variant.id,
                  fragment: partial,
                })
              }
              try {
                const raw = await Promise.resolve(
                  (result as { usage?: Promise<unknown> | unknown }).usage,
                )
                const parsed = readProviderUsage(raw)
                if (parsed.inputTokens > 0 || parsed.outputTokens > 0) {
                  capturedUsage = parsed
                }
              } catch {
                /* display-only; never fail generation */
              }
              return (await object) ?? last
            })

            if (!final) {
              const err = 'Generation produced an empty response'
              send({
                type: 'candidate_error',
                id: variant.id,
                error: err,
              })
              await persistCandidateRow({
                id: variant.id,
                status: 'error',
                error: err,
                template: assigned?.id || null,
                stackLabel: assigned?.stackLabel || null,
              })
              return {
                id: variant.id as VariantId,
                fragment: null,
                error: err,
              }
            }

            const stamped = applyAssignedTemplate(final, assigned)
            send({
              type: 'candidate_done',
              id: variant.id,
              fragment: stamped,
            })
            await persistCandidateRow({
              id: variant.id,
              status: 'done',
              fragment: stamped,
              template: assigned?.id || stamped?.template || null,
              stackLabel: assigned?.stackLabel || null,
              usage: capturedUsage,
            })
            return {
              id: variant.id as VariantId,
              fragment: stamped,
              error: null,
            }
          } catch (e: any) {
            const quota = classifyProviderQuotaError(e)
            const err =
              quota.kind !== 'none'
                ? quota.message
                : sanitizeProviderErrorMessage(e)

            if (quota.kind !== 'none') {
              send({
                type: 'provider_quota',
                state: quota.budgetState,
                message: err,
                retryAfterMs: quota.retryAfterMs ?? undefined,
              })
            }

            send({
              type: 'candidate_error',
              id: variant.id,
              error: err,
            })
            await persistCandidateRow({
              id: variant.id,
              status: 'error',
              error: err,
              template: assigned?.id || null,
              stackLabel: assigned?.stackLabel || null,
            })
            return {
              id: variant.id as VariantId,
              fragment: null,
              error: err,
            }
          }
        }),
      )

      const generated = genResults.filter((r) => r.fragment && !r.error)

      if (generated.length === 0) {
        send({ type: 'tournament_done' })
        closed = true
        controller.close()
        return
      }

      // ---- Phase 1b: deterministic architecture compliance (no E2B / LLM) ----
      type GeneratedWithArch = {
        id: VariantId
        fragment: any
        architectureCompliance: ArchitectureComplianceResult
      }

      const withArchitecture: GeneratedWithArch[] = generated.map((r) => {
        send({ type: 'candidate_architecture_checking', id: r.id })
        const frag = asFragment(r.fragment) || r.fragment
        const architectureCompliance = checkArchitectureCompliance({
          fragment: frag,
          plan,
        })
        send({
          type: 'candidate_architecture_checked',
          id: r.id,
          architectureCompliance,
        })
        return {
          id: r.id,
          fragment: r.fragment,
          architectureCompliance,
        }
      })

      // ---- Phase 2: deterministic preflight → E2B deploy → verify ----
      // Integrity/hydration heuristics are diagnostic only. Each candidate is
      // isolated: failure never aborts the tournament or sibling deploys.
      type Verified = {
        id: VariantId
        fragment: any
        originalFragment: any
        initialVerification: VerificationResult
        finalVerification: VerificationResult
        repairAttempt: RepairAttemptRecord | null
        /** Structural one-shot budget (0 or 1). */
        repairAttempts: number
        initialArchitectureCompliance: ArchitectureComplianceResult
        architectureCompliance: ArchitectureComplianceResult
        execution?: ExecutionResult
      }

      const productContextEarly = plan
        ? `${plan.productName}: ${plan.productGoal}\nCore: ${plan.coreFeatures.join('; ')}`
        : brief.slice(0, 800)

      // Deploy stays Promise.all so write/install/HTTP can overlap, but
      // Sandbox.create is serialized inside deployAndVerify (DNS/E2B handshake).
      const verifyTasks = withArchitecture.map(async (r) => {
        send({ type: 'candidate_verifying', id: r.id })
        const variantLabel =
          VARIANTS.find((v) => v.id === r.id)?.label || r.id
        const frag = asFragment(r.fragment)
        if (!frag) {
          const verification: VerificationResult = {
            status: 'failed',
            filesWritten: false,
            dependenciesInstalled: 'not_required',
            processStarted: false,
            previewReachable: false,
            errors: [
              `${variantLabel} generated fragment failed validation.`,
            ],
            warnings: [],
            durationMs: 0,
          }
          send({
            type: 'candidate_verified',
            id: r.id,
            verification,
          })
          return {
            id: r.id,
            fragment: r.fragment,
            originalFragment: r.fragment,
            initialVerification: verification,
            finalVerification: verification,
            repairAttempt: null,
            repairAttempts: 0,
            initialArchitectureCompliance: r.architectureCompliance,
            architectureCompliance: r.architectureCompliance,
          } as Verified
        }

        const preflighted = runGeneratedProjectPreflight(frag)
        let workingFrag = preflighted.fragment
        let repairAttempts = 0
        let repairAttempt: RepairAttemptRecord | null = null
        const architectureCompliance = r.architectureCompliance
        const integrity = preflighted.integrity

        try {
          const { verification, execution } = await deployAndVerify(
            workingFrag,
            {
              userID,
              teamID,
              accessToken,
            },
          )
          const qualityWarnings = formatNonBlockingIntegrityWarnings(integrity)
          if (qualityWarnings.length) {
            verification.warnings = [
              ...(verification.warnings || []),
              ...qualityWarnings,
            ]
          }
          logRuntimePreviewDiagnostic(
            'candidate_deploy',
            buildRuntimePreviewDiagnostic({
              candidateId: r.id,
              candidateLabel: variantLabel,
              verification,
              execution: execution || null,
              port:
                typeof workingFrag.port === 'number' ? workingFrag.port : null,
            }),
          )
          send({
            type: 'candidate_verified',
            id: r.id,
            verification,
            execution,
          })
          return {
            id: r.id,
            fragment: workingFrag,
            originalFragment: frag,
            initialVerification: verification,
            finalVerification: verification,
            repairAttempt,
            repairAttempts,
            initialArchitectureCompliance: r.architectureCompliance,
            architectureCompliance,
            execution,
          } as Verified
        } catch (e: any) {
          const details = [
            e?.message,
            e?.cause?.message,
            e?.code ? `code=${e.code}` : '',
          ]
            .filter(Boolean)
            .join(' · ')
          const verification: VerificationResult = {
            status: 'failed',
            filesWritten: false,
            dependenciesInstalled: 'not_required',
            processStarted: false,
            previewReachable: false,
            errors: [details || `${variantLabel} verification crashed`],
            warnings: [],
            durationMs: 0,
          }
          send({
            type: 'candidate_verified',
            id: r.id,
            verification,
          })
          return {
            id: r.id,
            fragment: workingFrag,
            originalFragment: frag,
            initialVerification: verification,
            finalVerification: verification,
            repairAttempt,
            repairAttempts,
            initialArchitectureCompliance: r.architectureCompliance,
            architectureCompliance,
          } as Verified
        }
      })

      const verified = await Promise.all(verifyTasks)

      // ---- Phase 2b: ONE-SHOT repair after genuine compile/runtime failure ----
      // Never repair healthy previews, architecture-only gaps, or E2B/infra failures.
      const productContext = productContextEarly

      const afterRepair = await Promise.all(
        verified.map(async (v) => {
          const eligible = shouldAttemptRepair({
            repairAttempts: v.repairAttempts,
            architectureCompliance: v.initialArchitectureCompliance,
            verification: v.initialVerification,
          })
          if (!eligible) {
            return v
          }

          const reason = selectRepairReason({
            architectureCompliance: v.initialArchitectureCompliance,
            verification: v.initialVerification,
          })
          // Prefer the latest working fragment (may already include integrity fixes).
          const frag = asFragment(v.fragment) || asFragment(v.originalFragment)
          if (!frag || !reason) {
            return v
          }

          send({ type: 'candidate_repairing', id: v.id, reason })
          try {
            const repaired = await repairAndReverify({
              fragment: frag,
              verification: v.initialVerification,
              architectureCompliance: v.initialArchitectureCompliance,
              repairAttempts: v.repairAttempts,
              plan,
              model,
              config,
              deployOpts: { userID, teamID, accessToken },
              productContext,
              llmCache: runtime.llmCache,
            })

            // Emit final architecture after the single repair (no second repair).
            if (repaired.finalArchitectureCompliance) {
              send({
                type: 'candidate_architecture_checked',
                id: v.id,
                architectureCompliance: repaired.finalArchitectureCompliance,
              })
            }

            if (repaired.repairAttempt.success) {
              const nextExecution = repaired.execution ?? v.execution
              send({
                type: 'candidate_repaired',
                id: v.id,
                fragment: repaired.fragment,
                repairAttempt: repaired.repairAttempt,
                initialVerification: repaired.initialVerification,
                finalVerification: repaired.finalVerification,
                architectureCompliance:
                  repaired.finalArchitectureCompliance ?? undefined,
                execution: nextExecution,
              })
              return {
                id: v.id,
                fragment: repaired.fragment,
                originalFragment: repaired.originalFragment,
                initialVerification: repaired.initialVerification,
                finalVerification: repaired.finalVerification,
                repairAttempt: repaired.repairAttempt,
                repairAttempts: repaired.repairAttempts,
                initialArchitectureCompliance:
                  repaired.initialArchitectureCompliance ||
                  v.initialArchitectureCompliance,
                architectureCompliance:
                  repaired.finalArchitectureCompliance ||
                  v.architectureCompliance,
                execution: nextExecution,
              } as Verified
            }

            send({
              type: 'candidate_repair_failed',
              id: v.id,
              repairAttempt: repaired.repairAttempt,
              initialVerification: repaired.initialVerification,
              finalVerification: repaired.finalVerification,
              architectureCompliance:
                repaired.finalArchitectureCompliance ?? undefined,
            })
            return {
              ...v,
              fragment: repaired.fragment,
              repairAttempt: repaired.repairAttempt,
              repairAttempts: repaired.repairAttempts,
              finalVerification: repaired.finalVerification,
              architectureCompliance:
                repaired.finalArchitectureCompliance ||
                v.architectureCompliance,
              // Keep prior execution/url if repair redeploy produced none.
              execution: repaired.execution ?? v.execution,
            } as Verified
          } catch (e: any) {
            const repairAttempt: RepairAttemptRecord = {
              attempted: true,
              reason: reason || 'runtime',
              repairAttempts: 1,
              success: false,
              error: e?.message || 'Repair phase crashed',
            }
            send({
              type: 'candidate_repair_failed',
              id: v.id,
              repairAttempt,
              initialVerification: v.initialVerification,
              finalVerification: v.initialVerification,
            })
            return { ...v, repairAttempt, repairAttempts: 1 }
          }
        }),
      )

      // ---- Phase 2c: browser smoke tests for runnable candidates only ----
      type WithSmoke = Verified & { smoke: SmokeSuiteResult | null }

      const afterSmoke: WithSmoke[] = await Promise.all(
        afterRepair.map(async (v) => {
          if (!shouldSmokeTest(v.finalVerification)) {
            return { ...v, smoke: null }
          }
          const previewUrl =
            v.execution && 'url' in v.execution
              ? (v.execution as { url?: string }).url
              : v.finalVerification.url

          send({ type: 'candidate_testing', id: v.id })
          try {
            const smoke = await runSmokeSuite({
              previewUrl: previewUrl || '',
              templateId:
                v.finalVerification.template ||
                (typeof v.fragment?.template === 'string'
                  ? v.fragment.template
                  : undefined),
              plan,
              verification: v.finalVerification,
            })
            send({ type: 'candidate_tested', id: v.id, smoke })
            return { ...v, smoke }
          } catch (e: any) {
            const smoke: SmokeSuiteResult = {
              status: 'failed',
              tests: [
                {
                  status: 'failed',
                  testName: 'Browser smoke suite',
                  durationMs: 0,
                  completedActions: 0,
                  error: e?.message || 'Smoke suite crashed',
                },
              ],
              durationMs: 0,
              summary: e?.message || 'Smoke suite crashed',
            }
            send({ type: 'candidate_tested', id: v.id, smoke })
            return { ...v, smoke }
          }
        }),
      )

      // ---- Phase 3: recommendation / validate (NO extra LLM judge) ----
      // User inspects all candidates and chooses. Recommendation is local-only.
      let verdictOut: ReturnType<typeof buildDeterministicTournamentVerdict> | undefined
      if (isSingleIteration) {
        const only = afterSmoke[0]
        if (only) {
          verdictOut = buildSingleIterationVerdict({
            id: only.id,
            verification: only.finalVerification,
            architecture: only.architectureCompliance,
            smoke: only.smoke,
            previousScore: evolution?.previousScore,
            userRequest: evolution?.userRequest,
          })
          send({
            type: 'verdict',
            verdict: verdictOut,
          })
        }
      } else {
        verdictOut = buildDeterministicTournamentVerdict(
          afterSmoke.map((r) => ({
            id: r.id,
            fragment: r.fragment,
            finalVerification: r.finalVerification,
            architectureCompliance: r.architectureCompliance,
            smoke: r.smoke,
          })),
        )
        send({ type: 'verdict', verdict: verdictOut })
      }

      const finished = new Set(afterSmoke.map((r) => r.id))
      for (const r of afterSmoke) {
        const runtimeStatus = r.finalVerification?.status
        const status =
          runtimeStatus === 'failed'
            ? 'verify_failed'
            : r.smoke?.status === 'failed' || r.smoke?.status === 'timeout'
              ? 'smoke_failed'
              : r.smoke
                ? 'tested'
                : runtimeStatus === 'passed' || runtimeStatus === 'partial'
                  ? 'verified'
                  : 'done'
        await persistCandidateRow({
          id: r.id,
          status,
          fragment: r.fragment,
          verification: r.finalVerification,
          smoke: r.smoke,
          architecture: r.architectureCompliance,
          scores: scoresFromVerdict(verdictOut, r.id),
          error: r.finalVerification?.errors?.[0] || null,
          template:
            templateAssignments[r.id]?.id ||
            (typeof r.fragment?.template === 'string'
              ? r.fragment.template
              : null),
          stackLabel: templateAssignments[r.id]?.stackLabel || null,
          previewUrl:
            r.execution &&
            'url' in r.execution &&
            typeof r.execution.url === 'string'
              ? r.execution.url
              : typeof r.finalVerification?.url === 'string'
                ? r.finalVerification.url
                : null,
          repairNotes: compactRepairNotes(r.repairAttempt),
        })
      }
      for (const r of genResults) {
        if (finished.has(r.id)) continue
        await persistCandidateRow({
          id: r.id,
          status: r.error ? 'error' : 'done',
          fragment: r.fragment,
          error: r.error,
          scores: scoresFromVerdict(verdictOut, r.id),
          template: templateAssignments[r.id]?.id || null,
          stackLabel: templateAssignments[r.id]?.stackLabel || null,
        })
      }

      send({ type: 'tournament_done' })
      closed = true
      controller.close()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  })
}

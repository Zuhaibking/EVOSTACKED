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
  normalizeApplicationPlan,
} from '@/lib/plan'
import { getModelClient, LLMModel, LLMModelConfig } from '@/lib/models'
import { buildEvolutionPrompt, buildGenerationPrompt } from '@/lib/prompt'
import { formatBaselineFilesForPrompt, buildSingleIterationVerdict } from '@/lib/evolution'
import {
  canDeployIntegrity,
  formatIntegrityUserSummary,
  formatNonBlockingIntegrityWarnings,
  integrityToFailedVerification,
} from '@/lib/fragment-integrity'
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
import {
  repairAndReverify,
  repairFragmentIntegrity,
} from '@/lib/repair-candidate'
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
import { buildCandidateGenerationQueue } from '@/lib/tournament-generation'
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

export async function handleTournament(req: Request) {
  const {
    messages,
    template,
    model,
    config,
    userID,
    teamID,
    accessToken,
    evolution,
  }: {
    messages: CoreMessage[]
    userID: string | undefined
    teamID: string | undefined
    accessToken: string | undefined
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

      // ---- Phase 0: shared product plan (once for all 3 candidates) ----
      // Evolution reuses the existing plan — no planning LLM call.
      let plan: ApplicationPlan | null = null
      if (isEvolution && evolution?.plan) {
        plan = normalizeApplicationPlan(evolution.plan)
        send({ type: 'plan', plan })
      } else {
        try {
          const planned = await withProviderRetry(async () =>
            generateObject({
              model: modelClient as LanguageModel,
              schema: applicationPlanSchema,
              system: PLANNING_SYSTEM_PROMPT,
              prompt: `User request / conversation brief:\n\n${brief}\n\nProduce the shared ApplicationPlan that all three implementation candidates must satisfy.`,
              maxRetries: 0,
              temperature: 0.2,
            }),
          )
          plan = normalizeApplicationPlan(planned.object)
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
            send({ type: 'tournament_done' })
            closed = true
            controller.close()
            return
          }
          plan = null
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

      type GenResult = {
        id: VariantId
        fragment: any
        error: string | null
        skipped?: boolean
      }

      for (const item of generationQueue) {
        const variant = VARIANTS.find((v) => v.id === item.id)!
        send({
          type: 'candidate_start',
          id: variant.id,
          label: variant.label,
          sigil: variant.sigil,
        })
      }

      const genResults: GenResult[] = await Promise.all(
        generationQueue.map(async (item): Promise<GenResult> => {
          const variant = VARIANTS.find((v) => v.id === item.id)!
          try {
            const system = isEvolution
              ? buildEvolutionPrompt({
                  template,
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
                })
              : buildGenerationPrompt({
                  template,
                  plan,
                  variantDirection: variant.systemSuffix,
                })

            const genParams = withGenerationTokenBudget(
              modelParams as Record<string, unknown>,
              plan,
              { concurrentJobs: generationQueue.length },
            )

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
              return (await object) ?? last
            })

            if (!final) {
              const err = 'Generation produced an empty response'
              send({
                type: 'candidate_error',
                id: variant.id,
                error: err,
              })
              return {
                id: variant.id as VariantId,
                fragment: null,
                error: err,
              }
            }

            send({
              type: 'candidate_done',
              id: variant.id,
              fragment: final,
            })
            return {
              id: variant.id as VariantId,
              fragment: final,
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

      // ---- Phase 2: local integrity → optional repair → runtime verify ----
      // Each candidate is isolated: failure never aborts the tournament.
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
              `${variantLabel} encountered a build issue. Generated fragment failed schema validation.`,
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

        try {
          let integrity = preflighted.integrity
          if (!canDeployIntegrity(integrity) && repairAttempts === 0) {
            const initialIntegrity = integrity
            send({
              type: 'candidate_repairing',
              id: r.id,
              reason: 'integrity',
            })
            try {
              const repaired = await repairFragmentIntegrity({
                fragment: workingFrag,
                integrity,
                repairAttempts: 0,
                plan,
                model,
                config,
                productContext: productContextEarly,
              })
              repairAttempts = repaired.repairAttempts
              repairAttempt = repaired.repairAttempt
              const again = runGeneratedProjectPreflight(repaired.fragment)
              workingFrag = again.fragment
              integrity = again.integrity

              if (repaired.repairAttempt.success && integrity.ok) {
                // Integrity recovered — fragment fixed. Do NOT claim runtime/preview
                // passed and do NOT omit a later deploy. Emit repair metadata only;
                // candidate_verified after deployAndVerify is the URL source of truth.
                send({
                  type: 'candidate_repaired',
                  id: r.id,
                  fragment: workingFrag,
                  repairAttempt: repaired.repairAttempt,
                  initialVerification: integrityToFailedVerification(
                    initialIntegrity,
                    { candidateLabel: variantLabel },
                  ),
                  finalVerification: {
                    status: 'partial',
                    filesWritten: false,
                    dependenciesInstalled: 'not_required',
                    processStarted: false,
                    previewReachable: false,
                    errors: [],
                    warnings: [
                      formatIntegrityUserSummary(integrity, {
                        candidateLabel: variantLabel,
                        recovered: true,
                      }) + ' Deploying for Preview…',
                    ],
                    durationMs: 0,
                  },
                  architectureCompliance,
                  // Explicitly omit execution — deploy has not run yet.
                })
              } else if (!canDeployIntegrity(integrity)) {
                send({
                  type: 'candidate_repair_failed',
                  id: r.id,
                  repairAttempt: repaired.repairAttempt,
                  initialVerification: integrityToFailedVerification(
                    initialIntegrity,
                    { candidateLabel: variantLabel },
                  ),
                  finalVerification: integrityToFailedVerification(integrity, {
                    candidateLabel: variantLabel,
                  }),
                  architectureCompliance,
                })
              }
            } catch (e: any) {
              repairAttempts = 1
              repairAttempt = {
                attempted: true,
                reason: 'integrity',
                repairAttempts: 1,
                success: false,
                error: e?.message || 'Integrity repair crashed',
              }
              send({
                type: 'candidate_repair_failed',
                id: r.id,
                repairAttempt,
                initialVerification: integrityToFailedVerification(
                  initialIntegrity,
                  { candidateLabel: variantLabel },
                ),
                finalVerification: integrityToFailedVerification(integrity, {
                  candidateLabel: variantLabel,
                }),
                architectureCompliance,
              })
            }
          }

          const gated = runGeneratedProjectPreflight(workingFrag)
          workingFrag = gated.fragment
          integrity = gated.integrity
          if (!canDeployIntegrity(integrity)) {
            const verification = integrityToFailedVerification(integrity, {
              candidateLabel: variantLabel,
            })
            if (repairAttempt && !repairAttempt.success) {
              const details = verification.errors.slice(1)
              verification.errors = [
                formatIntegrityUserSummary(integrity, {
                  candidateLabel: variantLabel,
                  repaired: true,
                }),
                ...details,
              ].filter(Boolean)
            }
            // Shared failure mode diagnostic: compile-blocking integrity (no E2B).
            logRuntimePreviewDiagnostic(
              'candidate_integrity_blocked',
              buildRuntimePreviewDiagnostic({
                candidateId: r.id,
                candidateLabel: variantLabel,
                verification,
                execution: null,
                port:
                  typeof workingFrag.port === 'number'
                    ? workingFrag.port
                    : null,
                deployError: verification.errors[0],
                integrityIssueCodes: integrity.issues
                  .filter((i) => i.severity === 'error')
                  .map((i) => i.code),
              }),
            )
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
          if (verification.status === 'failed' && verification.errors[0]) {
            const first = verification.errors[0]
            if (
              /Module not found|Can't resolve|Cannot find module/i.test(first)
            ) {
              const missing =
                first.match(/['"]([^'"]+)['"]/)?.[1] ||
                first.match(/resolve ['"]?([^'"\s]+)/)?.[1]
              verification.errors = [
                `${variantLabel} encountered a build issue.${
                  missing ? ` Missing module: ${missing}.` : ''
                }${
                  repairAttempts === 0
                    ? ' Attempted automatic repair when eligible.'
                    : ' Could not recover this candidate.'
                }`,
                ...verification.errors,
              ]
            }
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
          const verification: VerificationResult = {
            status: 'failed',
            filesWritten: false,
            dependenciesInstalled: 'not_required',
            processStarted: false,
            previewReachable: false,
            errors: [
              `${variantLabel} encountered a build issue.`,
              e?.message || 'Verification crashed',
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

      // ---- Phase 2b: unified ONE-SHOT repair (architecture and/or runtime) ----
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
      if (isSingleIteration) {
        const only = afterSmoke[0]
        if (only) {
          send({
            type: 'verdict',
            verdict: buildSingleIterationVerdict({
              id: only.id,
              verification: only.finalVerification,
              architecture: only.architectureCompliance,
              smoke: only.smoke,
              previousScore: evolution?.previousScore,
              userRequest: evolution?.userRequest,
            }),
          })
        }
      } else {
        const verdict = buildDeterministicTournamentVerdict(
          afterSmoke.map((r) => ({
            id: r.id,
            fragment: r.fragment,
            finalVerification: r.finalVerification,
            architectureCompliance: r.architectureCompliance,
            smoke: r.smoke,
          })),
        )
        send({ type: 'verdict', verdict })
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

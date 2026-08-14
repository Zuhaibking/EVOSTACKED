import { createRateLimitResponse, handleAPIError } from '@/lib/api-errors'
import { Duration } from '@/lib/duration'
import {
  summarizeFragmentForJudge,
  totalCodeLength,
} from '@/lib/fragment'
import {
  ArchitectureComplianceResult,
  checkArchitectureCompliance,
  formatArchitectureComplianceForJudge,
} from '@/lib/architecture-compliance'
import {
  ApplicationPlan,
  PLANNING_SYSTEM_PROMPT,
  applicationPlanSchema,
  formatContractsForJudge,
  formatPlanForJudge,
  normalizeApplicationPlan,
} from '@/lib/plan'
import { getModelClient, LLMModel, LLMModelConfig } from '@/lib/models'
import { buildGenerationPrompt } from '@/lib/prompt'
import ratelimit from '@/lib/ratelimit'
import { FragmentSchema, fragmentSchema as schema } from '@/lib/schema'
import { Templates } from '@/lib/templates'
import {
  VARIANTS,
  VariantId,
  TournamentEvent,
  verdictSchema,
} from '@/lib/tournament'
import {
  RepairAttemptRecord,
  formatRepairHistoryForJudge,
  selectRepairReason,
  shouldAttemptRepair,
} from '@/lib/repair'
import { repairAndReverify } from '@/lib/repair-candidate'
import {
  formatSmokeForJudge,
  preferReliableWinner,
  shouldSmokeTest,
  SmokeSuiteResult,
} from '@/lib/smoke'
import { runSmokeSuite } from '@/lib/smoke-runner'
import { VerificationResult } from '@/lib/verification'
import { deployAndVerify } from '@/lib/verify-candidate'
import { ExecutionResult } from '@/lib/types'
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

export async function POST(req: Request) {
  const {
    messages,
    template,
    model,
    config,
    userID,
    teamID,
    accessToken,
  }: {
    messages: CoreMessage[]
    userID: string | undefined
    teamID: string | undefined
    accessToken: string | undefined
    template: Templates
    model: LLMModel
    config: LLMModelConfig
  } = await req.json()

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

  const brief = messagesToBrief(messages)

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
      let plan: ApplicationPlan | null = null
      try {
        const planned = await generateObject({
          model: modelClient as LanguageModel,
          schema: applicationPlanSchema,
          system: PLANNING_SYSTEM_PROMPT,
          prompt: `User request / conversation brief:\n\n${brief}\n\nProduce the shared ApplicationPlan that all three implementation candidates must satisfy.`,
          maxRetries: 0,
          temperature: 0.2,
        })
        plan = normalizeApplicationPlan(planned.object)
        send({ type: 'plan', plan })
      } catch {
        plan = null
      }

      // ---- Phase 1: three candidates in parallel ----
      const genTasks = VARIANTS.map(async (variant) => {
        send({
          type: 'candidate_start',
          id: variant.id,
          label: variant.label,
          sigil: variant.sigil,
        })

        try {
          const system = buildGenerationPrompt({
            template,
            plan,
            variantDirection: variant.systemSuffix,
          })

          const result = await streamObject({
            model: modelClient as LanguageModel,
            schema,
            system,
            messages,
            maxRetries: 0,
            ...modelParams,
            temperature: variant.temperature,
          })
          const { partialObjectStream, object } = result

          let last: any = undefined
          for await (const partial of partialObjectStream) {
            last = partial
            send({ type: 'candidate_chunk', id: variant.id, fragment: partial })
          }
          const final = (await object) ?? last
          send({ type: 'candidate_done', id: variant.id, fragment: final })
          return { id: variant.id as VariantId, fragment: final, error: null as string | null }
        } catch (e: any) {
          send({
            type: 'candidate_error',
            id: variant.id,
            error: e?.message ?? 'unknown error',
          })
          return {
            id: variant.id as VariantId,
            fragment: null,
            error: e?.message ?? 'unknown error',
          }
        }
      })

      const genResults = await Promise.all(genTasks)
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

      // ---- Phase 2: runtime verification for every generated candidate ----
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

      const verifyTasks = withArchitecture.map(async (r) => {
        send({ type: 'candidate_verifying', id: r.id })
        const frag = asFragment(r.fragment)
        if (!frag) {
          const verification: VerificationResult = {
            status: 'failed',
            filesWritten: false,
            dependenciesInstalled: 'not_required',
            processStarted: false,
            previewReachable: false,
            errors: ['Generated fragment failed schema validation'],
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

        try {
          const { verification, execution } = await deployAndVerify(frag, {
            userID,
            teamID,
            accessToken,
          })
          send({
            type: 'candidate_verified',
            id: r.id,
            verification,
            execution,
          })
          return {
            id: r.id,
            fragment: frag,
            originalFragment: frag,
            initialVerification: verification,
            finalVerification: verification,
            repairAttempt: null,
            repairAttempts: 0,
            initialArchitectureCompliance: r.architectureCompliance,
            architectureCompliance: r.architectureCompliance,
            execution,
          } as Verified
        } catch (e: any) {
          const verification: VerificationResult = {
            status: 'failed',
            filesWritten: false,
            dependenciesInstalled: 'not_required',
            processStarted: false,
            previewReachable: false,
            errors: [e?.message || 'Verification crashed'],
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
            fragment: frag,
            originalFragment: frag,
            initialVerification: verification,
            finalVerification: verification,
            repairAttempt: null,
            repairAttempts: 0,
            initialArchitectureCompliance: r.architectureCompliance,
            architectureCompliance: r.architectureCompliance,
          } as Verified
        }
      })

      const verified = await Promise.all(verifyTasks)

      // ---- Phase 2b: unified ONE-SHOT repair (architecture and/or runtime) ----
      const productContext = plan
        ? `${plan.productName}: ${plan.productGoal}\nCore: ${plan.coreFeatures.join('; ')}`
        : brief.slice(0, 800)

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
          const frag = asFragment(v.originalFragment)
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
              send({
                type: 'candidate_repaired',
                id: v.id,
                fragment: repaired.fragment,
                repairAttempt: repaired.repairAttempt,
                initialVerification: repaired.initialVerification,
                finalVerification: repaired.finalVerification,
                architectureCompliance:
                  repaired.finalArchitectureCompliance ?? undefined,
                execution: repaired.execution,
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
                execution: repaired.execution,
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
            } as Verified
          } catch (e: any) {
            const repairAttempt: RepairAttemptRecord = {
              attempted: true,
              reason,
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

      // ---- Phase 3: judge with plan + runtime + repair + smoke ----
      try {
        const requirementsBlock = plan
          ? formatPlanForJudge(plan)
          : 'No formal plan available — score fit against the user brief.'

        const judgePrompt = `You are the chief editor of a tournament that judges three competing implementations of ONE shared product spec.

Score each candidate 0–1 on:
- clarity: coherent, maintainable structure
- fit: implements SHARED core features, pages, contracts, AND architectureRequirements (penalize missing requirements; do not reward unnecessary infrastructure)
- polish: design craft appropriate to the product domain (not generic AI UI)

FACTUAL EVIDENCE (not opinion):
- FINAL runtime FAILED → severe penalty. Do NOT pick over PASSED/PARTIAL peers.
- Interaction contracts are shared product requirements. A FAILED/TIMEOUT on a [critical] contract is a failed product requirement — heavy penalty vs peers that PASSED the same contract.
- [high] failures matter; [medium] less so. Do not treat all smoke failures equally.
- Architecture FIT: correct minimum architecture. If plan requires database/backend/auth — mock-data-only is a major failure. If plan forbids DB/auth/backend — unnecessary Prisma/PostgreSQL/login is a complexity penalty.
- More infrastructure is NOT automatically better. Simplest architecture that satisfies requirements wins on architecture fit.
- Browser NOT_TESTABLE is neutral (do not invent browser failures).
- Each candidate has at most ONE repair attempt (architecture and/or runtime). Smoke failures are evidence only — never a second repair.
- Evaluate FINAL architecture + FINAL runtime primarily; use repair history for context.
- Successful one-shot repair that ends PASSED/PARTIAL is fully eligible.
- If repair was already consumed and FINAL runtime or architecture still fails → treat as unreliable.
- Unnecessary infrastructure on simple apps is a warning/complexity penalty — not a virtue.
- Do not let subjective polish override obvious contract/runtime/architecture failure.

Composite is the mean after applying reliability penalties. Be terse and editorial.

USER BRIEF:
${brief.slice(0, 2000)}

${requirementsBlock}

${plan ? formatContractsForJudge(plan.interactionContracts) : 'Interaction contracts: (none)'}

CANDIDATES:
${afterSmoke
  .map((r) => {
    const f: any = r.fragment ?? {}
    const summary = summarizeFragmentForJudge(f, 1200)
    return `--- ${r.id.toUpperCase()} (${VARIANTS.find((v) => v.id === r.id)?.label}) ---
title: ${f.title ?? ''}
description: ${f.description ?? ''}
architecture: ${f.architecture ?? ''}
entry: ${f.file_path ?? ''}
${formatRepairHistoryForJudge({
  initial: r.initialVerification,
  final: r.finalVerification,
  repair: r.repairAttempt,
  initialArchitecture: r.initialArchitectureCompliance,
  finalArchitecture: r.architectureCompliance,
})}
${formatSmokeForJudge(r.smoke)}
${summary}`
  })
  .join('\n\n')}`

        const judgeResult = await generateObject({
          model: modelClient as LanguageModel,
          schema: verdictSchema,
          prompt: judgePrompt,
          maxRetries: 0,
          temperature: 0.2,
        })

        let verdict = judgeResult.object
        if (!afterSmoke.find((r) => r.id === verdict.winnerId)) {
          verdict = { ...verdict, winnerId: afterSmoke[0].id }
        }
        const enforced = preferReliableWinner(
          verdict.winnerId,
          afterSmoke.map((v) => ({
            id: v.id,
            verification: v.finalVerification,
            smoke: v.smoke,
            architectureCompliance: v.architectureCompliance,
          })),
        )
        if (enforced !== verdict.winnerId) {
          verdict = {
            ...verdict,
            winnerId: enforced as typeof verdict.winnerId,
            reasoning: `${verdict.reasoning} (Winner adjusted: preferred reliable runnable/architecture/smoke-passing candidate.)`,
          }
        }
        send({ type: 'verdict', verdict })
      } catch {
        const rank = (r: WithSmoke) => {
          let s = 0
          if (r.finalVerification.status === 'passed') s += 4
          else if (r.finalVerification.status === 'partial') s += 3
          if (r.smoke?.status === 'passed') s += 3
          else if (r.smoke?.status === 'failed' || r.smoke?.status === 'timeout')
            s -= 2
          if (r.architectureCompliance?.status === 'passed') s += 3
          else if (r.architectureCompliance?.status === 'failed') s -= 4
          else if (r.architectureCompliance?.status === 'partial') s -= 1
          s += Math.min(1, totalCodeLength(r.fragment) / 4000)
          return s
        }
        const scores = afterSmoke.map((r) => {
          const score = rank(r)
          const clarity = r.finalVerification.status === 'failed' ? 0.4 : 0.7
          const fit = Math.max(0, Math.min(1, score / 10))
          const polish =
            r.smoke?.status === 'passed'
              ? 0.75
              : r.finalVerification.status === 'passed'
                ? 0.65
                : 0.45
          return {
            id: r.id,
            clarity,
            fit,
            polish,
            composite: (clarity + fit + polish) / 3,
            comment:
              r.architectureCompliance?.status === 'failed'
                ? 'Heuristic — architecture compliance failed.'
                : r.smoke?.status === 'failed'
                  ? 'Heuristic — smoke tests failed.'
                  : r.finalVerification.status === 'failed'
                    ? 'Heuristic — final runtime failed.'
                    : 'Heuristic — runtime/architecture/smoke evidence.',
          }
        })
        const winner = scores.reduce((a, b) =>
          a.composite >= b.composite ? a : b,
        )
        send({
          type: 'verdict',
          verdict: {
            winnerId: winner.id,
            reasoning:
              'Heuristic verdict using runtime + architecture + browser smoke evidence.',
            scores,
          },
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

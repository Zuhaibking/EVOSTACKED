'use client'

import type { ArchitectureComplianceResult } from './architecture-compliance'
import { hasFragmentCode } from './fragment'
import type { ApplicationPlan } from './plan'
import type { RepairAttemptRecord, RepairReason } from './repair'
import { FragmentSchema } from './schema'
import type { SmokeSuiteResult } from './smoke'
import { TournamentEvent, VARIANTS, VariantId, Verdict } from './tournament'
import { applySmokeResultToCandidate } from './candidate-smoke'
import type { ProviderBudgetState } from './provider-quota'
import type { ExecutionResult } from './types'
import type { VerificationResult } from './verification'
import type { DeepPartial } from '@evostack/shared'
import { useCallback, useRef, useState } from 'react'

export type CandidateStatus =
  | 'pending'
  | 'generating'
  | 'done'
  | 'architecture_checking'
  | 'architecture_checked'
  | 'architecture_failed'
  | 'architecture_partial'
  | 'verifying'
  | 'verified'
  | 'verify_failed'
  | 'repairing'
  | 'repaired'
  | 'repair_failed'
  | 'testing'
  | 'tested'
  | 'smoke_failed'
  | 'not_testable'
  | 'not_attempted'
  | 'error'
  | 'judging'

export type Candidate = {
  id: VariantId
  label: string
  sigil: string
  status: CandidateStatus
  fragment?: DeepPartial<FragmentSchema>
  error?: string
  verification?: VerificationResult
  initialVerification?: VerificationResult
  finalVerification?: VerificationResult
  repairAttempt?: RepairAttemptRecord | null
  repairReason?: RepairReason | null
  smoke?: SmokeSuiteResult | null
  architectureCompliance?: ArchitectureComplianceResult | null
  initialArchitectureCompliance?: ArchitectureComplianceResult | null
  /** Reusable sandbox execution from tournament verification/repair. */
  execution?: ExecutionResult
  // Judge output
  scoreClarity?: number
  scoreFit?: number
  scorePolish?: number
  scoreComposite?: number
  scoreComment?: string
  isWinner?: boolean
  /** Assigned E2B template id (known even if generation fails). */
  template?: string
  stackLabel?: string
}

const initialCandidates = (): Record<VariantId, Candidate> =>
  Object.fromEntries(
    VARIANTS.map((v) => [
      v.id,
      {
        id: v.id,
        label: v.label,
        sigil: v.sigil,
        status: 'pending',
      } as Candidate,
    ]),
  ) as Record<VariantId, Candidate>

export type TournamentSubmitArgs = {
  messages: any[]
  template: any
  model: any
  config: any
  userID?: string
  teamID?: string
  accessToken?: string
  runId?: string
  /** Optional evolution payload — one user-triggered single-candidate improvement. */
  evolution?: {
    mode: 'evolution'
    candidateMode?: 'single' | 'tournament'
    activeVariantId?: import('./tournament').VariantId
    userRequest: string
    parentVersion: number
    previousScore?: number
    plan: ApplicationPlan
    baselineFragment: any
    iterationContext?: {
      knownIssues?: string[]
      fileTree?: string[]
      summary?: { productName?: string }
      currentVersion?: number
      recentRequests?: string[]
      userRequest?: string
      parentVersion?: number
      previousScore?: number
      baselinePrimaryFile?: string
      baselineTemplate?: string
      activeCandidateId?: import('./tournament').VariantId
    }
  }
}

export type TournamentPhase =
  | 'idle'
  | 'generating'
  | 'architecture'
  | 'verifying'
  | 'repairing'
  | 'testing'
  | 'judging'
  | 'done'

export function useTournament() {
  const [candidates, setCandidates] = useState<Record<VariantId, Candidate>>(
    initialCandidates,
  )
  const [verdict, setVerdict] = useState<Verdict | undefined>()
  const [phase, setPhase] = useState<TournamentPhase>('idle')
  const [error, setError] = useState<string | undefined>()
  const [plan, setPlan] = useState<ApplicationPlan | undefined>()
  const [providerBudget, setProviderBudget] =
    useState<ProviderBudgetState>('ready')
  const abortRef = useRef<AbortController | null>(null)

  const reset = useCallback(() => {
    setCandidates(initialCandidates())
    setVerdict(undefined)
    setError(undefined)
    setPhase('idle')
    setPlan(undefined)
    setProviderBudget('ready')
  }, [])

  const hydrate = useCallback(
    (snap: {
      candidates: Record<VariantId, Candidate>
      verdict?: Verdict
      phase: TournamentPhase
      plan?: ApplicationPlan
    }) => {
      const next = { ...snap.candidates }
      for (const id of Object.keys(next) as VariantId[]) {
        const c = next[id]
        if (
          c.status === 'generating' ||
          c.status === 'judging' ||
          c.status === 'architecture_checking' ||
          c.status === 'verifying' ||
          c.status === 'repairing' ||
          c.status === 'testing'
        ) {
          const ready = hasFragmentCode(c.fragment)
          const final =
            c.finalVerification || c.verification
          next[id] = {
            ...c,
            status: ready
              ? final
                ? final.status === 'failed'
                  ? c.repairAttempt?.attempted
                    ? 'repair_failed'
                    : 'verify_failed'
                  : c.repairAttempt?.success
                    ? 'repaired'
                    : 'verified'
                : 'done'
              : 'error',
            error: ready ? c.error : 'interrupted by reload',
          }
        }
      }
      setCandidates(next)
      setVerdict(snap.verdict)
      setPhase(snap.phase === 'idle' ? 'idle' : 'done')
      if (snap.plan) setPlan(snap.plan)
    },
    [],
  )

  const stop = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setPhase('done')
  }, [])

  const submit = useCallback(
    async (args: TournamentSubmitArgs) => {
      reset()
      setPhase('generating')
      const ctrl = new AbortController()
      abortRef.current = ctrl

      try {
        const { apiFetch } = await import('@/lib/api/client')
        const res = await apiFetch('/v1/tournament', {
          method: 'POST',
          token: args.accessToken,
          body: JSON.stringify(args),
          signal: ctrl.signal,
        })
        if (!res.ok || !res.body) {
          const txt = await res.text().catch(() => '')
          throw new Error(txt || `tournament request failed: ${res.status}`)
        }

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''

        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { value, done } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })

          let idx
          while ((idx = buffer.indexOf('\n\n')) !== -1) {
            const raw = buffer.slice(0, idx)
            buffer = buffer.slice(idx + 2)
            const dataLine = raw
              .split('\n')
              .find((l) => l.startsWith('data: '))
            if (!dataLine) continue
            try {
              const evt = JSON.parse(dataLine.slice(6)) as TournamentEvent
              applyEvent(evt)
            } catch {
              /* ignore parse errors on partial frames */
            }
          }
        }
        setPhase('done')
      } catch (e: any) {
        if (e?.name === 'AbortError') return
        setError(e?.message ?? 'tournament failed')
        setPhase('done')
      } finally {
        abortRef.current = null
      }
    },
    [reset],
  )

  function applyEvent(evt: TournamentEvent) {
    if (evt.type === 'plan') {
      setPlan(evt.plan)
      return
    }
    if (evt.type === 'candidate_start') {
      setCandidates((c) => ({
        ...c,
        [evt.id]: {
          ...c[evt.id],
          status: 'generating',
          template: evt.template || c[evt.id]?.template,
          stackLabel: evt.stackLabel || c[evt.id]?.stackLabel,
        },
      }))
    } else if (evt.type === 'candidate_chunk') {
      setCandidates((c) => ({
        ...c,
        [evt.id]: {
          ...c[evt.id],
          status: 'generating',
          fragment: evt.fragment,
        },
      }))
    } else if (evt.type === 'candidate_done') {
      setCandidates((c) => ({
        ...c,
        [evt.id]: { ...c[evt.id], status: 'done', fragment: evt.fragment },
      }))
    } else if (evt.type === 'candidate_error') {
      setCandidates((c) => ({
        ...c,
        // Only touch this candidate — never wipe siblings' source/execution.
        [evt.id]: {
          ...c[evt.id],
          status: 'error',
          error: evt.error,
          fragment: c[evt.id].fragment,
          execution: c[evt.id].execution,
        },
      }))
    } else if (evt.type === 'candidate_skipped') {
      setCandidates((c) => ({
        ...c,
        [evt.id]: {
          ...c[evt.id],
          status: 'not_attempted',
          error: evt.message,
          // Explicit: never invent fragment / execution for skipped slots.
          fragment: c[evt.id].fragment,
          execution: c[evt.id].execution,
        },
      }))
      setError(evt.message)
    } else if (evt.type === 'provider_quota') {
      setProviderBudget(evt.state)
      if (evt.state !== 'ready') {
        setError(evt.message)
      }
    } else if (evt.type === 'candidate_architecture_checking') {
      setPhase('architecture')
      setCandidates((c) => ({
        ...c,
        [evt.id]: { ...c[evt.id], status: 'architecture_checking' },
      }))
    } else if (evt.type === 'candidate_architecture_checked') {
      const archStatus = evt.architectureCompliance.status
      const status: CandidateStatus =
        archStatus === 'passed'
          ? 'architecture_checked'
          : archStatus === 'partial'
            ? 'architecture_partial'
            : 'architecture_failed'
      setCandidates((c) => ({
        ...c,
        [evt.id]: {
          ...c[evt.id],
          status,
          architectureCompliance: evt.architectureCompliance,
          initialArchitectureCompliance:
            c[evt.id].initialArchitectureCompliance ??
            evt.architectureCompliance,
        },
      }))
    } else if (evt.type === 'candidate_verifying') {
      setPhase('verifying')
      setCandidates((c) => ({
        ...c,
        [evt.id]: { ...c[evt.id], status: 'verifying' },
      }))
    } else if (evt.type === 'candidate_verified') {
      const failed = evt.verification.status === 'failed'
      setCandidates((c) => ({
        ...c,
        [evt.id]: {
          ...c[evt.id],
          status: failed ? 'verify_failed' : 'verified',
          verification: evt.verification,
          initialVerification:
            c[evt.id].initialVerification ?? evt.verification,
          finalVerification: evt.verification,
          // Prefer fresh execution; never wipe a prior URL with an omitted field.
          execution:
            evt.execution !== undefined
              ? evt.execution
              : c[evt.id].execution,
          error: failed
            ? evt.verification.errors[0] || 'Runtime verification failed'
            : undefined,
        },
      }))
    } else if (evt.type === 'candidate_repairing') {
      setPhase('repairing')
      setCandidates((c) => ({
        ...c,
        [evt.id]: {
          ...c[evt.id],
          status: 'repairing',
          repairReason: evt.reason ?? c[evt.id].repairReason,
        },
      }))
    } else if (evt.type === 'candidate_repaired') {
      const finalFailed = evt.finalVerification.status === 'failed'
      setCandidates((c) => ({
        ...c,
        [evt.id]: {
          ...c[evt.id],
          status: finalFailed ? 'repair_failed' : 'repaired',
          fragment: evt.fragment,
          repairAttempt: evt.repairAttempt,
          repairReason: evt.repairAttempt.reason,
          initialVerification: evt.initialVerification,
          finalVerification: evt.finalVerification,
          verification: evt.finalVerification,
          architectureCompliance:
            evt.architectureCompliance ?? c[evt.id].architectureCompliance,
          // Integrity soft-repair may omit execution until deploy finishes —
          // do not clobber a previously stored preview URL with undefined.
          execution:
            evt.execution !== undefined
              ? evt.execution
              : c[evt.id].execution,
          error: finalFailed
            ? evt.finalVerification.errors[0] || 'Repair did not fix runtime'
            : undefined,
        },
      }))
    } else if (evt.type === 'candidate_repair_failed') {
      setCandidates((c) => ({
        ...c,
        [evt.id]: {
          ...c[evt.id],
          status: 'repair_failed',
          repairAttempt: evt.repairAttempt,
          repairReason: evt.repairAttempt.reason,
          initialVerification: evt.initialVerification,
          finalVerification: evt.finalVerification,
          verification: evt.finalVerification,
          architectureCompliance:
            evt.architectureCompliance ?? c[evt.id].architectureCompliance,
          error:
            evt.repairAttempt.error ||
            evt.finalVerification.errors[0] ||
            'Repair failed',
        },
      }))
    } else if (evt.type === 'candidate_testing') {
      setPhase('testing')
      setCandidates((c) => ({
        ...c,
        [evt.id]: { ...c[evt.id], status: 'testing' },
      }))
    } else if (evt.type === 'candidate_tested') {
      setCandidates((c) => ({
        ...c,
        [evt.id]: applySmokeResultToCandidate(c[evt.id], evt.smoke),
      }))
    } else if (evt.type === 'verdict') {
      setVerdict(evt.verdict)
      setPhase('judging')
      setCandidates((c) => {
        const next = { ...c }
        for (const score of evt.verdict.scores) {
          if (next[score.id]) {
            next[score.id] = {
              ...next[score.id],
              scoreClarity: score.clarity,
              scoreFit: score.fit,
              scorePolish: score.polish,
              scoreComposite: score.composite,
              scoreComment: score.comment,
              isWinner: score.id === evt.verdict.winnerId,
            }
          }
        }
        return next
      })
    } else if (evt.type === 'tournament_done') {
      setPhase('done')
    }
  }

  return {
    candidates,
    verdict,
    phase,
    error,
    plan,
    providerBudget,
    submit,
    stop,
    reset,
    hydrate,
  }
}

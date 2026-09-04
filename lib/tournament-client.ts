'use client'

import { FragmentSchema } from './schema'
import { TournamentEvent, VARIANTS, VariantId, Verdict } from './tournament'
import { DeepPartial } from 'ai'
import { useCallback, useRef, useState } from 'react'

export type CandidateStatus =
  | 'pending'
  | 'generating'
  | 'done'
  | 'error'
  | 'judging'

export type Candidate = {
  id: VariantId
  label: string
  sigil: string
  status: CandidateStatus
  fragment?: DeepPartial<FragmentSchema>
  error?: string
  // Judge output
  scoreClarity?: number
  scoreFit?: number
  scorePolish?: number
  scoreComposite?: number
  scoreComment?: string
  isWinner?: boolean
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
}

export function useTournament() {
  const [candidates, setCandidates] = useState<Record<VariantId, Candidate>>(
    initialCandidates,
  )
  const [verdict, setVerdict] = useState<Verdict | undefined>()
  const [phase, setPhase] = useState<'idle' | 'generating' | 'judging' | 'done'>(
    'idle',
  )
  const [error, setError] = useState<string | undefined>()
  const abortRef = useRef<AbortController | null>(null)

  const patchCandidate = useCallback(
    (id: VariantId, patch: Partial<Candidate>) => {
      setCandidates((prev) => {
        const cur = prev[id]
        if (!cur) return prev
        return { ...prev, [id]: { ...cur, ...patch } }
      })
    },
    [],
  )

  const reset = useCallback(() => {
    setCandidates(initialCandidates())
    setVerdict(undefined)
    setError(undefined)
    setPhase('idle')
  }, [])

  // Restore tournament state from a persisted snapshot. Any candidates
  // mid-generation are settled — done if they produced code, otherwise
  // marked as error since their stream was killed by the page reload.
  const hydrate = useCallback(
    (snap: {
      candidates: Record<VariantId, Candidate>
      verdict?: Verdict
      phase: 'idle' | 'generating' | 'judging' | 'done'
    }) => {
      const next = { ...snap.candidates }
      for (const id of Object.keys(next) as VariantId[]) {
        const c = next[id]
        if (c.status === 'generating' || c.status === 'judging') {
          next[id] = {
            ...c,
            status: c.fragment?.code ? 'done' : 'error',
            error: c.fragment?.code ? undefined : 'interrupted by reload',
          }
        }
      }
      setCandidates(next)
      setVerdict(snap.verdict)
      setPhase(snap.phase === 'idle' ? 'idle' : 'done')
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
        const res = await fetch('/api/tournament', {
          method: 'POST',
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

          // Parse complete SSE events from the buffer
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
              // ignore parse errors on partial frames
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
    if (evt.type === 'candidate_start') {
      setCandidates((c) => ({
        ...c,
        [evt.id]: { ...c[evt.id], status: 'generating' },
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
        [evt.id]: { ...c[evt.id], status: 'error', error: evt.error },
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
    submit,
    stop,
    reset,
    hydrate,
    patchCandidate,
  }
}

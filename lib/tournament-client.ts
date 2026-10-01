'use client'

import { FragmentSchema, fragmentCodeText } from './schema'
import { TournamentEvent, VARIANTS, VariantId, Verdict } from './tournament'
import type { CandidateHealth } from './candidate-health'
import type { ExecutionResult } from './types'
import { DeepPartial } from 'ai'
import { useCallback, useEffect, useRef, useState } from 'react'

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
  health?: CandidateHealth
  sandboxStatus?: 'starting' | 'ready' | 'error'
  sandboxError?: string
  runtimeError?: string
  result?: ExecutionResult
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
  projectID?: string
  runID?: string
  seedCandidates?: Partial<Record<VariantId, FragmentSchema>>
}

export type TournamentResumeArgs = { projectID: string; runID: string }

const runPath = ({ projectID, runID }: TournamentResumeArgs) =>
  `/api/tournament?${new URLSearchParams({ projectID, runID })}`

export function useTournament() {
  const [candidates, setCandidates] = useState<Record<VariantId, Candidate>>(
    initialCandidates,
  )
  const [verdict, setVerdict] = useState<Verdict | undefined>()
  const [phase, setPhase] = useState<'idle' | 'generating' | 'judging' | 'done'>(
    'idle',
  )
  const [error, setError] = useState<string | undefined>()
  const [runID, setRunID] = useState<string | undefined>()
  const [canResume, setCanResume] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const runRef = useRef<{ projectID?: string; runID: string } | null>(null)

  useEffect(() => () => { abortRef.current?.abort() }, [])

  // Switching workspaces only detaches this browser. The server job keeps running.
  const detach = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
  }, [])

  const reset = useCallback(() => {
    detach()
    runRef.current = null
    setRunID(undefined)
    setCanResume(false)
    setCandidates(initialCandidates())
    setVerdict(undefined)
    setError(undefined)
    setPhase('idle')
  }, [detach])

  const hydrate = useCallback(
    (snap: {
      candidates: Record<VariantId, Candidate>
      verdict?: Verdict
      phase: 'idle' | 'generating' | 'judging' | 'done'
      runID?: string
      projectID?: string
    }) => {
      detach()
      runRef.current = snap.runID ? { projectID: snap.projectID, runID: snap.runID } : null
      setRunID(snap.runID)
      setCanResume(Boolean(snap.runID))
      let interrupted = false
      const next = { ...snap.candidates }
      for (const id of Object.keys(next) as VariantId[]) {
        let candidate = next[id]
        if (candidate.sandboxStatus === 'starting') {
          candidate = { ...candidate, sandboxStatus: undefined, sandboxError: undefined }
        }
        // Older snapshots settled unfinished work as errors on reload. They can
        // now reconnect; a partial fragment is never proof of completed output.
        if (candidate.status === 'error' && candidate.error === 'interrupted by reload') {
          interrupted = true
          candidate = { ...candidate, status: candidate.fragment ? 'generating' : 'pending', error: undefined }
        }
        next[id] = candidate
      }
      setCandidates(next)
      setVerdict(snap.verdict)
      setError(undefined)
      setPhase(interrupted ? 'generating' : snap.phase)
    },
    [detach],
  )

  const stop = useCallback(() => {
    const run = runRef.current
    detach()
    setCanResume(false)
    setCandidates((current) => Object.fromEntries(
      Object.entries(current).map(([id, candidate]) => {
        if (!['pending', 'generating', 'judging'].includes(candidate.status)) return [id, candidate]
        return [id, { ...candidate, status: 'error', error: 'canceled' }]
      }),
    ) as Record<VariantId, Candidate>)
    setPhase('done')
    // Retain the run identity so a canceled snapshot cannot start a fresh job.
    if (run?.projectID) {
      fetch(runPath({ projectID: run.projectID, runID: run.runID }), { method: 'DELETE' }).catch(() => {
        if (runRef.current === run) setError('Could not confirm cancellation with the server.')
      })
    }
  }, [detach])

  const applyEvent = useCallback((evt: TournamentEvent) => {
    if (evt.type === 'candidate_start' || evt.type === 'candidate_chunk' || evt.type === 'candidate_done' || evt.type === 'candidate_error') {
      setCandidates((current) => {
        const candidate = current[evt.id]
        if (!candidate) return current
        // Replayed events describe original model output. A completed local
        // source may already contain inspector edits or a restored version.
        if (candidate.status === 'done' && fragmentCodeText(candidate.fragment?.code).trim()) return current
        if (evt.type === 'candidate_start') {
          return { ...current, [evt.id]: { ...candidate, status: 'generating', error: undefined } }
        }
        if (evt.type === 'candidate_chunk' || evt.type === 'candidate_done') {
          return { ...current, [evt.id]: { ...candidate, status: evt.type === 'candidate_done' ? 'done' : 'generating', fragment: evt.fragment, error: undefined } }
        }
        return { ...current, [evt.id]: { ...candidate, status: 'error', error: evt.error } }
      })
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
      setCanResume(false)
      setPhase('done')
    }
  }, [])

  const readStream = useCallback(async (res: Response, ctrl: AbortController) => {
    const isCurrent = () => abortRef.current === ctrl && !ctrl.signal.aborted
    if (!res.ok || !res.body) {
      const txt = await res.text().catch(() => '')
      throw new Error(res.status === 404
        ? 'This saved generation is no longer available on the server. Your saved source is intact; start a new generation to continue.'
        : txt || `tournament request failed: ${res.status}`)
    }
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let completed = false
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { value, done } = await reader.read()
      if (!isCurrent()) return
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let idx
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const raw = buffer.slice(0, idx)
        buffer = buffer.slice(idx + 2)
        const dataLine = raw.split('\n').find((line) => line.startsWith('data: '))
        if (!dataLine) continue
        let evt: TournamentEvent
        try { evt = JSON.parse(dataLine.slice(6)) as TournamentEvent } catch { continue }
        if (!isCurrent()) return
        if (evt.type === 'tournament_done') completed = true
        applyEvent(evt)
      }
    }
    if (isCurrent() && !completed) throw new Error('Generation connection closed before completion. Reopen this workspace to reconnect to the saved run.')
  }, [applyEvent])

  const connect = useCallback(async (args: TournamentResumeArgs | TournamentSubmitArgs, fresh: boolean, preserveCompleted = false) => {
    detach()
    const id = args.runID ?? (typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `r_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`)
    const run = { projectID: args.projectID, runID: id }
    runRef.current = run
    setRunID(id)
    setError(undefined)
    setPhase('generating')
    if (fresh) {
      setCanResume(false)
      setCandidates((current) => {
        const next = initialCandidates()
        for (const key of Object.keys(next) as VariantId[]) {
          if (preserveCompleted && current[key].status === 'done' && fragmentCodeText(current[key].fragment?.code).trim()) {
            next[key] = current[key].sandboxStatus === 'starting'
              ? { ...current[key], sandboxStatus: undefined, sandboxError: undefined }
              : current[key]
          }
        }
        for (const [candidateID, fragment] of Object.entries((args as TournamentSubmitArgs).seedCandidates ?? {})) {
          if (candidateID in next && fragmentCodeText(fragment?.code).trim()) {
            const key = candidateID as VariantId
            if (next[key].status !== 'done') next[key] = { ...next[key], status: 'done', fragment }
          }
        }
        return next
      })
      setVerdict(undefined)
      setPhase('generating')
    }
    const ctrl = new AbortController()
    abortRef.current = ctrl
    const isCurrent = () => abortRef.current === ctrl && !ctrl.signal.aborted
    let receivedResponse = false
    try {
      const res = await fetch(fresh ? '/api/tournament' : runPath(args as TournamentResumeArgs), {
        method: fresh ? 'POST' : 'GET',
        ...(fresh ? { body: JSON.stringify({ ...args, runID: id }), headers: { 'Content-Type': 'application/json' } } : {}),
        signal: ctrl.signal,
      })
      receivedResponse = true
      if (!isCurrent()) return
      if (res.status >= 400 && res.status < 500) setCanResume(false)
      else if ((res.ok && res.body) || run.projectID) setCanResume(true)
      await readStream(res, ctrl)
    } catch (e: any) {
      if (!isCurrent() || e?.name === 'AbortError') return
      // A POST can reach the server even when its response headers never reach
      // this tab. Check the saved identity before authorizing another paid run.
      if (!receivedResponse && run.projectID) setCanResume(true)
      const message = e?.message ?? 'tournament failed'
      setError(message)
      setCandidates((current) => Object.fromEntries(Object.entries(current).map(([candidateID, candidate]) => [candidateID,
        ['pending', 'generating', 'judging'].includes(candidate.status) ? { ...candidate, status: 'error', error: message } : candidate,
      ])) as Record<VariantId, Candidate>)
      setPhase('done')
    } finally {
      if (abortRef.current === ctrl) abortRef.current = null
    }
  }, [detach, readStream])

  const submit = useCallback((args: TournamentSubmitArgs, preserveCompleted = false) => connect(args, true, preserveCompleted), [connect])
  const resume = useCallback((args: TournamentResumeArgs) => connect(args, false), [connect])

  const noteHealth = useCallback((id: VariantId, health: CandidateHealth) => {
    setCandidates((c) => {
      if (!c[id]) return c
      return { ...c, [id]: { ...c[id], health } }
    })
  }, [])

  const noteSandbox = useCallback((id: VariantId, update: Partial<Pick<Candidate, 'sandboxStatus' | 'sandboxError' | 'runtimeError' | 'result' | 'fragment'>>) => {
    setCandidates((c) => {
      if (!c[id]) return c
      const health = update.result && 'health' in update.result ? update.result.health : c[id].health
      return { ...c, [id]: { ...c[id], ...update, health } }
    })
  }, [])

  return {
    candidates,
    verdict,
    phase,
    error,
    runID,
    canResume,
    submit,
    resume,
    detach,
    stop,
    reset,
    hydrate,
    noteHealth,
    noteSandbox,
  }
}

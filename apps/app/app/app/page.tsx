'use client'

import { AskEvoStack } from '@/components/ask-evostack'
import { ActiveVersionPicker } from '@/components/active-version-picker'
import { AuthDialog, ViewType } from '@/components/auth-dialog'
import { Chat } from '@/components/chat'
import { ChatInput } from '@/components/chat-input'
import { ChatPicker } from '@/components/chat-picker'
import { ChatSettings } from '@/components/chat-settings'
import { ImproveAppPanel } from '@/components/improve-app-panel'
import { NavBar } from '@/components/navbar'
import { Preview } from '@/components/preview'
import { ProjectBrainPanel } from '@/components/project-brain-panel'
import { SpecimenStrip } from '@/components/specimen-strip'
import { VersionVaultPanel } from '@/components/version-vault-panel'
import { providerBudgetLabel } from '@/lib/provider-quota'
import { useAuth } from '@/lib/auth'
import { calculateAppHealth } from '@/lib/app-health'
import {
  applyEvolutionToBrain,
  buildEvolutionApiPayload,
  buildIterationContext,
  completeEvolutionRound,
  createEvolutionRound,
  EvolutionRound,
  failEvolutionRound,
  INITIAL_TOURNAMENT_CANDIDATE_COUNT,
  ITERATION_CANDIDATE_COUNT,
  preserveBrainAfterFailedEvolution,
  shouldPromoteEvolutionWinner,
  startEvolutionRound,
} from '@/lib/evolution'
import { buildEvolutionReport } from '@/lib/evolution-report'
import { Message, toAISDKMessages, toMessageImage } from '@/lib/messages'
import { LLMModel, LLMModelConfig } from '@/lib/model-catalog'
import modelsList from '@/lib/models.json'
import {
  fragmentCodeEqual,
  getPrimaryFileContent,
  hasFragmentCode,
} from '@/lib/fragment'
import {
  retainTournamentCandidates,
} from '@/lib/tournament-candidates'
import { buildCandidatePreviewAction } from '@/lib/candidate-preview'
import {
  buildBrainFromTournament,
  ProjectBrain,
  selectActiveProjectVersion,
} from '@/lib/project-brain'
import { FragmentSchema } from '@/lib/schema'
import type { SmokeSuiteResult } from '@/lib/smoke'
import { diffFragments } from '@/lib/source-diff'
import templates from '@/lib/templates'
import { VariantId, VARIANTS } from '@/lib/tournament'
import { useTournament, type Candidate } from '@/lib/tournament-client'
import { ExecutionResult } from '@/lib/types'
import {
  buildVersionSnapshot,
  clearVaultForRun,
  createVaultRunId,
  restoreFromSnapshot,
  type VersionSnapshot,
} from '@/lib/version-vault'
import type { DeepPartial } from '@evostack/shared'
import {
  apiFetch,
  createRun,
  getRun,
  getRunBrain,
  getRunMessages,
  getRunVersions,
  patchRun,
  saveRunBrain,
  saveRunVersion,
} from '@/lib/api/client'
import { usePostHog } from 'posthog-js/react'
import { SetStateAction, useEffect, useMemo, useRef, useState } from 'react'
import { useLocalStorage } from 'usehooks-ts'

export default function Home() {
  const [chatInput, setChatInput] = useLocalStorage('chat', '')
  const [files, setFiles] = useState<File[]>([])
  const [selectedTemplate, setSelectedTemplate] = useState<string>(
    'auto',
  )
  const [languageModel, setLanguageModel] = useLocalStorage<LLMModelConfig>(
    'languageModel',
    {
      model: 'gpt-4.1',
    },
  )

  const posthog = usePostHog()

  const [result, setResult] = useState<ExecutionResult>()
  const [messages, setMessages] = useState<Message[]>([])
  const [fragment, setFragment] = useState<DeepPartial<FragmentSchema>>()
  const [currentTab, setCurrentTab] = useState<'code' | 'fragment'>('code')
  const [isPreviewLoading, setIsPreviewLoading] = useState(false)
  const [isAuthDialogOpen, setAuthDialog] = useState(false)
  const [authView, setAuthView] = useState<ViewType>('sign_in')
  const [isRateLimited, setIsRateLimited] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [selectedCandidate, setSelectedCandidate] = useState<VariantId | undefined>()
  const [hasTournament, setHasTournament] = useState(false)
  const [projectBrain, setProjectBrain] = useState<ProjectBrain | null>(null)
  const [evolutionRound, setEvolutionRound] = useState<EvolutionRound | null>(
    null,
  )
  const [evolutionBaseline, setEvolutionBaseline] = useState<
    DeepPartial<FragmentSchema> | undefined
  >()
  const [evolutionParentEvidence, setEvolutionParentEvidence] = useState<{
    runtime?: string
    architecture?: string
    smoke?: SmokeSuiteResult | null
  } | null>(null)
  /** Keeps initial Product/Premium/Innovate metadata after single-candidate iteration. */
  const [specimenArchive, setSpecimenArchive] = useState<Record<
    VariantId,
    Candidate
  > | null>(null)
  const [vaultSnapshots, setVaultSnapshots] = useState<VersionSnapshot[]>([])
  const [vaultRefreshKey, setVaultRefreshKey] = useState(0)
  /** Scopes Version Vault to this project/run — never the legacy global key. */
  const [vaultRunId, setVaultRunId] = useState<string | null>(null)
  const vaultRunIdRef = useRef<string | null>(null)
  const evolutionActiveRef = useRef(false)
  /** When true, skip the auto-select effect so explicit Preview clicks win. */
  const previewClickOverrideRef = useRef(false)
  const tournament = useTournament()
  const { session, userTeam, signOut, getAccessToken } = useAuth(
    setAuthDialog,
    setAuthView,
  )
  const accessTokenRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    accessTokenRef.current = session?.access_token
  }, [session?.access_token])
  const [useMorphApply, setUseMorphApply] = useLocalStorage(
    'useMorphApply',
    process.env.NEXT_PUBLIC_USE_MORPH_APPLY === 'true',
  )

  const hideLocalModels =
    !!process.env.NEXT_PUBLIC_HIDE_LOCAL_MODELS ||
    process.env.NEXT_PUBLIC_VERCEL_ENV === 'production' ||
    process.env.NEXT_PUBLIC_VERCEL_ENV === 'preview'

  const filteredModels = (modelsList.models as LLMModel[]).filter((model) => {
    if (hideLocalModels && (model.localOnly || model.providerId === 'ollama')) {
      return false
    }
    return true
  })

  const defaultModel = filteredModels.find(
    (model) => model.id === 'gpt-4.1',
  ) || filteredModels[0]

  const currentModel = filteredModels.find(
    (model) => model.id === languageModel.model,
  ) || defaultModel

  // Update localStorage if stored model no longer exists
  useEffect(() => {
    if (languageModel.model && !filteredModels.find((m) => m.id === languageModel.model)) {
      setLanguageModel({ ...languageModel, model: defaultModel.id })
    }
  }, [languageModel.model])

  // Prefill chat input from landing-page prompt (?prompt=...)
  // Read directly from window to avoid forcing /app out of static prerender.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const incoming = new URLSearchParams(window.location.search).get('prompt')
    if (incoming && incoming.length > 0) {
      setChatInput(incoming)
    }
    // run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---- Persistence: browser keeps metadata only ----
  const META_KEY = 'evostack:ui:v1'
  const [hydrated, setHydrated] = useState(false)
  const [chatLoading, setChatLoading] = useState(false)
  const [memoryRevision, setMemoryRevision] = useState(0)
  const skipBrainPushRef = useRef(true)
  const chatAbortRef = useRef<AbortController | null>(null)

  function applyVaultRunId(id: string) {
    vaultRunIdRef.current = id
    setVaultRunId(id)
  }

  /** New project/run → empty Version Vault (does not touch other runs' data). */
  function beginNewVaultRun() {
    const id = createVaultRunId()
    applyVaultRunId(id)
    try {
      clearVaultForRun(id)
    } catch {
      /* ignore */
    }
    setVaultSnapshots([])
    setVaultRefreshKey((k) => k + 1)
    return id
  }

  // Hydrate once on mount — metadata only. Messages/brain/vault come from Nest.
  useEffect(() => {
    if (typeof window === 'undefined') return
    let snapRunId: string | null = null
    try {
      const raw = localStorage.getItem(META_KEY)
      if (raw) {
        const snap = JSON.parse(raw)
        if (typeof snap?.runId === 'string' && snap.runId.trim()) {
          snapRunId = snap.runId.trim()
        }
        if (snap?.selectedCandidate) setSelectedCandidate(snap.selectedCandidate)
        if (snap?.hasTournament) setHasTournament(!!snap.hasTournament)
        if (typeof snap?.memoryRevision === 'number') {
          setMemoryRevision(snap.memoryRevision)
        }
      }
    } catch {
      // ignore corrupted snapshots
    } finally {
      applyVaultRunId(snapRunId || createVaultRunId())
      setVaultSnapshots([])
      setHydrated(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function refreshVaultList() {
    setVaultRefreshKey((k) => k + 1)
  }

  function persistVaultSnapshot(snapshot: VersionSnapshot) {
    setVaultSnapshots((prev) => {
      const next = [
        ...prev.filter((s) => s.version !== snapshot.version),
        snapshot,
      ].sort((a, b) => a.version - b.version)
      return next
    })
    refreshVaultList()
    const id = vaultRunIdRef.current
    const token = accessTokenRef.current
    if (!id || !token) return
    void saveRunVersion(id, snapshot.version, snapshot, token)
  }

  useEffect(() => {
    if (!hydrated || typeof window === 'undefined') return
    try {
      localStorage.setItem(
        META_KEY,
        JSON.stringify({
          runId: vaultRunIdRef.current,
          selectedCandidate,
          hasTournament,
          activeVersion: projectBrain?.activeVersion ?? null,
          memoryRevision,
        }),
      )
    } catch {
      /* ignore quota */
    }
  }, [
    hydrated,
    vaultRunId,
    selectedCandidate,
    hasTournament,
    projectBrain?.activeVersion,
    memoryRevision,
  ])

  useEffect(() => {
    const runId = vaultRunIdRef.current
    const token = session?.access_token
    if (!hydrated || !runId || !token) return
    let cancelled = false
    ;(async () => {
      try {
        let meta
        try {
          meta = await getRun(runId, token)
        } catch {
          await createRun(token, runId)
          meta = await getRun(runId, token)
        }
        if (cancelled) return
        if (meta.hasTournament) setHasTournament(true)
        setMemoryRevision(meta.memoryRevision)
        if (meta.selectedCandidate) {
          setSelectedCandidate(meta.selectedCandidate as VariantId)
        }
        const [serverMessages, brain, versions] = await Promise.all([
          getRunMessages(runId, token),
          getRunBrain(runId, token),
          getRunVersions(runId, token),
        ])
        if (cancelled) return
        if (Array.isArray(serverMessages) && serverMessages.length) {
          setMessages(serverMessages as Message[])
        }
        if (brain && typeof brain === 'object') {
          skipBrainPushRef.current = true
          setProjectBrain(brain as ProjectBrain)
        } else {
          skipBrainPushRef.current = false
        }
        if (Array.isArray(versions)) {
          setVaultSnapshots(
            versions.filter((v: VersionSnapshot) => v?.fragment),
          )
        }
      } catch {
        skipBrainPushRef.current = false
      }
    })()
    return () => {
      cancelled = true
    }
  }, [hydrated, session?.access_token, vaultRunId])

  useEffect(() => {
    if (!hydrated || !projectBrain) return
    if (skipBrainPushRef.current) {
      skipBrainPushRef.current = false
      return
    }
    const runId = vaultRunIdRef.current
    const token = accessTokenRef.current
    if (!runId || !token) return
    void saveRunBrain(runId, projectBrain, token)
  }, [hydrated, projectBrain])

  useEffect(() => {
    const runId = vaultRunIdRef.current
    const token = accessTokenRef.current
    if (!hydrated || !runId || !token) return
    void patchRun(
      runId,
      {
        selectedCandidate: selectedCandidate ?? null,
        hasTournament,
        activeVersion: projectBrain?.activeVersion ?? null,
      },
      token,
    ).catch(() => {})
  }, [
    hydrated,
    selectedCandidate,
    hasTournament,
    projectBrain?.activeVersion,
    session?.access_token,
  ])
  const currentTemplate =
    selectedTemplate === 'auto'
      ? templates
      : { [selectedTemplate]: templates[selectedTemplate] }
  const lastMessage = messages[messages.length - 1]

  const evolutionSourceDiff = useMemo(() => {
    if (evolutionRound?.status !== 'succeeded' || !evolutionBaseline) return null
    const winnerId = evolutionRound.winnerId
    const winnerFrag = winnerId
      ? tournament.candidates[winnerId]?.fragment
      : undefined
    if (!winnerFrag) return null
    return diffFragments(evolutionBaseline, winnerFrag)
  }, [
    evolutionRound?.status,
    evolutionRound?.winnerId,
    evolutionBaseline,
    tournament.candidates,
  ])

  const evolutionReport = useMemo(() => {
    if (
      evolutionRound?.status !== 'succeeded' ||
      !evolutionSourceDiff ||
      !evolutionRound
    ) {
      return null
    }
    const winnerId = evolutionRound.winnerId
    const winner = winnerId ? tournament.candidates[winnerId] : undefined
    return buildEvolutionReport({
      round: evolutionRound,
      diff: evolutionSourceDiff,
      evidence: {
        parentRuntime: evolutionParentEvidence?.runtime,
        parentArchitecture: evolutionParentEvidence?.architecture,
        parentSmoke: evolutionParentEvidence?.smoke,
        winnerRuntime:
          winner?.finalVerification?.status || winner?.verification?.status,
        winnerArchitecture: winner?.architectureCompliance?.status,
        winnerSmoke: winner?.smoke ?? null,
        verdict: tournament.verdict,
        newVersion: projectBrain?.currentVersion,
      },
    })
  }, [
    evolutionRound,
    evolutionSourceDiff,
    evolutionParentEvidence,
    tournament.candidates,
    tournament.verdict,
    projectBrain?.currentVersion,
  ])

  /** Deterministic health for the active version — zero API/provider calls. */
  const appHealth = useMemo(() => {
    if (!projectBrain?.activeCandidateId) return null
    const activeVer = projectBrain.activeVersion ?? projectBrain.currentVersion
    const snapshot =
      activeVer != null
        ? vaultSnapshots.find((s) => s.version === activeVer) ?? null
        : null
    return calculateAppHealth({ brain: projectBrain, snapshot })
  }, [projectBrain, vaultSnapshots])

  /** Retained Product / Premium / Innovate pool for inspection. */
  const retainedCandidates = useMemo(
    () =>
      retainTournamentCandidates(specimenArchive || tournament.candidates),
    [specimenArchive, tournament.candidates],
  )

  const selectedPreviewNotice = useMemo(() => {
    if (!selectedCandidate) return null
    const c = retainedCandidates[selectedCandidate]
    if (!c) return null
    const action = buildCandidatePreviewAction(c)
    if (!action || action.showIframe) return null
    return (
      action.unavailableReason ||
      'Runtime deployment did not produce a preview URL for this candidate.'
    )
  }, [selectedCandidate, retainedCandidates])

  // Silence unused invariant (kept for documentation / external imports).
  void INITIAL_TOURNAMENT_CANDIDATE_COUNT
  void ITERATION_CANDIDATE_COUNT
  void VARIANTS

  const shouldUseMorph =
    useMorphApply && !!fragment && hasFragmentCode(fragment) && !!fragment.file_path
  const isLoading = chatLoading || tournament.phase === 'generating'
  function stop() {
    chatAbortRef.current?.abort()
    chatAbortRef.current = null
    setChatLoading(false)
    tournament.stop()
  }

  async function deployFragment(nextFragment: DeepPartial<FragmentSchema>) {
    setIsPreviewLoading(true)
    posthog.capture('fragment_generated', { template: nextFragment?.template })
    setFragment(nextFragment)
    const response = await apiFetch('/v1/sandbox', {
      method: 'POST',
      token: accessTokenRef.current || session?.access_token,
      body: JSON.stringify({
        fragment: nextFragment,
        runId: vaultRunIdRef.current,
      }),
    })
    const result = await response.json()
    if (
      !response.ok ||
      result?.code === 'FRAGMENT_INTEGRITY_FAILED' ||
      (result?.error && !result?.sbxId && !result?.url)
    ) {
      setErrorMessage(
        result?.error ||
          'Fragment failed integrity validation and was not deployed.',
      )
      setResult(undefined)
      setCurrentTab('code')
      setIsPreviewLoading(false)
      return
    }
    posthog.capture('sandbox_created', { url: result.url })
    setResult(result)
    setCurrentPreview({ fragment: nextFragment, result })
    setMessage({ result })
    setCurrentTab('fragment')
    setIsPreviewLoading(false)
  }

  async function submit(payload: Record<string, unknown>) {
    const runId = vaultRunIdRef.current
    if (!runId) return
    const token = (await getAccessToken()) || accessTokenRef.current
    if (!token) {
      setAuthDialog(true)
      return
    }
    const ctrl = new AbortController()
    chatAbortRef.current = ctrl
    setChatLoading(true)
    setErrorMessage('')
    try {
      const path = shouldUseMorph ? '/v1/morph' : '/v1/chat'
      const res = await apiFetch(path, {
        method: 'POST',
        token,
        signal: ctrl.signal,
        body: JSON.stringify({ ...payload, runId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        const msg = data?.error || data?.message || `Request failed: ${res.status}`
        if (String(msg).includes('limit')) setIsRateLimited(true)
        setErrorMessage(typeof msg === 'string' ? msg : 'Chat failed')
        return
      }
      if (typeof data?.memoryRevision === 'number') {
        setMemoryRevision(data.memoryRevision)
      }
      if (data?.runId && data.runId !== runId) {
        applyVaultRunId(data.runId)
      }
      if (Array.isArray(data?.messages) && data.messages.length) {
        setMessages(data.messages as Message[])
      }
      const nextFragment = data?.fragment
      if (nextFragment?.file_path || nextFragment?.code) {
        await deployFragment(nextFragment)
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') return
      setErrorMessage(err?.message || 'Chat failed')
    } finally {
      setChatLoading(false)
      chatAbortRef.current = null
    }
  }

  // Do not auto-activate a specimen — user must click "Use this version".
  // Preview selection remains manual via SpecimenStrip / ActiveVersionPicker.

  // Build / refresh Project Brain when an initial tournament completes (no extra LLM calls).
  // Does not record v1 until the user selects an active version.
  useEffect(() => {
    if (evolutionActiveRef.current || evolutionRound?.status === 'running') {
      return
    }
    if (tournament.phase !== 'done' || !tournament.verdict) return
    // Skip brain rebuild when this completion was a single-candidate iteration.
    if (evolutionRound?.candidateMode === 'single') return
    const winnerId = tournament.verdict.winnerId
    const winner = tournament.candidates[winnerId]
    if (!winner?.fragment) return

    const firstUser = messages.find((m) => m.role === 'user')
    const userRequest =
      firstUser?.content
        ?.filter((p) => p.type === 'text')
        .map((p) => ('text' in p ? String(p.text) : ''))
        .join('\n')
        .trim() || undefined

    setProjectBrain((prev) =>
      buildBrainFromTournament({
        previous: prev,
        plan: tournament.plan,
        fragment: winner.fragment,
        winnerId,
        verification: winner.finalVerification || winner.verification,
        architectureCompliance: winner.architectureCompliance,
        smoke: winner.smoke ?? null,
        verdict: tournament.verdict,
        repairAttempt: winner.repairAttempt ?? null,
        userRequest,
      }),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    tournament.phase,
    tournament.verdict,
    tournament.plan,
    tournament.candidates,
    evolutionRound?.status,
    evolutionRound?.candidateMode,
  ])

  // Archive ALL initial tournament specimens (including failed ones) so
  // iteration never erases Product / Premium / Innovate for inspection.
  useEffect(() => {
    if (tournament.phase !== 'done' || !tournament.verdict) return
    if (evolutionRound?.candidateMode === 'single') return
    setSpecimenArchive(retainTournamentCandidates(tournament.candidates))
  }, [
    tournament.phase,
    tournament.verdict,
    tournament.candidates,
    evolutionRound?.candidateMode,
  ])

  // Surface provider quota messages in the existing chat error strip.
  // Never clears Project Brain / Version Vault / activeVersion / previews.
  useEffect(() => {
    if (!tournament.error) return
    setErrorMessage(tournament.error)
    if (
      tournament.providerBudget === 'daily_limit_reached' ||
      tournament.providerBudget === 'rate_limited' ||
      tournament.providerBudget === 'temporarily_rate_limited'
    ) {
      setIsRateLimited(true)
    }
  }, [tournament.error, tournament.providerBudget])

  // Finalize one user-triggered evolution round (promote only on success).
  useEffect(() => {
    if (evolutionRound?.status !== 'running') return
    if (tournament.phase !== 'done') return

    const candidateList = Object.values(tournament.candidates)
    const canPromote =
      !!tournament.verdict &&
      shouldPromoteEvolutionWinner({
        verdict: tournament.verdict,
        candidates: candidateList,
      })

    if (!canPromote || !tournament.verdict) {
      const failed = failEvolutionRound(
        evolutionRound,
        tournament.error ||
          'Evolution failed — no reliable improved candidate. Kept current version.',
      )
      setEvolutionRound(failed)
      setProjectBrain((prev) =>
        prev ? preserveBrainAfterFailedEvolution(prev, failed) : prev,
      )
      evolutionActiveRef.current = false
      return
    }

    const winner = tournament.candidates[tournament.verdict.winnerId]
    const completed = completeEvolutionRound(evolutionRound, {
      verdict: tournament.verdict,
      candidates: candidateList.map((c) => ({
        id: c.id,
        finalVerification: c.finalVerification,
        verification: c.verification,
        smoke: c.smoke,
      })),
    })
    setEvolutionRound(completed)
    setProjectBrain((prev) => {
      if (!prev) return prev
      const next = applyEvolutionToBrain(prev, completed, {
        verdict: tournament.verdict!,
        fragment: winner?.fragment,
        verification: winner?.finalVerification || winner?.verification,
        architectureCompliance: winner?.architectureCompliance
          ? {
              status: winner.architectureCompliance.status,
              summary: winner.architectureCompliance.summary,
            }
          : null,
        smoke: winner?.smoke
          ? {
              status: winner.smoke.status,
              summary: winner.smoke.summary,
            }
          : null,
        repairAttempt: winner?.repairAttempt ?? null,
      })
      if (winner?.fragment) {
        const ver = next.versions[next.versions.length - 1]
        persistVaultSnapshot(
          buildVersionSnapshot({
            version: next.currentVersion,
            parentVersion: completed.parentVersion,
            label: ver?.label || completed.userRequest || `v${next.currentVersion}`,
            userRequest: completed.userRequest,
            summary: tournament.verdict?.reasoning,
            fragment: winner.fragment as DeepPartial<FragmentSchema>,
            plan: next.plan || tournament.plan,
            activeCandidateId: tournament.verdict!.winnerId,
            compositeScore: completed.newScore != null
              ? completed.newScore / 100
              : ver?.compositeScore,
            runtimeStatus:
              winner.finalVerification?.status || winner.verification?.status,
            smokeStatus: winner.smoke?.status,
            architectureStatus: winner.architectureCompliance?.status,
            previewReachable:
              winner.finalVerification?.previewReachable ||
              winner.verification?.previewReachable,
            execution: winner.execution,
          }),
        )
      }
      return next
    })
    if (winner) {
      setSpecimenArchive((prev) => {
        if (!prev) return prev
        const id = winner.id
        return {
          ...prev,
          [id]: {
            ...prev[id],
            ...winner,
            isWinner: true,
          },
        }
      })
    }
    evolutionActiveRef.current = false
    setSelectedCandidate(tournament.verdict.winnerId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tournament.phase, tournament.verdict, tournament.error, evolutionRound?.status])

  useEffect(() => {
    if (tournament.phase !== 'done') return
    const runId = vaultRunIdRef.current
    const token = accessTokenRef.current
    if (!runId || !token) return
    getRunMessages(runId, token)
      .then((serverMessages) => {
        if (Array.isArray(serverMessages) && serverMessages.length) {
          setMessages(serverMessages as Message[])
        }
      })
      .catch(() => {})
    getRun(runId, token)
      .then((meta) => setMemoryRevision(meta.memoryRevision))
      .catch(() => {})
  }, [tournament.phase])

  // Whenever the user picks a candidate (strip click), show THAT candidate.
  // Explicit [PREVIEW] clicks set previewClickOverrideRef and own the pane.
  useEffect(() => {
    // Keep the working app on screen while evolution candidates are still running.
    if (evolutionActiveRef.current && evolutionRound?.status === 'running') {
      return
    }
    if (previewClickOverrideRef.current) {
      previewClickOverrideRef.current = false
      return
    }
    if (!selectedCandidate) return
    const pool = retainTournamentCandidates(
      specimenArchive || tournament.candidates,
    )
    const c = pool[selectedCandidate]
    if (
      !c?.fragment ||
      c.status === 'generating' ||
      c.status === 'verifying' ||
      c.status === 'architecture_checking' ||
      c.status === 'repairing' ||
      c.status === 'testing'
    ) {
      return
    }

    const next = c.fragment as DeepPartial<FragmentSchema>
    const sameCodeAlreadyRunning =
      !!result && !!fragment && fragmentCodeEqual(fragment, next)
    setFragment(next)

    // Capture selected candidate in the chat transcript (inspectable).
    if (!sameCodeAlreadyRunning) {
      const content: Message['content'] = [
        { type: 'text', text: next.commentary || '' },
        { type: 'code', text: getPrimaryFileContent(next) },
      ]
      setMessages((prev) => {
        const last = prev[prev.length - 1]
        if (last && last.role === 'assistant') {
          const copy = [...prev]
          copy[copy.length - 1] = { ...last, content, object: next }
          return copy
        }
        return [...prev, { role: 'assistant', content, object: next }]
      })
    }

    const action = buildCandidatePreviewAction(c)
    if (action?.showIframe && action.result) {
      setResult(action.result)
      setCurrentTab('fragment')
      setIsPreviewLoading(false)
      return
    }

    // No reusable Preview for this candidate — clear prior candidate's URL.
    setResult(undefined)
    setCurrentTab(action?.tab === 'fragment' ? 'fragment' : 'code')
    setIsPreviewLoading(false)

    // Only attempt a fresh sandbox deploy when runtime did not already fail.
    const runtimeStatus =
      c.finalVerification?.status || c.verification?.status
    if (runtimeStatus === 'failed' || runtimeStatus == null) {
      return
    }
    if (sameCodeAlreadyRunning) return

    if (!session) {
      setAuthDialog(true)
      return
    }

    let cancelled = false
    setIsPreviewLoading(true)
    apiFetch('/v1/sandbox', {
      method: 'POST',
      token: accessTokenRef.current || session.access_token,
      body: JSON.stringify({
        fragment: next,
        runId: vaultRunIdRef.current,
      }),
    })
      .then((r) => r.json())
      .then((sandboxResult) => {
        if (cancelled) return
        if (sandboxResult?.error && !sandboxResult?.sbxId) {
          setIsPreviewLoading(false)
          return
        }
        setResult(sandboxResult)
        setCurrentTab('fragment')
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setIsPreviewLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [
    selectedCandidate,
    specimenArchive,
    tournament.candidates[selectedCandidate ?? 'minimal']?.status,
    tournament.candidates[selectedCandidate ?? 'minimal']?.execution,
    tournament.candidates[selectedCandidate ?? 'minimal']?.verification,
    tournament.candidates[selectedCandidate ?? 'minimal']?.finalVerification,
    session,
    userTeam?.id,
    evolutionRound?.status,
  ])

  function setMessage(message: Partial<Message>, index?: number) {
    setMessages((previousMessages) => {
      const updatedMessages = [...previousMessages]
      updatedMessages[index ?? previousMessages.length - 1] = {
        ...previousMessages[index ?? previousMessages.length - 1],
        ...message,
      }

      return updatedMessages
    })
  }

  async function handleSubmitAuth(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()

    const token = (await getAccessToken()) || session?.access_token
    if (!session || !token) {
      return setAuthDialog(true)
    }

    if (isLoading) {
      stop()
    }
    if (
      tournament.phase === 'generating' ||
      tournament.phase === 'verifying' ||
      tournament.phase === 'architecture' ||
      tournament.phase === 'repairing' ||
      tournament.phase === 'testing'
    ) {
      tournament.stop()
    }

    const content: Message['content'] = [{ type: 'text', text: chatInput }]
    const images = await toMessageImage(files)

    if (images.length > 0) {
      images.forEach((image) => {
        content.push({ type: 'image', image })
      })
    }

    const updatedMessages = addMessage({
      role: 'user',
      content,
    })

    const isFirstGeneration = !fragment && !shouldUseMorph

    if (isFirstGeneration) {
      // Tournament: 3 specimens — candidates only until Use this version.
      beginNewVaultRun()
      setHasTournament(true)
      setSelectedCandidate(undefined)
      setFragment(undefined)
      setResult(undefined)
      setProjectBrain(null)
      setEvolutionRound(null)
    setEvolutionBaseline(undefined)
    setEvolutionParentEvidence(null)
    setSpecimenArchive(null)
    evolutionActiveRef.current = false
      let serverRunId = vaultRunIdRef.current
      try {
        const created = await createRun(token, serverRunId || undefined)
        if (created?.id) {
          applyVaultRunId(created.id)
          serverRunId = created.id
        }
      } catch {
        /* local run id still used; Nest ensure() will create it */
      }
      tournament.submit({
        userID: session?.user?.id,
        teamID: userTeam?.id,
        accessToken: token,
        runId: serverRunId || undefined,
        messages: toAISDKMessages(updatedMessages),
        template: currentTemplate,
        model: currentModel,
        config: languageModel,
      })

      posthog.capture('tournament_submit', {
        template: selectedTemplate,
        model: languageModel.model,
      })
    } else {
      submit({
        userID: session?.user?.id,
        teamID: userTeam?.id,
        messages: toAISDKMessages(updatedMessages),
        template: currentTemplate,
        model: currentModel,
        config: languageModel,
        ...(shouldUseMorph && fragment ? { currentFragment: fragment } : {}),
      })

      posthog.capture('chat_submit', {
        template: selectedTemplate,
        model: languageModel.model,
      })
    }

    setChatInput('')
    setFiles([])
    setCurrentTab('code')
  }

  function retry() {
    submit({
      userID: session?.user?.id,
      teamID: userTeam?.id,
      messages: toAISDKMessages(messages),
      template: currentTemplate,
      model: currentModel,
      config: languageModel,
      ...(shouldUseMorph && fragment ? { currentFragment: fragment } : {}),
    })
  }

  function addMessage(message: Message) {
    setMessages((previousMessages) => [...previousMessages, message])
    return [...messages, message]
  }

  function handleSaveInputChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setChatInput(e.target.value)
  }

  function handleFileChange(change: SetStateAction<File[]>) {
    setFiles(change)
  }

  function logout() {
    signOut()
  }

  function handleLanguageModelChange(e: LLMModelConfig) {
    setLanguageModel({ ...languageModel, ...e })
  }

  function handleSocialClick(target: 'github' | 'x' | 'discord') {
    if (target === 'github') {
      window.open('https://github.com/Zuhaibking/EVOSTACKED', '_blank')
    }

    posthog.capture(`${target}_click`)
  }

  function handleClearChat() {
    stop()
    tournament.stop()
    tournament.reset()
    setHasTournament(false)
    setSelectedCandidate(undefined)
    setChatInput('')
    setFiles([])
    setMessages([])
    setFragment(undefined)
    setResult(undefined)
    setCurrentTab('code')
    setIsPreviewLoading(false)
    setProjectBrain(null)
    setEvolutionRound(null)
    setEvolutionBaseline(undefined)
    setEvolutionParentEvidence(null)
    setSpecimenArchive(null)
    const nextId = beginNewVaultRun()
    evolutionActiveRef.current = false
    const token = accessTokenRef.current
    if (token) void createRun(token, nextId)
  }

  /**
   * Tournament [PREVIEW] → load THIS candidate into the existing right-side Preview pane.
   * Does NOT promote activeVersion. Isolation: only this candidate's execution URL.
   */
  function handleCandidatePreview(id: VariantId) {
    const c = retainedCandidates[id]
    const action = buildCandidatePreviewAction(c)
    if (!action) return

    previewClickOverrideRef.current = true
    setSelectedCandidate(id)

    if (action.fragment) {
      setFragment(action.fragment as DeepPartial<FragmentSchema>)
    }

    // Clear previous candidate iframe first, then load this one.
    setResult(undefined)
    setIsPreviewLoading(false)
    setCurrentTab('fragment')

    if (action.showIframe && action.result) {
      // New object reference so FragmentWeb remounts cleanly.
      setResult({ ...action.result })
    }
  }

  function handleCandidateViewSource(id: VariantId) {
    const c = retainedCandidates[id]
    if (!c?.fragment || !hasFragmentCode(c.fragment)) return
    previewClickOverrideRef.current = true
    setSelectedCandidate(id)
    setFragment(c.fragment)
    setResult(undefined)
    setCurrentTab('code')
  }

  /** Confirm a tournament specimen as the active project version (v1 on first pick). */
  function handleUseVersion(id: VariantId) {
    const pool = retainTournamentCandidates(
      specimenArchive || tournament.candidates,
    )
    const c = pool[id]
    if (!c?.fragment || !hasFragmentCode(c.fragment)) return
    setSelectedCandidate(id)
    setProjectBrain((prev) => {
      const next = (() => {
        if (!prev) {
          const seeded = buildBrainFromTournament({
            plan: tournament.plan,
            fragment: c.fragment,
            winnerId: id,
            verification: c.finalVerification || c.verification,
            architectureCompliance: c.architectureCompliance,
            smoke: c.smoke ?? null,
            verdict: tournament.verdict,
            repairAttempt: c.repairAttempt ?? null,
          })
          return selectActiveProjectVersion(seeded, {
            candidateId: id,
            fragment: c.fragment,
            verification: c.finalVerification || c.verification,
            architectureCompliance: c.architectureCompliance,
            smoke: c.smoke ?? null,
            scoreComposite: c.scoreComposite,
            summary: `${c.label} is now your active version.`,
          })
        }
        return selectActiveProjectVersion(prev, {
          candidateId: id,
          fragment: c.fragment,
          verification: c.finalVerification || c.verification,
          architectureCompliance: c.architectureCompliance,
          smoke: c.smoke ?? null,
          scoreComposite: c.scoreComposite,
          summary: `${c.label} is now your active version.`,
        })
      })()

      // First active selection → vault v1 (or refresh active snapshot).
      persistVaultSnapshot(
        buildVersionSnapshot({
          version: next.activeVersion || next.currentVersion || 1,
          label: `${c.label} selected`,
          userRequest: undefined,
          summary: `${c.label} is now your active version.`,
          fragment: c.fragment as DeepPartial<FragmentSchema>,
          plan: next.plan || tournament.plan,
          activeCandidateId: id,
          compositeScore: c.scoreComposite,
          runtimeStatus:
            c.finalVerification?.status || c.verification?.status,
          smokeStatus: c.smoke?.status,
          architectureStatus: c.architectureCompliance?.status,
          previewReachable:
            c.finalVerification?.previewReachable ||
            c.verification?.previewReachable,
          execution: c.execution,
        }),
      )
      return next
    })
  }

  /** Restore a vault snapshot from in-memory / server data — no localStorage. */
  function handleVaultRestore(snapshot: VersionSnapshot) {
    if (!projectBrain) return
    const restored = restoreFromSnapshot(snapshot, projectBrain)
    if (!restored) return
    setProjectBrain(restored.brain)
    setFragment(restored.fragment)
    if (restored.execution) {
      setResult(restored.execution)
      setCurrentTab('fragment')
    } else {
      // Old sandbox may be gone — keep source local; Preview can redeploy on demand.
      setResult(undefined)
      setCurrentTab('code')
    }
    if (restored.brain.activeCandidateId) {
      setSelectedCandidate(restored.brain.activeCandidateId)
    }
    refreshVaultList()
  }

  function handleVaultPreview(snapshot: VersionSnapshot) {
    setFragment(snapshot.fragment)
    if (
      snapshot.execution?.sbxId &&
      snapshot.execution?.url &&
      snapshot.execution?.template
    ) {
      setResult({
        sbxId: snapshot.execution.sbxId,
        url: snapshot.execution.url,
        template: snapshot.execution.template,
      })
      setCurrentTab('fragment')
    } else {
      setResult(undefined)
      setCurrentTab('code')
    }
    if (snapshot.activeCandidateId) {
      setSelectedCandidate(snapshot.activeCandidateId)
    }
  }

  /** One user-triggered single-candidate evolution over the active version. */
  function handleEvolve(request: string) {
    if (!session) {
      setAuthDialog(true)
      return
    }
    if (
      !projectBrain?.plan ||
      !projectBrain.activeCandidateId ||
      !fragment ||
      !hasFragmentCode(fragment)
    ) {
      return
    }
    if (evolutionActiveRef.current) return

    const activeId = projectBrain.activeCandidateId
    const parentCandidate = tournament.candidates[activeId]
    setEvolutionBaseline(fragment)
    setEvolutionParentEvidence({
      runtime: projectBrain.verification?.status,
      architecture: projectBrain.architectureCompliance?.status,
      smoke: parentCandidate?.smoke ?? null,
    })

    const ctx = buildIterationContext({
      brain: projectBrain,
      userRequest: request,
      baselineFragment: fragment,
    })
    const round = startEvolutionRound(
      createEvolutionRound({
        brain: projectBrain,
        userRequest: request,
        candidateMode: 'single',
        activeVariantId: activeId,
      }),
    )
    setEvolutionRound(round)
    evolutionActiveRef.current = true
    setHasTournament(true)

    const evolution = buildEvolutionApiPayload(ctx, fragment, {
      activeVariantId: activeId,
    })
    tournament.submit({
      userID: session.user?.id,
      teamID: userTeam?.id,
      accessToken: session.access_token,
      runId: vaultRunIdRef.current || undefined,
      messages: toAISDKMessages([
        { role: 'user', content: [{ type: 'text', text: request }] },
      ]),
      template: currentTemplate,
      model: currentModel,
      config: languageModel,
      evolution,
    })

    posthog.capture('evolution_submit', {
      parentVersion: round.parentVersion,
      model: languageModel.model,
      candidateMode: 'single',
      activeVariantId: activeId,
    })

    setMessages((prev) => [
      ...prev,
      { role: 'user', content: [{ type: 'text', text: `Improve: ${request}` }] },
    ])
  }

  function setCurrentPreview(preview: {
    fragment: DeepPartial<FragmentSchema> | undefined
    result: ExecutionResult | undefined
  }) {
    setFragment(preview.fragment)
    setResult(preview.result)
  }

  function handleUndo() {
    setMessages((previousMessages) => [...previousMessages.slice(0, -2)])
    setCurrentPreview({ fragment: undefined, result: undefined })
  }

  return (
    <main className="flex flex-col min-h-screen bg-background">
      <AuthDialog
        open={isAuthDialogOpen}
        setOpen={setAuthDialog}
        view={authView}
      />

      {/* Editorial app bar — brand + run meta + actions, all in one strip */}
      <div className="shrink-0 border-b border-border bg-background">
        <div className="max-w-[1400px] mx-auto">
          <NavBar
            session={session}
            showLogin={() => setAuthDialog(true)}
            signOut={logout}
            onSocialClick={handleSocialClick}
            onClear={handleClearChat}
            canClear={messages.length > 0}
            canUndo={messages.length > 1 && !isLoading}
            onUndo={handleUndo}
            isLoading={
              isLoading ||
              tournament.phase === 'generating' ||
              tournament.phase === 'verifying' ||
              tournament.phase === 'architecture' ||
              tournament.phase === 'repairing' ||
              tournament.phase === 'testing' ||
              tournament.phase === 'judging'
            }
            hasFragment={!!fragment}
          />
        </div>
      </div>

      {/* Specimen strip — always show retained Product / Premium / Innovate */}
      {hasTournament && (
        <>
          {tournament.providerBudget &&
            tournament.providerBudget !== 'ready' && (
              <div
                className="mx-3 sm:mx-4 md:mx-6 mt-2 border border-border px-3 py-2 font-mono text-[11px] tracking-wide text-muted-foreground"
                role="status"
              >
                <span className="text-foreground">
                  {providerBudgetLabel(tournament.providerBudget)}
                </span>
                {tournament.error ? ` — ${tournament.error}` : ''}
              </div>
            )}
          <SpecimenStrip
            candidates={retainedCandidates}
            selectedId={selectedCandidate}
            onSelect={setSelectedCandidate}
            verdictReasoning={tournament.verdict?.reasoning}
            phase={
              evolutionRound?.candidateMode === 'single' && specimenArchive
                ? 'done'
                : tournament.phase
            }
          />
        </>
      )}

      {hasTournament &&
        tournament.phase === 'done' &&
        evolutionRound?.status !== 'running' && (
          <ActiveVersionPicker
            candidates={retainedCandidates}
            selectedId={selectedCandidate}
            activeId={projectBrain?.activeCandidateId}
            onPreview={handleCandidatePreview}
            onViewSource={handleCandidateViewSource}
            onViewFailure={handleCandidateViewSource}
            onUseVersion={handleUseVersion}
          />
        )}

      {projectBrain && <ProjectBrainPanel brain={projectBrain} />}

      {hydrated && (
        <VersionVaultPanel
          snapshots={vaultSnapshots}
          activeVersion={projectBrain?.activeVersion ?? null}
          refreshKey={vaultRefreshKey}
          onPreview={handleVaultPreview}
          onRestore={handleVaultRestore}
        />
      )}

      <AskEvoStack
        enabled={
          !!projectBrain?.plan &&
          !!projectBrain.activeCandidateId &&
          !!fragment &&
          hasFragmentCode(fragment) &&
          (projectBrain.activeVersion || projectBrain.currentVersion || 0) >= 1
        }
        busy={
          evolutionRound?.status === 'running' ||
          tournament.phase === 'generating' ||
          tournament.phase === 'verifying' ||
          tournament.phase === 'architecture' ||
          tournament.phase === 'repairing' ||
          tournament.phase === 'testing' ||
          tournament.phase === 'judging'
        }
        activeVersion={
          projectBrain?.activeVersion ?? projectBrain?.currentVersion
        }
        productName={projectBrain?.plan?.productName}
        healthLabel={
          appHealth
            ? `Health ${appHealth.score} · ${appHealth.statusLabel}`
            : null
        }
        suggestions={
          appHealth?.recommendations?.slice(0, 3).map((r) => ({
            id: r.id,
            title: r.title,
            text: r.improveRequest,
          })) || []
        }
        onSubmit={(composedRequest) => {
          handleEvolve(composedRequest)
        }}
      />

      <ImproveAppPanel
        enabled={
          !!projectBrain?.plan &&
          !!projectBrain.activeCandidateId &&
          !!fragment &&
          hasFragmentCode(fragment) &&
          (projectBrain.activeVersion || projectBrain.currentVersion || 0) >=
            1
        }
        busy={evolutionRound?.status === 'running'}
        round={evolutionRound}
        candidates={tournament.candidates}
        phase={tournament.phase}
        report={evolutionReport}
        sourceDiff={evolutionSourceDiff}
        onRetry={() => {
          // Focus stays on Ask EvoStack — user must click Improve again (no auto API).
        }}
        onPreviewWinner={() => {
          if (evolutionRound?.winnerId) {
            setSelectedCandidate(evolutionRound.winnerId)
            setCurrentTab('fragment')
          }
        }}
      />

      {/* Workspace — substantial editor/preview area; page scrolls normally above */}
      <div className="grid w-full md:grid-cols-2 min-h-[70vh] border-t border-border">
        <div
          className={`flex flex-col w-full max-w-[900px] mx-auto px-3 sm:px-4 md:px-6 pt-2 sm:pt-3 ${fragment ? 'col-span-1 md:border-r md:border-border' : 'col-span-2'}`}
        >
          <Chat
            messages={messages}
            isLoading={isLoading}
            setCurrentPreview={setCurrentPreview}
          />
          <ChatInput
            retry={retry}
            isErrored={!!errorMessage || !!tournament.error}
            errorMessage={errorMessage || tournament.error || ''}
            isLoading={isLoading}
            isRateLimited={
              isRateLimited ||
              tournament.providerBudget === 'daily_limit_reached' ||
              tournament.providerBudget === 'rate_limited' ||
              tournament.providerBudget === 'temporarily_rate_limited'
            }
            stop={stop}
            input={chatInput}
            handleInputChange={handleSaveInputChange}
            handleSubmit={handleSubmitAuth}
            isMultiModal={currentModel?.multiModal || false}
            files={files}
            handleFileChange={handleFileChange}
          >
            <ChatPicker
              templates={templates}
              selectedTemplate={selectedTemplate}
              onSelectedTemplateChange={setSelectedTemplate}
              models={filteredModels}
              languageModel={languageModel}
              onLanguageModelChange={handleLanguageModelChange}
            />
            <ChatSettings
              languageModel={languageModel}
              onLanguageModelChange={handleLanguageModelChange}
              apiKeyConfigurable={!process.env.NEXT_PUBLIC_NO_API_KEY_INPUT}
              baseURLConfigurable={!process.env.NEXT_PUBLIC_NO_BASE_URL_INPUT}
              useMorphApply={useMorphApply}
              onUseMorphApplyChange={setUseMorphApply}
            />
          </ChatInput>
        </div>
        {fragment && (
          <div className="flex flex-col overflow-hidden h-full min-h-[70vh] md:min-h-full">
            <Preview
              teamID={userTeam?.id}
              accessToken={session?.access_token}
              selectedTab={currentTab}
              onSelectedTabChange={setCurrentTab}
              isChatLoading={isLoading}
              isPreviewLoading={isPreviewLoading}
              fragment={fragment}
              result={result as ExecutionResult}
              unavailableReason={selectedPreviewNotice}
              onClose={() => setFragment(undefined)}
            />
          </div>
        )}
      </div>
    </main>
  )
}

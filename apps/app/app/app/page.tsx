'use client'

import { ArenaShell } from '@/components/arena/arena-shell'
import { ArenaWorkspace } from '@/components/arena/arena-workspace'
import { AuthDialog, ViewType } from '@/components/auth-dialog'
import { ChatPicker } from '@/components/chat-picker'
import { ChatSettings } from '@/components/chat-settings'
import { CommandBar } from '@/components/command-bar'
import { ImproveAppPanel } from '@/components/improve-app-panel'
import { NavBar } from '@/components/navbar'
import { ProjectSidebar } from '@/components/project-sidebar'
import { buildArenaActivity } from '@/lib/arena-activity'
import { arenaLoadingLabel } from '@/lib/arena-loading'
import {
  isArenaCommandDocked,
  type PreviewViewport,
  type WorkspaceMode,
} from '@/lib/arena-workspace'
import {
  prepareAskEvoStackSubmit,
  type AskRequestKind,
} from '@/lib/ask-evostack'
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
  pickInspectableCandidateId,
  retainTournamentCandidates,
} from '@/lib/tournament-candidates'
import { formatCandidateBuildDiagnostics } from '@/lib/build-failure-diagnostics'
import { buildCandidatePreviewAction } from '@/lib/candidate-preview'
import {
  estimateTournamentCost,
  type GenerationCostSummary,
} from '@/lib/generation-cost'
import { shouldPreferMorph } from '@/lib/morph-preference'
import type { ProjectExportMeta } from '@/lib/project-export'
import {
  compactArchitectureSummary,
  compactRepairNotes,
  compactSmokeSummary,
  compactVerificationSummary,
} from '@/lib/tournament-candidate-record'
import {
  buildBrainFromTournament,
  ProjectBrain,
  recordImprovement,
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
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>('preview')
  const [previewViewport, setPreviewViewport] =
    useState<PreviewViewport>('desktop')
  const [askKind, setAskKind] = useState<AskRequestKind | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
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

  const generationCost = useMemo((): GenerationCostSummary | null => {
    if (projectBrain?.generationUsage) {
      const u = projectBrain.generationUsage
      return {
        modelId: u.modelId,
        modelName: u.modelName || u.modelId,
        inputTokens: u.inputTokens,
        outputTokens: u.outputTokens,
        totalTokens: u.totalTokens,
        estimatedUsd: u.estimatedUsd,
        calls: u.calls ?? 0,
        source: u.source || 'estimate',
      }
    }
    if (tournament.phase !== 'done') return null
    return estimateTournamentCost({
      model: currentModel,
      plan: tournament.plan || projectBrain?.plan,
      messages,
      candidates: retainedCandidates,
      isEvolution: evolutionRound?.candidateMode === 'single',
    })
  }, [
    projectBrain?.generationUsage,
    tournament.phase,
    tournament.plan,
    projectBrain?.plan,
    messages,
    retainedCandidates,
    currentModel,
    evolutionRound?.candidateMode,
  ])

  // Inspect the first finished specimen in Preview. Never promotes activeVersion.
  useEffect(() => {
    if (selectedCandidate) return
    if (tournament.phase === 'idle' && !specimenArchive) return
    const id = pickInspectableCandidateId(retainedCandidates)
    if (id) setSelectedCandidate(id)
  }, [
    retainedCandidates,
    selectedCandidate,
    tournament.phase,
    specimenArchive,
  ])

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

  const selectedDiagnostics = useMemo(() => {
    if (!selectedCandidate) return []
    const c = retainedCandidates[selectedCandidate]
    if (!c) return []
    return formatCandidateBuildDiagnostics(c)
  }, [selectedCandidate, retainedCandidates])

  const loadingLabel = arenaLoadingLabel({
    tournamentPhase: tournament.phase,
    candidates: retainedCandidates,
    isPreviewLoading,
    isChatLoading: chatLoading,
    evolutionRunning: evolutionRound?.status === 'running',
  })

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
      setWorkspaceMode('code')
      setIsPreviewLoading(false)
      return
    }
    posthog.capture('sandbox_created', { url: result.url })
    setResult(result)
    setCurrentPreview({ fragment: nextFragment, result })
    setMessage({ result })
    setWorkspaceMode('preview')
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

  /** Small Design/Mobile/UX/Feature chips try Morph first, then full Improve. */
  async function applySmallChipViaMorph(opts: {
    userRequest: string
    displayText: string
  }): Promise<boolean> {
    const runId = vaultRunIdRef.current
    const token = (await getAccessToken()) || accessTokenRef.current
    if (!runId || !token || !fragment || !hasFragmentCode(fragment)) return false
    const ctrl = new AbortController()
    chatAbortRef.current = ctrl
    setChatLoading(true)
    setErrorMessage('')
    try {
      const res = await apiFetch('/v1/morph', {
        method: 'POST',
        token,
        signal: ctrl.signal,
        body: JSON.stringify({
          userID: session?.user?.id,
          teamID: userTeam?.id,
          messages: toAISDKMessages([
            { role: 'user', content: [{ type: 'text', text: opts.userRequest }] },
          ]),
          template: currentTemplate,
          model: currentModel,
          config: languageModel,
          currentFragment: fragment,
          runId,
        }),
      })
      const data = await res.json().catch(() => ({}))
      const nextFragment = data?.fragment
      if (!res.ok || !(nextFragment?.file_path || nextFragment?.code)) {
        return false
      }
      if (typeof data?.memoryRevision === 'number') {
        setMemoryRevision(data.memoryRevision)
      }
      await deployFragment(nextFragment)
      setProjectBrain((prev) =>
        prev
          ? recordImprovement(prev, {
              request: opts.displayText || opts.userRequest,
              note: 'Applied via Morph (small Design/UX/Feature change)',
            })
          : prev,
      )
      setMessages((prev) => [
        ...prev,
        {
          role: 'user',
          content: [{ type: 'text', text: opts.displayText || opts.userRequest }],
        },
      ])
      posthog.capture('morph_chip_apply', { model: languageModel.model })
      return true
    } catch (err: any) {
      if (err?.name === 'AbortError') return true
      return false
    } finally {
      setChatLoading(false)
      chatAbortRef.current = null
    }
  }

  // Do not auto-activate a specimen — user must click "Use this version".
  // Preview selection remains manual via CandidateSwitcher.

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

    setProjectBrain((prev) => {
      const next = buildBrainFromTournament({
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
      })
      const usage = estimateTournamentCost({
        model: currentModel,
        plan: tournament.plan,
        messages,
        candidates: tournament.candidates,
        isEvolution: false,
      })
      return { ...next, generationUsage: usage }
    })
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
      const usage = estimateTournamentCost({
        model: currentModel,
        plan: next.plan || tournament.plan,
        messages: [
          {
            role: 'user',
            content: [{ type: 'text', text: completed.userRequest }],
          },
        ],
        candidates: tournament.candidates,
        isEvolution: true,
      })
      return { ...next, generationUsage: usage }
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
      setWorkspaceMode('preview')
      setIsPreviewLoading(false)
      return
    }

    // No reusable Preview for this candidate — clear prior candidate's URL.
    setResult(undefined)
    setWorkspaceMode(action?.tab === 'fragment' ? 'preview' : 'code')
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
        setWorkspaceMode('preview')
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
    setWorkspaceMode('preview')
  }

  function handleCommandDispatch(
    e: React.FormEvent<HTMLFormElement>,
    kind: AskRequestKind | null,
  ) {
    const hasActiveApp =
      !!fragment &&
      hasFragmentCode(fragment) &&
      !!projectBrain?.activeCandidateId &&
      (projectBrain.activeVersion || projectBrain.currentVersion || 0) >= 1

    if (hasActiveApp && kind) {
      e.preventDefault()
      if (!session) {
        setAuthDialog(true)
        return
      }
      const prepared = prepareAskEvoStackSubmit({
        kind,
        text: chatInput,
        hasActiveVersion: true,
        busy:
          evolutionRound?.status === 'running' ||
          tournament.phase === 'generating' ||
          tournament.phase === 'verifying',
      })
      if (!prepared.ok || !prepared.composed) {
        if (prepared.reason) setErrorMessage(prepared.reason)
        return
      }
      const morphPref = shouldPreferMorph({
        morphEnabled: useMorphApply,
        hasActiveFragment: hasFragmentCode(fragment),
        kind,
        text: prepared.composed.rawText || chatInput,
      })
      if (morphPref.prefer) {
        const composed = prepared.composed
        void applySmallChipViaMorph({
          userRequest: composed.userRequest,
          displayText: composed.rawText || chatInput,
        }).then((ok) => {
          if (!ok) handleEvolve(composed.userRequest)
        })
        setChatInput('')
        setFiles([])
        return
      }
      handleEvolve(prepared.composed.userRequest)
      setChatInput('')
      setFiles([])
      return
    }

    void handleSubmitAuth(e)
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
    setWorkspaceMode('preview')
    setAskKind(null)
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
    setWorkspaceMode('preview')

    if (!action.showIframe && !action.fragment) {
      return
    }

    if (action.fragment) {
      setFragment(action.fragment as DeepPartial<FragmentSchema>)
    }

    setResult(undefined)
    setIsPreviewLoading(false)

    if (action.showIframe && action.result) {
      setResult({ ...action.result })
    }
  }

  function handleCandidateViewSource(id: VariantId) {
    const c = retainedCandidates[id]
    if (!c?.fragment || !hasFragmentCode(c.fragment)) return
    previewClickOverrideRef.current = true
    setSelectedCandidate(id)
    setFragment(c.fragment)
    const action = buildCandidatePreviewAction(c)
    if (action?.showIframe && action.result) {
      setResult({ ...action.result })
    } else {
      setResult(undefined)
    }
    setWorkspaceMode('code')
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
      setWorkspaceMode('preview')
    } else {
      // Old sandbox may be gone — keep source local; Preview can redeploy on demand.
      setResult(undefined)
      setWorkspaceMode('code')
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
      setWorkspaceMode('preview')
    } else {
      setResult(undefined)
      setWorkspaceMode('code')
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

  const projectName =
    projectBrain?.plan?.productName ||
    (typeof fragment?.title === 'string' ? fragment.title : '') ||
    undefined
  const selectedForExport = selectedCandidate
    ? retainedCandidates[selectedCandidate]
    : undefined
  const firstUserPrompt =
    messages
      .find((m) => m.role === 'user')
      ?.content?.filter((p) => p.type === 'text')
      .map((p) => ('text' in p ? String(p.text) : ''))
      .join('\n')
      .trim() ||
    projectBrain?.userRequests?.[0] ||
    ''
  const exportMeta: ProjectExportMeta = {
    prompt: firstUserPrompt,
    plan: projectBrain?.plan || tournament.plan,
    variantId: selectedCandidate,
    variantLabel: selectedForExport?.label,
    scores: selectedForExport
      ? {
          clarity: selectedForExport.scoreClarity,
          fit: selectedForExport.scoreFit,
          polish: selectedForExport.scorePolish,
          composite: selectedForExport.scoreComposite,
        }
      : null,
    health: appHealth
      ? { score: appHealth.score, statusLabel: appHealth.statusLabel }
      : null,
    architectureSummary: compactArchitectureSummary(
      selectedForExport?.architectureCompliance,
    ),
    verificationSummary: compactVerificationSummary(
      selectedForExport?.finalVerification || selectedForExport?.verification,
    ),
    smokeSummary: compactSmokeSummary(selectedForExport?.smoke),
    repairNotes: compactRepairNotes(selectedForExport?.repairAttempt),
    templateId:
      (typeof selectedForExport?.fragment?.template === 'string'
        ? selectedForExport.fragment.template
        : null) ||
      (typeof fragment?.template === 'string' ? fragment.template : null),
  }
  const chipsEnabled =
    !!projectBrain?.plan &&
    !!projectBrain.activeCandidateId &&
    !!fragment &&
    hasFragmentCode(fragment) &&
    (projectBrain.activeVersion || projectBrain.currentVersion || 0) >= 1
  const workspaceBusy =
    isLoading ||
    tournament.phase === 'generating' ||
    tournament.phase === 'verifying' ||
    tournament.phase === 'architecture' ||
    tournament.phase === 'repairing' ||
    tournament.phase === 'testing' ||
    tournament.phase === 'judging'

  const activityItems = useMemo(
    () =>
      buildArenaActivity({
        phase: tournament.phase,
        plan: tournament.plan || projectBrain?.plan,
        candidates: retainedCandidates,
        evolutionRunning: evolutionRound?.status === 'running',
      }),
    [
      tournament.phase,
      tournament.plan,
      projectBrain?.plan,
      retainedCandidates,
      evolutionRound?.status,
    ],
  )

  const hasLivePreview = Boolean(result)
  const budgetNotice =
    tournament.providerBudget && tournament.providerBudget !== 'ready'
      ? `${providerBudgetLabel(tournament.providerBudget)}${
          tournament.error ? ` — ${tournament.error}` : ''
        }`
      : null

  const sidebar = (
    <ProjectSidebar
      projectBrain={projectBrain}
      vaultSnapshots={hydrated ? vaultSnapshots : []}
      vaultRefreshKey={vaultRefreshKey}
      activeVersion={projectBrain?.activeVersion ?? null}
      onVaultPreview={handleVaultPreview}
      onVaultRestore={handleVaultRestore}
      runId={vaultRunId}
      tournamentPhase={
        evolutionRound?.candidateMode === 'single' && specimenArchive
          ? 'done'
          : tournament.phase
      }
      selectedCandidate={
        selectedCandidate ? retainedCandidates[selectedCandidate] : undefined
      }
      messages={messages}
      isLoading={isLoading}
      setCurrentPreview={setCurrentPreview}
      candidates={retainedCandidates}
      selectedId={selectedCandidate}
      activeId={projectBrain?.activeCandidateId}
      onSelectCandidate={setSelectedCandidate}
      onPreviewCandidate={handleCandidatePreview}
      onViewSourceCandidate={handleCandidateViewSource}
      onUseVersion={handleUseVersion}
      activity={activityItems}
      onViewSource={handleCandidateViewSource}
      detailsFor={(id) =>
        formatCandidateBuildDiagnostics(retainedCandidates[id])
      }
      appHealth={appHealth}
      generationCost={generationCost}
      providerBudgetLabel={budgetNotice}
    />
  )

  return (
    <>
      <AuthDialog
        open={isAuthDialogOpen}
        setOpen={setAuthDialog}
        view={authView}
      />
      <ArenaShell
        sidebarOpen={sidebarOpen}
        onCloseSidebar={() => setSidebarOpen(false)}
        topbar={
          <NavBar
            session={session}
            showLogin={() => setAuthDialog(true)}
            signOut={logout}
            onSocialClick={handleSocialClick}
            onClear={handleClearChat}
            canClear={messages.length > 0}
            canUndo={messages.length > 1 && !isLoading}
            onUndo={handleUndo}
            runId={vaultRunId || undefined}
            projectName={projectName}
            isLoading={workspaceBusy}
            hasFragment={!!fragment}
            onMenuClick={() => setSidebarOpen(true)}
          />
        }
        sidebar={sidebar}
        commandDocked={isArenaCommandDocked({
          messageCount: messages.length,
          tournamentPhase: tournament.phase,
          hasFragment: !!fragment,
        })}
        commandOverlaysWorkspace={workspaceMode !== 'database'}
        workspace={
          <ArenaWorkspace
            mode={workspaceMode}
            onModeChange={setWorkspaceMode}
            viewport={previewViewport}
            onViewportChange={setPreviewViewport}
            fragment={fragment}
            result={result as ExecutionResult}
            unavailableReason={selectedPreviewNotice}
            diagnostics={selectedDiagnostics}
            onViewSource={() => {
              if (selectedCandidate) handleCandidateViewSource(selectedCandidate)
              else setWorkspaceMode('code')
            }}
            isChatLoading={isLoading}
            isPreviewLoading={isPreviewLoading}
            loadingLabel={loadingLabel}
            hasLivePreview={hasLivePreview}
            teamID={userTeam?.id}
            accessToken={session?.access_token}
            projectName={projectName}
            chipsEnabled={chipsEnabled}
            askKind={askKind}
            onAskKindChange={setAskKind}
            onSeedText={setChatInput}
            exportMeta={exportMeta}
            designPanel={
              evolutionRound ? (
                <ImproveAppPanel
                  enabled={chipsEnabled}
                  busy={evolutionRound?.status === 'running'}
                  round={evolutionRound}
                  candidates={tournament.candidates}
                  phase={tournament.phase}
                  report={evolutionReport}
                  sourceDiff={evolutionSourceDiff}
                  onRetry={() => undefined}
                  onPreviewWinner={() => {
                    if (evolutionRound?.winnerId) {
                      setSelectedCandidate(evolutionRound.winnerId)
                      setWorkspaceMode('preview')
                    }
                  }}
                />
              ) : null
            }
          />
        }
        commandBar={
          <CommandBar
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
            onDispatch={handleCommandDispatch}
            isMultiModal={currentModel?.multiModal || false}
            files={files}
            handleFileChange={handleFileChange}
            chipsEnabled={chipsEnabled}
            askKind={askKind}
            onAskKindChange={setAskKind}
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
          </CommandBar>
        }
      />
    </>
  )
}

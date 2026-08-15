'use client'

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
import { RecommendationsPanel } from '@/components/recommendations-panel'
import { SpecimenStrip } from '@/components/specimen-strip'
import { VersionVaultPanel } from '@/components/version-vault-panel'
import { useAuth } from '@/lib/auth'
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
import { resolveReusablePreviewExecution } from '@/lib/preview-execution'
import {
  buildBrainFromTournament,
  deserializeProjectBrain,
  ProjectBrain,
  selectActiveProjectVersion,
  serializeProjectBrain,
} from '@/lib/project-brain'
import { buildRecommendations } from '@/lib/recommendations'
import { FragmentSchema, fragmentSchema as schema } from '@/lib/schema'
import type { SmokeSuiteResult } from '@/lib/smoke'
import { diffFragments } from '@/lib/source-diff'
import templates from '@/lib/templates'
import { VariantId, VARIANTS } from '@/lib/tournament'
import { useTournament, type Candidate } from '@/lib/tournament-client'
import { ExecutionResult } from '@/lib/types'
import {
  buildVersionSnapshot,
  listVersionSnapshots,
  restoreVersionSnapshot,
  saveVersionSnapshot,
  type VersionSnapshot,
} from '@/lib/version-vault'
import { DeepPartial } from 'ai'
import { experimental_useObject as useObject } from 'ai/react'
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
  const evolutionActiveRef = useRef(false)
  const tournament = useTournament()
  const { session, userTeam, signOut } = useAuth(setAuthDialog, setAuthView)
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

  // ---- Persistence (localStorage stopgap until a real DB) ----
  const RUN_KEY = 'evostack:run:v1'
  const [hydrated, setHydrated] = useState(false)

  // Hydrate once on mount.
  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const raw = localStorage.getItem(RUN_KEY)
      if (raw) {
        const snap = JSON.parse(raw)
        if (snap?.messages) setMessages(snap.messages)
        if (snap?.fragment) setFragment(snap.fragment)
        if (snap?.result) setResult(snap.result)
        if (snap?.selectedCandidate) setSelectedCandidate(snap.selectedCandidate)
        if (snap?.hasTournament) setHasTournament(snap.hasTournament)
        if (snap?.brain) {
          const restored = deserializeProjectBrain(
            typeof snap.brain === 'string'
              ? snap.brain
              : JSON.stringify(snap.brain),
          )
          if (restored) setProjectBrain(restored)
        }
        if (snap?.tournament) {
          tournament.hydrate({
            candidates: snap.tournament.candidates,
            verdict: snap.tournament.verdict,
            phase: snap.tournament.phase ?? 'done',
            plan: snap.tournament.plan,
          })
        }
      }
    } catch {
      // ignore corrupted snapshots
    } finally {
      setHydrated(true)
      try {
        setVaultSnapshots(listVersionSnapshots())
      } catch {
        setVaultSnapshots([])
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function refreshVaultList() {
    try {
      setVaultSnapshots(listVersionSnapshots())
      setVaultRefreshKey((k) => k + 1)
    } catch {
      /* ignore */
    }
  }

  function persistVaultSnapshot(snapshot: VersionSnapshot) {
    try {
      saveVersionSnapshot(snapshot)
      refreshVaultList()
    } catch {
      /* never crash on vault write */
    }
  }

  // Persist whenever the meaningful slice changes — but only after the
  // initial hydrate is complete so we don't overwrite the saved snapshot
  // with an empty initial state on first render.
  useEffect(() => {
    if (!hydrated || typeof window === 'undefined') return
    try {
      const snap = {
        messages,
        fragment,
        result,
        selectedCandidate,
        hasTournament,
        // Compact brain only (paths + plan metadata — no file bodies / secrets).
        brain: projectBrain ? serializeProjectBrain(projectBrain) : null,
        tournament: {
          candidates: tournament.candidates,
          verdict: tournament.verdict,
          phase: tournament.phase,
          plan: tournament.plan,
        },
      }
      localStorage.setItem(RUN_KEY, JSON.stringify(snap))
    } catch {
      // localStorage full or serialization issue — silently drop.
    }
  }, [
    hydrated,
    messages,
    fragment,
    result,
    selectedCandidate,
    hasTournament,
    projectBrain,
    tournament.candidates,
    tournament.verdict,
    tournament.phase,
    tournament.plan,
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

  const recommendations = useMemo(() => {
    if (!projectBrain?.activeCandidateId) return []
    return buildRecommendations({
      brain: projectBrain,
      diff: evolutionSourceDiff,
    })
  }, [projectBrain, evolutionSourceDiff])

  // Silence unused invariant (kept for documentation / external imports).
  void ITERATION_CANDIDATE_COUNT
  void VARIANTS

  // Determine which API to use based on morph toggle and existing fragment
  const shouldUseMorph =
    useMorphApply && !!fragment && hasFragmentCode(fragment) && !!fragment.file_path
  const apiEndpoint = shouldUseMorph ? '/api/morph-chat' : '/api/chat'

  const { object, submit, isLoading, stop, error } = useObject({
    api: apiEndpoint,
    schema,
    onError: (error) => {
      console.error('Error submitting request:', error)
      if (error.message.includes('limit')) {
        setIsRateLimited(true)
      }

      setErrorMessage(error.message)
    },
    onFinish: async ({ object: fragment, error }) => {
      if (!error) {
        // send it to /api/sandbox
        console.log('fragment', fragment)
        setIsPreviewLoading(true)
        posthog.capture('fragment_generated', {
          template: fragment?.template,
        })

        const response = await fetch('/api/sandbox', {
          method: 'POST',
          body: JSON.stringify({
            fragment,
            userID: session?.user?.id,
            teamID: userTeam?.id,
            accessToken: session?.access_token,
          }),
        })

        const result = await response.json()
        console.log('result', result)
        posthog.capture('sandbox_created', { url: result.url })

        setResult(result)
        setCurrentPreview({ fragment, result })
        setMessage({ result })
        setCurrentTab('fragment')
        setIsPreviewLoading(false)
      }
    },
  })

  useEffect(() => {
    if (object) {
      setFragment(object)
      const content: Message['content'] = [
        { type: 'text', text: object.commentary || '' },
        { type: 'code', text: getPrimaryFileContent(object) },
      ]

      if (!lastMessage || lastMessage.role !== 'assistant') {
        addMessage({
          role: 'assistant',
          content,
          object,
        })
      }

      if (lastMessage && lastMessage.role === 'assistant') {
        setMessage({
          content,
          object,
        })
      }
    }
  }, [object])

  useEffect(() => {
    if (error) stop()
  }, [error])

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

  // Archive the initial 3 specimens so iteration does not erase their metadata.
  useEffect(() => {
    if (tournament.phase !== 'done' || !tournament.verdict) return
    if (evolutionRound?.candidateMode === 'single') return
    const withCode = Object.values(tournament.candidates).filter((c) =>
      hasFragmentCode(c.fragment),
    )
    if (withCode.length >= INITIAL_TOURNAMENT_CANDIDATE_COUNT) {
      setSpecimenArchive({ ...tournament.candidates })
    }
  }, [
    tournament.phase,
    tournament.verdict,
    tournament.candidates,
    evolutionRound?.candidateMode,
  ])

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

  // Whenever the user picks a candidate (or one is auto-selected), promote
  // its fragment to the main view. Prefer the sandbox already verified during
  // the tournament; only create a new sandbox when none is reusable.
  useEffect(() => {
    // Keep the working app on screen while evolution candidates are still running.
    if (evolutionActiveRef.current && evolutionRound?.status === 'running') {
      return
    }
    if (!selectedCandidate) return
    const c = tournament.candidates[selectedCandidate]
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
    if (sameCodeAlreadyRunning) return

    // Append a synthetic assistant message capturing the selected candidate.
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

    // Reuse tournament-verified (or repaired) sandbox when available.
    // Runtime ✓ alone does not set `result`; Preview needs ExecutionResult.url.
    const reusable = resolveReusablePreviewExecution({
      execution: c.execution,
      verification: c.verification,
      finalVerification: c.finalVerification,
    })
    if (reusable) {
      setResult(reusable)
      setCurrentTab('fragment')
      setIsPreviewLoading(false)
      return
    }

    // No reusable sandbox — deploy via existing /api/sandbox path.
    if (!session) {
      setAuthDialog(true)
      return
    }

    let cancelled = false
    setIsPreviewLoading(true)
    setCurrentTab('code')
    fetch('/api/sandbox', {
      method: 'POST',
      body: JSON.stringify({
        fragment: next,
        userID: session.user.id,
        teamID: userTeam?.id,
        accessToken: session.access_token,
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

    if (!session) {
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
      // Tournament: 3 specimens generated in parallel, judged by editor.
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
      tournament.submit({
        userID: session?.user?.id,
        teamID: userTeam?.id,
        accessToken: session?.access_token,
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
    refreshVaultList()
    evolutionActiveRef.current = false
  }

  /** Confirm a tournament specimen as the active project version (v1 on first pick). */
  function handleUseVersion(id: VariantId) {
    const pool = specimenArchive || tournament.candidates
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

  /** Restore a vault snapshot locally — zero API calls. */
  function handleVaultRestore(snapshot: VersionSnapshot) {
    if (!projectBrain) return
    const restored = restoreVersionSnapshot(snapshot.version, projectBrain)
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
    <main className="flex flex-col min-h-screen max-h-screen bg-background">
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

      {/* Specimen strip — visible once a tournament has been dispatched */}
      {hasTournament && (
        <SpecimenStrip
          candidates={tournament.candidates}
          selectedId={selectedCandidate}
          onSelect={setSelectedCandidate}
          verdictReasoning={tournament.verdict?.reasoning}
          phase={tournament.phase}
        />
      )}

      {hasTournament &&
        tournament.phase === 'done' &&
        evolutionRound?.status !== 'running' && (
          <ActiveVersionPicker
            candidates={specimenArchive || tournament.candidates}
            activeId={projectBrain?.activeCandidateId}
            onPreview={(id) => {
              const pool = specimenArchive || tournament.candidates
              const c = pool[id]
              if (c?.fragment) {
                setSelectedCandidate(id)
                setFragment(c.fragment)
                const reusable = resolveReusablePreviewExecution({
                  execution: c.execution,
                  verification: c.verification,
                  finalVerification: c.finalVerification,
                })
                if (reusable) {
                  setResult(reusable)
                  setCurrentTab('fragment')
                } else {
                  setCurrentTab('code')
                }
              }
            }}
            onUseVersion={handleUseVersion}
          />
        )}

      {projectBrain && <ProjectBrainPanel brain={projectBrain} />}

      {vaultSnapshots.length > 0 && (
        <VersionVaultPanel
          snapshots={vaultSnapshots}
          activeVersion={projectBrain?.activeVersion}
          refreshKey={vaultRefreshKey}
          onPreview={handleVaultPreview}
          onRestore={handleVaultRestore}
        />
      )}

      {projectBrain?.activeCandidateId && (
        <RecommendationsPanel
          recommendations={recommendations}
          disabled={
            evolutionRound?.status === 'running' ||
            tournament.phase === 'generating' ||
            tournament.phase === 'verifying' ||
            tournament.phase === 'architecture' ||
            tournament.phase === 'repairing' ||
            tournament.phase === 'testing' ||
            tournament.phase === 'judging'
          }
          onImprove={handleEvolve}
        />
      )}

      <ImproveAppPanel
        enabled={
          !!projectBrain?.plan &&
          !!projectBrain.activeCandidateId &&
          !!fragment &&
          hasFragmentCode(fragment) &&
          (projectBrain.activeVersion || projectBrain.currentVersion || 0) >=
            1 &&
          !evolutionActiveRef.current &&
          tournament.phase !== 'generating' &&
          tournament.phase !== 'architecture' &&
          tournament.phase !== 'verifying' &&
          tournament.phase !== 'repairing' &&
          tournament.phase !== 'testing' &&
          tournament.phase !== 'judging'
        }
        busy={evolutionRound?.status === 'running'}
        round={evolutionRound}
        candidates={tournament.candidates}
        phase={tournament.phase}
        report={evolutionReport}
        sourceDiff={evolutionSourceDiff}
        onEvolve={handleEvolve}
        onPreviewWinner={() => {
          if (evolutionRound?.winnerId) {
            setSelectedCandidate(evolutionRound.winnerId)
            setCurrentTab('fragment')
          }
        }}
      />

      {/* Workspace */}
      <div className="flex-1 grid w-full md:grid-cols-2 overflow-hidden">
        <div
          className={`flex flex-col w-full max-h-full max-w-[900px] mx-auto px-3 sm:px-4 md:px-6 pt-2 sm:pt-3 overflow-auto ${fragment ? 'col-span-1 md:border-r md:border-border' : 'col-span-2'}`}
        >
          <Chat
            messages={messages}
            isLoading={isLoading}
            setCurrentPreview={setCurrentPreview}
          />
          <ChatInput
            retry={retry}
            isErrored={error !== undefined}
            errorMessage={errorMessage}
            isLoading={isLoading}
            isRateLimited={isRateLimited}
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
          <div className="flex flex-col overflow-hidden">
            <Preview
              teamID={userTeam?.id}
              accessToken={session?.access_token}
              selectedTab={currentTab}
              onSelectedTabChange={setCurrentTab}
              isChatLoading={isLoading}
              isPreviewLoading={isPreviewLoading}
              fragment={fragment}
              result={result as ExecutionResult}
              onClose={() => setFragment(undefined)}
            />
          </div>
        )}
      </div>
    </main>
  )
}

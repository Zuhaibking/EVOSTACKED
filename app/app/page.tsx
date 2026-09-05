'use client'

import { AuthDialog, ViewType } from '@/components/auth-dialog'
import { Chat } from '@/components/chat'
import { ChatInput } from '@/components/chat-input'
import { ChatPicker } from '@/components/chat-picker'
import { ChatSettings } from '@/components/chat-settings'
import { NavBar } from '@/components/navbar'
import { Preview, ArenaTab } from '@/components/preview'
import { SpecimenStrip } from '@/components/specimen-strip'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/lib/auth'
import { Message, toAISDKMessages, toMessageImage } from '@/lib/messages'
import { InspectSelection, toCompleteFragment } from '@/lib/inspect'
import {
  ProjectRecord,
  ProjectStore,
  ProjectWorkspace,
  blankWorkspace,
  createDebouncedSaver,
  createProject,
  deleteProject,
  getActive,
  listProjects,
  loadStore,
  pushVersion,
  saveWorkspace,
  setActiveId,
  upsertProject,
} from '@/lib/projects'
import { LLMModelConfig } from '@/lib/models'
import modelsList from '@/lib/models.json'
import { FragmentSchema, fragmentCodeText, fragmentSchema as schema } from '@/lib/schema'
import templates from '@/lib/templates'
import { VariantId } from '@/lib/tournament'
import { useTournament } from '@/lib/tournament-client'
import { ExecutionResult } from '@/lib/types'
import { DeepPartial } from 'ai'
import { experimental_useObject as useObject } from 'ai/react'
import { usePostHog } from 'posthog-js/react'
import { ReactNode, SetStateAction, useEffect, useRef, useState } from 'react'
import { useLocalStorage } from 'usehooks-ts'

export default function Home() {
  const [chatInput, setChatInput] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [selectedTemplate, setSelectedTemplate] = useState<string>(
    'auto',
  )
  const [languageModel, setLanguageModel] = useLocalStorage<LLMModelConfig>(
    'languageModel',
    {
      model: 'gpt-5',
    },
  )

  const posthog = usePostHog()

  const [result, setResult] = useState<ExecutionResult>()
  const [messages, setMessages] = useState<Message[]>([])
  const [fragment, setFragment] = useState<DeepPartial<FragmentSchema>>()
  const [currentTab, setCurrentTab] = useState<ArenaTab>('code')
  const [isPreviewLoading, setIsPreviewLoading] = useState(false)
  const [isAuthDialogOpen, setAuthDialog] = useState(false)
  const [authView, setAuthView] = useState<ViewType>('sign_in')
  const [isRateLimited, setIsRateLimited] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [selectedCandidate, setSelectedCandidate] = useState<VariantId | undefined>()
  const [activeCandidateId, setActiveCandidateId] = useState<VariantId | undefined>()
  const [hasTournament, setHasTournament] = useState(false)
  const [serverVersions, setServerVersions] = useState<
    { id: string; label: string; createdAt: number }[]
  >([])
  const tournament = useTournament()
  const { session, userTeam, signOut } = useAuth(setAuthDialog, setAuthView)
  const [useMorphApply, setUseMorphApply] = useLocalStorage(
    'useMorphApply',
    process.env.NEXT_PUBLIC_USE_MORPH_APPLY === 'true',
  )

  const filteredModels = modelsList.models.filter((model) => {
    if (process.env.NEXT_PUBLIC_HIDE_LOCAL_MODELS) {
      return model.providerId !== 'ollama'
    }
    return true
  })

  const defaultModel = filteredModels.find(
    (model) => model.id === 'gpt-5',
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

  const [hydrated, setHydrated] = useState(false)
  const [projectStore, setProjectStore] = useState<ProjectStore | null>(null)
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const skipSaveRef = useRef(true)
  const skipCandidatePromoteRef = useRef(false)
  const storeRef = useRef<ProjectStore | null>(null)
  const lastGoodFragmentRef = useRef<DeepPartial<FragmentSchema> | undefined>()
  const persistedRunRef = useRef('')
  const lastSandboxedCandidateRef = useRef<string>()
  const resultRef = useRef<ExecutionResult | undefined>()
  const workspaceRef = useRef<ProjectWorkspace>(blankWorkspace())
  const [inspectOpen, setInspectOpen] = useState(false)
  const [inspectSelection, setInspectSelection] = useState<InspectSelection | null>(null)
  const [inspectApplying, setInspectApplying] = useState(false)
  const [inspectError, setInspectError] = useState('')
  const [versionCursor, setVersionCursor] = useState(0)

  resultRef.current = result
  workspaceRef.current = {
    messages,
    fragment,
    result,
    selectedCandidate,
    activeCandidateId,
    hasTournament,
    currentTab,
    chatInput,
    tournament: {
      candidates: tournament.candidates,
      verdict: tournament.verdict,
      phase: tournament.phase,
    },
  }

  const applyProject = (project: ProjectRecord) => {
    skipSaveRef.current = true
    skipCandidatePromoteRef.current = true
    setInspectOpen(false)
    setInspectSelection(null)
    setInspectError('')
    setVersionCursor(0)
    setMessages(project.messages ?? [])
    setFragment(project.fragment)
    setResult(project.result)
    setSelectedCandidate(project.selectedCandidate)
    setActiveCandidateId(project.activeCandidateId)
    lastGoodFragmentRef.current = project.fragment
    lastSandboxedCandidateRef.current = undefined
    persistedRunRef.current = ''
    setServerVersions([])
    setHasTournament(Boolean(project.hasTournament))
    setCurrentTab(
      project.currentTab === 'fragment' || project.currentTab === 'database'
        ? project.currentTab
        : 'code',
    )
    setChatInput(project.chatInput ?? '')
    setFiles([])
    setIsPreviewLoading(false)
    if (project.tournament?.candidates) {
      tournament.hydrate({
        candidates: project.tournament.candidates,
        verdict: project.tournament.verdict,
        phase: project.tournament.phase ?? 'done',
      })
    } else {
      tournament.reset()
    }
  }

  const persistCurrent = (force = false) => {
    const store = storeRef.current
    if (!store) return
    if (!force && skipSaveRef.current) return
    const next = saveWorkspace(store, store.activeId, workspaceRef.current)
    storeRef.current = next
    setProjectStore(next)
  }

  useEffect(() => {
    if (typeof window === 'undefined') return
    const store = loadStore()
    storeRef.current = store
    setProjectStore(store)
    applyProject(getActive(store))
    setHydrated(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const saverRef = useRef(createDebouncedSaver(() => persistCurrent()))
  useEffect(() => {
    saverRef.current = createDebouncedSaver(() => persistCurrent())
    return () => saverRef.current.cancel()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!hydrated) return
    if (skipSaveRef.current) {
      skipSaveRef.current = false
      return
    }
    saverRef.current.schedule()
  }, [
    hydrated,
    messages,
    fragment,
    result,
    selectedCandidate,
    activeCandidateId,
    hasTournament,
    currentTab,
    chatInput,
    tournament.candidates,
    tournament.verdict,
    tournament.phase,
  ])

  function handleNewProject() {
    saverRef.current.flush()
    persistCurrent(true)
    const store = storeRef.current
    if (!store) return
    const created = createProject(blankWorkspace())
    const next = upsertProject(store, created, true)
    storeRef.current = next
    setProjectStore(next)
    applyProject(created)
  }

  function handleSwitchProject(id: string) {
    const store = storeRef.current
    if (!store || id === store.activeId) return
    saverRef.current.flush()
    persistCurrent(true)
    const latest = storeRef.current
    if (!latest?.projects[id]) return
    const next = setActiveId(latest, id)
    storeRef.current = next
    setProjectStore(next)
    applyProject(next.projects[id])
  }

  function confirmDeleteProject() {
    const store = storeRef.current
    const id = pendingDeleteId
    if (!store || !id) return
    saverRef.current.flush()
    if (id === store.activeId) persistCurrent(true)
    const { store: next, opened } = deleteProject(store, id)
    storeRef.current = next
    setProjectStore(next)
    setPendingDeleteId(null)
    applyProject(opened)
  }
  const currentTemplate =
    selectedTemplate === 'auto'
      ? templates
      : { [selectedTemplate]: templates[selectedTemplate] }
  const lastMessage = messages[messages.length - 1]

  // Determine which API to use based on morph toggle and existing fragment
  const shouldUseMorph =
    useMorphApply && fragment && fragment.code && fragment.file_path
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

        const editId = activeCandidateId ?? selectedCandidate ?? 'solo'
        const response = await fetch('/api/sandbox', {
          method: 'POST',
          body: JSON.stringify({
            fragment,
            userID: session?.user?.id,
            teamID: userTeam?.id,
            accessToken: session?.access_token,
            projectId: storeRef.current?.activeId,
            candidateId: editId,
            runId: storeRef.current?.activeId,
            sbxId:
              lastSandboxedCandidateRef.current === editId &&
              resultRef.current &&
              'sbxId' in resultRef.current
                ? resultRef.current.sbxId
                : undefined,
          }),
        })

        const sandboxResult = await response.json()
        console.log('result', sandboxResult)
        if (!response.ok || (!sandboxResult?.url && !sandboxResult?.sbxId)) {
          setErrorMessage(
            sandboxResult?.error || 'Preview failed. Previous version kept.',
          )
          if (lastGoodFragmentRef.current) setFragment(lastGoodFragmentRef.current)
          setIsPreviewLoading(false)
          return
        }
        posthog.capture('sandbox_created', { url: sandboxResult.url })
        lastGoodFragmentRef.current = fragment
        lastSandboxedCandidateRef.current = editId
        if (activeCandidateId) {
          tournament.patchCandidate(activeCandidateId, { fragment })
        }

        setResult(sandboxResult)
        setCurrentPreview({ fragment, result: sandboxResult })
        setMessage({ result: sandboxResult })
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
        { type: 'code', text: fragmentCodeText(object.code) },
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

  // Highlight the winner; do not sandbox until USE.
  useEffect(() => {
    const winner = Object.values(tournament.candidates).find((c) => c.isWinner)
    if (winner && !selectedCandidate) {
      setSelectedCandidate(winner.id)
    }
  }, [tournament.candidates, selectedCandidate])

  // Persist all three candidates after generation — no sandbox required.
  useEffect(() => {
    if (tournament.phase !== 'done') return
    const projectId = storeRef.current?.activeId
    if (!projectId) return
    const ready = Object.values(tournament.candidates).filter(
      (c) => c.fragment && (c.fragment.code || c.fragment.file_path),
    )
    if (!ready.length) return
    const key = `${projectId}:done:${ready.map((c) => c.id).join(',')}`
    if (persistedRunRef.current === key) return
    persistedRunRef.current = key
    for (const c of ready) {
      void fetch('/api/project-files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          candidateId: c.id,
          runId: projectId,
          fragment: c.fragment,
          label: c.fragment?.title || c.label,
          score: c.scoreComposite,
          isWinner: c.isWinner,
        }),
      })
    }
  }, [tournament.phase, tournament.candidates])

  // Server project record is authoritative for ACTIVE.
  useEffect(() => {
    if (!hydrated || !projectStore?.activeId) return
    const id = projectStore.activeId
    let cancelled = false
    fetch(`/api/project?projectId=${encodeURIComponent(id)}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled || !data?.activeCandidateId) return
        setActiveCandidateId(data.activeCandidateId as VariantId)
        setSelectedCandidate((cur) => cur || (data.activeCandidateId as VariantId))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [hydrated, projectStore?.activeId])

  useEffect(() => {
    if (!activeCandidateId || !projectStore?.activeId) {
      setServerVersions([])
      return
    }
    let cancelled = false
    fetch(
      `/api/project-files?projectId=${encodeURIComponent(projectStore.activeId)}&candidateId=${encodeURIComponent(activeCandidateId)}`,
    )
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return
        setServerVersions(
          Array.isArray(data?.versions)
            ? data.versions.map((v: { id: string; label?: string; createdAt?: number }) => ({
                id: v.id,
                label: v.label || 'Version',
                createdAt: v.createdAt || 0,
              }))
            : [],
        )
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [activeCandidateId, projectStore?.activeId, result?.sbxId])

  // Sandbox only the ACTIVE candidate, from persisted files.
  useEffect(() => {
    if (!hydrated || !activeCandidateId || !session) return
    const c = tournament.candidates[activeCandidateId]
    const next =
      (c?.fragment as DeepPartial<FragmentSchema> | undefined) ||
      lastGoodFragmentRef.current ||
      fragment
    if (!next && !c) return
    let cancelled = false
    setIsPreviewLoading(true)
    const reuse =
      lastSandboxedCandidateRef.current === activeCandidateId &&
      resultRef.current &&
      'sbxId' in resultRef.current
        ? resultRef.current.sbxId
        : undefined
    fetch('/api/sandbox', {
      method: 'POST',
      body: JSON.stringify({
        fragment: next || {
          template: 'nextjs-developer',
          file_path: 'pages/index.tsx',
          code: '',
        },
        userID: session.user?.id,
        teamID: userTeam?.id,
        accessToken: session.access_token,
        projectId: storeRef.current?.activeId,
        candidateId: activeCandidateId,
        runId: storeRef.current?.activeId,
        sbxId: reuse,
        rehydrateOnly: !Boolean(next && (next.code || next.file_path)),
      }),
    })
      .then(async (r) => {
        const sandboxResult = await r.json()
        if (cancelled) return
        if (!r.ok) {
          setErrorMessage(sandboxResult?.error || 'Could not resume preview.')
          return
        }
        lastSandboxedCandidateRef.current = activeCandidateId
        setResult(sandboxResult)
        if (sandboxResult?.installError) {
          setErrorMessage(`Install did not finish: ${sandboxResult.installError}`)
        } else if (sandboxResult?.runError) {
          setErrorMessage(`Preview did not finish: ${sandboxResult.runError}`)
        }
        setCurrentTab('fragment')
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setIsPreviewLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, activeCandidateId, session?.user?.id, projectStore?.activeId])

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

  async function handleUse(id: VariantId) {
    const projectId = storeRef.current?.activeId
    const c = tournament.candidates[id]
    if (c?.fragment) {
      setFragment(c.fragment)
      lastGoodFragmentRef.current = c.fragment
    }
    setSelectedCandidate(id)
    setActiveCandidateId(id)
    setHasTournament(true)
    if (projectId) {
      void fetch('/api/project', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          activeCandidateId: id,
          ownerId: session?.user?.id,
        }),
      })
    }
  }

  async function handleSubmitAuth(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()

    if (!session) {
      return setAuthDialog(true)
    }

    if (isLoading) {
      stop()
    }
    if (tournament.phase === 'generating') {
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

    const readyCandidates = Object.values(tournament.candidates).filter(
      (c) => c.fragment && (c.status === 'done' || c.isWinner),
    )
    const arenaReady = tournament.phase === 'done' && readyCandidates.length > 0
    const isFirstGeneration =
      !activeCandidateId && !arenaReady && !fragment && !shouldUseMorph

    if (isFirstGeneration) {
      // Tournament: 3 specimens generated in parallel, judged by editor.
      setHasTournament(true)
      setSelectedCandidate(undefined)
      setFragment(undefined)
      setResult(undefined)
      tournament.submit({
        userID: session?.user?.id,
        teamID: userTeam?.id,
        messages: toAISDKMessages(updatedMessages),
        template: currentTemplate,
        model: currentModel,
        config: languageModel,
        projectId: storeRef.current?.activeId,
      })

      posthog.capture('tournament_submit', {
        template: selectedTemplate,
        model: languageModel.model,
      })
    } else {
      if (!activeCandidateId && arenaReady) {
        const pick =
          (selectedCandidate &&
            tournament.candidates[selectedCandidate]?.fragment &&
            selectedCandidate) ||
          readyCandidates.find((c) => c.isWinner)?.id ||
          readyCandidates[0].id
        await handleUse(pick)
      }
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
    if (tournament.phase === 'generating' || tournament.phase === 'judging') {
      tournament.stop()
    }
    setChatInput('')
    setFiles([])
    setMessages([])
    setInspectOpen(false)
    setInspectSelection(null)
    setInspectError('')
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
    if (activeCandidateId && lastGoodFragmentRef.current) {
      setFragment(lastGoodFragmentRef.current)
    } else {
      setCurrentPreview({ fragment: undefined, result: undefined })
    }
  }

  const activeVersions = projectStore ? getActive(projectStore).versions : []

  function restoreVersionAt(index: number) {
    const v = activeVersions[index]
    if (!v?.fragment) return
    skipCandidatePromoteRef.current = true
    setVersionCursor(index)
    setFragment(v.fragment)
    setResult(v.result)
    setInspectSelection(null)
    setCurrentTab('fragment')
  }

  async function handleInspectApply(instruction: string) {
    if (!session) {
      setAuthDialog(true)
      return
    }
    const complete = toCompleteFragment(fragment)
    if (!complete) {
      setInspectError('No active project source to patch.')
      return
    }
    setInspectApplying(true)
    setInspectError('')
    try {
      const res = await fetch('/api/inspect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fragment: complete,
          selection: inspectSelection,
          instruction,
          model: currentModel,
          config: languageModel,
        }),
      })
      if (!res.ok) {
        setInspectError((await res.text()) || 'Inspect apply failed.')
        return
      }
      const updated = (await res.json()) as DeepPartial<FragmentSchema>
      const nextComplete = toCompleteFragment(updated)
      if (!nextComplete) {
        setInspectError('Patch failed validation.')
        return
      }
      const sandboxRes = await fetch('/api/sandbox', {
        method: 'POST',
        body: JSON.stringify({
          fragment: nextComplete,
          userID: session.user?.id,
          teamID: userTeam?.id,
          accessToken: session.access_token,
          projectId: storeRef.current?.activeId,
          candidateId: activeCandidateId ?? selectedCandidate ?? 'solo',
          runId: storeRef.current?.activeId,
          sbxId: result && 'sbxId' in result ? result.sbxId : undefined,
        }),
      })
      const sandboxResult = await sandboxRes.json()
      if (!sandboxRes.ok || !sandboxResult?.url) {
        setInspectError('Patch generated but preview failed to start.')
        return
      }
      skipCandidatePromoteRef.current = true
      setFragment(nextComplete)
      setResult(sandboxResult)
      setCurrentTab('fragment')
      setInspectSelection(null)
      const store = storeRef.current
      if (store) {
        const version = {
          id:
            typeof crypto !== 'undefined' && crypto.randomUUID
              ? crypto.randomUUID()
              : `v_${Date.now().toString(36)}`,
          createdAt: Date.now(),
          label: instruction.trim().slice(0, 56),
          fragment: nextComplete,
          result: sandboxResult,
        }
        const next = pushVersion(store, store.activeId, version, {
          ...workspaceRef.current,
          fragment: nextComplete,
          result: sandboxResult,
          currentTab: 'fragment',
        })
        storeRef.current = next
        setProjectStore(next)
        setVersionCursor(0)
      }
    } catch (e) {
      setInspectError(e instanceof Error ? e.message : 'Inspect apply failed.')
    } finally {
      setInspectApplying(false)
    }
  }

  const pendingDeleteName = pendingDeleteId
    ? projectStore?.projects[pendingDeleteId]?.name ?? 'this project'
    : ''
  const firstPrompt = messages
    .find((m) => m.role === 'user')
    ?.content.find((c) => c.type === 'text' && 'text' in c)?.text
  const selectedSpec = selectedCandidate
    ? tournament.candidates[selectedCandidate]
    : undefined

  const isBuilding =
    tournament.phase === 'generating' ||
    tournament.phase === 'judging' ||
    isLoading ||
    isPreviewLoading
  const dockCommand = isBuilding || hasTournament

  useEffect(() => {
    if (!isBuilding) {
      setElapsed(0)
      return
    }
    const started = Date.now()
    const tick = () => setElapsed(Math.floor((Date.now() - started) / 1000))
    tick()
    const id = setInterval(tick, 250)
    return () => clearInterval(id)
  }, [isBuilding])

  const chatInputSlot = (
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
  )

  return (
    <main className="flex flex-col min-h-screen max-h-screen bg-background">
      <AuthDialog
        open={isAuthDialogOpen}
        setOpen={setAuthDialog}
        view={authView}
      />
      <Dialog open={!!pendingDeleteId} onOpenChange={(o) => !o && setPendingDeleteId(null)}>
        <DialogContent className="rounded-none border-foreground sm:max-w-sm">
          <DialogTitle className="font-display text-xl">
            Delete “{pendingDeleteName}”?
          </DialogTitle>
          <DialogDescription>
            This removes the project from this browser. It cannot be undone.
          </DialogDescription>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              type="button"
              variant="ghost"
              className="rounded-none"
              onClick={() => setPendingDeleteId(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="rounded-none"
              onClick={confirmDeleteProject}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Editorial app bar — brand + run meta + actions, all in one strip */}
      <div className="shrink-0 border-b border-border bg-background">
        <NavBar
          session={session}
          showLogin={() => setAuthDialog(true)}
          signOut={logout}
          onSocialClick={handleSocialClick}
          onClear={handleClearChat}
          canClear={messages.length > 0}
          canUndo={messages.length > 1 && !isLoading}
          onUndo={handleUndo}
          isLoading={isLoading || tournament.phase === 'generating' || tournament.phase === 'judging'}
          hasFragment={!!fragment && !!result && !isPreviewLoading}
          projects={projectStore ? listProjects(projectStore).map((p) => ({ id: p.id, name: p.name })) : []}
          activeProjectId={projectStore?.activeId}
          activeProjectName={
            projectStore ? getActive(projectStore).name : 'Untitled'
          }
          onNewProject={handleNewProject}
          onSwitchProject={handleSwitchProject}
          onDeleteProject={setPendingDeleteId}
        />
      </div>

      {/* Thin rail | wide preview — command docks left once a run starts */}
      <div
        className={`flex-1 grid w-full grid-cols-1 overflow-hidden ${
          dockCommand
            ? 'md:grid-cols-[minmax(22rem,28rem)_minmax(0,1fr)]'
            : 'md:grid-cols-[16rem_minmax(0,1fr)]'
        }`}
      >
        <aside className="flex flex-col min-h-0 min-w-0 border-b md:border-b-0 md:border-r border-border overflow-hidden">
          <div className="flex-1 min-h-0 overflow-y-auto">
          <RailSection label="Project">
            <p className="font-display text-[14px] leading-tight">
              {projectStore ? getActive(projectStore).name : firstPrompt?.slice(0, 48) || 'Untitled'}
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {projectStore
                ? getActive(projectStore).purpose || 'No purpose yet.'
                : firstPrompt
                  ? firstPrompt.slice(0, 72)
                  : 'No purpose yet.'}
            </p>
          </RailSection>
          <RailSection label="Versions">
            <p className="font-mono text-[10px] tracking-[0.16em] uppercase text-muted-foreground">
              + {(serverVersions.length || activeVersions.length)} versions +
            </p>
            {(serverVersions.length ? serverVersions : activeVersions).slice(0, 8).map((v, i) => (
              <p key={v.id} className="mt-1 text-[11px] text-muted-foreground truncate">
                {v.label || 'Version'}
              </p>
            ))}
          </RailSection>
          <RailSection label="Run">
            <p className="text-[12px]">
              {activeCandidateId
                ? `${tournament.candidates[activeCandidateId]?.sigil || ''} · ${tournament.candidates[activeCandidateId]?.label || activeCandidateId} · Active`
                : selectedSpec
                  ? `${selectedSpec.sigil} · ${selectedSpec.label}`
                  : 'No active candidate. Use one to continue.'}
            </p>
          </RailSection>
          <RailSection label="Candidates">
            {hasTournament || activeCandidateId ? (
              <SpecimenStrip
                layout="rail"
                candidates={tournament.candidates}
                selectedId={selectedCandidate}
                activeId={activeCandidateId}
                onSelect={setSelectedCandidate}
                onUse={handleUse}
                verdictReasoning={tournament.verdict?.reasoning}
                phase={tournament.phase}
              />
            ) : (
              <p className="text-[12px] text-muted-foreground">No candidates yet.</p>
            )}
          </RailSection>
          <RailSection label="Brain">
            <p className="font-mono text-[10px] tracking-[0.16em] uppercase text-muted-foreground">
              empty +
            </p>
          </RailSection>
          <RailSection label="Activity">
            {messages.length > 0 ? (
              <Chat
                messages={messages}
                isLoading={isLoading}
                setCurrentPreview={setCurrentPreview}
              />
            ) : (
              <p className="text-[12px] text-muted-foreground">No activity.</p>
            )}
          </RailSection>
          </div>
          {dockCommand && (
            <div className="shrink-0 border-t border-border px-3 pt-2 pb-3">
              {chatInputSlot}
            </div>
          )}
        </aside>

        <section className="relative flex flex-col min-h-0 min-w-0 overflow-hidden">
          {fragment ? (
            <div className="flex-1 min-h-0 overflow-hidden">
              <Preview
                teamID={userTeam?.id}
                accessToken={session?.access_token}
                selectedTab={currentTab}
                onSelectedTabChange={setCurrentTab}
                isChatLoading={isLoading}
                isPreviewLoading={isPreviewLoading}
                fragment={fragment}
                result={result as ExecutionResult}
                projectId={projectStore?.activeId}
                candidateId={activeCandidateId ?? selectedCandidate ?? 'solo'}
                onClose={() => {
                  if (activeCandidateId) return
                  setFragment(undefined)
                }}
                inspect={{
                  open: inspectOpen,
                  setOpen: setInspectOpen,
                  selection: inspectSelection,
                  setSelection: setInspectSelection,
                  onApply: handleInspectApply,
                  applying: inspectApplying,
                  error: inspectError,
                  canUndo: versionCursor < activeVersions.length - 1,
                  canRedo: versionCursor > 0,
                  onUndo: () => restoreVersionAt(versionCursor + 1),
                  onRedo: () => restoreVersionAt(versionCursor - 1),
                  onReset: () => {
                    setInspectSelection(null)
                    if (activeVersions[0]) restoreVersionAt(0)
                  },
                }}
              />
            </div>
          ) : isBuilding ? (
            <ProcessingPane
              seconds={elapsed}
              detail={
                tournament.phase === 'judging'
                  ? 'editor scoring'
                  : isPreviewLoading
                    ? 'sandboxing'
                    : 'sequencing specimens'
              }
            />
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center px-6">
              <p className="font-mono text-[10px] tracking-[0.28em] uppercase text-muted-foreground">
                Live preview
              </p>
              <h2 className="mt-3 font-display font-black tracking-tight text-center text-[clamp(1.75rem,5vw,3.25rem)] leading-[1.05]">
                {hasTournament
                  ? 'Use a candidate to start the workspace'
                  : 'Describe what you want to build'}
              </h2>
              {!dockCommand && (
                <div className="mt-8 w-full max-w-2xl">{chatInputSlot}</div>
              )}
            </div>
          )}
        </section>
      </div>
    </main>
  )
}

function ProcessingPane({ seconds, detail }: { seconds: number; detail: string }) {
  const mm = String(Math.floor(seconds / 60)).padStart(2, '0')
  const ss = String(seconds % 60).padStart(2, '0')
  return (
    <div className="h-full flex flex-col items-center justify-center px-6">
      <p className="font-mono text-[10px] tracking-[0.28em] uppercase text-muted-foreground">
        Processing
      </p>
      <p className="mt-5 font-display font-black tabular leading-none text-[clamp(3.5rem,12vw,7rem)]">
        {mm}:{ss}
      </p>
      <p className="mt-4 font-mono text-[10px] tracking-[0.22em] uppercase text-muted-foreground">
        {detail}
      </p>
    </div>
  )
}

function RailSection({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <div className="px-3 py-2.5 border-b border-border/70">
      <p className="font-mono text-[9px] tracking-[0.22em] uppercase text-muted-foreground mb-1.5">
        {label}
      </p>
      {children}
    </div>
  )
}

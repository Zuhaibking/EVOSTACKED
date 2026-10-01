'use client'

import { AuthDialog, ViewType } from '@/components/auth-dialog'
import { Chat } from '@/components/chat'
import { ChatInput } from '@/components/chat-input'
import { ChatPicker } from '@/components/chat-picker'
import { ChatSettings } from '@/components/chat-settings'
import { NavBar } from '@/components/navbar'
import { Preview } from '@/components/preview'
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
  getProjectById,
  prepareProjectForOpen,
  projectIdFromPath,
  projectPath,
  listProjects,
  loadStore,
  pushVersion,
  saveWorkspace,
  setActiveId,
  upsertProject,
} from '@/lib/projects'
import { LLMModelConfig } from '@/lib/models'
import modelsList from '@/lib/models.json'
import { FragmentSchema, fragmentCodeText, sameFragmentSource, fragmentSchema as schema } from '@/lib/schema'
import templates from '@/lib/templates'
import { VariantId } from '@/lib/tournament'
import { useTournament } from '@/lib/tournament-client'
import { ExecutionResult } from '@/lib/types'
import { createSandbox } from '@/lib/sandbox-client'
import { DeepPartial } from 'ai'
import { experimental_useObject as useObject } from 'ai/react'
import { usePostHog } from 'posthog-js/react'
import { ReactNode, SetStateAction, useEffect, useRef, useState } from 'react'
import { useLocalStorage } from 'usehooks-ts'
import { ArrowUpRight, Check, History, Layers3, Loader2 } from 'lucide-react'

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
  const [currentTab, setCurrentTab] = useState<'code' | 'fragment'>('code')
  const [isPreviewLoading, setIsPreviewLoading] = useState(false)
  const [isAuthDialogOpen, setAuthDialog] = useState(false)
  const [authView, setAuthView] = useState<ViewType>('sign_in')
  const [isRateLimited, setIsRateLimited] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [selectedCandidate, setSelectedCandidate] = useState<VariantId | undefined>()
  const [hasTournament, setHasTournament] = useState(false)
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

  const [hydrated, setHydrated] = useState(false)
  const [projectStore, setProjectStore] = useState<ProjectStore | null>(null)
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const [missingProjectId, setMissingProjectId] = useState<string | null>(null)
  const [previewRestoreEpoch, setPreviewRestoreEpoch] = useState(0)
  const missingProjectRef = useRef<string | null>(null)
  const standaloneRestoreRef = useRef<{ fragment: DeepPartial<FragmentSchema>; result?: ExecutionResult; runtimeError?: string } | null>(null)
  const generationResumeRef = useRef<ProjectRecord | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const skipSaveRef = useRef(true)
  const skipCandidatePromoteRef = useRef(false)
  const fragmentRef = useRef(fragment)
  const sandboxGen = useRef(0)
  const chatRequestGen = useRef(-1)
  const chatRequestSequence = useRef(0)
  const chatBaseFragmentRef = useRef<DeepPartial<FragmentSchema> | undefined>()
  const inspectGen = useRef(0)
  const previewJobs = useRef(new Map<VariantId | 'standalone', AbortController>())

  function cancelPreviews() {
    sandboxGen.current += 1
    chatRequestGen.current = -1
    chatBaseFragmentRef.current = undefined
    chatRequestSequence.current += 1
    inspectGen.current += 1
    for (const controller of previewJobs.current.values()) controller.abort()
    previewJobs.current.clear()
    standaloneRestoreRef.current = null
    generationResumeRef.current = null
  }
  const promotedIdRef = useRef<VariantId | undefined>(undefined)
  const inspectOpenRef = useRef(false)
  fragmentRef.current = fragment
  const storeRef = useRef<ProjectStore | null>(null)
  const workspaceRef = useRef<ProjectWorkspace>(blankWorkspace())
  const [inspectOpen, setInspectOpen] = useState(false)
  inspectOpenRef.current = inspectOpen
  const [inspectSelection, setInspectSelection] = useState<InspectSelection | null>(null)
  const [inspectApplying, setInspectApplying] = useState(false)
  const [inspectError, setInspectError] = useState('')
  const [versionCursor, setVersionCursor] = useState(0)

  workspaceRef.current = {
    messages,
    fragment,
    result,
    selectedCandidate,
    hasTournament,
    currentTab,
    chatInput,
    tournament: {
      runID: tournament.runID,
      candidates: tournament.candidates,
      verdict: tournament.verdict,
      phase: tournament.phase,
    },
  }

  const applyProject = (saved: ProjectRecord, historyMode: 'push' | 'replace' | false = 'push') => {
    const project = prepareProjectForOpen(saved)
    missingProjectRef.current = null
    setMissingProjectId(null)
    cancelPreviews()
    stop()
    tournament.detach()
    promotedIdRef.current = undefined
    setErrorMessage('')
    skipSaveRef.current = true
    skipCandidatePromoteRef.current = true
    setInspectOpen(false)
    setInspectSelection(null)
    setInspectError('')
    setInspectApplying(false)
    setVersionCursor(0)
    setMessages(project.messages ?? [])
    setFragment(project.fragment)
    setResult(project.result)
    setSelectedCandidate(project.selectedCandidate)
    setHasTournament(Boolean(project.hasTournament))
    setCurrentTab(project.currentTab === 'fragment' ? 'fragment' : 'code')
    setChatInput(project.chatInput ?? '')
    setFiles([])
    setIsPreviewLoading(Boolean(project.fragment))
    if (historyMode && typeof window !== 'undefined') {
      const url = new URL(window.location.href)
      url.pathname = projectPath(project.id)
      url.searchParams.delete('prompt')
      const path = `${url.pathname}${url.search}${url.hash}`
      if (`${window.location.pathname}${window.location.search}${window.location.hash}` !== path) {
        window.history[historyMode === 'push' ? 'pushState' : 'replaceState'](null, '', path)
      }
    }
    if (project.fragment && !project.selectedCandidate) {
      standaloneRestoreRef.current = { fragment: project.fragment, result: project.result }
      setPreviewRestoreEpoch((value) => value + 1)
    }
    if (project.tournament?.candidates) {
      if (project.hasTournament && (['generating', 'judging'].includes(project.tournament.phase) || Object.values(project.tournament.candidates).some((c) => c.error === 'interrupted by reload'))) {
        generationResumeRef.current = project
      }
      tournament.hydrate({
        runID: project.tournament.runID,
        projectID: project.id,
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
    if (!store || missingProjectRef.current) return
    if (!force && skipSaveRef.current) return
    const next = saveWorkspace(store, store.activeId, workspaceRef.current)
    storeRef.current = next
    setProjectStore(next)
  }

  useEffect(() => {
    if (typeof window === 'undefined') return
    let store = loadStore()
    const incoming = new URLSearchParams(window.location.search).get('prompt')
    const routedId = projectIdFromPath(window.location.pathname)
    const requestedId = routedId || (window.location.pathname.startsWith('/app/') && window.location.pathname !== '/app/' ? window.location.pathname : null)
    const project = requestedId ? getProjectById(store, requestedId) : getActive(store)
    if (project) store = setActiveId(store, project.id)
    storeRef.current = store
    setProjectStore(store)
    if (project) applyProject(project, 'replace')
    else {
      missingProjectRef.current = requestedId
      setMissingProjectId(requestedId)
    }
    if (incoming?.trim()) setChatInput(incoming)
    setHydrated(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const saverRef = useRef(createDebouncedSaver(() => persistCurrent()))
  useEffect(() => {
    saverRef.current = createDebouncedSaver(() => persistCurrent())
    const saveBeforeLeave = () => {
      if (!storeRef.current || missingProjectRef.current) return
      saverRef.current.cancel()
      persistCurrent(true)
    }
    const onHistoryChange = () => {
      saveBeforeLeave()
      cancelPreviews()
      stop()
      tournament.detach()
      if (!/^\/app(?:\/|$)/.test(window.location.pathname)) return
      const store = loadStore()
      const id = projectIdFromPath(window.location.pathname)
      const requestedId = id || (window.location.pathname.startsWith('/app/') && window.location.pathname !== '/app/' ? window.location.pathname : null)
      const project = requestedId ? getProjectById(store, requestedId) : getActive(store)
      if (!project) {
        missingProjectRef.current = requestedId
        setMissingProjectId(requestedId)
        setIsPreviewLoading(false)
        return
      }
      const next = setActiveId(store, project.id)
      storeRef.current = next
      setProjectStore(next)
      applyProject(project, id ? false : 'replace')
    }
    window.addEventListener('pagehide', saveBeforeLeave)
    window.addEventListener('beforeunload', saveBeforeLeave)
    window.addEventListener('popstate', onHistoryChange)
    return () => {
      saveBeforeLeave()
      saverRef.current.cancel()
      window.removeEventListener('pagehide', saveBeforeLeave)
      window.removeEventListener('beforeunload', saveBeforeLeave)
      window.removeEventListener('popstate', onHistoryChange)
    }
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
    hasTournament,
    currentTab,
    chatInput,
    tournament.candidates,
    tournament.verdict,
    tournament.phase,
    tournament.runID,
  ])

  useEffect(() => {
    if (hydrated && tournament.runID) persistCurrent(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, tournament.runID])

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
    const { store: next, opened } = deleteProject(storeRef.current ?? store, id)
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
      if (chatRequestGen.current !== sandboxGen.current) return
      console.error('Error submitting request:', error)
      if (error.message.includes('limit')) {
        setIsRateLimited(true)
      }

      setErrorMessage(error.message)
      if (selectedCandidate) tournament.noteSandbox(selectedCandidate, { sandboxStatus: 'error', sandboxError: error.message })
    },
    onFinish: async ({ object: generated, error }) => {
      if (error || !generated || chatRequestGen.current !== sandboxGen.current) return
      const gen = sandboxGen.current
      const request = chatRequestSequence.current
      setIsPreviewLoading(true)
      setErrorMessage('')
      posthog.capture('fragment_generated', { template: generated.template })
      try {
        const nextResult = await createSandbox({
          fragment: generated,
          projectID: storeRef.current?.activeId,
          candidateID: selectedCandidate,
          userID: session?.user?.id,
          teamID: userTeam?.id,
          accessToken: session?.access_token,
          model: currentModel,
          config: languageModel,
        })
        if (gen !== sandboxGen.current || chatRequestGen.current !== gen || request !== chatRequestSequence.current) return
        const nextFragment = ('fragment' in nextResult && nextResult.fragment) || generated
        if (selectedCandidate) tournament.noteSandbox(selectedCandidate, {
          fragment: nextFragment,
          result: nextResult,
          sandboxStatus: 'ready',
          sandboxError: undefined,
        })
        setCurrentPreview({ fragment: nextFragment, result: nextResult })
        setMessage({ object: nextFragment, result: nextResult, content: [
          { type: 'text', text: nextFragment.commentary || '' },
          { type: 'code', text: fragmentCodeText(nextFragment.code) },
        ] })
        setCurrentTab('fragment')
      } catch (e) {
        if (gen !== sandboxGen.current || chatRequestGen.current !== gen || request !== chatRequestSequence.current) return
        const message = e instanceof Error ? e.message : 'Preview failed to start.'
        setErrorMessage(message)
        if (selectedCandidate) tournament.noteSandbox(selectedCandidate, { sandboxStatus: 'error', sandboxError: message })
      } finally {
        if (gen === sandboxGen.current && chatRequestGen.current === gen && request === chatRequestSequence.current) setIsPreviewLoading(false)
      }
    },
  })

  useEffect(() => {
    if (object && isLoading && chatRequestGen.current === sandboxGen.current) {
      const base = chatBaseFragmentRef.current
      const files = new Map((base?.files ?? []).filter((file) => file?.file_path).map((file) => [file!.file_path, file]))
      for (const file of object.files ?? []) if (file?.file_path) files.set(file.file_path, { ...files.get(file.file_path), ...file, file_content: file.file_content ?? files.get(file.file_path)?.file_content })
      const streamed = { ...base, ...object, ...(files.size ? { files: Array.from(files.values()) } : {}) }
      setFragment(streamed)
      const content: Message['content'] = [
        { type: 'text', text: streamed.commentary || '' },
        { type: 'code', text: fragmentCodeText(streamed.code) },
      ]

      if (!lastMessage || lastMessage.role !== 'assistant') {
        addMessage({
          role: 'assistant',
          content,
          object: streamed,
        })
      }

      if (lastMessage && lastMessage.role === 'assistant') {
        setMessage({
          content,
          object: streamed,
        })
      }
    }
  }, [object, isLoading])

  useEffect(() => {
    if (error) stop()
  }, [error])

  // Auto-select the winning candidate when verdict arrives.
  useEffect(() => {
    const winner = Object.values(tournament.candidates).find((c) => c.isWinner)
    if (winner && !selectedCandidate) {
      setSelectedCandidate(winner.id)
    }
  }, [tournament.candidates, selectedCandidate])

  useEffect(() => {
    if (!hydrated || !session || missingProjectRef.current || !generationResumeRef.current) return
    const saved = generationResumeRef.current
    generationResumeRef.current = null
    if (saved.tournament.runID) tournament.resume({ projectID: saved.id, runID: saved.tournament.runID })
    else startTournament(saved.messages, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, session, projectStore?.activeId])

  // Each completed candidate starts independently. Selection only reads its cached preview.
  useEffect(() => {
    if (!hydrated || !session || missingProjectRef.current) return
    const gen = sandboxGen.current
    for (const c of Object.values(tournament.candidates)) {
      if (c.status !== 'done' || !c.fragment || c.sandboxStatus || previewJobs.current.has(c.id)) continue
      const controller = new AbortController()
      previewJobs.current.set(c.id, controller)
      tournament.noteSandbox(c.id, { sandboxStatus: 'starting', sandboxError: undefined })
      createSandbox({
        fragment: c.fragment,
        cachedResult: c.result,
        projectID: storeRef.current?.activeId,
        runID: tournament.runID,
        candidateID: c.id,
        userID: session.user?.id,
        teamID: userTeam?.id,
        accessToken: session.access_token,
        model: currentModel,
        config: languageModel,
        runtimeError: c.runtimeError,
      }, controller.signal).then((nextResult) => {
        if (gen !== sandboxGen.current || controller.signal.aborted) return
        tournament.noteSandbox(c.id, {
          result: nextResult,
          ...('fragment' in nextResult && nextResult.fragment ? { fragment: nextResult.fragment } : {}),
          sandboxStatus: 'ready',
          sandboxError: undefined,
          runtimeError: undefined,
        })
      }).catch((e) => {
        if (gen !== sandboxGen.current || controller.signal.aborted) return
        tournament.noteSandbox(c.id, { sandboxStatus: 'error', sandboxError: e instanceof Error ? e.message : 'Preview failed to start.' })
      }).finally(() => {
        if (previewJobs.current.get(c.id) === controller) previewJobs.current.delete(c.id)
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, session, tournament.candidates])

  // Legacy single-fragment projects also restore their preview on reopen.
  useEffect(() => {
    if (!hydrated || !session || missingProjectRef.current || !standaloneRestoreRef.current) return
    const saved = standaloneRestoreRef.current
    standaloneRestoreRef.current = null
    const gen = sandboxGen.current
    const controller = new AbortController()
    previewJobs.current.set('standalone', controller)
    setIsPreviewLoading(true)
    createSandbox({
      fragment: saved.fragment,
      cachedResult: saved.result,
      runtimeError: saved.runtimeError,
      projectID: storeRef.current?.activeId,
      userID: session.user?.id,
      teamID: userTeam?.id,
      accessToken: session.access_token,
      model: currentModel,
      config: languageModel,
    }, controller.signal).then((next) => {
      if (gen !== sandboxGen.current || controller.signal.aborted) return
      setResult(next)
      setFragment('fragment' in next && next.fragment || saved.fragment)
      setCurrentTab('fragment')
      setErrorMessage('')
    }).catch((e) => {
      if (gen !== sandboxGen.current || controller.signal.aborted) return
      standaloneRestoreRef.current = saved
      setErrorMessage(e instanceof Error ? e.message : 'Could not restore this preview.')
    }).finally(() => {
      if (gen === sandboxGen.current && !controller.signal.aborted) setIsPreviewLoading(false)
      if (previewJobs.current.get('standalone') === controller) previewJobs.current.delete('standalone')
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, session, projectStore?.activeId, previewRestoreEpoch])

  useEffect(() => {
    if (!hydrated) return
    const refreshVisiblePreview = () => {
      if (document.visibilityState !== 'visible' || missingProjectRef.current) return
      const workspace = workspaceRef.current
      const current = workspace.result
      if (!current || !('url' in current) || isPreviewLoading) return
      const id = workspace.selectedCandidate
      if (id) {
        const candidate = workspace.tournament.candidates?.[id]
        if (candidate?.sandboxStatus === 'ready') tournament.noteSandbox(id, { sandboxStatus: undefined })
      } else if (workspace.fragment && !previewJobs.current.size) {
        standaloneRestoreRef.current = { fragment: workspace.fragment, result: current }
        setPreviewRestoreEpoch((value) => value + 1)
      }
    }
    const timer = setInterval(refreshVisiblePreview, 4 * 60 * 1000)
    document.addEventListener('visibilitychange', refreshVisiblePreview)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', refreshVisiblePreview)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, isPreviewLoading])

  useEffect(() => () => cancelPreviews(), [])

  useEffect(() => {
    if (!selectedCandidate || inspectOpenRef.current) return
    if (skipCandidatePromoteRef.current) {
      skipCandidatePromoteRef.current = false
      return
    }
    const c = tournament.candidates[selectedCandidate]
    if (!c?.fragment || c.status === 'generating') return
    if (c.sandboxStatus === 'ready' && c.result && 'expiresAt' in c.result && c.result.expiresAt && c.result.expiresAt <= Date.now()) {
      tournament.noteSandbox(c.id, { sandboxStatus: undefined })
    }
    const next = c.fragment
    const changed = promotedIdRef.current !== selectedCandidate || !sameFragmentSource(fragmentRef.current, next)
    promotedIdRef.current = selectedCandidate
    setFragment(next)
    setResult(c.result)
    setIsPreviewLoading(c.sandboxStatus === 'starting')
    if (c.result) setCurrentTab('fragment')
    if (!changed) return
    const content: Message['content'] = [
      { type: 'text', text: next.commentary || '' },
      { type: 'code', text: fragmentCodeText(next.code) },
    ]
    setMessages((prev) => {
      const last = prev[prev.length - 1]
      return last?.role === 'assistant'
        ? [...prev.slice(0, -1), { ...last, content, object: next, result: c.result }]
        : [...prev, { role: 'assistant', content, object: next, result: c.result }]
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCandidate, tournament.candidates[selectedCandidate ?? 'minimal']])

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
    if (tournament.phase === 'generating') {
      tournament.stop()
    }

    setErrorMessage('')
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
      cancelPreviews()
      promotedIdRef.current = undefined
      // Tournament: 3 specimens generated in parallel, judged by editor.
      setHasTournament(true)
      setSelectedCandidate(undefined)
      setFragment(undefined)
      setResult(undefined)
      startTournament(updatedMessages)

      posthog.capture('tournament_submit', {
        template: selectedTemplate,
        model: languageModel.model,
      })
    } else {
      if (selectedCandidate) {
        previewJobs.current.get(selectedCandidate)?.abort()
        previewJobs.current.delete(selectedCandidate)
        tournament.noteSandbox(selectedCandidate, { sandboxStatus: 'starting', sandboxError: undefined, result: undefined })
      }
      chatBaseFragmentRef.current = fragment
      chatRequestGen.current = sandboxGen.current
      chatRequestSequence.current += 1
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
    setErrorMessage('')
    if (standaloneRestoreRef.current) {
      setPreviewRestoreEpoch((value) => value + 1)
      return
    }
    if (hasTournament && !fragment) {
      if (tournament.error && tournament.canResume && tournament.runID && storeRef.current) {
        tournament.resume({ projectID: storeRef.current.activeId, runID: tournament.runID })
        return
      }
      cancelPreviews()
      promotedIdRef.current = undefined
      startTournament(messages, true)
      return
    }
    chatBaseFragmentRef.current = fragment
    chatRequestGen.current = sandboxGen.current
    chatRequestSequence.current += 1
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

  function startTournament(runMessages: Message[], preserveCompleted = false) {
    const projectID = storeRef.current?.activeId
    if (!projectID) return
    const runID = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `r_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`
    const seedCandidates: Partial<Record<VariantId, FragmentSchema>> = {}
    if (preserveCompleted) for (const c of Object.values(tournament.candidates)) {
      const saved = schema.safeParse(c.fragment)
      if (c.status === 'done' && saved.success) seedCandidates[c.id] = saved.data
    }
    workspaceRef.current = {
      ...workspaceRef.current,
      messages: runMessages,
      hasTournament: true,
      ...(preserveCompleted ? {} : { fragment: undefined, result: undefined, selectedCandidate: undefined }),
      tournament: { candidates: preserveCompleted ? tournament.candidates : undefined, phase: 'generating', runID },
    }
    saverRef.current.cancel()
    persistCurrent(true)
    tournament.submit({ projectID, runID, seedCandidates, userID: session?.user?.id, teamID: userTeam?.id, messages: toAISDKMessages(runMessages), template: currentTemplate, model: currentModel, config: languageModel }, preserveCompleted)
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
    cancelPreviews()
    promotedIdRef.current = undefined
    setErrorMessage('')
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
    setInspectOpen(false)
    setInspectSelection(null)
    setInspectError('')
    setInspectApplying(false)
    setVersionCursor(0)
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

  const activeVersions = projectStore ? getActive(projectStore).versions : []

  function restoreVersionAt(index: number) {
    const v = activeVersions[index]
    if (!v?.fragment) return
    setVersionCursor(index)
    restorePreview(v)
    setInspectSelection(null)
    setCurrentTab('fragment')
  }

  function restorePreview(preview: { fragment?: DeepPartial<FragmentSchema>; result?: ExecutionResult }) {
    if (!preview.fragment) return
    stop()
    chatRequestGen.current = -1
    chatBaseFragmentRef.current = undefined
    chatRequestSequence.current += 1
    inspectGen.current += 1
    setInspectApplying(false)
    setCurrentPreview({ fragment: preview.fragment, result: preview.result })
    setIsPreviewLoading(true)
    setErrorMessage('')
    if (selectedCandidate) {
      previewJobs.current.get(selectedCandidate)?.abort()
      previewJobs.current.delete(selectedCandidate)
      tournament.noteSandbox(selectedCandidate, { fragment: preview.fragment, result: preview.result, sandboxStatus: undefined, sandboxError: undefined, runtimeError: undefined })
    } else {
      previewJobs.current.get('standalone')?.abort()
      previewJobs.current.delete('standalone')
      standaloneRestoreRef.current = { fragment: preview.fragment, result: preview.result }
      setPreviewRestoreEpoch((value) => value + 1)
    }
  }

  async function handleInspectApply(instruction: string, targetFile?: string) {
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
    const gen = ++inspectGen.current
    try {
      const res = await fetch('/api/inspect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fragment: complete,
          selection: inspectSelection,
          instruction,
          targetFile,
          model: currentModel,
          config: languageModel,
        }),
      })
      if (gen !== inspectGen.current) return
      if (!res.ok) {
        setInspectError((await res.text()) || 'Inspect apply failed.')
        return
      }
      const updated = (await res.json()) as DeepPartial<FragmentSchema>
      if (gen !== inspectGen.current) return
      const nextComplete = toCompleteFragment(updated)
      if (!nextComplete) {
        setInspectError('Patch failed validation.')
        return
      }
      const sandboxResult = await createSandbox({
        fragment: nextComplete,
        projectID: storeRef.current?.activeId,
        candidateID: selectedCandidate,
        userID: session.user?.id,
        teamID: userTeam?.id,
        accessToken: session.access_token,
        model: currentModel,
        config: languageModel,
      })
      if (!('url' in sandboxResult)) throw new Error('Patch preview failed to start.')
      if (gen !== inspectGen.current) return
      if (selectedCandidate) tournament.noteSandbox(selectedCandidate, {
        fragment: sandboxResult.fragment || nextComplete,
        result: sandboxResult,
        runtimeError: undefined,
        sandboxStatus: 'ready',
        sandboxError: undefined,
      })
      skipCandidatePromoteRef.current = true
      setFragment(sandboxResult.fragment || nextComplete)
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
          fragment: sandboxResult.fragment || nextComplete,
          result: sandboxResult,
        }
        const next = pushVersion(store, store.activeId, version, {
          ...workspaceRef.current,
          fragment: sandboxResult.fragment || nextComplete,
          result: sandboxResult,
          currentTab: 'fragment',
        })
        storeRef.current = next
        setProjectStore(next)
        setVersionCursor(0)
      }
    } catch (e) {
      if (gen === inspectGen.current) setInspectError(e instanceof Error ? e.message : 'Inspect apply failed.')
    } finally {
      if (gen === inspectGen.current) setInspectApplying(false)
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
  const dockCommand = isBuilding || hasTournament || Boolean(fragment)

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
      isErrored={!!errorMessage || !!tournament.error}
      errorMessage={errorMessage || tournament.error || ''}
      isLoading={isLoading || tournament.phase === 'generating' || tournament.phase === 'judging'}
      isRateLimited={isRateLimited}
      stop={() => {
        stop()
        tournament.stop()
        cancelPreviews()
        for (const c of Object.values(tournament.candidates)) {
          if (c.sandboxStatus === 'starting') tournament.noteSandbox(c.id, { sandboxStatus: 'error', sandboxError: 'Preview canceled. Retry to continue.' })
        }
        setIsPreviewLoading(false)
      }}
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

  if (missingProjectId) {
    return (
      <main className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 bg-background px-6 text-center">
        <Layers3 className="h-8 w-8 text-muted-foreground" />
        <h1 className="font-display text-3xl">Project not found in this browser</h1>
        <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">This workspace may have been deleted, or its saved browser data is unavailable.</p>
        <div className="mt-2 flex gap-2">
          <Button variant="outline" onClick={() => { const store = loadStore(); storeRef.current = store; setProjectStore(store); applyProject(getActive(store)) }}>Open saved projects</Button>
          <Button onClick={handleNewProject}>New project</Button>
        </div>
      </main>
    )
  }

  return (
    <main className="flex min-h-screen flex-col bg-background lg:h-[100dvh] lg:overflow-hidden">
      <AuthDialog
        open={isAuthDialogOpen}
        setOpen={setAuthDialog}
        view={authView}
      />
      <Dialog open={!!pendingDeleteId} onOpenChange={(o) => !o && setPendingDeleteId(null)}>
        <DialogContent className="rounded-xl sm:max-w-sm">
          <DialogTitle className="text-xl font-semibold">
            Delete “{pendingDeleteName}”?
          </DialogTitle>
          <DialogDescription>
            This removes the project from this browser. It cannot be undone.
          </DialogDescription>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              type="button"
              variant="ghost"
              className="rounded-lg"
              onClick={() => setPendingDeleteId(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="rounded-lg"
              onClick={confirmDeleteProject}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Editorial app bar — brand + run meta + actions, all in one strip */}
      <div className="shrink-0 bg-background">
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
          hasFragment={!!fragment}
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
            ? 'lg:grid-cols-[22rem_minmax(0,1fr)] xl:grid-cols-[23rem_minmax(0,1fr)]'
            : 'lg:grid-cols-[16rem_minmax(0,1fr)]'
        }`}
      >
        <aside className={`min-h-0 min-w-0 flex-col overflow-hidden border-border/70 bg-card/50 lg:flex lg:border-r ${dockCommand ? 'flex border-b lg:border-b-0' : 'hidden'}`}>
          <div className="shrink-0 border-b border-border/60 px-5 pb-4 pt-5">
            <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Project</p>
            <p className="line-clamp-2 text-[14px] font-medium leading-snug text-foreground">
              {projectStore ? getActive(projectStore).name : firstPrompt?.slice(0, 48) || 'Untitled'}
            </p>
            <p className="mt-2 line-clamp-2 text-[12px] leading-relaxed text-muted-foreground">
              {projectStore
                ? getActive(projectStore).purpose || 'Start with a brief to shape your project.'
                : firstPrompt || 'Start with a brief to shape your project.'}
            </p>
            <div className="mt-4 flex items-center justify-between gap-3 border-t border-border/50 pt-3 text-[11px] text-muted-foreground">
              <span className="flex min-w-0 items-center gap-2">
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${isBuilding ? 'bg-brand animate-pulse' : selectedSpec ? 'bg-brand-accent' : 'bg-muted-foreground/40'}`} />
                <span className="truncate">{selectedSpec ? `${selectedSpec.label} selected` : isBuilding ? 'Exploring three directions' : 'Ready to create'}</span>
              </span>
              <details className="relative shrink-0">
                <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded px-1 py-0.5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="Saved versions">
                  <History className="h-3 w-3" />{activeVersions.length} versions
                </summary>
                <ul className="absolute right-0 top-7 z-30 max-h-60 w-64 overflow-y-auto rounded-lg border border-border bg-popover p-1.5 shadow-xl">
                  {activeVersions.length ? activeVersions.slice(0, 8).map((v, i) => (
                    <li key={v.id}>
                      <button type="button" onClick={(e) => { restoreVersionAt(i); e.currentTarget.closest('details')?.removeAttribute('open') }} className={`block w-full truncate rounded-md px-3 py-2 text-left text-xs hover:bg-accent ${i === versionCursor ? 'text-foreground' : 'text-muted-foreground'}`}>{v.label || 'Version'}</button>
                    </li>
                  )) : <li className="px-3 py-2 text-xs">No saved versions yet</li>}
                </ul>
              </details>
            </div>
          </div>
          <div className="workspace-scrollbar min-h-0 max-h-[40vh] flex-1 overflow-y-auto lg:max-h-none">
          <RailSection label="Design directions">
            {hasTournament ? (
              <SpecimenStrip
                layout="rail"
                candidates={tournament.candidates}
                selectedId={selectedCandidate}
                onSelect={setSelectedCandidate}
                verdictReasoning={tournament.verdict?.reasoning}
                phase={tournament.phase}
              />
            ) : (
              <p className="text-[12px] text-muted-foreground">No candidates yet.</p>
            )}
          </RailSection>
          <RailSection label="Activity">
            {messages.length > 0 ? (
              <Chat
                messages={messages}
                isLoading={isLoading}
                setCurrentPreview={restorePreview}
              />
            ) : (
              <p className="text-[12px] text-muted-foreground">No activity.</p>
            )}
          </RailSection>
          </div>
          {dockCommand && (
            <div className="shrink-0 border-t border-border/60 bg-background/60 px-4 pb-3 pt-4">
              {chatInputSlot}
            </div>
          )}
        </aside>

        <section className="relative flex min-h-[420px] min-w-0 flex-col overflow-hidden bg-background lg:min-h-0">
          {!fragment && dockCommand && (
            <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border/60 px-6">
              <span className="flex items-center gap-2 text-xs text-muted-foreground"><Layers3 className="h-3.5 w-3.5" />Workspace</span>
              <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">{isBuilding && <Loader2 className="h-3 w-3 animate-spin text-brand" />}{isBuilding ? 'Building your project' : 'Choose a direction'}</span>
            </div>
          )}
          {selectedSpec?.sandboxError && (
            <div role="alert" className="flex shrink-0 items-center justify-between gap-4 border-b border-destructive/30 bg-destructive/10 px-5 py-3 text-sm">
              <p className="min-w-0 whitespace-pre-wrap break-words">{selectedSpec.sandboxError.slice(0, 600)}</p>
              <Button variant="outline" size="sm" className="shrink-0" onClick={() => tournament.noteSandbox(selectedSpec.id, { sandboxStatus: undefined, sandboxError: undefined })}>{selectedSpec.runtimeError ? 'Repair preview' : 'Retry preview'}</Button>
            </div>
          )}
          {!selectedSpec && errorMessage && fragment && (
            <div role="alert" className="flex shrink-0 items-center justify-between gap-4 border-b border-destructive/30 bg-destructive/10 px-5 py-3 text-sm">
              <p className="min-w-0 whitespace-pre-wrap break-words">{errorMessage.slice(0, 600)}</p>
              <Button variant="outline" size="sm" className="shrink-0" onClick={retry}>Retry preview</Button>
            </div>
          )}
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
                onClose={() => setFragment(undefined)}
                onRuntimeError={(message) => {
                  if (selectedCandidate) tournament.noteSandbox(selectedCandidate, {
                    sandboxStatus: 'error', sandboxError: message, runtimeError: message,
                    ...(result && 'url' in result ? { result: { ...result, health: {
                      buildStatus: 'skipped', dependencyStatus: 'skipped', repairAttempts: 0, repaired: false,
                      ...result.health, state: 'FAILED', runtimeStatus: 'failed', verified: false,
                      log: [...(result.health?.log || []), message],
                    } } } : {}),
                  })
                  else {
                    standaloneRestoreRef.current = { fragment, result, runtimeError: message }
                    setErrorMessage(message)
                  }
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
              stage={isPreviewLoading ? 2 : tournament.phase === 'judging' ? 1 : 0}
              readyCount={Object.values(tournament.candidates).filter((c) => c.status === 'done' || c.status === 'judging').length}
            />
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center px-5 py-14 sm:px-10">
              <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground"><Layers3 className="h-7 w-7" strokeWidth={1.5} /></div>
              <p className="label-caps text-muted-foreground">A new canvas</p>
              <h2 className="mt-3 text-center font-display text-4xl font-medium tracking-tight sm:text-5xl">What will you build today?</h2>
              <p className="mt-3 max-w-md text-center text-sm leading-relaxed text-muted-foreground">Describe your idea. Compare three approaches, choose your favorite, and bring it to life.</p>
              {!dockCommand && (
                <div className="mt-8 w-full max-w-2xl">
                  {chatInputSlot}
                  <div className="mt-5 grid gap-2 sm:grid-cols-3">
                    {[
                      { label: 'A personal portfolio', prompt: 'Build a clean personal portfolio with a project gallery, an about section, and a contact form.' },
                      { label: 'A SaaS landing page', prompt: 'Build a polished SaaS landing page for a team productivity app with features, pricing, and a waitlist form.' },
                      { label: 'A data dashboard', prompt: 'Build a dashboard that lets me upload a CSV and explore its data with charts and summary statistics.' },
                    ].map((idea) => (
                      <button key={idea.label} type="button" onClick={() => setChatInput(idea.prompt)} className="group flex items-center justify-between gap-2 rounded-lg border border-border bg-card px-4 py-3.5 text-left text-xs font-medium text-muted-foreground transition-colors hover:border-brand/30 hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        {idea.label}<ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60 group-hover:text-brand" />
                      </button>
                    ))}
                  </div>
                  <p className="mt-5 text-center text-xs text-muted-foreground">Your project has its own URL and saves in this browser.</p>
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </main>
  )
}

function ProcessingPane({ seconds, stage, readyCount }: { seconds: number; stage: number; readyCount: number }) {
  const mm = String(Math.floor(seconds / 60)).padStart(2, '0')
  const ss = String(seconds % 60).padStart(2, '0')
  const titles = ['An idea, taking shape.', 'Finding the strongest direction.', 'Bringing your design to life.']
  const descriptions = ['Three distinct approaches to your brief are being created.', 'Comparing clarity, fit, and polish across your designs.', 'Starting the sandbox and checking the generated source.']
  return (
    <div className="flex min-h-[420px] flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-[440px]">
        <div className="mb-7 flex items-center justify-between">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-border bg-card/60 text-foreground/70"><Layers3 className="h-5 w-5" strokeWidth={1.4} /></div>
          <span aria-label="Elapsed time" className="flex items-center gap-2 font-mono text-xs tabular-nums text-muted-foreground"><span className="h-1.5 w-1.5 rounded-full bg-brand animate-pulse" />{mm}:{ss}</span>
        </div>
        <h2 role="status" aria-atomic="true" className="font-display text-[32px] font-medium leading-tight tracking-tight sm:text-[36px]">{titles[stage]}</h2>
        <p className="mt-3 max-w-sm text-[13px] leading-relaxed text-muted-foreground">{descriptions[stage]}</p>
        <div className="mt-8 grid grid-cols-3 border-t border-border/70 pt-5">
          {['Create', 'Compare', 'Preview'].map((label, index) => (
            <div key={label} className={`flex items-center gap-2 text-xs ${index === stage ? 'text-foreground' : index < stage ? 'text-muted-foreground' : 'text-muted-foreground/50'}`}>
              <span className={`flex h-5 w-5 items-center justify-center rounded-full border ${index < stage ? 'border-brand-accent/30 bg-brand-accent/10 text-brand-accent' : index === stage ? 'border-brand/40 bg-brand/10 text-brand' : 'border-border'}`}>
                {index < stage ? <Check className="h-2.5 w-2.5" /> : index === stage ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <span className="font-mono text-[9px]">{index + 1}</span>}
              </span>{label}
            </div>
          ))}
        </div>
        {stage === 0 && <p className="mt-5 text-[11px] text-muted-foreground/70">{readyCount} of 3 designs ready · You can explore each direction as it takes shape.</p>}
      </div>
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
    <div className="border-b border-border/50 px-5 py-5">
      <p className="mb-3 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </p>
      {children}
    </div>
  )
}

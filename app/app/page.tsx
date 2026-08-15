'use client'

import { AuthDialog, ViewType } from '@/components/auth-dialog'
import { Chat } from '@/components/chat'
import { ChatInput } from '@/components/chat-input'
import { ChatPicker } from '@/components/chat-picker'
import { ChatSettings } from '@/components/chat-settings'
import { NavBar } from '@/components/navbar'
import { Preview } from '@/components/preview'
import { SpecimenStrip } from '@/components/specimen-strip'
import { useAuth } from '@/lib/auth'
import { Message, toAISDKMessages, toMessageImage } from '@/lib/messages'
import { LLMModel, LLMModelConfig } from '@/lib/model-catalog'
import modelsList from '@/lib/models.json'
import {
  fragmentCodeEqual,
  getPrimaryFileContent,
  hasFragmentCode,
} from '@/lib/fragment'
import { resolveReusablePreviewExecution } from '@/lib/preview-execution'
import { FragmentSchema, fragmentSchema as schema } from '@/lib/schema'
import templates from '@/lib/templates'
import { VariantId } from '@/lib/tournament'
import { useTournament } from '@/lib/tournament-client'
import { ExecutionResult } from '@/lib/types'
import { DeepPartial } from 'ai'
import { experimental_useObject as useObject } from 'ai/react'
import { usePostHog } from 'posthog-js/react'
import { SetStateAction, useEffect, useState } from 'react'
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
        if (snap?.tournament) {
          tournament.hydrate({
            candidates: snap.tournament.candidates,
            verdict: snap.tournament.verdict,
            phase: snap.tournament.phase ?? 'done',
          })
        }
      }
    } catch {
      // ignore corrupted snapshots
    } finally {
      setHydrated(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
        tournament: {
          candidates: tournament.candidates,
          verdict: tournament.verdict,
          phase: tournament.phase,
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
    tournament.candidates,
    tournament.verdict,
    tournament.phase,
  ])
  const currentTemplate =
    selectedTemplate === 'auto'
      ? templates
      : { [selectedTemplate]: templates[selectedTemplate] }
  const lastMessage = messages[messages.length - 1]

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

  // Auto-select the winning candidate when verdict arrives.
  useEffect(() => {
    const winner = Object.values(tournament.candidates).find((c) => c.isWinner)
    if (winner && !selectedCandidate) {
      setSelectedCandidate(winner.id)
    }
  }, [tournament.candidates, selectedCandidate])

  // Whenever the user picks a candidate (or one is auto-selected), promote
  // its fragment to the main view. Prefer the sandbox already verified during
  // the tournament; only create a new sandbox when none is reusable.
  useEffect(() => {
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

import { InspectToolbar } from './inspect-panel'
import { CopyButton } from './ui/copy-button'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  INSPECT_SOURCE,
  InspectDraft,
  InspectSelection,
  isInspectMessage,
  livePayload,
  stableInspectSrc,
} from '@/lib/inspect'
import { ExecutionResultWeb } from '@/lib/types'
import { ExternalLink, LoaderCircle, RotateCw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

export function FragmentWeb({
  result,
  inspectEnabled = false,
  selection = null,
  onSelection,
  draft = null,
  compare = false,
  onDraft,
  onText,
  applying = false,
  guides = false,
  teamID,
  accessToken,
  onRuntimeError,
}: {
  result: ExecutionResultWeb
  inspectEnabled?: boolean
  selection?: InspectSelection | null
  onSelection?: (selection: InspectSelection | null) => void
  draft?: InspectDraft | null
  compare?: boolean
  onDraft?: (draft: InspectDraft) => void
  onText?: (text: string) => void
  applying?: boolean
  guides?: boolean
  teamID?: string
  accessToken?: string
  onRuntimeError?: (message: string) => void
}) {
  const [iframeKey, setIframeKey] = useState(0)
  const [previewState, setPreviewState] = useState<'loading' | 'rendered' | 'unconfirmed' | 'error'>('loading')
  const [previewError, setPreviewError] = useState('')
  const documentLoadedRef = useRef(false)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [iframeBox, setIframeBox] = useState<DOMRect | null>(null)
  const selectionRef = useRef(selection)
  selectionRef.current = selection
  const srcRef = useRef(result.url)
  if (!inspectEnabled) srcRef.current = result.url
  const iframeSrc = stableInspectSrc(srcRef.current, result.url, inspectEnabled)

  function refreshIframe() {
    documentLoadedRef.current = false
    setPreviewState('loading')
    setPreviewError('')
    setIframeKey((prevKey) => prevKey + 1)
  }

  function postToPreview(data: Record<string, unknown>) {
    iframeRef.current?.contentWindow?.postMessage(
      { source: INSPECT_SOURCE, ...data },
      '*',
    )
  }

  useEffect(() => {
    documentLoadedRef.current = false
    setPreviewState('loading')
    setPreviewError('')
    const timer = window.setTimeout(() => setPreviewState((state) => state === 'loading' ? 'unconfirmed' : state), 45_000)
    return () => window.clearTimeout(timer)
  }, [iframeSrc, iframeKey])

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.source !== iframeRef.current?.contentWindow) return
      try {
        if (event.origin !== new URL(iframeSrc).origin) return
      } catch {
        return
      }
      const data = event.data
      if (data?.source === INSPECT_SOURCE && data.type === 'runtime-error') {
        if (typeof data.payload?.message === 'string' && data.payload.message.trim()) {
          setPreviewError(data.payload.message.slice(0, 2000))
          setPreviewState('error')
          onRuntimeError?.(data.payload.message.slice(0, 2000))
        }
        return
      }
      if (data?.source === INSPECT_SOURCE && data.type === 'rendered') {
        if (documentLoadedRef.current && data.payload?.hasContent === true) setPreviewState((state) => state === 'error' ? state : 'rendered')
        return
      }
      if (!isInspectMessage(event.data)) return
      if (event.data.type === 'ready' && inspectEnabled) {
        postToPreview({ type: 'enable' })
        postToPreview({ type: 'guides', on: guides })
      }
      if (event.data.type === 'select') {
        onSelection?.(event.data.payload)
      }
      if (event.data.type === 'text' && typeof event.data.payload === 'string') {
        onText?.(event.data.payload)
      }
      if (event.data.type === 'rect' && selectionRef.current) {
        onSelection?.({ ...selectionRef.current, rect: event.data.payload })
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [inspectEnabled, guides, onSelection, onText, iframeSrc, onRuntimeError])

  useEffect(() => {
    postToPreview({ type: inspectEnabled ? 'enable' : 'disable' })
  }, [inspectEnabled, iframeKey])

  useEffect(() => {
    postToPreview({ type: 'guides', on: guides })
  }, [guides, iframeKey])

  useEffect(() => {
    if (!inspectEnabled || !draft) return
    postToPreview({
      ...livePayload(draft, compare),
      selector: selectionRef.current?.selector || '',
    })
  }, [inspectEnabled, draft, compare, iframeKey])

  useEffect(() => {
    if (!inspectEnabled || !result.sbxId) return
    fetch('/api/inspect/inject', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sbxId: result.sbxId,
        teamID,
        accessToken,
      }),
    }).catch(() => {})
    // Inject the bridge without remounting. A reload here blanks the preview and drops applied edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inspectEnabled, result.sbxId])

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const measure = () => setIframeBox(el.getBoundingClientRect())
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [selection, iframeKey])

  if (!result) return null

  return (
    <div className="flex flex-col w-full h-full">
      {previewState !== 'rendered' && (
        <div role={previewState === 'loading' ? 'status' : 'alert'} className={'flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2 text-xs ' + (previewState === 'error' ? 'border-destructive/20 bg-destructive/5 text-destructive' : 'border-border bg-muted/30 text-muted-foreground')}>
          {previewState === 'loading' ? <LoaderCircle className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden="true" /> : null}
          <p className="min-w-0 flex-1 whitespace-pre-wrap break-words">{previewState === 'loading' ? 'Opening preview…' : previewState === 'error' ? previewError : 'The preview has not confirmed visible content yet. Reload it or open it in a new tab.'}</p>
          {previewState !== 'loading' && <><Button variant="outline" size="sm" className="h-7 text-xs" onClick={refreshIframe}>Reload</Button><a href={iframeSrc} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-foreground hover:bg-muted">Open preview<ExternalLink className="h-3 w-3" aria-hidden="true" /></a></>}
        </div>
      )}
      <div ref={wrapRef} className="relative flex-1 min-h-0">
        <iframe
          ref={iframeRef}
          key={iframeKey}
          className="h-full w-full"
          title="Generated app preview"
          sandbox="allow-forms allow-scripts allow-same-origin"
          loading="eager"
          src={iframeSrc}
          onLoad={() => {
            documentLoadedRef.current = true
            postToPreview({ type: 'preview-status' })
            if (inspectEnabled) postToPreview({ type: 'enable' })
          }}
          onError={() => { setPreviewState('error'); setPreviewError('The preview could not be loaded in this browser. Reload it or open it in a new tab.') }}
        />
        {inspectEnabled && onDraft ? (
          <InspectToolbar
            selection={selection}
            iframeBox={iframeBox}
            applying={applying}
            draft={draft}
            onDraft={onDraft}
          />
        ) : null}
      </div>
      {result.health?.state === 'FAILED' ? (
        <p role="alert" className="m-3 rounded-lg bg-destructive/5 px-3 py-3 text-xs leading-relaxed text-destructive border border-destructive/20">
          {result.health.log.slice(-3).join(' · ')}
        </p>
      ) : null}
      <div className="p-3 border-t border-border bg-card">
        <div className="flex items-center gap-1 bg-muted/60 rounded-lg border border-border">
          <TooltipProvider>
            <Tooltip delayDuration={0}>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground shrink-0 rounded-lg"
                  aria-label="Refresh preview"
                  onClick={refreshIframe}
                >
                  <RotateCw className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Refresh</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <span className="text-muted-foreground font-mono text-[11px] min-w-0 flex-1 text-ellipsis overflow-hidden whitespace-nowrap">
            {result.url}
          </span>
          <TooltipProvider>
            <Tooltip delayDuration={0}>
              <TooltipTrigger asChild>
                <CopyButton
                  variant="ghost"
                  content={result.url}
                  className="text-muted-foreground"
                />
              </TooltipTrigger>
              <TooltipContent>Copy URL</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>
    </div>
  )
}

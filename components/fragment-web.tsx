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
} from '@/lib/inspect'
import { ExecutionResultWeb } from '@/lib/types'
import { RotateCw } from 'lucide-react'
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
}) {
  const [iframeKey, setIframeKey] = useState(0)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [iframeBox, setIframeBox] = useState<DOMRect | null>(null)
  const selectionRef = useRef(selection)
  selectionRef.current = selection

  function refreshIframe() {
    setIframeKey((prevKey) => prevKey + 1)
  }

  function postToPreview(data: Record<string, unknown>) {
    iframeRef.current?.contentWindow?.postMessage(
      { source: INSPECT_SOURCE, ...data },
      '*',
    )
  }

  useEffect(() => {
    function onMessage(event: MessageEvent) {
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
  }, [inspectEnabled, guides, onSelection, onText])

  useEffect(() => {
    postToPreview({ type: inspectEnabled ? 'enable' : 'disable' })
  }, [inspectEnabled, iframeKey])

  useEffect(() => {
    postToPreview({ type: 'guides', on: guides })
  }, [guides, iframeKey])

  useEffect(() => {
    if (!inspectEnabled) return
    postToPreview(livePayload(draft, compare))
  }, [inspectEnabled, draft, compare, iframeKey])

  useEffect(() => {
    if (!inspectEnabled || !result.sbxId) return
    let cancelled = false
    fetch('/api/inspect/inject', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sbxId: result.sbxId,
        teamID,
        accessToken,
      }),
    })
      .catch(() => {})
      .then(() => new Promise((r) => setTimeout(r, 800)))
      .then(() => {
        if (!cancelled) refreshIframe()
      })
    return () => {
      cancelled = true
    }
    // inject once per sandbox when inspect opens
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
      <div ref={wrapRef} className="relative flex-1 min-h-0">
        <iframe
          ref={iframeRef}
          key={iframeKey}
          className="h-full w-full"
          sandbox="allow-forms allow-scripts allow-same-origin"
          loading="lazy"
          src={result.url}
          onLoad={() => {
            if (inspectEnabled) postToPreview({ type: 'enable' })
          }}
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
      <div className="p-2 border-t">
        <div className="flex items-center bg-muted dark:bg-white/10 rounded-2xl">
          <TooltipProvider>
            <Tooltip delayDuration={0}>
              <TooltipTrigger asChild>
                <Button
                  variant="link"
                  className="text-muted-foreground"
                  onClick={refreshIframe}
                >
                  <RotateCw className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Refresh</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <span className="text-muted-foreground text-xs flex-1 text-ellipsis overflow-hidden whitespace-nowrap">
            {result.url}
          </span>
          <TooltipProvider>
            <Tooltip delayDuration={0}>
              <TooltipTrigger asChild>
                <CopyButton
                  variant="link"
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

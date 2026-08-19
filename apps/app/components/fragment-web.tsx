'use client'

import { DesignPalette } from '@/components/arena/design-palette'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import type { DesignInspectController } from '@/lib/design-mode/controller'
import {
  parentMessage,
  parseInspectChildMessage,
} from '@/lib/design-mode/protocol'
import { ExecutionResultWeb } from '@/lib/types'
import { MousePointer2, RotateCw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

export function FragmentWeb({
  result,
  viewport = 'desktop',
  inspect,
}: {
  result: ExecutionResultWeb
  viewport?: 'desktop' | 'tablet' | 'mobile'
  inspect?: DesignInspectController
}) {
  const [iframeKey, setIframeKey] = useState(0)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [probeReady, setProbeReady] = useState(false)

  function refreshIframe() {
    setProbeReady(false)
    setIframeKey((prevKey) => prevKey + 1)
  }

  const frameKey = `${result.url}::${iframeKey}`

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (iframeRef.current && event.source !== iframeRef.current.contentWindow) {
        return
      }
      const parsed = parseInspectChildMessage(event.data)
      if (!parsed || !inspect) return
      if (parsed.type === 'ready') {
        setProbeReady(true)
        return
      }
      if (parsed.type === 'select') inspect.select(parsed.node)
      if (parsed.type === 'clear') inspect.select(null)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [inspect])

  useEffect(() => {
    const frame = iframeRef.current?.contentWindow
    if (!frame || !inspect) return
    frame.postMessage(
      parentMessage({ type: inspect.enabled ? 'enable' : 'disable' }),
      '*',
    )
  }, [inspect, inspect?.enabled, probeReady, frameKey])

  useEffect(() => {
    const frame = iframeRef.current?.contentWindow
    if (!frame || !inspect?.enabled || !inspect.node) return
    frame.postMessage(parentMessage({ type: 'resetPending' }), '*')
    if (inspect.patches.length > 0) {
      frame.postMessage(
        parentMessage({ type: 'applyPending', patches: inspect.patches }),
        '*',
      )
    }
  }, [inspect, inspect?.enabled, inspect?.node, inspect?.patches, probeReady])

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (!inspect) return
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'i') {
        event.preventDefault()
        inspect.setEnabled(!inspect.enabled)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [inspect])

  return (
    <div className="flex flex-col w-full h-full min-h-0">
      <div className="flex-1 min-h-0 flex">
        <div
          className="preview-stage flex-1 min-h-0 min-w-0"
          data-viewport={viewport}
        >
          <div className="preview-device">
            <iframe
              ref={iframeRef}
              key={frameKey}
              title="Candidate preview"
              className="absolute inset-0 h-full w-full border-0 bg-background"
              sandbox="allow-forms allow-scripts allow-same-origin"
              loading="lazy"
              src={result.url}
            />
          </div>
        </div>
        {inspect?.enabled ? (
          <aside className="hidden md:block w-[min(20rem,40%)] shrink-0 border-l border-border overflow-y-auto">
            <DesignPalette inspect={inspect} />
          </aside>
        ) : null}
      </div>
      <div className="shrink-0 flex items-center gap-1 px-2 h-10 border-t border-border/70">
        <TooltipProvider>
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 rounded-none text-muted-foreground"
                onClick={refreshIframe}
                aria-label="Refresh preview"
              >
                <RotateCw className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Refresh</TooltipContent>
          </Tooltip>
        </TooltipProvider>
        {inspect ? (
          <TooltipProvider>
            <Tooltip delayDuration={0}>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className={`h-8 rounded-none px-2.5 font-mono text-[11px] tracking-[0.14em] uppercase ${
                    inspect.enabled
                      ? 'bg-foreground text-background'
                      : 'text-muted-foreground'
                  }`}
                  onClick={() => inspect.setEnabled(!inspect.enabled)}
                  aria-pressed={inspect.enabled}
                  aria-label="Inspect preview"
                >
                  <MousePointer2 className="h-4 w-4 mr-1.5" />
                  Inspect
                </Button>
              </TooltipTrigger>
              <TooltipContent>Inspect (⌘I)</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : null}
      </div>
    </div>
  )
}

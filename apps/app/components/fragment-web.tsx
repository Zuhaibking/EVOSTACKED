import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { ExecutionResultWeb } from '@/lib/types'
import { RotateCw } from 'lucide-react'
import { useState } from 'react'

export function FragmentWeb({
  result,
  viewport = 'desktop',
}: {
  result: ExecutionResultWeb
  viewport?: 'desktop' | 'tablet' | 'mobile'
}) {
  const [iframeKey, setIframeKey] = useState(0)
  if (!result) return null

  function refreshIframe() {
    setIframeKey((prevKey) => prevKey + 1)
  }

  const frameKey = `${result.url}::${iframeKey}`
  const frameWidth =
    viewport === 'mobile'
      ? 'max-w-[390px]'
      : viewport === 'tablet'
        ? 'max-w-[768px]'
        : 'max-w-none'

  return (
    <div className="flex flex-col w-full h-full min-h-0">
      <div className={`flex-1 min-h-0 mx-auto w-full ${frameWidth}`}>
        <iframe
          key={frameKey}
          title="Candidate preview"
          className="h-full w-full bg-background"
          sandbox="allow-forms allow-scripts allow-same-origin"
          loading="lazy"
          src={result.url}
        />
      </div>
      <div className="shrink-0 flex items-center gap-1 px-2 h-8 border-t border-border/70">
        <TooltipProvider>
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 rounded-none text-muted-foreground"
                onClick={refreshIframe}
                aria-label="Refresh preview"
              >
                <RotateCw className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Refresh</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </div>
  )
}

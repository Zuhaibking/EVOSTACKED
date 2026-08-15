'use client'

import { DeployDialog } from './deploy-dialog'
import { FragmentCode } from './fragment-code'
import { FragmentPreview } from './fragment-preview'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent } from '@/components/ui/tabs'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { getFragmentFiles } from '@/lib/fragment'
import { FragmentSchema } from '@/lib/schema'
import { getTemplateId } from '@/lib/templates'
import { ExecutionResult, ExecutionResultWeb } from '@/lib/types'
import type { DeepPartial } from '@evostack/shared'
import { LoaderCircle, X } from 'lucide-react'
import { Dispatch, SetStateAction } from 'react'

export function Preview({
  teamID,
  accessToken,
  selectedTab,
  onSelectedTabChange,
  isChatLoading,
  isPreviewLoading,
  fragment,
  result,
  onClose,
  unavailableReason,
}: {
  teamID: string | undefined
  accessToken: string | undefined
  selectedTab: 'code' | 'fragment'
  onSelectedTabChange: Dispatch<SetStateAction<'code' | 'fragment'>>
  isChatLoading: boolean
  isPreviewLoading: boolean
  fragment?: DeepPartial<FragmentSchema>
  result?: ExecutionResult
  onClose: () => void
  /** Shown when this candidate has source but no runnable Preview URL. */
  unavailableReason?: string | null
}) {
  if (!fragment) {
    return null
  }

  const isLinkAvailable =
    result?.template &&
    getTemplateId(result?.template!) !== 'code-interpreter-v1'

  const files = getFragmentFiles(fragment)
  const fileLabel =
    files.length > 1
      ? `${fragment.file_path || files[0]?.file_path || 'untitled'} · ${files.length} files`
      : fragment.file_path || files[0]?.file_path || 'untitled'

  return (
    <div className="absolute md:relative z-10 top-0 left-0 bg-background h-full w-full overflow-hidden flex flex-col md:border-l md:border-border">
      <Tabs
        value={selectedTab}
        onValueChange={(value) =>
          onSelectedTabChange(value as 'code' | 'fragment')
        }
        className="h-full flex flex-col items-stretch"
      >
        {/* Single editorial top bar: filename · segmented tabs · actions */}
        <header className="shrink-0 flex items-center gap-2 sm:gap-3 px-2.5 sm:px-3 md:px-4 h-10 sm:h-11 border-b border-border bg-background/95">
          {/* Filename / context */}
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <span className="font-mono text-[9px] tracking-[0.22em] uppercase text-muted-foreground shrink-0 hidden sm:inline">
              §
            </span>
            <span className="font-mono text-[10px] sm:text-[11px] text-foreground truncate" title={fileLabel}>
              {fileLabel}
            </span>
            {(isChatLoading || isPreviewLoading) && (
              <span className="flex items-center gap-1 font-mono text-[9px] tracking-[0.2em] uppercase text-brand shrink-0">
                <LoaderCircle strokeWidth={2.5} className="h-3 w-3 animate-spin" />
                <span className="hidden md:inline">
                  {isPreviewLoading ? 'sandboxing' : 'streaming'}
                </span>
              </span>
            )}
          </div>

          {/* Segmented tab control — brutalist hard-edge */}
          <div
            role="tablist"
            aria-label="Specimen view"
            className="inline-flex border border-border shrink-0"
          >
            <button
              role="tab"
              type="button"
              aria-selected={selectedTab === 'code'}
              onClick={() => onSelectedTabChange('code')}
              className={`
                h-6 sm:h-7 px-2 sm:px-3 font-mono text-[9px] sm:text-[10px] tracking-[0.22em] uppercase
                inline-flex items-center gap-1 transition-colors
                ${
                  selectedTab === 'code'
                    ? 'bg-foreground text-background'
                    : 'text-muted-foreground hover:text-foreground hover:bg-foreground/[0.04]'
                }
              `}
            >
              Source
            </button>
            <button
              role="tab"
              type="button"
              disabled={!result && !unavailableReason}
              aria-selected={selectedTab === 'fragment'}
              onClick={() => onSelectedTabChange('fragment')}
              className={`
                h-6 sm:h-7 px-2 sm:px-3 font-mono text-[9px] sm:text-[10px] tracking-[0.22em] uppercase
                inline-flex items-center gap-1 transition-colors
                border-l border-border
                ${
                  selectedTab === 'fragment'
                    ? 'bg-foreground text-background'
                    : !result && !unavailableReason
                      ? 'text-muted-foreground/40 cursor-not-allowed'
                      : 'text-muted-foreground hover:text-foreground hover:bg-foreground/[0.04]'
                }
              `}
            >
              Preview
            </button>
          </div>

          {/* Action cluster */}
          <div className="flex items-center gap-1 shrink-0">
            {result && isLinkAvailable && (
              <DeployDialog
                url={(result as ExecutionResultWeb).url!}
                sbxId={result.sbxId!}
                teamID={teamID}
                accessToken={accessToken}
              />
            )}
            <TooltipProvider>
              <Tooltip delayDuration={0}>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={onClose}
                    className="h-7 w-7 sm:h-8 sm:w-8 rounded-none text-muted-foreground hover:text-foreground"
                    aria-label="Close specimen"
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Close specimen</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </header>

        {/* Body */}
        <div className="flex-1 overflow-y-auto w-full">
          <TabsContent value="code" className="h-full m-0">
            {files.length > 0 && (
              <FragmentCode
                files={files.map((f) => ({
                  name: f.file_path,
                  content: f.file_content,
                }))}
              />
            )}
          </TabsContent>
          <TabsContent value="fragment" className="h-full m-0">
            {result ? (
              <FragmentPreview result={result as ExecutionResult} />
            ) : unavailableReason ? (
              <div className="h-full flex flex-col items-start justify-center gap-3 px-6 py-8">
                <p className="text-[14px] text-foreground" role="status">
                  Preview unavailable
                </p>
                <p className="text-[12px] text-muted-foreground max-w-md">
                  {unavailableReason}
                </p>
                <button
                  type="button"
                  onClick={() => onSelectedTabChange('code')}
                  className="font-mono text-[11px] tracking-[0.14em] uppercase px-3 py-1.5 border border-border hover:bg-foreground/[0.03]"
                >
                  View Source
                </button>
              </div>
            ) : null}
          </TabsContent>
        </div>
      </Tabs>
    </div>
  )
}

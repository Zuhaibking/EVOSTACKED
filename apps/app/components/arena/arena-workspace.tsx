'use client'

import { DatabaseWorkspace } from '@/components/arena/database-workspace'
import { DesignWorkspace } from '@/components/arena/design-workspace'
import { DeployDialog } from '@/components/deploy-dialog'
import { FragmentCode } from '@/components/fragment-code'
import { Preview } from '@/components/preview'
import { LoadingState } from '@/components/ui/loading-state'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import type { AskRequestKind } from '@/lib/ask-evostack'
import {
  PREVIEW_VIEWPORTS,
  WORKSPACE_MODES,
  type PreviewViewport,
  type WorkspaceMode,
} from '@/lib/arena-workspace'
import { getFragmentFiles, hasFragmentCode } from '@/lib/fragment'
import { downloadProjectZip, zipFilename } from '@/lib/project-zip'
import { FragmentSchema } from '@/lib/schema'
import { getTemplateId } from '@/lib/templates'
import { ExecutionResult, ExecutionResultWeb } from '@/lib/types'
import type { DeepPartial } from '@evostack/shared'
import { Download, ExternalLink } from 'lucide-react'
import type { ReactNode } from 'react'

export function ArenaWorkspace({
  mode,
  onModeChange,
  viewport,
  onViewportChange,
  fragment,
  result,
  unavailableReason,
  diagnostics,
  onViewSource,
  isChatLoading,
  isPreviewLoading,
  loadingLabel,
  hasLivePreview,
  teamID,
  accessToken,
  projectName,
  chipsEnabled,
  askKind,
  onAskKindChange,
  onSeedText,
  designPanel,
}: {
  mode: WorkspaceMode
  onModeChange: (mode: WorkspaceMode) => void
  viewport: PreviewViewport
  onViewportChange: (viewport: PreviewViewport) => void
  fragment?: DeepPartial<FragmentSchema>
  result?: ExecutionResult
  unavailableReason?: string | null
  diagnostics?: string[]
  onViewSource: () => void
  isChatLoading: boolean
  isPreviewLoading: boolean
  loadingLabel: string | null
  hasLivePreview: boolean
  teamID: string | undefined
  accessToken: string | undefined
  projectName?: string
  chipsEnabled: boolean
  askKind: AskRequestKind | null
  onAskKindChange: (kind: AskRequestKind | null) => void
  onSeedText: (text: string) => void
  designPanel?: ReactNode
}) {
  const isLinkAvailable =
    result?.template &&
    getTemplateId(result.template) !== 'code-interpreter-v1'
  const previewUrl =
    result && 'url' in result ? (result as ExecutionResultWeb).url : undefined
  const files = getFragmentFiles(fragment)
  const canZip = hasFragmentCode(fragment)
  const showOverlay = !!loadingLabel && !hasLivePreview

  function handleDownloadZip() {
    if (!canZip) return
    downloadProjectZip(
      zipFilename(projectName),
      files.map((f) => ({ path: f.file_path, content: f.file_content })),
    )
  }

  return (
    <div className="relative h-full w-full min-h-0 flex flex-col overflow-hidden">
      <header className="shrink-0 flex items-center gap-2 px-2.5 sm:px-3 h-10 border-b border-border arena-glass">
        <div
          role="tablist"
          aria-label="Workspace"
          className="inline-flex border border-border shrink-0"
        >
          {WORKSPACE_MODES.map((tab, idx) => (
            <button
              key={tab.id}
              role="tab"
              type="button"
              aria-selected={mode === tab.id}
              onClick={() => onModeChange(tab.id)}
              className={`h-6 px-2 font-mono text-[9px] tracking-[0.18em] uppercase ${
                idx > 0 ? 'border-l border-border' : ''
              } ${
                mode === tab.id
                  ? 'bg-foreground text-background'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="hidden sm:inline-flex border border-border shrink-0">
          {PREVIEW_VIEWPORTS.map((item, idx) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onViewportChange(item.id)}
              className={`h-6 px-2 font-mono text-[8px] tracking-[0.14em] uppercase ${
                idx > 0 ? 'border-l border-border' : ''
              } ${
                viewport === item.id
                  ? 'bg-foreground/[0.08] text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {(isChatLoading || isPreviewLoading) && (
          <span className="hidden lg:inline font-mono text-[9px] tracking-[0.2em] uppercase text-brand truncate">
            {isPreviewLoading ? 'sandboxing' : 'streaming'}
          </span>
        )}

        <div className="ml-auto flex items-center gap-1 shrink-0">
          {previewUrl && isLinkAvailable && (
            <TooltipProvider>
              <Tooltip delayDuration={0}>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 rounded-none text-muted-foreground"
                    aria-label="Open preview"
                    onClick={() =>
                      window.open(previewUrl, '_blank', 'noopener,noreferrer')
                    }
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Open preview</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          <TooltipProvider>
            <Tooltip delayDuration={0}>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!canZip}
                  className="h-7 rounded-none px-2 font-mono text-[9px] tracking-[0.14em] uppercase text-muted-foreground disabled:opacity-30"
                  onClick={handleDownloadZip}
                >
                  <Download className="h-3.5 w-3.5 mr-1.5 hidden sm:inline" />
                  <span className="hidden sm:inline">Download ZIP</span>
                  <span className="sm:hidden">ZIP</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>Download ZIP</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          {result && isLinkAvailable && (
            <DeployDialog
              url={(result as ExecutionResultWeb).url!}
              sbxId={result.sbxId!}
              teamID={teamID}
              accessToken={accessToken}
            />
          )}
        </div>
      </header>

      <div className="relative flex-1 min-h-0 overflow-hidden">
        {mode === 'preview' && (
          fragment ? (
            <Preview
              fragment={fragment}
              result={result}
              viewport={viewport}
              unavailableReason={unavailableReason}
              diagnostics={diagnostics}
              onViewSource={onViewSource}
            />
          ) : (
            <div className="arena-empty-hero h-full flex flex-col items-center justify-center px-6 text-center">
              <p className="font-mono text-[10px] tracking-[0.28em] uppercase text-muted-foreground">
                Live preview
              </p>
              <p className="mt-2 font-display text-[22px] text-foreground">
                Describe what you want to build
              </p>
              <p className="mt-1 text-[13px] text-muted-foreground max-w-md">
                Product, Premium, and Innovate will appear in the sidebar after
                the first generation.
              </p>
            </div>
          )
        )}
        {mode === 'design' && (
          <DesignWorkspace
            chipsEnabled={chipsEnabled}
            askKind={askKind}
            onAskKindChange={onAskKindChange}
            onSeedText={onSeedText}
          >
            {designPanel}
          </DesignWorkspace>
        )}
        {mode === 'code' && (
          files.length > 0 ? (
            <FragmentCode
              files={files.map((f) => ({
                name: f.file_path,
                content: f.file_content,
              }))}
            />
          ) : (
            <div className="h-full flex items-center justify-center">
              <p className="font-mono text-[11px] text-muted-foreground">
                No source yet.
              </p>
            </div>
          )
        )}
        {mode === 'database' && <DatabaseWorkspace fragment={fragment} />}
        {showOverlay && mode === 'preview' ? (
          <LoadingState label={loadingLabel!} variant="drive" size="overlay" />
        ) : null}
      </div>
    </div>
  )
}

'use client'

import { DeployDialog } from './deploy-dialog'
import { FragmentCode } from './fragment-code'
import { FragmentPreview } from './fragment-preview'
import { InspectPanel } from './inspect-panel'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent } from '@/components/ui/tabs'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  InspectDraft,
  InspectSelection,
  draftFromSelection,
} from '@/lib/inspect'
import { FragmentSchema, fragmentSourceFiles } from '@/lib/schema'
import { getTemplateId } from '@/lib/templates'
import { ExecutionResult, ExecutionResultWeb } from '@/lib/types'
import { DeepPartial } from 'ai'
import { Crosshair, LoaderCircle, X } from 'lucide-react'
import { Dispatch, SetStateAction, useEffect, useRef, useState } from 'react'

export type InspectControls = {
  open: boolean
  setOpen: (open: boolean) => void
  selection: InspectSelection | null
  setSelection: (selection: InspectSelection | null) => void
  onApply: (instruction: string, targetFile?: string) => void
  applying: boolean
  error?: string
  canUndo?: boolean
  canRedo?: boolean
  onUndo?: () => void
  onRedo?: () => void
  onReset?: () => void
}

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
  inspect,
  onRuntimeError,
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
  inspect?: InspectControls
  onRuntimeError?: (message: string) => void
}) {
  const [guides, setGuides] = useState(false)
  const [selectedSourceFile, setSelectedSourceFile] = useState<string | undefined>()
  const [draft, setDraft] = useState<InspectDraft | null>(null)
  const [baseline, setBaseline] = useState<InspectDraft | null>(null)
  const [hist, setHist] = useState<InspectDraft[]>([])
  const [histI, setHistI] = useState(0)
  const [compare, setCompare] = useState(false)
  const histIRef = useRef(0)
  histIRef.current = histI

  const selKey = inspect?.selection
    ? `${inspect.selection.tag}|${inspect.selection.selector}`
    : ''

  useEffect(() => {
    if (!inspect?.selection) {
      setDraft(null)
      setBaseline(null)
      setHist([])
      setHistI(0)
      setCompare(false)
      return
    }
    const next = draftFromSelection(inspect.selection)
    setDraft(next)
    setBaseline(next)
    setHist([next])
    setHistI(0)
    setCompare(false)
    // only reset when the selected node changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selKey])

  useEffect(() => {
    if (!inspect) return
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'i') {
        e.preventDefault()
        const next = !inspect!.open
        inspect!.setOpen(next)
        if (next) onSelectedTabChange('fragment')
      }
      if (e.key === 'Escape' && inspect!.open) {
        inspect!.setSelection(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [inspect, onSelectedTabChange])

  function commitDraft(next: InspectDraft) {
    setDraft(next)
    setCompare(false)
    setHist((h) => {
      const merged = [...h.slice(0, histIRef.current + 1), next].slice(-40)
      setHistI(merged.length - 1)
      return merged
    })
  }

  if (!fragment) {
    return null
  }

  const isLinkAvailable =
    result?.template &&
    getTemplateId(result?.template!) !== 'code-interpreter-v1'

  const inspectAvailable = Boolean(isLinkAvailable && inspect)
  const fileLabel = fragment.title || fragment.file_path || 'Project'
  const files = fragmentSourceFiles(fragment).map((file) => ({ name: file.file_path, content: file.file_content }))
  const hasSource = files.some((file) => file.content.trim())

  return (
    <div className="absolute md:relative z-10 top-0 left-0 bg-background h-full w-full overflow-hidden flex flex-col md:rounded-lg md:border md:border-border">
      <Tabs
        value={selectedTab}
        onValueChange={(value) =>
          onSelectedTabChange(value as 'code' | 'fragment')
        }
        className="h-full flex flex-col items-stretch"
      >
        <header className="shrink-0 flex flex-wrap items-center gap-2 sm:gap-3 px-3 md:px-4 min-h-14 py-2 border-b border-border bg-background">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <span className="font-mono text-[11px] sm:text-xs text-foreground truncate" title={fileLabel}>
              {fileLabel}
            </span>
            {files.length > 1 && <span className="shrink-0 text-[11px] text-muted-foreground">{files.length} files</span>}
            {(isChatLoading || isPreviewLoading) && (
              <span className="flex items-center gap-1.5 text-xs text-brand shrink-0" role="status">
                <LoaderCircle strokeWidth={2.5} className="h-3 w-3 animate-spin" />
                <span className="hidden md:inline">
                  {isPreviewLoading ? 'Preparing preview' : 'Writing code'}
                </span>
              </span>
            )}
          </div>

          <div
            role="tablist"
            aria-label="Project view"
            className="inline-flex rounded-lg bg-muted p-1 shrink-0"
          >
            <button
              role="tab"
              type="button"
              aria-selected={selectedTab === 'code'}
              onClick={() => onSelectedTabChange('code')}
              className={`
                h-8 px-3 text-xs font-medium rounded-md
                inline-flex items-center gap-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand
                ${
                  selectedTab === 'code'
                    ? 'bg-foreground text-background'
                    : 'text-muted-foreground hover:text-foreground hover:bg-foreground/[0.04]'
                }
              `}
            >
              Code
            </button>
            <button
              role="tab"
              type="button"
              disabled={!result}
              aria-selected={selectedTab === 'fragment'}
              onClick={() => onSelectedTabChange('fragment')}
              className={`
                h-8 px-3 text-xs font-medium rounded-md
                inline-flex items-center gap-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand
                ${
                  selectedTab === 'fragment'
                    ? 'bg-foreground text-background'
                    : !result
                      ? 'text-muted-foreground/40 cursor-not-allowed'
                      : 'text-muted-foreground hover:text-foreground hover:bg-foreground/[0.04]'
                }
              `}
            >
              Preview
            </button>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {inspectAvailable && (
              <TooltipProvider>
                <Tooltip delayDuration={0}>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        const next = !inspect!.open
                        inspect!.setOpen(next)
                        if (next) onSelectedTabChange('fragment')
                      }}
                      className={`h-8 w-8 rounded-lg ${
                        inspect!.open
                          ? 'bg-brand text-brand-foreground hover:bg-brand/90'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                      aria-label="Inspect"
                      aria-pressed={inspect!.open}
                    >
                      <Crosshair className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Inspect</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
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
                    className="h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground"
                    aria-label="Close preview"
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Close preview</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </header>

        <div className="flex-1 overflow-hidden w-full flex min-h-0">
          <div className="flex-1 min-w-0 min-h-0 overflow-y-auto">
            <TabsContent value="code" className="h-full m-0">
              {!hasSource && (
                <div className="h-full min-h-48 flex flex-col items-center justify-center gap-3 p-8 text-center" role="status">
                  <LoaderCircle className="h-6 w-6 animate-spin text-brand" />
                  <p className="text-sm font-medium">Writing your first version</p>
                  <p className="text-sm text-muted-foreground">The code will appear here as it is generated.</p>
                </div>
              )}
              {hasSource && <FragmentCode files={files} onSelectedFileChange={setSelectedSourceFile} />}
            </TabsContent>
            <TabsContent value="fragment" className="h-full m-0">
              {result && (
                <FragmentPreview
                  result={result as ExecutionResult}
                  inspectEnabled={Boolean(inspect?.open)}
                  selection={inspect?.selection ?? null}
                  onSelection={inspect?.setSelection}
                  draft={draft}
                  compare={compare}
                  onDraft={commitDraft}
                  onText={(text) =>
                    setDraft((d) => (d ? { ...d, text } : d))
                  }
                  applying={inspect?.applying}
                  guides={guides}
                  teamID={teamID}
                  accessToken={accessToken}
                  onRuntimeError={onRuntimeError}
                />
              )}
            </TabsContent>
          </div>
          {inspect?.open && (
            <InspectPanel
              selection={inspect.selection}
              draft={draft}
              baseline={baseline}
              fragment={fragment}
              filePath={selectedTab === 'code' ? selectedSourceFile : undefined}
              applying={inspect.applying}
              error={inspect.error}
              compare={compare}
              canUndo={histI > 0}
              canRedo={histI < hist.length - 1}
              onClose={() => inspect.setOpen(false)}
              onReselect={() => inspect.setSelection(null)}
              onDraft={commitDraft}
              onApply={inspect.onApply}
              onUndo={() => {
                if (histI <= 0) return
                const i = histI - 1
                setHistI(i)
                setDraft(hist[i])
                setCompare(false)
              }}
              onRedo={() => {
                if (histI >= hist.length - 1) return
                const i = histI + 1
                setHistI(i)
                setDraft(hist[i])
                setCompare(false)
              }}
              onReset={() => {
                if (!baseline) return
                commitDraft(baseline)
              }}
              onDelete={() =>
                inspect.onApply('Remove this element from the page. Leave the rest intact.')
              }
              onCompare={setCompare}
              onGuides={setGuides}
              guides={guides}
            />
          )}
        </div>
      </Tabs>
    </div>
  )
}

'use client'

import { ArenaCodeTab } from './arena-code-tab'
import { ArenaDatabaseTab } from './arena-database-tab'
import { DeployDialog } from './deploy-dialog'
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
import { FragmentSchema } from '@/lib/schema'
import { getTemplateId } from '@/lib/templates'
import { ExecutionResult } from '@/lib/types'
import { DeepPartial } from 'ai'
import { Crosshair, LoaderCircle, X } from 'lucide-react'
import Link from 'next/link'
import { Dispatch, SetStateAction, useEffect, useRef, useState } from 'react'

export type InspectControls = {
  open: boolean
  setOpen: (open: boolean) => void
  selection: InspectSelection | null
  setSelection: (selection: InspectSelection | null) => void
  onApply: (instruction: string) => void
  applying: boolean
  error?: string
  canUndo?: boolean
  canRedo?: boolean
  onUndo?: () => void
  onRedo?: () => void
  onReset?: () => void
}

export type ArenaTab = 'fragment' | 'code' | 'database'

export function Preview({
  teamID,
  accessToken,
  selectedTab,
  onSelectedTabChange,
  isChatLoading,
  isPreviewLoading,
  fragment,
  result,
  projectId,
  candidateId,
  onClose,
  inspect,
}: {
  teamID: string | undefined
  accessToken: string | undefined
  selectedTab: ArenaTab
  onSelectedTabChange: Dispatch<SetStateAction<ArenaTab>>
  isChatLoading: boolean
  isPreviewLoading: boolean
  fragment?: DeepPartial<FragmentSchema>
  result?: ExecutionResult
  projectId?: string
  candidateId?: string
  onClose: () => void
  inspect?: InspectControls
}) {
  const [guides, setGuides] = useState(false)
  const [draft, setDraft] = useState<InspectDraft | null>(null)
  const [baseline, setBaseline] = useState<InspectDraft | null>(null)
  const [hist, setHist] = useState<InspectDraft[]>([])
  const [histI, setHistI] = useState(0)
  const [compare, setCompare] = useState(false)
  const [requiresDataLayer, setRequiresDataLayer] = useState(false)
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
    if (!projectId || !candidateId) {
      setRequiresDataLayer(false)
      return
    }
    let cancelled = false
    fetch(
      `/api/project-files?projectId=${encodeURIComponent(projectId)}&candidateId=${encodeURIComponent(candidateId)}`,
    )
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setRequiresDataLayer(Boolean(data?.requires_data_layer))
      })
      .catch(() => {
        if (!cancelled) setRequiresDataLayer(false)
      })
    return () => {
      cancelled = true
    }
  }, [projectId, candidateId, result?.sbxId])

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
  const fileLabel = fragment.file_path || 'untitled'

  return (
    <div className="absolute md:relative z-10 top-0 left-0 bg-background h-full w-full overflow-hidden flex flex-col md:border-l md:border-border">
      <Tabs
        value={selectedTab}
        onValueChange={(value) => onSelectedTabChange(value as ArenaTab)}
        className="h-full flex flex-col items-stretch"
      >
        <header className="shrink-0 flex items-center gap-2 sm:gap-3 px-2.5 sm:px-3 md:px-4 h-10 sm:h-11 border-b border-border bg-background/95">
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

          <div
            role="tablist"
            aria-label="Specimen view"
            className="inline-flex border border-border shrink-0"
          >
            {(
              [
                ['fragment', 'Preview', Boolean(result)],
                ['code', 'Code', true],
                ['database', 'Database', true],
              ] as const
            ).map(([id, label, enabled], i) => (
              <button
                key={id}
                role="tab"
                type="button"
                disabled={!enabled}
                aria-selected={selectedTab === id}
                onClick={() => enabled && onSelectedTabChange(id)}
                className={`
                  h-6 sm:h-7 px-2 sm:px-3 font-mono text-[9px] sm:text-[10px] tracking-[0.22em] uppercase
                  inline-flex items-center gap-1 transition-colors
                  ${i > 0 ? 'border-l border-border' : ''}
                  ${
                    selectedTab === id
                      ? 'bg-foreground text-background'
                      : !enabled
                        ? 'text-muted-foreground/40 cursor-not-allowed'
                        : 'text-muted-foreground hover:text-foreground hover:bg-foreground/[0.04]'
                  }
                `}
              >
                {label}
              </button>
            ))}
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
                      className={`h-7 w-7 sm:h-8 sm:w-8 rounded-none ${
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
            {requiresDataLayer && projectId ? (
              <Link
                href={`/projects/${encodeURIComponent(projectId)}/submissions`}
                className="h-7 sm:h-8 px-2 inline-flex items-center font-mono text-[9px] sm:text-[10px] tracking-[0.22em] uppercase text-muted-foreground hover:text-foreground"
              >
                Admin
              </Link>
            ) : null}
            {projectId && candidateId ? (
              <DeployDialog projectId={projectId} candidateId={candidateId} />
            ) : null}
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

        <div className="flex-1 overflow-hidden w-full flex min-h-0">
          <div className="flex-1 min-w-0 min-h-0 overflow-y-auto">
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
                />
              )}
            </TabsContent>
            <TabsContent value="code" className="h-full m-0">
              <ArenaCodeTab
                projectId={projectId}
                candidateId={candidateId}
                revision={result?.sbxId}
                fallback={fragment}
              />
            </TabsContent>
            <TabsContent value="database" className="h-full m-0">
              <ArenaDatabaseTab
                projectId={projectId}
                candidateId={candidateId}
                revision={result?.sbxId}
              />
            </TabsContent>
          </div>
          {inspect?.open && (
            <InspectPanel
              selection={inspect.selection}
              draft={draft}
              baseline={baseline}
              fragment={fragment}
              filePath={fragment.file_path}
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

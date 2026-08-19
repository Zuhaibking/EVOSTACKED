'use client'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { RunHistoryItem } from '@/lib/run-history'
import { ChevronDown } from 'lucide-react'

function visibleRuns(runs: RunHistoryItem[] | undefined, activeId: string | null) {
  return (Array.isArray(runs) ? runs : []).filter(
    (run) => run.memoryVersion > 0 || run.id === activeId,
  )
}

export function ProjectSwitch({
  runs,
  activeId,
  currentTitle,
  onSelect,
  onNew,
  canNew,
}: {
  runs: RunHistoryItem[]
  activeId: string | null
  currentTitle?: string
  onSelect: (id: string) => void
  onNew: () => void
  canNew: boolean
}) {
  const listed = visibleRuns(runs, activeId)
  const label = currentTitle?.trim() || 'New project'

  return (
    <div className="flex items-center min-w-0 gap-0">
      <button
        type="button"
        onClick={onNew}
        disabled={!canNew}
        className="h-8 shrink-0 px-2 font-mono text-[11px] tracking-[0.2em] uppercase text-foreground border border-border hover:border-foreground disabled:opacity-30 disabled:hover:border-border"
      >
        New
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="h-8 min-w-0 max-w-[11rem] sm:max-w-[16rem] lg:max-w-[20rem] inline-flex items-center gap-1.5 border border-l-0 border-border px-2 hover:border-foreground hover:border-l data-[state=open]:border-foreground"
            aria-label="Open project history"
          >
            <span className="truncate font-mono text-[13px] tracking-[0.08em] text-foreground">
              {label}
            </span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="w-[min(22rem,calc(100vw-2rem))] rounded-none border-foreground p-0"
        >
          <DropdownMenuLabel className="px-3 py-2 font-mono text-[11px] tracking-[0.22em] uppercase text-muted-foreground">
            Projects
          </DropdownMenuLabel>
          <DropdownMenuItem
            disabled={!canNew}
            className="rounded-none px-3 py-2 font-mono text-[13px] tracking-[0.08em]"
            onSelect={onNew}
          >
            New project
          </DropdownMenuItem>
          <DropdownMenuSeparator className="bg-border" />
          {listed.length === 0 ? (
            <p className="px-3 py-2 font-mono text-[13px] text-muted-foreground">
              Saved work appears here.
            </p>
          ) : (
            <div className="max-h-72 overflow-y-auto py-1">
              {listed.map((run) => {
                const active = run.id === activeId
                return (
                  <DropdownMenuItem
                    key={run.id}
                    className={`rounded-none items-start justify-between px-3 py-2 ${
                      active ? 'bg-foreground/[0.06]' : ''
                    }`}
                    onSelect={() => onSelect(run.id)}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-mono text-[13px] text-foreground">
                        {run.title}
                      </span>
                      {run.preview ? (
                        <span className="mt-0.5 block truncate font-mono text-[11px] text-muted-foreground">
                          {run.preview}
                        </span>
                      ) : null}
                    </span>
                    {active ? (
                      <span className="ml-3 shrink-0 font-mono text-[10px] tracking-[0.16em] uppercase text-muted-foreground">
                        Open
                      </span>
                    ) : null}
                  </DropdownMenuItem>
                )
              })}
            </div>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

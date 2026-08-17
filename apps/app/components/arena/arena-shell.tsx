'use client'

import { cn } from '@/lib/utils'
import type { ReactNode } from 'react'

export function ArenaShell({
  topbar,
  sidebar,
  sidebarOpen,
  onCloseSidebar,
  workspace,
  commandBar,
  commandDocked,
}: {
  topbar: ReactNode
  sidebar: ReactNode
  sidebarOpen: boolean
  onCloseSidebar: () => void
  workspace: ReactNode
  commandBar: ReactNode
  commandDocked: boolean
}) {
  return (
    <div
      className="flex flex-col h-dvh overflow-hidden bg-background arena-workspace"
      data-command-docked={commandDocked ? 'true' : 'false'}
    >
      <div className="shrink-0 border-b border-border arena-glass">{topbar}</div>

      {sidebarOpen && (
        <div className="md:hidden fixed inset-0 z-40">
          <button
            type="button"
            className="absolute inset-0 bg-background/60"
            aria-label="Close sidebar"
            onClick={onCloseSidebar}
          />
          <aside className="relative z-10 h-full w-[min(320px,88vw)] border-r border-border arena-glass arena-panel overflow-hidden">
            {sidebar}
          </aside>
        </div>
      )}

      <div
        className={cn(
          'flex-1 min-h-0 min-w-0 grid grid-cols-1 grid-rows-[minmax(0,1fr)_auto]',
          'md:grid-cols-[var(--arena-sidebar-width)_minmax(0,1fr)]',
        )}
      >
        <aside
          className={cn(
            'hidden md:flex md:col-start-1 md:row-start-1 min-h-0 min-w-0 overflow-hidden border-r border-border arena-glass arena-panel',
            commandDocked ? '' : 'md:row-span-2',
          )}
        >
          <div className="w-full h-full min-h-0 min-w-0 overflow-hidden">
            {sidebar}
          </div>
        </aside>

        <div
          className={cn(
            'col-start-1 row-start-1 min-h-0 min-w-0 overflow-hidden md:col-start-2 md:row-start-1',
            commandDocked && 'md:row-span-2',
          )}
        >
          {workspace}
        </div>

        <div
          className={cn(
            commandDocked
              ? 'col-start-1 row-start-2 w-full min-w-0 justify-self-stretch arena-glass md:border-r md:border-border'
              : 'col-start-1 row-start-2 min-w-0 w-full md:col-start-2 md:row-start-1 arena-command-slot-centered',
          )}
        >
          <div
            className={cn(
              'w-full min-w-0',
              commandDocked
                ? 'px-3 pt-2 pb-3 [&_form]:w-full [&_form]:px-0 [&_form]:sm:px-0 [&_textarea]:min-h-[4.5rem]'
                : '[&_form]:w-full md:[&_form]:border-t-0 md:[&_form]:px-0 md:[&_form]:sm:px-0 md:[&_form]:bg-transparent',
            )}
          >
            {commandBar}
          </div>
        </div>
      </div>
    </div>
  )
}

'use client'

import Logo from './logo'
import { Avatar, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ThemeToggle } from '@/components/ui/theme-toggle'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import type { AuthSession } from '@/lib/auth'
import { GitHubLogoIcon } from '@radix-ui/react-icons'
import { ArrowRight, ChevronDown, Loader2, LogOut, Plus, Trash, Undo } from 'lucide-react'
import Link from 'next/link'

/**
 * Editorial app bar for /app.
 * Composed of four distinct groups with hairline separators between them:
 *   1. Brand    — logo + wordmark + section
 *   2. Run meta — # · date · time (mono tabular chip)
 *   3. Status   — pulse + phase label (pill)
 *   4. Actions  — icons + sign-in / avatar
 */
export function NavBar({
  session,
  showLogin,
  signOut,
  onClear,
  canClear,
  onSocialClick,
  onUndo,
  canUndo,
  runId = '0044',
  isLoading = false,
  hasFragment = false,
  projects = [],
  activeProjectId,
  activeProjectName = 'Untitled',
  onNewProject,
  onSwitchProject,
  onDeleteProject,
}: {
  session: AuthSession | null
  showLogin: () => void
  signOut: () => void
  onClear: () => void
  canClear: boolean
  onSocialClick: (target: 'github' | 'x' | 'discord') => void
  onUndo: () => void
  canUndo: boolean
  runId?: string
  isLoading?: boolean
  hasFragment?: boolean
  projects?: { id: string; name: string }[]
  activeProjectId?: string
  activeProjectName?: string
  onNewProject?: () => void
  onSwitchProject?: (id: string) => void
  onDeleteProject?: (id: string) => void
}) {
  const phase = isLoading
    ? 'Generating'
    : hasFragment
      ? 'Ready'
      : 'Idle'

  const dot = isLoading
    ? 'bg-brand'
    : hasFragment
      ? 'bg-brand-accent'
      : 'bg-muted-foreground/60'

  const statusBorder = isLoading
    ? 'border-brand/40'
    : hasFragment
      ? 'border-brand-accent/40'
      : 'border-border'

  const now = new Date()
  const date = now.toISOString().slice(0, 10).replace(/-/g, '·')
  const time = now.toTimeString().slice(0, 5)

  return (
    <nav className="w-full flex items-stretch h-12 sm:h-[52px] bg-background">
      {/* 1. Brand group */}
      <div className="flex items-center gap-2 sm:gap-2.5 pl-3 sm:pl-4 md:pl-6 pr-3 sm:pr-4 shrink-0">
        <Link href="/" className="flex items-center gap-2 group">
          <Logo width={22} height={22} className="text-foreground" />
          <h1 className="font-display text-[18px] sm:text-[19px] font-black tracking-tight leading-none">
            Evo<span className="italic font-normal">Stack</span>
          </h1>
        </Link>
        <span className="hidden sm:inline-flex items-center font-mono text-[9px] tracking-[0.26em] uppercase text-muted-foreground/70 border-l border-border pl-2.5 ml-0.5 self-center h-4">
          arena
        </span>
        <button
          type="button"
          onClick={onNewProject}
          className="hidden sm:inline-flex items-center h-7 px-2 border border-border font-mono text-[9px] tracking-[0.22em] uppercase text-muted-foreground hover:text-foreground hover:border-foreground/60 hover:bg-foreground/[0.04] transition-colors"
        >
          <Plus className="h-3 w-3 mr-1" />
          New
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 max-w-[10rem] sm:max-w-[14rem] h-7 px-2 border border-border bg-foreground/[0.02] font-mono text-[10px] tracking-[0.08em] text-foreground hover:border-foreground/60 hover:bg-foreground/[0.04] transition-colors"
              title={activeProjectName}
            >
              <span className="truncate">{activeProjectName}</span>
              <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="w-64 rounded-none border-foreground p-1"
          >
            <DropdownMenuItem
              onSelect={() => onNewProject?.()}
              className="rounded-none font-mono text-[11px] tracking-[0.12em] uppercase cursor-pointer"
            >
              <Plus className="mr-2 h-3.5 w-3.5" />
              New project
            </DropdownMenuItem>
            {projects.length > 0 && <DropdownMenuSeparator />}
            {projects.map((p) => (
              <div
                key={p.id}
                className={`flex items-center gap-0.5 ${
                  p.id === activeProjectId ? 'bg-foreground/[0.06]' : ''
                }`}
              >
                <DropdownMenuItem
                  onSelect={() => onSwitchProject?.(p.id)}
                  className="rounded-none flex-1 min-w-0 cursor-pointer"
                >
                  <span className="truncate text-[13px]">{p.name}</span>
                </DropdownMenuItem>
                <button
                  type="button"
                  aria-label={`Delete ${p.name}`}
                  className="h-8 w-8 shrink-0 inline-flex items-center justify-center text-muted-foreground hover:text-destructive"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    onDeleteProject?.(p.id)
                  }}
                >
                  <Trash className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* 2. Run meta — a tabular chip with its own subtle frame */}
      <div className="hidden md:flex items-center self-center mr-2">
        <div className="inline-flex items-center gap-2.5 lg:gap-3 h-7 px-2.5 lg:px-3 border border-border bg-foreground/[0.02]">
          <span className="font-mono text-[9px] tracking-[0.24em] uppercase text-muted-foreground/80">
            run
          </span>
          <span className="font-mono text-[11px] tabular text-foreground font-medium">
            #{runId}
          </span>
          <span className="h-3 w-px bg-border/80 hidden lg:inline-block" />
          <span className="hidden lg:inline font-mono text-[10px] tracking-[0.14em] uppercase text-muted-foreground tabular">
            {date}
          </span>
          <span className="h-3 w-px bg-border/80" />
          <span className="font-mono text-[10px] tracking-[0.14em] uppercase text-muted-foreground tabular">
            {time}
          </span>
        </div>
      </div>

      {/* 3. Status pill — its own framed unit, lives left of center on med, right-aligned on sm */}
      <div className="flex items-center self-center ml-auto md:ml-0 mr-2 sm:mr-3">
        <div
          className={`inline-flex items-center gap-1.5 sm:gap-2 h-7 px-2 sm:px-2.5 border ${statusBorder} bg-card/40`}
        >
          <span className="relative inline-flex h-1.5 w-1.5 shrink-0">
            {isLoading && (
              <span className={`absolute inline-flex h-full w-full rounded-full ${dot} opacity-70 animate-ping`} />
            )}
            <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${dot}`} />
          </span>
          <span className="font-mono text-[9px] sm:text-[10px] tracking-[0.22em] uppercase text-foreground inline-flex items-center gap-1.5 whitespace-nowrap">
            {isLoading && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
            {phase}
          </span>
        </div>
      </div>

      {/* 4. Action cluster — pinned right */}
      <div className="flex items-center self-center gap-0.5 sm:gap-1 ml-auto md:ml-auto pr-2 sm:pr-3 md:pr-4 shrink-0 border-l border-border pl-2 sm:pl-3">
        <TooltipProvider>
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={onUndo}
                disabled={!canUndo}
                className="h-8 w-8 rounded-none text-muted-foreground hover:text-foreground hover:bg-foreground/[0.04] disabled:opacity-30"
              >
                <Undo className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Undo</TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <TooltipProvider>
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={onClear}
                disabled={!canClear}
                className="h-8 w-8 rounded-none text-muted-foreground hover:text-foreground hover:bg-foreground/[0.04] disabled:opacity-30"
              >
                <Trash className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Clear chat</TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <TooltipProvider>
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <ThemeToggle />
            </TooltipTrigger>
            <TooltipContent>Toggle theme</TooltipContent>
          </Tooltip>
        </TooltipProvider>

        <span aria-hidden className="h-5 w-px bg-border mx-1 sm:mx-1.5" />

        {session ? (
          <DropdownMenu>
            <TooltipProvider>
              <Tooltip delayDuration={0}>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Avatar className="w-7 h-7 sm:w-8 sm:h-8 ring-1 ring-border hover:ring-foreground transition-colors cursor-pointer rounded-none">
                      <AvatarImage
                        src={
                          session.user.user_metadata?.avatar_url ||
                          'https://avatar.vercel.sh/' + session.user.email
                        }
                        alt={session.user.email}
                      />
                    </Avatar>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent>My Account</TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <DropdownMenuContent className="w-60 rounded-none border-foreground" align="end">
              <DropdownMenuLabel className="flex flex-col gap-0.5">
                <span className="font-mono text-[10px] tracking-[0.22em] uppercase text-muted-foreground">
                  § Identity
                </span>
                <span className="text-sm">{session.user.email}</span>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => onSocialClick('github')}>
                <GitHubLogoIcon className="mr-2 h-4 w-4 text-muted-foreground" />
                Star EvoStack on GitHub
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={signOut}>
                <LogOut className="mr-2 h-4 w-4 text-muted-foreground" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <Button
            variant="default"
            onClick={showLogin}
            className="h-8 px-3 rounded-none font-mono text-[10px] sm:text-[11px] tracking-[0.22em] uppercase border border-foreground bg-foreground text-background hover:bg-brand hover:text-brand-foreground hover:border-brand transition-colors"
          >
            Sign in
            <ArrowRight className="ml-1.5 h-3 w-3 sm:h-3.5 sm:w-3.5" />
          </Button>
        )}
      </div>
    </nav>
  )
}

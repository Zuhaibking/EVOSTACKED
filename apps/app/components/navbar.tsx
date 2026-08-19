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
import { toast } from '@/components/ui/use-toast'
import { ProjectSwitch } from '@/components/run-history'
import type { AuthSession } from '@/lib/auth'
import type { RunHistoryItem } from '@/lib/run-history'
import { GitHubLogoIcon } from '@radix-ui/react-icons'
import { ArrowRight, LogOut, Menu, Share2, Undo } from 'lucide-react'
import Link from 'next/link'

export function NavBar({
  session,
  showLogin,
  signOut,
  onNewProject,
  canNewProject,
  onSelectProject,
  runHistory,
  onSocialClick,
  onUndo,
  canUndo,
  runId,
  projectName,
  isLoading = false,
  hasFragment = false,
  onMenuClick,
}: {
  session: AuthSession | null
  showLogin: () => void
  signOut: () => void
  onNewProject: () => void
  canNewProject: boolean
  onSelectProject: (id: string) => void
  runHistory: RunHistoryItem[]
  onSocialClick: (target: 'github' | 'x' | 'discord') => void
  onUndo: () => void
  canUndo: boolean
  runId?: string
  projectName?: string
  isLoading?: boolean
  hasFragment?: boolean
  onMenuClick?: () => void
}) {
  const phase = isLoading ? 'Generating' : hasFragment ? 'Ready' : 'Idle'
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
  const runLabel = runId ? runId.replace(/^run_/, '').slice(-8) : null

  return (
    <nav className="w-full flex items-center h-[55px] sm:h-[60px] bg-transparent">
      <div className="flex items-center gap-2 pl-2 sm:pl-3 md:pl-4 pr-2 shrink-0 min-w-0">
        {onMenuClick && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onMenuClick}
            className="md:hidden h-10 w-10 rounded-none text-muted-foreground"
            aria-label="Open project sidebar"
          >
            <Menu className="h-4 w-4" />
          </Button>
        )}
        <Link href="/" className="flex items-center gap-2 shrink-0">
          <Logo width={25} height={25} className="text-foreground" />
          <h1 className="font-display text-[21px] sm:text-[23px] font-black tracking-tight leading-none">
            Evo<span className="italic font-normal">Stack</span>
          </h1>
        </Link>
        <span className="hidden sm:inline-flex items-center font-mono text-[11px] tracking-[0.26em] uppercase text-muted-foreground/70 border-l border-border pl-2 h-4">
          Arena
        </span>
        <div className="min-w-0 border-l border-border pl-2">
          <ProjectSwitch
            runs={runHistory}
            activeId={runId || null}
            currentTitle={projectName}
            onSelect={onSelectProject}
            onNew={onNewProject}
            canNew={canNewProject}
          />
        </div>
      </div>

      <div className="hidden md:flex items-center gap-2 ml-2 min-w-0">
        {runLabel ? (
          <span className="font-mono text-[13px] tabular tracking-[0.14em] uppercase text-muted-foreground">
            Run #{runLabel}
          </span>
        ) : null}
        <div
          className={`inline-flex items-center gap-1.5 h-8 px-2.5 border ${statusBorder} bg-card/40`}
        >
          <span className="relative inline-flex h-2 w-2 shrink-0">
            {isLoading && (
              <span
                className={`absolute inline-flex h-full w-full rounded-full ${dot} opacity-70 animate-ping motion-reduce:animate-none`}
              />
            )}
            <span className={`relative inline-flex h-2 w-2 rounded-full ${dot}`} />
          </span>
          <span className="font-mono text-[11px] tracking-[0.2em] uppercase text-foreground">
            {phase}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-0.5 ml-auto pr-2 sm:pr-3 shrink-0 border-l border-border pl-2">
        {runId ? (
          <TooltipProvider>
            <Tooltip delayDuration={0}>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-10 w-10 rounded-none text-muted-foreground hover:text-foreground"
                  aria-label="Copy share link"
                  onClick={async () => {
                    const url = `${window.location.origin}/r/${runId}`
                    try {
                      await navigator.clipboard.writeText(url)
                      toast({
                        title: 'Share link copied',
                        description: 'Anyone with the link can view this run.',
                      })
                    } catch {
                      toast({
                        title: 'Copy failed',
                        description: url,
                      })
                    }
                  }}
                >
                  <Share2 className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Copy share link</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : null}
        <TooltipProvider>
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={onUndo}
                disabled={!canUndo}
                className="h-10 w-10 rounded-none text-muted-foreground hover:text-foreground disabled:opacity-30"
              >
                <Undo className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Undo</TooltipContent>
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

        <span aria-hidden className="h-5 w-px bg-border mx-1" />

        {session ? (
          <DropdownMenu>
            <TooltipProvider>
              <Tooltip delayDuration={0}>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Avatar className="w-9 h-9 ring-1 ring-border hover:ring-foreground cursor-pointer rounded-none">
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
                <span className="font-mono text-[13px] tracking-[0.22em] uppercase text-muted-foreground">
                  Identity
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
            className="h-10 px-4 rounded-none font-mono text-[13px] tracking-[0.22em] uppercase border border-foreground bg-foreground text-background hover:bg-brand hover:text-brand-foreground hover:border-brand"
          >
            Sign in
            <ArrowRight className="ml-1.5 h-4 w-4" />
          </Button>
        )}
      </div>
    </nav>
  )
}

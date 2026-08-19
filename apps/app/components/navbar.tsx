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
import type { AuthSession } from '@/lib/auth'
import { GitHubLogoIcon } from '@radix-ui/react-icons'
import { ArrowRight, Loader2, LogOut, Menu, Share2, Trash, Undo } from 'lucide-react'
import Link from 'next/link'

export function NavBar({
  session,
  showLogin,
  signOut,
  onClear,
  canClear,
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
  onClear: () => void
  canClear: boolean
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
    <nav className="w-full flex items-center h-11 sm:h-12 bg-transparent">
      <div className="flex items-center gap-2 pl-2 sm:pl-3 md:pl-4 pr-2 shrink-0 min-w-0">
        {onMenuClick && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onMenuClick}
            className="md:hidden h-8 w-8 rounded-none text-muted-foreground"
            aria-label="Open project sidebar"
          >
            <Menu className="h-4 w-4" />
          </Button>
        )}
        <Link href="/" className="flex items-center gap-2 shrink-0">
          <Logo width={20} height={20} className="text-foreground" />
          <h1 className="font-display text-[17px] sm:text-[18px] font-black tracking-tight leading-none">
            Evo<span className="italic font-normal">Stack</span>
          </h1>
        </Link>
        <span className="hidden sm:inline-flex items-center font-mono text-[9px] tracking-[0.26em] uppercase text-muted-foreground/70 border-l border-border pl-2 h-4">
          Arena
        </span>
        {projectName ? (
          <span className="hidden md:inline-flex items-center font-mono text-[10px] tracking-[0.16em] uppercase text-foreground/80 border-l border-border pl-2 truncate max-w-[180px] lg:max-w-[220px]">
            {projectName}
          </span>
        ) : null}
      </div>

      <div className="hidden md:flex items-center gap-2 ml-2 min-w-0">
        {runLabel ? (
          <span className="font-mono text-[10px] tabular tracking-[0.14em] uppercase text-muted-foreground">
            Run #{runLabel}
          </span>
        ) : null}
        <div
          className={`inline-flex items-center gap-1.5 h-6 px-2 border ${statusBorder} bg-card/40`}
        >
          <span className="relative inline-flex h-1.5 w-1.5 shrink-0">
            {isLoading && (
              <span
                className={`absolute inline-flex h-full w-full rounded-full ${dot} opacity-70 animate-ping motion-reduce:animate-none`}
              />
            )}
            <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${dot}`} />
          </span>
          <span className="font-mono text-[9px] tracking-[0.2em] uppercase text-foreground inline-flex items-center gap-1.5">
            {isLoading && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
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
                  className="h-8 w-8 rounded-none text-muted-foreground hover:text-foreground"
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
                  <Share2 className="h-3.5 w-3.5" />
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
                className="h-8 w-8 rounded-none text-muted-foreground hover:text-foreground disabled:opacity-30"
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
                className="h-8 w-8 rounded-none text-muted-foreground hover:text-foreground disabled:opacity-30"
                aria-label="Clear workspace"
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

        <span aria-hidden className="h-5 w-px bg-border mx-1" />

        {session ? (
          <DropdownMenu>
            <TooltipProvider>
              <Tooltip delayDuration={0}>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Avatar className="w-7 h-7 ring-1 ring-border hover:ring-foreground cursor-pointer rounded-none">
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
            className="h-8 px-3 rounded-none font-mono text-[10px] tracking-[0.22em] uppercase border border-foreground bg-foreground text-background hover:bg-brand hover:text-brand-foreground hover:border-brand"
          >
            Sign in
            <ArrowRight className="ml-1.5 h-3 w-3" />
          </Button>
        )}
      </div>
    </nav>
  )
}

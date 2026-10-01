'use client'

import { Avatar, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { ThemeToggle } from '@/components/ui/theme-toggle'
import type { AuthSession } from '@/lib/auth'
import { GitHubLogoIcon } from '@radix-ui/react-icons'
import { ChevronDown, Loader2, LogOut, Plus, Trash, Undo } from 'lucide-react'
import Link from 'next/link'

export function NavBar({ session, showLogin, signOut, onClear, canClear, onSocialClick, onUndo, canUndo, isLoading = false, hasFragment = false, projects = [], activeProjectId, activeProjectName = 'Untitled', onNewProject, onSwitchProject, onDeleteProject }: {
  session: AuthSession | null
  showLogin: () => void
  signOut: () => void
  onClear: () => void
  canClear: boolean
  onSocialClick: (target: 'github' | 'x' | 'discord') => void
  onUndo: () => void
  canUndo: boolean
  isLoading?: boolean
  hasFragment?: boolean
  projects?: { id: string; name: string }[]
  activeProjectId?: string
  activeProjectName?: string
  onNewProject?: () => void
  onSwitchProject?: (id: string) => void
  onDeleteProject?: (id: string) => void
}) {
  return (
    <nav aria-label="Workspace" className="flex min-h-[56px] flex-wrap items-center justify-between gap-2 border-b border-border/60 bg-background px-4 py-2 sm:min-h-[60px] sm:px-6">
      <div className="flex min-w-0 items-center gap-2 sm:gap-4">
        <Link href="/" className="shrink-0 font-display text-[22px] font-bold tracking-tight text-foreground leading-none">
          Evo<span className="italic text-brand-accent">Stack</span>
        </Link>
        <span aria-hidden className="hidden h-5 w-px bg-border/60 sm:block" />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="h-8 max-w-[9rem] gap-2 px-2 sm:max-w-[15rem]" aria-label="Choose project">
              <span className="truncate text-[13px] font-medium">{activeProjectName}</span><ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-72 rounded-lg p-2 shadow-lg">
            <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">Your projects</DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => onNewProject?.()} className="cursor-pointer rounded-lg py-2.5"><Plus className="mr-2 h-4 w-4" />New project</DropdownMenuItem>
            {projects.length > 0 && <DropdownMenuSeparator />}
            {projects.map((p) => (
              <div key={p.id} className={`flex items-center rounded-lg ${p.id === activeProjectId ? 'bg-brand/5 text-brand' : ''}`}>
                <DropdownMenuItem onSelect={() => onSwitchProject?.(p.id)} className="min-w-0 flex-1 cursor-pointer rounded-lg py-2.5"><span className="truncate">{p.name}</span></DropdownMenuItem>
                <button type="button" aria-label={`Delete ${p.name}`} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDeleteProject?.(p.id) }}><Trash className="h-4 w-4" /></button>
              </div>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button onClick={onNewProject} variant="ghost" size="sm" className="hidden h-8 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground md:inline-flex"><Plus className="h-3.5 w-3.5" />New project</Button>
      </div>
      <div className="flex items-center gap-1">
        <span className="mr-3 hidden items-center gap-2 text-[11px] text-muted-foreground lg:inline-flex">
          {isLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin text-brand" /> : <span className={`h-1.5 w-1.5 rounded-full ${hasFragment ? 'bg-brand-accent' : 'bg-muted-foreground/50'}`} />}
          {isLoading ? 'Building' : hasFragment ? 'Ready to preview' : 'Ready to create'}
        </span>
        <div className="flex items-center gap-0.5">
          <Button variant="ghost" size="icon" onClick={onUndo} disabled={!canUndo} aria-label="Undo last message" title="Undo last message" className="h-8 w-8 text-muted-foreground hover:text-foreground"><Undo className="h-3.5 w-3.5" /></Button>
          <Button variant="ghost" size="icon" onClick={onClear} disabled={!canClear} aria-label="Clear chat" title="Clear chat" className="h-8 w-8 text-muted-foreground hover:text-foreground"><Trash className="h-3.5 w-3.5" /></Button>
        </div>
        <span aria-hidden className="mx-1 h-4 w-px bg-border/60" />
        <span className="hidden sm:inline-flex"><ThemeToggle /></span>
        {session ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label="Account menu" className="h-8 w-8 rounded-full"><Avatar className="h-6 w-6"><AvatarImage src={session.user.user_metadata?.avatar_url || 'https://avatar.vercel.sh/' + session.user.email} alt={session.user.email} /></Avatar></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64 rounded-lg p-2"><DropdownMenuLabel className="truncate text-sm">{session.user.email}</DropdownMenuLabel><DropdownMenuSeparator /><DropdownMenuItem onClick={() => onSocialClick('github')}><GitHubLogoIcon className="mr-2 h-4 w-4" />View on GitHub</DropdownMenuItem><DropdownMenuItem onClick={signOut}><LogOut className="mr-2 h-4 w-4" />Sign out</DropdownMenuItem></DropdownMenuContent>
          </DropdownMenu>
        ) : <Button onClick={showLogin} size="sm" className="h-8 px-3 text-xs">Sign in</Button>}
      </div>
    </nav>
  )
}

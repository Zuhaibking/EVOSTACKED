import Logo from '@/components/logo'
import { GitHubLogoIcon } from '@radix-ui/react-icons'
import Link from 'next/link'

const REPO_URL = 'https://github.com/Suhaib3100/EVOSTACKED'

export function LandingNav() {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur-md supports-[backdrop-filter]:bg-background/70">
      <div className="mx-auto flex h-16 max-w-[1400px] items-center justify-between gap-4 px-6 md:h-[72px] md:px-10">
        <Link href="/" className="flex items-center gap-2.5 rounded-sm" aria-label="EvoStack home">
          <Logo width={24} height={24} className="text-foreground" />
          <span className="font-display text-2xl font-black leading-none tracking-tight md:text-[28px]">
            Evo<span className="font-normal italic">Stack</span>
          </span>
        </Link>
        <nav aria-label="Primary" className="flex items-center gap-1 md:gap-2">
          <a
            href="#protocol"
            className="hidden h-9 items-center rounded-md px-3 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground sm:inline-flex"
          >
            Method
          </a>
          <a
            href={REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="hidden h-9 items-center gap-2 rounded-md px-3 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground sm:inline-flex"
          >
            <GitHubLogoIcon aria-hidden className="h-4 w-4" />
            Source
          </a>
          <Link
            href="/app"
            className="ml-1 inline-flex h-9 items-center rounded-lg bg-foreground px-4 text-sm font-medium text-background transition-colors hover:bg-brand hover:text-brand-foreground active:bg-brand/90"
          >
            Enter the arena
          </Link>
        </nav>
      </div>
    </header>
  )
}

import Logo from '@/components/logo'
import { GitHubLogoIcon } from '@radix-ui/react-icons'
import Link from 'next/link'

export function LandingNav() {
  return (
    <header className="border-b border-border bg-background">
      <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-4 px-6 py-6 md:px-10">
        <Link href="/" className="flex items-center gap-2.5" aria-label="EvoStack home">
          <Logo width={26} height={26} className="text-foreground" />
          <span className="font-display text-3xl font-black leading-none tracking-tight">Evo<span className="font-normal italic">Stack</span></span>
        </Link>
        <nav aria-label="Primary" className="flex items-center gap-5 md:gap-8">
          <a href="#protocol" className="hidden font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground transition-colors hover:text-foreground sm:inline">The method</a>
          <a href="https://github.com/Zuhaibking/EVOSTACKED" target="_blank" rel="noopener noreferrer" aria-label="EvoStack on GitHub" className="hidden items-center gap-2 text-muted-foreground transition-colors hover:text-foreground sm:inline-flex"><GitHubLogoIcon className="h-4 w-4" /><span className="font-mono text-[11px] uppercase tracking-[0.12em]">Source</span></a>
          <Link href="/app" className="rounded-lg border border-foreground px-4 py-2.5 font-mono text-[11px] uppercase tracking-[0.12em] text-foreground transition-colors hover:bg-foreground hover:text-background">Enter arena →</Link>
        </nav>
      </div>
    </header>
  )
}

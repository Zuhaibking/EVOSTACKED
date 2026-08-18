import Logo from '@/components/logo'
import { GitHubLogoIcon } from '@radix-ui/react-icons'
import Link from 'next/link'

export function LandingNav() {
  return (
    <header className="relative border-b border-border bg-background">
      <div className="max-w-[1400px] mx-auto px-6 md:px-10">
        <div className="flex items-center justify-between py-3">
          <div className="flex items-center gap-3">
            <span className="label-caps">Vol. 01 — Iss. 04</span>
            <span className="hidden md:inline text-muted-foreground/40">/</span>
            <span className="hidden md:inline font-mono text-[11px] tracking-[0.2em] uppercase text-muted-foreground">
              2026 · Q2
            </span>
          </div>
          <div className="flex items-center gap-6">
            <span className="hidden sm:inline font-mono text-[11px] tracking-[0.2em] uppercase text-muted-foreground">
              Apache-2.0
            </span>
            <a
              href="https://github.com/Zuhaibking/EVOSTACKED"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="EvoStack on GitHub"
              className="inline-flex items-center gap-1.5 font-mono text-[11px] tracking-[0.18em] uppercase text-muted-foreground hover:text-foreground transition-colors"
            >
              <GitHubLogoIcon className="h-3.5 w-3.5" />
              Source
            </a>
          </div>
        </div>

        <div className="rule" />

        <div className="flex items-end justify-between py-6 md:py-8">
          <Link href="/" className="flex items-baseline gap-3 group">
            <Logo width={30} height={30} className="text-foreground translate-y-0.5" />
            <span className="font-display font-black text-4xl md:text-5xl tracking-tight leading-none">
              Evo<span className="italic font-normal">Stack</span>
            </span>
          </Link>

          <nav aria-label="Primary" className="hidden md:flex items-end gap-8">
            <a href="#arena-demo" className="label-caps hover:text-foreground transition-colors">
              § Arena
            </a>
            <a href="#protocol" className="label-caps hover:text-foreground transition-colors">
              § Protocol
            </a>
            <a href="#ledger" className="label-caps hover:text-foreground transition-colors">
              § Ledger
            </a>
            <a href="#findings" className="label-caps hover:text-foreground transition-colors">
              § Findings
            </a>
            <a href="#colophon" className="label-caps hover:text-foreground transition-colors">
              § Colophon
            </a>
            <Link
              href="/app"
              className="font-mono text-xs tracking-[0.2em] uppercase border border-foreground text-foreground hover:bg-foreground hover:text-background transition-colors px-3 py-2"
            >
              Enter Arena →
            </Link>
          </nav>
        </div>

        <div className="rule" />

        <p className="py-2 font-mono text-[10px] tracking-[0.22em] uppercase text-muted-foreground flex flex-wrap gap-x-6 gap-y-1">
          <span>A tournament engine for software architecture.</span>
          <span className="text-muted-foreground/50">—</span>
          <span>Published by Team Zuhaib.</span>
          <span className="text-muted-foreground/50">—</span>
          <span>Forked from E2B Fragments.</span>
        </p>
      </div>
    </header>
  )
}

import Logo from '@/components/logo'
import { GitHubLogoIcon } from '@radix-ui/react-icons'
import Link from 'next/link'

export function Footer() {
  const year = new Date().getFullYear()
  return (
    <footer className="border-t-2 border-foreground noise-overlay">
      <div className="max-w-[1400px] mx-auto px-6 md:px-10">
        {/* Big wordmark */}
        <div className="py-12 md:py-16 border-b border-border">
          <Link
            href="/"
            aria-label="EvoStack — home"
            className="inline-block"
          >
            <span className="block font-display font-black leading-none tracking-tight text-foreground text-[clamp(3.5rem,14vw,12rem)]">
              Evo<span className="italic font-normal">Stack</span>
              <span className="text-brand-accent">.</span>
            </span>
          </Link>
        </div>

        {/* Bottom bar */}
        <div className="py-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div className="flex items-center gap-3">
            <Logo width={20} height={20} className="text-foreground" />
            <span className="font-mono text-[10px] tracking-[0.22em] uppercase text-muted-foreground">
              © {year} Team Zuhaib · Apache-2.0 · Forked from E2B Fragments
            </span>
          </div>

          <nav
            aria-label="Footer"
            className="flex flex-wrap items-center gap-x-6 gap-y-2 font-mono text-[11px] tracking-[0.2em] uppercase text-muted-foreground"
          >
            <a href="#protocol" className="hover:text-foreground transition-colors">
              Protocol
            </a>
            <a href="#ledger" className="hover:text-foreground transition-colors">
              Ledger
            </a>
            <a href="#findings" className="hover:text-foreground transition-colors">
              Findings
            </a>
            <a href="#colophon" className="hover:text-foreground transition-colors">
              Colophon
            </a>
            <Link href="/app" className="text-foreground hover:text-brand transition-colors">
              Enter Arena →
            </Link>
            <a
              href="https://github.com/Zuhaibking/EVOSTACKED"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="GitHub"
              className="inline-flex items-center gap-1.5 hover:text-foreground transition-colors"
            >
              <GitHubLogoIcon className="h-3 w-3" />
              Source
            </a>
          </nav>
        </div>

        <p className="pb-8 max-w-3xl font-display italic text-xs text-muted-foreground/70 leading-relaxed">
          Disclaimer — figures on this page are priors from representative
          runs, not contractual guarantees. Your tournament&apos;s own
          scorecard is the only ground truth. All brand marks belong to their
          respective owners.
        </p>
      </div>
    </footer>
  )
}

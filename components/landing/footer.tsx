import Logo from '@/components/logo'
import { GitHubLogoIcon } from '@radix-ui/react-icons'
import Link from 'next/link'

const REPO_URL = 'https://github.com/Suhaib3100/EVOSTACKED'

const linkClass =
  'rounded-sm text-muted-foreground transition-colors hover:text-foreground'

export function Footer() {
  const year = new Date().getFullYear()
  return (
    <footer className="noise-overlay border-t border-border">
      <div className="mx-auto max-w-[1400px] px-6 md:px-10">
        {/* Big wordmark */}
        <div className="border-b border-border py-12 md:py-16">
          <Link href="/" aria-label="EvoStack — home" className="inline-block rounded-sm">
            <span className="block font-display text-[clamp(3.5rem,14vw,12rem)] font-black leading-none tracking-tight text-foreground">
              Evo<span className="font-normal italic">Stack</span>
              <span className="text-brand-accent">.</span>
            </span>
          </Link>
        </div>

        {/* Bottom bar */}
        <div className="flex flex-col items-start justify-between gap-5 py-7 md:flex-row md:items-center">
          <div className="flex items-center gap-3">
            <Logo width={18} height={18} className="text-foreground" />
            <span className="text-xs text-muted-foreground">
              © {year} Team Zuhaib · Apache-2.0 · Forked from E2B Fragments
            </span>
          </div>

          <nav
            aria-label="Footer"
            className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm"
          >
            <a href="#protocol" className={linkClass}>
              Method
            </a>
            <a href="#stack" className={linkClass}>
              Stack
            </a>
            <a
              href={REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              className={`${linkClass} inline-flex items-center gap-1.5`}
            >
              <GitHubLogoIcon aria-hidden className="h-3.5 w-3.5" />
              Source
            </a>
            <Link
              href="/app"
              className="rounded-sm font-medium text-foreground transition-colors hover:text-brand"
            >
              Enter the arena →
            </Link>
          </nav>
        </div>

        <p className="pb-8 text-xs leading-relaxed text-muted-foreground">
          All brand marks belong to their respective owners.
        </p>
      </div>
    </footer>
  )
}

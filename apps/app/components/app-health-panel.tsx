'use client'

import type { AppHealthReport } from '@/lib/app-health'

const ICONS: Record<string, string> = {
  ui: '🎨',
  ux: '📱',
  speed: '⚡',
  quality: '🧪',
  architecture: '🏗',
  runtime: '⚙️',
}

function dimMark(score: number | null, measured: boolean): string {
  if (!measured || score == null) return '—'
  if (score >= 85) return '✓'
  if (score >= 60) return '·'
  return '✗'
}

/**
 * Compact deterministic App Health panel — zero API calls.
 */
export function AppHealthPanel({
  report,
  disabled,
  onImprove,
}: {
  report: AppHealthReport | null
  disabled?: boolean
  onImprove: (request: string) => void
}) {
  if (!report) return null

  return (
    <section className="mx-3 sm:mx-4 md:mx-6 mb-3 border border-border bg-background/80">
      <div className="px-3 py-2 border-b border-border/70 flex items-center justify-between gap-2">
        <span className="font-mono text-[13px] tracking-[0.22em] uppercase text-muted-foreground">
          🧠 App Health
        </span>
        {report.activeVersion != null && (
          <span className="font-mono text-[13px] text-muted-foreground">
            v{report.activeVersion}
          </span>
        )}
      </div>

      <div className="px-3 py-4 flex flex-col sm:flex-row gap-4 sm:items-center">
        <div className="text-center sm:min-w-[120px]">
          <div className="font-display text-4xl leading-none text-foreground">
            {report.score}
          </div>
          <div className="font-mono text-[14px] text-muted-foreground mt-0.5">
            /100
          </div>
          <div
            className={`mt-1 font-mono text-[14px] tracking-[0.08em] uppercase ${
              report.status === 'excellent' || report.status === 'good'
                ? 'text-brand-accent'
                : report.status === 'needs_attention'
                  ? 'text-foreground'
                  : 'text-destructive'
            }`}
          >
            {report.statusLabel}
          </div>
        </div>

        <div className="flex-1 space-y-1 border-t sm:border-t-0 sm:border-l border-border/70 pt-3 sm:pt-0 sm:pl-4">
          {report.dimensions.map((d) => (
            <div
              key={d.id}
              className="flex items-baseline justify-between gap-3 text-[15px]"
            >
              <span className="text-muted-foreground">{d.label}</span>
              <span className="font-mono text-[14px] text-foreground tabular-nums">
                {d.measured && d.score != null ? d.score : '—'}
                <span className="ml-1.5 text-muted-foreground">
                  {dimMark(d.score, d.measured)}
                </span>
              </span>
            </div>
          ))}
          {report.qualityUnavailable && (
            <p className="text-[13px] text-muted-foreground pt-1">
              Quality not measured (iteration skips judge — no extra API call).
            </p>
          )}
        </div>
      </div>

      {report.recommendations.length > 0 && (
        <div className="border-t border-border/70 px-3 py-3 space-y-2">
          <div className="font-mono text-[11px] tracking-[0.18em] uppercase text-muted-foreground">
            Improvement opportunities
          </div>
          <ul className="space-y-2">
            {report.recommendations.map((r) => (
              <li
                key={r.id}
                className="flex items-start justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="text-[16px]">
                    <span className="mr-1.5">{ICONS[r.icon] || '•'}</span>
                    {r.title}
                  </div>
                  <p className="text-[14px] text-muted-foreground leading-snug mt-0.5">
                    {r.explanation}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onImprove(r.improveRequest)}
                  className="shrink-0 font-mono text-[13px] tracking-[0.14em] uppercase px-2 py-1 border border-border hover:bg-foreground/[0.03] disabled:opacity-40"
                >
                  Improve
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

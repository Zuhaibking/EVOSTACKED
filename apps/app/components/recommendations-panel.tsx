'use client'

import type { EvoStackRecommendation } from '@/lib/recommendations'

const ICONS: Record<EvoStackRecommendation['icon'], string> = {
  ui: '🎨',
  ux: '📱',
  speed: '⚡',
  a11y: '♿',
  quality: '🧪',
  architecture: '🏗',
}

/**
 * Zero-cost local recommendations for the active app.
 */
export function RecommendationsPanel({
  recommendations,
  disabled,
  onImprove,
}: {
  recommendations: EvoStackRecommendation[]
  disabled?: boolean
  onImprove: (request: string) => void
}) {
  if (!recommendations.length) return null

  return (
    <section className="mx-3 sm:mx-4 md:mx-6 mb-3 border border-border bg-background/80">
      <div className="px-3 py-2 border-b border-border/70">
        <span className="font-mono text-[13px] tracking-[0.22em] uppercase text-muted-foreground">
          🧠 EvoStack Recommendations
        </span>
      </div>
      <ul className="divide-y divide-border/60">
        {recommendations.map((r) => (
          <li
            key={r.id}
            className="px-3 py-2.5 flex items-start justify-between gap-3"
          >
            <div className="min-w-0">
              <div className="text-[16px] font-medium">
                <span className="mr-1.5">{ICONS[r.icon]}</span>
                {r.title}
                <span className="ml-2 font-mono text-[11px] tracking-[0.12em] uppercase text-muted-foreground">
                  {r.priority}
                </span>
              </div>
              <p className="text-[15px] text-muted-foreground leading-snug mt-0.5">
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
    </section>
  )
}

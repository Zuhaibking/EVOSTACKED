'use client'

import type { EvolutionReport, VersionScoreRow } from '@/lib/evolution-report'

const SECTION_ICONS: Record<string, string> = {
  ui: '🎨',
  ux: '📱',
  functional: '⚙️',
  architecture: '🏗',
  verification: '🧪',
}

/**
 * Compact deterministic Evolution Report (no LLM copy).
 */
export function EvolutionReportPanel({
  report,
}: {
  report: EvolutionReport | null
}) {
  if (!report) return null

  return (
    <div className="border-t border-border/70 pt-3 space-y-3">
      <div>
        <div className="font-mono text-[13px] tracking-[0.2em] uppercase text-muted-foreground">
          Evolution report · Round {report.roundNumber}
        </div>
        <div className="mt-1 text-[16px] font-medium">
          v{report.parentVersion} → v{report.newVersion}
          {report.previousScore != null && report.newScore != null && (
            <span className="ml-2 text-muted-foreground font-normal">
              {report.previousScore} → {report.newScore}
              {report.improvementDelta != null && (
                <span className="ml-1 text-brand-accent">
                  {report.improvementDelta >= 0 ? '+' : ''}
                  {report.improvementDelta} points
                </span>
              )}
            </span>
          )}
        </div>
      </div>

      <div>
        <div className="font-mono text-[11px] tracking-[0.16em] uppercase text-muted-foreground mb-0.5">
          Request
        </div>
        <p className="text-[15px] leading-snug text-foreground/90">
          “{report.userRequest}”
        </p>
      </div>

      <div>
        <div className="font-mono text-[11px] tracking-[0.16em] uppercase text-muted-foreground mb-0.5">
          Result
        </div>
        <p className="text-[15px]">
          🏆 {report.winnerLabel || 'Winner'} won
        </p>
      </div>

      <ScoreComparisonTable rows={report.scoreComparison} />

      <div className="space-y-2">
        {report.sections.map((section) => (
          <div key={section.id}>
            <div className="font-mono text-[11px] tracking-[0.16em] uppercase text-muted-foreground mb-0.5">
              {SECTION_ICONS[section.id] || ''} {section.title}
            </div>
            <ul className="space-y-0.5">
              {section.items.slice(0, 6).map((item, i) => (
                <li key={i} className="text-[15px] text-foreground/85 leading-snug">
                  {item}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  )
}

export function ScoreComparisonTable({ rows }: { rows: VersionScoreRow[] }) {
  if (rows.length < 1) return null
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[14px] font-mono">
        <thead>
          <tr className="text-muted-foreground text-left">
            <th className="py-1 pr-2 font-normal" />
            {rows.map((r) => (
              <th key={r.version} className="py-1 pr-2 font-normal">
                v{r.version}
                {r.isWinner ? ' 🏆' : ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="py-0.5 pr-2 text-muted-foreground">Score</td>
            {rows.map((r) => (
              <td key={`s-${r.version}`} className="py-0.5 pr-2">
                {r.score ?? '—'}
              </td>
            ))}
          </tr>
          <tr>
            <td className="py-0.5 pr-2 text-muted-foreground">Runtime</td>
            {rows.map((r) => (
              <td key={`r-${r.version}`} className="py-0.5 pr-2">
                {runtimeMark(r.runtime)}
              </td>
            ))}
          </tr>
          <tr>
            <td className="py-0.5 pr-2 text-muted-foreground">Smoke</td>
            {rows.map((r) => (
              <td key={`sm-${r.version}`} className="py-0.5 pr-2">
                {r.smokeLabel ?? '—'}
              </td>
            ))}
          </tr>
          <tr>
            <td className="py-0.5 pr-2 text-muted-foreground">Winner</td>
            {rows.map((r) => (
              <td key={`w-${r.version}`} className="py-0.5 pr-2">
                {r.isWinner ? '🏆' : ''}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  )
}

function runtimeMark(status?: string): string {
  if (!status) return '—'
  if (status === 'passed' || status === 'partial') return '✓'
  if (status === 'failed' || status === 'timeout') return '✗'
  return status
}

'use client'

import { ScoreComparisonTable } from '@/components/evolution-report-panel'
import {
  buildVersionHistory,
  type VersionScoreRow,
} from '@/lib/evolution-report'
import {
  ProjectBrain,
  summarizeProjectBrain,
} from '@/lib/project-brain'
import { useMemo, useState } from 'react'

function StatusLine({
  label,
  status,
}: {
  label: string
  status: string
}) {
  const ok =
    status === 'passed' ||
    status === 'not_testable' ||
    status === 'partial'
  const mark = ok ? '✓' : status === 'unknown' ? '·' : '✗'
  const tone = ok
    ? 'text-brand-accent'
    : status === 'unknown'
      ? 'text-muted-foreground'
      : 'text-destructive'
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5">
      <span className="font-mono text-[10px] tracking-[0.16em] uppercase text-muted-foreground">
        {label}
      </span>
      <span className={`font-mono text-[11px] ${tone}`}>
        <span className="mr-1.5">{mark}</span>
        {status}
      </span>
    </div>
  )
}

/**
 * Compact Project Brain overview + version history (metadata only).
 */
export function ProjectBrainPanel({ brain }: { brain: ProjectBrain | null }) {
  const [open, setOpen] = useState(true)
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null)
  const summary = useMemo(
    () => (brain ? summarizeProjectBrain(brain) : null),
    [brain],
  )
  const history = useMemo(
    () => (brain ? buildVersionHistory(brain) : []),
    [brain],
  )
  const selected: VersionScoreRow | undefined = history.find(
    (v) => v.version === selectedVersion,
  )

  if (!brain || !summary) return null

  return (
    <section className="mx-3 sm:mx-4 md:mx-6 mb-3 border border-border bg-background/80">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left hover:bg-foreground/[0.02]"
      >
        <span className="font-mono text-[10px] tracking-[0.22em] uppercase text-muted-foreground">
          Project Brain
        </span>
        <span className="font-display text-sm text-foreground truncate">
          {summary.productName}
        </span>
        <span className="font-mono text-[10px] text-muted-foreground shrink-0">
          {open ? '▾' : '▸'} v{summary.currentVersion || 0}
        </span>
      </button>

      {open && (
        <div className="px-3 pb-3 border-t border-border/70 space-y-3">
          {summary.purpose && (
            <div>
              <div className="font-mono text-[9px] tracking-[0.18em] uppercase text-muted-foreground mb-1">
                Purpose
              </div>
              <p className="text-[13px] leading-snug text-foreground/90">
                {summary.purpose}
              </p>
            </div>
          )}

          {summary.features.length > 0 && (
            <div>
              <div className="font-mono text-[9px] tracking-[0.18em] uppercase text-muted-foreground mb-1">
                Features
              </div>
              <ul className="space-y-0.5">
                {summary.features.map((f) => (
                  <li
                    key={f}
                    className="text-[12px] text-foreground/85 flex gap-2"
                  >
                    <span className="text-brand-accent shrink-0">✓</span>
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="border-t border-border/60 pt-2 space-y-0.5">
            <StatusLine label="Architecture" status={summary.architectureStatus} />
            <StatusLine label="Runtime" status={summary.runtimeStatus} />
            <StatusLine label="Smoke" status={summary.smokeStatus} />
            <div className="flex items-baseline justify-between gap-3 py-0.5">
              <span className="font-mono text-[10px] tracking-[0.16em] uppercase text-muted-foreground">
                Active version
              </span>
              <span className="font-mono text-[11px] text-foreground">
                v{brain.activeVersion || summary.currentVersion || 0}
                {brain.activeCandidateLabel
                  ? ` · ${brain.activeCandidateLabel}`
                  : summary.winnerLabel
                    ? ` · ${summary.winnerLabel}`
                    : ''}
              </span>
            </div>
          </div>

          {history.length > 0 && (
            <div className="border-t border-border/60 pt-2">
              <div className="font-mono text-[9px] tracking-[0.18em] uppercase text-muted-foreground mb-1.5">
                Version history
              </div>
              <ul className="space-y-1">
                {history.map((v, idx) => (
                  <li key={v.version}>
                    <button
                      type="button"
                      onClick={() =>
                        setSelectedVersion((cur) =>
                          cur === v.version ? null : v.version,
                        )
                      }
                      className={`w-full text-left flex items-baseline justify-between gap-2 px-1 py-0.5 hover:bg-foreground/[0.03] ${
                        selectedVersion === v.version
                          ? 'bg-foreground/[0.04]'
                          : ''
                      }`}
                    >
                      <span className="text-[12px] truncate">
                        <span className="font-mono text-muted-foreground mr-1.5">
                          v{v.version}
                        </span>
                        {v.label}
                        {v.isWinner ? ' 🏆' : ''}
                      </span>
                      <span className="font-mono text-[11px] text-muted-foreground shrink-0">
                        {v.score ?? '—'}
                      </span>
                    </button>
                    {idx < history.length - 1 && (
                      <div className="pl-3 text-[10px] text-muted-foreground/70 leading-none">
                        ↓
                      </div>
                    )}
                  </li>
                ))}
              </ul>

              {selected && (
                <div className="mt-2 border border-border/70 p-2 space-y-1 text-[12px]">
                  <div className="font-mono text-[9px] tracking-[0.16em] uppercase text-muted-foreground">
                    v{selected.version} metadata
                  </div>
                  <div>{selected.label}</div>
                  {selected.score != null && (
                    <div className="text-muted-foreground">Score {selected.score}</div>
                  )}
                  {selected.winnerLabel && (
                    <div className="text-muted-foreground">
                      Winner {selected.winnerLabel}
                    </div>
                  )}
                  {selected.parentVersion != null && (
                    <div className="text-muted-foreground">
                      Parent v{selected.parentVersion}
                      {selected.improvementDelta != null && (
                        <span>
                          {' '}
                          · Δ{' '}
                          {selected.improvementDelta >= 0 ? '+' : ''}
                          {selected.improvementDelta}
                        </span>
                      )}
                    </div>
                  )}
                  {selected.userRequest && (
                    <div className="text-muted-foreground">
                      “{selected.userRequest}”
                    </div>
                  )}
                  {selected.summary && (
                    <div className="text-muted-foreground leading-snug">
                      {selected.summary}
                    </div>
                  )}
                  {selected.runtime && (
                    <div className="text-muted-foreground">
                      Runtime {selected.runtime}
                    </div>
                  )}
                </div>
              )}

              {history.length >= 2 && (
                <div className="mt-2">
                  <ScoreComparisonTable
                    rows={history.slice(-2).map((r, i, arr) => ({
                      ...r,
                      isWinner: i === arr.length - 1,
                    }))}
                  />
                </div>
              )}
            </div>
          )}

          {summary.judgeReasoning && (
            <p className="text-[11px] text-muted-foreground leading-snug border-t border-border/60 pt-2">
              {summary.judgeReasoning}
            </p>
          )}
        </div>
      )}
    </section>
  )
}

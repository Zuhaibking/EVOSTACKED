'use client'

import type { Candidate } from '@/lib/tournament-client'
import type { VariantId } from '@/lib/tournament'
import { VARIANTS } from '@/lib/tournament'

function formatPct(n?: number) {
  if (n == null || Number.isNaN(n)) return '—'
  return `${Math.round(n * 100)}`
}

function runtimeLabel(c: Candidate): string {
  const status =
    c.finalVerification?.status || c.verification?.status || '—'
  if (status === 'passed' || status === 'partial') return '✓'
  if (status === 'failed') return '✗'
  return String(status)
}

function smokeLabel(c: Candidate): string {
  const status = c.smoke?.status
  if (!status) return '—'
  if (status === 'passed') return '✓'
  if (status === 'not_testable') return 'n/a'
  if (status === 'failed' || status === 'timeout') return '✗'
  return status
}

/**
 * Post-tournament picker: choose which specimen becomes the active project version.
 */
export function ActiveVersionPicker({
  candidates,
  activeId,
  onUseVersion,
  onPreview,
}: {
  candidates: Record<VariantId, Candidate>
  activeId?: VariantId
  onUseVersion: (id: VariantId) => void
  onPreview: (id: VariantId) => void
}) {
  const list = VARIANTS.map((v) => candidates[v.id]).filter(Boolean)
  if (list.length === 0) return null

  return (
    <section className="mx-3 sm:mx-4 md:mx-6 mb-3 border border-border bg-background/80">
      <div className="px-3 py-2 border-b border-border/70 flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] tracking-[0.22em] uppercase text-muted-foreground">
          Choose active version
        </span>
        {activeId && (
          <span className="font-mono text-[10px] text-brand-accent">
            {VARIANTS.find((v) => v.id === activeId)?.label} is active
          </span>
        )}
      </div>
      <div className="grid sm:grid-cols-3 gap-2 p-3">
        {list.map((c) => {
          const isActive = activeId === c.id
          return (
            <div
              key={c.id}
              className={`border p-2.5 space-y-2 ${
                isActive
                  ? 'border-brand-accent bg-brand-accent/5'
                  : 'border-border'
              }`}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-mono text-[11px] tracking-[0.14em] uppercase">
                  {c.label}
                </span>
                {c.isWinner && (
                  <span className="text-[10px] text-muted-foreground">Judge 🏆</span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 font-mono text-[10px] text-muted-foreground">
                <span>Score</span>
                <span className="text-foreground text-right">
                  {formatPct(c.scoreComposite)}
                </span>
                <span>Runtime</span>
                <span className="text-foreground text-right">{runtimeLabel(c)}</span>
                <span>Smoke</span>
                <span className="text-foreground text-right">{smokeLabel(c)}</span>
                <span>Judge</span>
                <span className="text-foreground text-right truncate">
                  {c.scoreComment || '—'}
                </span>
              </div>
              <div className="flex gap-1.5 pt-1">
                <button
                  type="button"
                  onClick={() => onPreview(c.id)}
                  className="flex-1 font-mono text-[10px] tracking-[0.12em] uppercase px-2 py-1 border border-border hover:bg-foreground/[0.03]"
                >
                  Preview
                </button>
                <button
                  type="button"
                  onClick={() => onUseVersion(c.id)}
                  className={`flex-1 font-mono text-[10px] tracking-[0.12em] uppercase px-2 py-1 border ${
                    isActive
                      ? 'border-brand-accent text-brand-accent'
                      : 'border-border bg-foreground text-background'
                  }`}
                >
                  {isActive ? 'Active' : 'Use this version'}
                </button>
              </div>
            </div>
          )
        })}
      </div>
      {!activeId && (
        <p className="px-3 pb-3 text-[12px] text-muted-foreground">
          Select a candidate to make it your active version before improving.
        </p>
      )}
    </section>
  )
}

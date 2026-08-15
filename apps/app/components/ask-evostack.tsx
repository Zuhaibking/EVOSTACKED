'use client'

import {
  applyAskQuickAction,
  applyDesignStarter,
  ASK_QUICK_ACTIONS,
  askEvoStackCostCopy,
  canSubmitAskEvoStack,
  composeAskEvoStackRequest,
  DESIGN_STARTER_PROMPTS,
  formatActiveVersionLabel,
  type AskEvoStackSuggestion,
  type AskRequestKind,
} from '@/lib/ask-evostack'
import { useId, useState } from 'react'

/**
 * Primary improvement command center — single-candidate Improve pipeline only.
 * Never auto-submits; no background API loops.
 */
export function AskEvoStack({
  enabled,
  busy,
  activeVersion,
  productName,
  suggestions,
  healthLabel,
  onSubmit,
}: {
  enabled: boolean
  busy?: boolean
  activeVersion?: number | null
  productName?: string | null
  /** Optional health-derived tips — fill input only. */
  suggestions?: AskEvoStackSuggestion[]
  healthLabel?: string | null
  onSubmit: (composedUserRequest: string, kind: AskRequestKind) => void
}) {
  const inputId = useId()
  const [text, setText] = useState('')
  const [kind, setKind] = useState<AskRequestKind>('general')
  const [designMode, setDesignMode] = useState(false)

  const hasActiveVersion =
    enabled && activeVersion != null && activeVersion >= 1
  const gate = canSubmitAskEvoStack({
    hasActiveVersion,
    text,
    busy,
  })
  const cost = askEvoStackCostCopy()
  const activeLabel = formatActiveVersionLabel({
    version: activeVersion,
    productName,
  })

  function selectQuickAction(next: AskRequestKind) {
    const applied = applyAskQuickAction(next)
    setKind(applied.kind)
    setDesignMode(applied.kind === 'design')
    setText(applied.seedText)
    // autoSubmit is always false — user must click Improve.
  }

  function selectDesignStarter(prompt: string) {
    const applied = applyDesignStarter(prompt)
    setKind(applied.kind)
    setDesignMode(true)
    setText(applied.seedText)
  }

  function selectSuggestion(s: AskEvoStackSuggestion) {
    setKind('general')
    setDesignMode(false)
    setText(s.text)
  }

  function submit() {
    if (!gate.ok || busy) return
    const composed = composeAskEvoStackRequest({ kind, text })
    onSubmit(composed.userRequest, kind)
    setText('')
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      submit()
    }
  }

  return (
    <section
      className="mx-3 sm:mx-4 md:mx-6 mb-3 border border-border bg-background/80"
      aria-label="Ask EvoStack"
    >
      <div className="px-3 py-2 border-b border-border/70 flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-[10px] tracking-[0.22em] uppercase text-muted-foreground">
          ✨ Ask EvoStack
        </span>
        <div className="flex flex-wrap items-center gap-2 font-mono text-[10px] text-muted-foreground">
          {healthLabel ? <span aria-label="App health">{healthLabel}</span> : null}
          {activeLabel ? (
            <span aria-live="polite">{activeLabel}</span>
          ) : (
            <span aria-live="polite">No active version</span>
          )}
        </div>
      </div>

      <div className="p-3 space-y-3">
        <label
          htmlFor={inputId}
          className="block text-[13px] text-foreground"
        >
          What do you want to change?
        </label>

        <textarea
          id={inputId}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={!hasActiveVersion || !!busy}
          rows={3}
          placeholder="Make the dashboard more modern…"
          aria-label="Improvement request"
          aria-disabled={!hasActiveVersion || !!busy}
          className="w-full resize-none bg-transparent border border-border px-2.5 py-2 text-[13px] leading-snug text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:ring-1 focus:ring-brand/40 disabled:opacity-50"
        />

        {!hasActiveVersion && (
          <p className="text-[12px] text-muted-foreground" role="status">
            Generate an app and choose <span className="text-foreground">Use this version</span> before asking EvoStack to improve it.
          </p>
        )}

        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Quick actions">
          {ASK_QUICK_ACTIONS.map((action) => {
            const isDesign = action.id === 'design'
            const active = isDesign
              ? designMode || kind === 'design'
              : kind === action.id
            return (
              <button
                key={action.id}
                type="button"
                disabled={!!busy}
                aria-pressed={active}
                onClick={() => selectQuickAction(action.id)}
                className={`font-mono text-[10px] tracking-[0.12em] uppercase px-2 py-1 border transition-colors disabled:opacity-40 ${
                  active
                    ? 'border-foreground bg-foreground text-background'
                    : 'border-border hover:bg-foreground/[0.03]'
                }`}
              >
                <span aria-hidden="true">{action.icon} </span>
                {action.label}
              </button>
            )
          })}
        </div>

        {(designMode || kind === 'design') && (
          <div className="space-y-1.5" aria-label="Design Mode starters">
            <div className="font-mono text-[9px] tracking-[0.18em] uppercase text-muted-foreground">
              Design Mode · starter prompts
            </div>
            <div className="flex flex-wrap gap-1.5">
              {DESIGN_STARTER_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  disabled={!!busy}
                  onClick={() => selectDesignStarter(prompt)}
                  className="text-left text-[11px] px-2 py-1 border border-dashed border-border hover:bg-foreground/[0.03] disabled:opacity-40"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        )}

        {suggestions && suggestions.length > 0 && hasActiveVersion && (
          <div className="space-y-1.5" aria-label="Suggested improvements">
            <div className="font-mono text-[9px] tracking-[0.18em] uppercase text-muted-foreground">
              Suggestions
            </div>
            <div className="flex flex-wrap gap-1.5">
              {suggestions.slice(0, 3).map((s) => (
                <button
                  key={s.id}
                  type="button"
                  disabled={!!busy}
                  onClick={() => selectSuggestion(s)}
                  className="text-[11px] px-2 py-1 border border-border hover:bg-foreground/[0.03] disabled:opacity-40"
                >
                  {s.title}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2 pt-1">
          <div className="space-y-0.5">
            <div className="text-[12px] text-foreground">✨ {cost.title}</div>
            <div className="font-mono text-[10px] text-muted-foreground">
              {cost.detail}
            </div>
          </div>
          <button
            type="button"
            disabled={!gate.ok || !!busy}
            onClick={submit}
            aria-label="Improve active application — 1 generation"
            className="font-mono text-[11px] tracking-[0.14em] uppercase px-3 py-1.5 border border-border bg-foreground text-background disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90"
          >
            {busy ? 'Improving…' : 'Improve →'}
          </button>
        </div>
      </div>
    </section>
  )
}

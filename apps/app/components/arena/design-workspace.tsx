'use client'

import {
  ASK_QUICK_ACTIONS,
  DESIGN_STARTER_PROMPTS,
  applyAskQuickAction,
  applyDesignStarter,
  type AskRequestKind,
} from '@/lib/ask-evostack'
import type { ReactNode } from 'react'

export function DesignWorkspace({
  chipsEnabled,
  askKind,
  onAskKindChange,
  onSeedText,
  children,
}: {
  chipsEnabled: boolean
  askKind: AskRequestKind | null
  onAskKindChange: (kind: AskRequestKind | null) => void
  onSeedText: (text: string) => void
  children?: ReactNode
}) {
  function toggleChip(next: AskRequestKind) {
    if (!chipsEnabled) return
    if (askKind === next) {
      onAskKindChange(null)
      return
    }
    const applied = applyAskQuickAction(next)
    onAskKindChange(applied.kind)
    onSeedText(applied.seedText)
  }

  return (
    <div className="h-full min-h-0 overflow-y-auto px-4 py-4 space-y-4">
      <div>
        <p className="font-mono text-[10px] tracking-[0.22em] uppercase text-muted-foreground">
          Design
        </p>
        <p className="mt-1 text-[13px] text-muted-foreground max-w-lg">
          Enhance the selected project from the command bar. These chips set the
          same Improve focus — they do not start a new generation.
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {ASK_QUICK_ACTIONS.map((action) => (
          <button
            key={action.id}
            type="button"
            disabled={!chipsEnabled}
            onClick={() => toggleChip(action.id)}
            className={`h-7 px-2.5 font-mono text-[9px] tracking-[0.18em] uppercase border transition-colors disabled:opacity-35 ${
              askKind === action.id
                ? 'border-foreground bg-foreground text-background'
                : 'border-border text-muted-foreground hover:text-foreground'
            }`}
          >
            {action.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {DESIGN_STARTER_PROMPTS.map((prompt) => (
          <button
            key={prompt}
            type="button"
            disabled={!chipsEnabled}
            onClick={() => {
              const applied = applyDesignStarter(prompt)
              onAskKindChange(applied.kind)
              onSeedText(applied.seedText)
            }}
            className="h-7 px-2.5 font-mono text-[10px] text-muted-foreground border border-border hover:text-foreground disabled:opacity-35"
          >
            {prompt}
          </button>
        ))}
      </div>

      {children ? <div className="[&>section]:mx-0 [&>section]:mb-0">{children}</div> : null}
    </div>
  )
}

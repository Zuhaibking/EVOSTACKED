'use client'

import { CodeView } from '@/components/code-view'
import { inspectGeneratedProjectDatabase } from '@/lib/generated-project-database'
import type { FragmentSchema } from '@/lib/schema'
import type { DeepPartial } from '@evostack/shared'
import { useMemo, useState } from 'react'

export function DatabaseWorkspace({
  fragment,
}: {
  fragment?: DeepPartial<FragmentSchema>
}) {
  const inspection = useMemo(
    () => inspectGeneratedProjectDatabase(fragment),
    [fragment],
  )
  const [selected, setSelected] = useState<string | null>(null)
  const active =
    inspection.files.find((f) => f.file_path === selected) || inspection.files[0]

  if (!inspection.configured) {
    return (
      <div className="h-full flex flex-col items-center justify-center px-6 text-center">
        <p className="font-mono text-[10px] tracking-[0.22em] uppercase text-muted-foreground">
          Database
        </p>
        <p className="mt-2 text-[14px] text-foreground">
          No database configured for this project.
        </p>
      </div>
    )
  }

  return (
    <div className="h-full min-h-0 flex">
      <aside className="w-[200px] shrink-0 border-r border-border overflow-y-auto">
        {inspection.models.length > 0 && (
          <div className="px-3 py-2 border-b border-border/70">
            <p className="font-mono text-[9px] tracking-[0.18em] uppercase text-muted-foreground mb-1">
              Models
            </p>
            {inspection.models.map((model) => (
              <p key={model} className="font-mono text-[11px] truncate">
                {model}
              </p>
            ))}
          </div>
        )}
        {inspection.files.map((file) => (
          <button
            key={file.file_path}
            type="button"
            onClick={() => setSelected(file.file_path)}
            className={`w-full text-left px-3 py-1.5 font-mono text-[10px] truncate ${
              active?.file_path === file.file_path
                ? 'bg-foreground/[0.06] text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {file.file_path}
          </button>
        ))}
      </aside>
      <div className="flex-1 min-w-0 overflow-auto">
        {active ? (
          <CodeView
            code={active.file_content}
            lang={active.file_path.split('.').pop() || 'txt'}
          />
        ) : null}
      </div>
    </div>
  )
}

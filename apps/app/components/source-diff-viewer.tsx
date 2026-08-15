'use client'

import type { FileDiff, SourceDiff } from '@/lib/source-diff'
import { useMemo, useState } from 'react'

/**
 * Compact source-diff browser: file lists + readable line comparison.
 */
export function SourceDiffViewer({
  diff,
  open,
  onClose,
}: {
  diff: SourceDiff | null
  open: boolean
  onClose: () => void
}) {
  const selectable = useMemo(
    () =>
      (diff?.files || []).filter(
        (f) =>
          f.status === 'added' ||
          f.status === 'removed' ||
          f.status === 'modified',
      ),
    [diff],
  )
  const [selectedPath, setSelectedPath] = useState<string | undefined>()
  const selected: FileDiff | undefined =
    selectable.find((f) => f.path === selectedPath) || selectable[0]

  if (!open || !diff) return null

  return (
    <div className="border border-border bg-background mt-2">
      <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 border-b border-border/70">
        <span className="font-mono text-[10px] tracking-[0.18em] uppercase text-muted-foreground">
          View changes
        </span>
        <button
          type="button"
          onClick={onClose}
          className="font-mono text-[10px] tracking-[0.12em] uppercase text-muted-foreground hover:text-foreground"
        >
          Close
        </button>
      </div>

      <div className="grid md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.4fr)] gap-0">
        <div className="border-b md:border-b-0 md:border-r border-border/70 p-2 space-y-2 max-h-56 overflow-auto">
          {diff.addedFiles.length > 0 && (
            <FileGroup
              title="Added"
              mark="+"
              paths={diff.addedFiles}
              selected={selected?.path}
              onSelect={setSelectedPath}
              tone="text-brand-accent"
            />
          )}
          {diff.modifiedFiles.length > 0 && (
            <FileGroup
              title="Modified"
              mark="~"
              paths={diff.modifiedFiles}
              selected={selected?.path}
              onSelect={setSelectedPath}
              tone="text-foreground"
            />
          )}
          {diff.removedFiles.length > 0 && (
            <FileGroup
              title="Removed"
              mark="-"
              paths={diff.removedFiles}
              selected={selected?.path}
              onSelect={setSelectedPath}
              tone="text-destructive"
            />
          )}
          {diff.addedFiles.length +
            diff.modifiedFiles.length +
            diff.removedFiles.length ===
            0 && (
            <p className="text-[12px] text-muted-foreground px-1">
              No file changes.
            </p>
          )}
          <div className="font-mono text-[10px] text-muted-foreground px-1 pt-1">
            +{diff.addedLines} / −{diff.removedLines} lines
          </div>
        </div>

        <div className="p-2 max-h-56 overflow-auto">
          {selected ? (
            <>
              <div className="font-mono text-[10px] text-muted-foreground mb-1 truncate">
                {selected.path} · {selected.status}
              </div>
              <pre className="text-[11px] leading-snug font-mono whitespace-pre-wrap break-words">
                {selected.lines.length === 0 && selected.status === 'unchanged'
                  ? 'Unchanged'
                  : selected.lines.map((line, idx) => (
                      <div
                        key={idx}
                        className={
                          line.type === 'add'
                            ? 'bg-brand-accent/10 text-foreground'
                            : line.type === 'remove'
                              ? 'bg-destructive/10 text-foreground'
                              : 'text-muted-foreground'
                        }
                      >
                        <span className="inline-block w-4 select-none opacity-70">
                          {line.type === 'add'
                            ? '+'
                            : line.type === 'remove'
                              ? '−'
                              : ' '}
                        </span>
                        {line.text || ' '}
                      </div>
                    ))}
              </pre>
            </>
          ) : (
            <p className="text-[12px] text-muted-foreground">
              Select a file to compare.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

function FileGroup({
  title,
  mark,
  paths,
  selected,
  onSelect,
  tone,
}: {
  title: string
  mark: string
  paths: string[]
  selected?: string
  onSelect: (path: string) => void
  tone: string
}) {
  return (
    <div>
      <div className="font-mono text-[9px] tracking-[0.16em] uppercase text-muted-foreground mb-0.5">
        {title}
      </div>
      <ul className="space-y-0.5">
        {paths.map((p) => (
          <li key={p}>
            <button
              type="button"
              onClick={() => onSelect(p)}
              className={`w-full text-left font-mono text-[11px] px-1 py-0.5 truncate ${tone} ${
                selected === p ? 'bg-foreground/[0.05]' : 'hover:bg-foreground/[0.03]'
              }`}
            >
              <span className="mr-1.5 opacity-70">{mark}</span>
              {p}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

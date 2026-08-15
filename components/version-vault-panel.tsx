'use client'

import { diffFragments } from '@/lib/source-diff'
import { SourceDiffViewer } from '@/components/source-diff-viewer'
import {
  buildVersionTree,
  getActiveVersion,
  getVersionSnapshot,
  listVersionSnapshots,
  type VersionSnapshot,
  type VersionTreeNode,
} from '@/lib/version-vault'
import { useMemo, useState } from 'react'

function scoreLabel(n?: number) {
  if (n == null || Number.isNaN(n)) return '—'
  return n <= 1 ? `${Math.round(n * 100)}` : `${Math.round(n)}`
}

function statusMark(status?: string) {
  if (!status) return '—'
  if (status === 'passed' || status === 'partial' || status === 'not_testable') {
    return '✓'
  }
  if (status === 'failed' || status === 'timeout') return '✗'
  return status
}

function TreeRows({
  nodes,
  depth,
  selected,
  onSelect,
}: {
  nodes: VersionTreeNode[]
  depth: number
  selected?: number
  onSelect: (v: number) => void
}) {
  return (
    <>
      {nodes.map((n, idx) => (
        <div key={n.version}>
          <button
            type="button"
            onClick={() => onSelect(n.version)}
            className={`w-full text-left flex items-baseline justify-between gap-2 px-1 py-0.5 hover:bg-foreground/[0.03] ${
              selected === n.version ? 'bg-foreground/[0.04]' : ''
            }`}
            style={{ paddingLeft: 4 + depth * 12 }}
          >
            <span className="text-[12px] truncate">
              {depth > 0 && (
                <span className="text-muted-foreground/70 mr-1">
                  {idx === nodes.length - 1 ? '└' : '├'}
                </span>
              )}
              <span className="font-mono text-muted-foreground mr-1.5">
                v{n.version}
              </span>
              {n.label}
              {n.isActive ? (
                <span className="ml-1.5 font-mono text-[9px] tracking-[0.12em] uppercase text-brand-accent">
                  Active
                </span>
              ) : null}
            </span>
          </button>
          {depth === 0 && nodes.length > 0 && n.children.length === 0 && idx < nodes.length - 1 && (
            <div className="pl-3 text-[10px] text-muted-foreground/70 leading-none">↓</div>
          )}
          {n.children.length > 0 && (
            <>
              <div
                className="text-[10px] text-muted-foreground/70 leading-none"
                style={{ paddingLeft: 10 + depth * 12 }}
              >
                ↓
              </div>
              <TreeRows
                nodes={n.children}
                depth={depth + 1}
                selected={selected}
                onSelect={onSelect}
              />
            </>
          )}
        </div>
      ))}
    </>
  )
}

/**
 * Compact Version Vault browser — local restore only (zero API calls).
 */
export function VersionVaultPanel({
  snapshots,
  activeVersion,
  onPreview,
  onRestore,
  refreshKey,
}: {
  snapshots: VersionSnapshot[]
  activeVersion?: number | null
  onPreview: (snapshot: VersionSnapshot) => void
  onRestore: (snapshot: VersionSnapshot) => void
  /** Bump to force re-read if parent manages list externally. */
  refreshKey?: number
}) {
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null)
  const [showDiff, setShowDiff] = useState(false)
  const [confirmRestore, setConfirmRestore] = useState(false)

  const active =
    activeVersion ??
    snapshots.find((s) => s.version === getActiveVersion())?.version ??
    null

  const tree = useMemo(
    () => buildVersionTree(snapshots, active),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [snapshots, active, refreshKey],
  )

  const selected =
    snapshots.find((s) => s.version === selectedVersion) ||
    snapshots.find((s) => s.version === active) ||
    snapshots[0]

  const activeSnap = snapshots.find((s) => s.version === active)
  const diff = useMemo(() => {
    if (!selected || !activeSnap || selected.version === activeSnap.version) {
      return null
    }
    return diffFragments(selected.fragment, activeSnap.fragment)
  }, [selected, activeSnap])

  if (!snapshots.length) return null

  return (
    <section className="mx-3 sm:mx-4 md:mx-6 mb-3 border border-border bg-background/80">
      <div className="px-3 py-2 border-b border-border/70 flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] tracking-[0.22em] uppercase text-muted-foreground">
          Version Vault
        </span>
        <span className="font-mono text-[10px] text-muted-foreground">
          {snapshots.length} saved
        </span>
      </div>

      <div className="grid md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] gap-0">
        <div className="p-2 border-b md:border-b-0 md:border-r border-border/70 max-h-64 overflow-auto">
          <TreeRows
            nodes={tree}
            depth={0}
            selected={selected?.version}
            onSelect={(v) => {
              setSelectedVersion(v)
              setShowDiff(false)
              setConfirmRestore(false)
            }}
          />
        </div>

        {selected && (
          <div className="p-3 space-y-2">
            <div className="font-mono text-[10px] tracking-[0.16em] uppercase text-muted-foreground">
              Version {selected.version}
              {selected.version === active ? ' · Active' : ''}
            </div>
            <div className="text-[13px] font-medium">{selected.label}</div>
            {selected.userRequest && (
              <p className="text-[12px] text-muted-foreground leading-snug">
                “{selected.userRequest}”
              </p>
            )}
            <div className="font-mono text-[11px] space-y-0.5 text-muted-foreground">
              <div>
                Score:{' '}
                <span className="text-foreground">
                  {scoreLabel(selected.compositeScore)}
                </span>
              </div>
              <div>
                Runtime:{' '}
                <span className="text-foreground">
                  {statusMark(selected.runtimeStatus)}
                </span>
              </div>
              <div>
                Smoke:{' '}
                <span className="text-foreground">
                  {statusMark(selected.smokeStatus)}
                </span>
              </div>
              {selected.parentVersion != null && (
                <div>Parent: v{selected.parentVersion}</div>
              )}
            </div>

            <div className="flex flex-wrap gap-1.5 pt-1">
              <button
                type="button"
                onClick={() => onPreview(selected)}
                className="font-mono text-[10px] tracking-[0.14em] uppercase px-2 py-1 border border-border hover:bg-foreground/[0.03]"
              >
                Preview
              </button>
              {diff && (
                <button
                  type="button"
                  onClick={() => setShowDiff((v) => !v)}
                  className="font-mono text-[10px] tracking-[0.14em] uppercase px-2 py-1 border border-border hover:bg-foreground/[0.03]"
                >
                  {showDiff ? 'Hide changes' : 'View changes'}
                </button>
              )}
              {selected.version !== active && (
                <button
                  type="button"
                  onClick={() => setConfirmRestore(true)}
                  className="font-mono text-[10px] tracking-[0.14em] uppercase px-2 py-1 border border-border bg-foreground text-background"
                >
                  Restore
                </button>
              )}
            </div>

            {confirmRestore && (
              <div className="border border-border/70 p-2 space-y-2 text-[12px]">
                <p>
                  Restore v{selected.version}? This becomes the active version for
                  Improve. Later versions are kept (branching). No API calls.
                </p>
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      onRestore(selected)
                      setConfirmRestore(false)
                    }}
                    className="font-mono text-[10px] tracking-[0.14em] uppercase px-2 py-1 border border-border bg-foreground text-background"
                  >
                    Confirm restore
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmRestore(false)}
                    className="font-mono text-[10px] tracking-[0.14em] uppercase px-2 py-1 border border-border"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {showDiff && diff && (
              <SourceDiffViewer
                diff={diff}
                open={showDiff}
                onClose={() => setShowDiff(false)}
              />
            )}
          </div>
        )}
      </div>
    </section>
  )
}

/** Convenience hook-free loader for parents that own storage. */
export function readVaultSnapshots(): VersionSnapshot[] {
  return listVersionSnapshots()
}

export function readVaultSnapshot(version: number): VersionSnapshot | null {
  return getVersionSnapshot(version)
}

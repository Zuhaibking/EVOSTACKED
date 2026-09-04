'use client'

import { CodeView } from './code-view'
import { CopyButton } from './ui/copy-button'
import { fragmentCodeText } from '@/lib/schema'
import { DeepPartial } from 'ai'
import { FragmentSchema } from '@/lib/schema'
import { useEffect, useState } from 'react'

type FileRow = { file_path: string; file_content: string }

export function ArenaCodeTab({
  projectId,
  candidateId,
  revision,
  fallback,
}: {
  projectId?: string
  candidateId?: string
  revision?: string
  fallback?: DeepPartial<FragmentSchema>
}) {
  const [files, setFiles] = useState<FileRow[]>([])
  const [active, setActive] = useState('')
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!projectId || !candidateId) {
      setFiles(fallbackFiles(fallback))
      setLoaded(true)
      return
    }
    let cancelled = false
    fetch(
      `/api/project-files?projectId=${encodeURIComponent(projectId)}&candidateId=${encodeURIComponent(candidateId)}`,
    )
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return
        const rows: FileRow[] = Array.isArray(data?.files)
          ? data.files
              .filter((f: FileRow) => f?.file_path)
              .map((f: FileRow) => ({
                file_path: f.file_path,
                file_content: f.file_content ?? '',
              }))
          : []
        setFiles(rows.length ? rows : fallbackFiles(fallback))
        setLoaded(true)
      })
      .catch(() => {
        if (cancelled) return
        setFiles(fallbackFiles(fallback))
        setLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [projectId, candidateId, revision, fallback?.file_path, fallback?.code])

  useEffect(() => {
    if (!files.length) {
      setActive('')
      return
    }
    if (!files.some((f) => f.file_path === active)) {
      setActive(files[0].file_path)
    }
  }, [files, active])

  const current = files.find((f) => f.file_path === active)
  const lang = (active.split('.').pop() || 'tsx').replace('htm', 'markup')

  if (!loaded) {
    return (
      <div className="h-full flex items-center justify-center font-mono text-[10px] tracking-[0.22em] uppercase text-muted-foreground">
        Loading files
      </div>
    )
  }

  if (!files.length) {
    return (
      <div className="h-full flex items-center justify-center px-6 text-center">
        <p className="text-[13px] text-muted-foreground">
          No persisted files yet. Generate a specimen first.
        </p>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0">
      <aside className="w-44 sm:w-52 shrink-0 border-r border-border overflow-y-auto bg-background/40">
        <p className="px-2.5 pt-2 pb-1 font-mono text-[9px] tracking-[0.22em] uppercase text-muted-foreground">
          Files
        </p>
        {files
          .slice()
          .sort((a, b) => a.file_path.localeCompare(b.file_path))
          .map((f) => {
            const parts = f.file_path.split('/')
            const depth = Math.max(0, parts.length - 1)
            const name = parts[parts.length - 1]
            const selected = f.file_path === active
            return (
              <button
                key={f.file_path}
                type="button"
                title={f.file_path}
                onClick={() => setActive(f.file_path)}
                className={`w-full text-left font-mono text-[10px] leading-tight truncate py-1.5 pr-2 ${
                  selected
                    ? 'bg-foreground text-background'
                    : 'text-muted-foreground hover:text-foreground hover:bg-foreground/[0.04]'
                }`}
                style={{ paddingLeft: 10 + depth * 8 }}
              >
                {name}
              </button>
            )
          })}
      </aside>
      <div className="flex-1 min-w-0 min-h-0 flex flex-col">
        <div className="shrink-0 flex items-center gap-2 px-2.5 h-8 border-b border-border/60">
          <span className="font-mono text-[10px] text-foreground truncate flex-1">
            {active}
          </span>
          <CopyButton
            content={current?.file_content || ''}
            className="text-muted-foreground hover:text-foreground h-7 w-7 rounded-none"
          />
        </div>
        <div className="flex-1 overflow-auto">
          <CodeView code={current?.file_content || ''} lang={lang} />
        </div>
      </div>
    </div>
  )
}

function fallbackFiles(fragment?: DeepPartial<FragmentSchema>): FileRow[] {
  if (!fragment?.file_path) return []
  const content = fragmentCodeText(fragment.code)
  if (!content) return []
  return [{ file_path: fragment.file_path, file_content: content }]
}

'use client'

import { CodeView } from './code-view'
import { Button } from './ui/button'
import { CopyButton } from './ui/copy-button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { ChevronRight, Download, FileCode2, Folder } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

type SourceFile = { name: string; content: string }
type FileNode = { name: string; path: string; children: FileNode[]; file?: SourceFile }

function sourceTree(files: SourceFile[]): FileNode[] {
  const roots: FileNode[] = []
  for (const file of files) {
    let nodes = roots
    const parts = file.name.split('/').filter(Boolean)
    for (let index = 0; index < parts.length; index++) {
      const path = parts.slice(0, index + 1).join('/')
      let node = nodes.find((item) => item.path === path)
      if (!node) {
        node = { name: parts[index], path, children: [] }
        nodes.push(node)
      }
      if (index === parts.length - 1) node.file = file
      nodes = node.children
    }
  }
  const sort = (nodes: FileNode[]) => {
    nodes.sort((a, b) => Number(Boolean(a.file)) - Number(Boolean(b.file)) || a.name.localeCompare(b.name))
    for (const node of nodes) sort(node.children)
  }
  sort(roots)
  return roots
}

function FileTree({ nodes, selected, onSelect }: { nodes: FileNode[]; selected: string; onSelect: (path: string) => void }) {
  return <ul className="space-y-0.5">
    {nodes.map((node) => <li key={node.path}>
      {node.file ? <button
        type="button"
        title={node.path}
        aria-pressed={selected === node.path}
        onClick={() => onSelect(node.path)}
        className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${selected === node.path ? 'bg-brand/10 text-brand' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
      >
        <FileCode2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="truncate">{node.name}</span>
      </button> : <details open className="[&[open]>summary>svg:first-child]:rotate-90">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-md px-1.5 py-1.5 text-xs text-foreground/80 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand [&::-webkit-details-marker]:hidden">
          <ChevronRight className="h-3 w-3 shrink-0 transition-transform" aria-hidden="true" />
          <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="truncate">{node.name}</span>
        </summary>
        <div className="ml-3 border-l border-border/70 pl-2">
          <FileTree nodes={node.children} selected={selected} onSelect={onSelect} />
        </div>
      </details>}
    </li>)}
  </ul>
}

export function FragmentCode({ files, onSelectedFileChange }: { files: SourceFile[]; onSelectedFileChange?: (path: string) => void }) {
  const [currentFile, setCurrentFile] = useState(files[0]?.name || '')
  const tree = useMemo(() => sourceTree(files), [files])
  const selected = files.find((file) => file.name === currentFile) ?? files[0]

  useEffect(() => {
    if (!files.some((file) => file.name === currentFile)) setCurrentFile(files[0]?.name || '')
  }, [files, currentFile])

  function download() {
    if (!selected) return
    const url = window.URL.createObjectURL(new Blob([selected.content], { type: 'text/plain' }))
    const a = document.createElement('a')
    a.href = url
    a.download = selected.name.split('/').pop() || selected.name
    a.click()
    window.URL.revokeObjectURL(url)
  }

  if (!selected) return null

  return <div className="flex h-full min-h-0 flex-col md:flex-row">
    <aside className="flex min-h-0 shrink-0 flex-col border-b border-border bg-muted/20 md:w-52 md:border-b-0 md:border-r">
      <div className="flex items-center justify-between px-3 py-3">
        <h3 className="text-xs font-medium text-foreground">Project files</h3>
        <span className="text-[11px] text-muted-foreground">{files.length}</span>
      </div>
      <nav aria-label="Project source files" className="min-h-0 max-h-36 overflow-y-auto px-2 pb-3 md:max-h-none md:flex-1">
        <FileTree nodes={tree} selected={selected.name} onSelect={(path) => { setCurrentFile(path); onSelectedFileChange?.(path) }} />
      </nav>
    </aside>
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-border bg-muted/10 px-3 py-2">
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground" title={selected.name}>{selected.name}</span>
        <TooltipProvider>
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild><CopyButton aria-label={`Copy ${selected.name}`} content={selected.content} className="h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground" /></TooltipTrigger>
            <TooltipContent side="bottom">Copy file</TooltipContent>
          </Tooltip>
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground" aria-label={`Download ${selected.name}`} onClick={download}><Download className="h-3.5 w-3.5" /></Button></TooltipTrigger>
            <TooltipContent side="bottom">Download file</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <CodeView code={selected.content} lang={selected.name.split('.').pop() || ''} />
      </div>
    </div>
  </div>
}

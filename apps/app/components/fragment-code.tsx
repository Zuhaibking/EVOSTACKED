import { CodeView } from './code-view'
import { Button } from './ui/button'
import { CopyButton } from './ui/copy-button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { Download, FileText } from 'lucide-react'
import { useMemo, useState } from 'react'

function fileLabel(path: string) {
  const parts = path.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] || path
}

export function FragmentCode({
  files,
}: {
  files: { name: string; content: string }[]
}) {
  const [currentFile, setCurrentFile] = useState(files[0]?.name)
  const currentFileContent = files.find(
    (file) => file.name === currentFile,
  )?.content

  function download(filename: string, content: string) {
    const blob = new Blob([content], { type: 'text/plain' })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.style.display = 'none'
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    window.URL.revokeObjectURL(url)
    document.body.removeChild(a)
  }

  const tree = useMemo(() => {
    return [...files].sort((a, b) => a.name.localeCompare(b.name))
  }, [files])

  const isMultiFile = files.length > 1

  if (files.length === 0) return null

  return (
    <div className="flex h-full min-h-0">
      {isMultiFile && (
        <aside className="w-[180px] shrink-0 border-r border-border overflow-y-auto">
          {tree.map((file) => (
            <button
              key={file.name}
              type="button"
              title={file.name}
              onClick={() => setCurrentFile(file.name)}
              className={`w-full flex items-center gap-1.5 px-2 py-1.5 text-left font-mono text-[10px] truncate ${
                file.name === currentFile
                  ? 'bg-foreground/[0.06] text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <FileText className="h-3 w-3 shrink-0" />
              <span className="truncate">{file.name}</span>
            </button>
          ))}
        </aside>
      )}
      <div className="flex flex-col flex-1 min-w-0 min-h-0">
        <div className="flex items-center gap-1 px-2 sm:px-2.5 py-1 border-b border-border/60 bg-background/40">
          <span className="flex-1 font-mono text-[10px] text-muted-foreground truncate">
            {currentFile ? fileLabel(currentFile) : ''}
          </span>
          <TooltipProvider>
            <Tooltip delayDuration={0}>
              <TooltipTrigger asChild>
                <CopyButton
                  content={currentFileContent || ''}
                  className="text-muted-foreground hover:text-foreground h-7 w-7 rounded-none"
                />
              </TooltipTrigger>
              <TooltipContent side="bottom">Copy</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <TooltipProvider>
            <Tooltip delayDuration={0}>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground hover:text-foreground h-7 w-7 rounded-none"
                  onClick={() =>
                    download(fileLabel(currentFile || 'file'), currentFileContent || '')
                  }
                >
                  <Download className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Download</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        <div className="flex-1 min-h-0 overflow-auto">
          <CodeView
            code={currentFileContent || ''}
            lang={currentFile?.split('.').pop() || ''}
          />
        </div>
      </div>
    </div>
  )
}

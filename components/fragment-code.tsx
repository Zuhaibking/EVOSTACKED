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
import { useState } from 'react'

export function FragmentCode({
  files,
}: {
  files: { name: string; content: string }[]
}) {
  const [currentFile, setCurrentFile] = useState(files[0].name)
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

  const isMultiFile = files.length > 1

  return (
    <div className="flex flex-col h-full">
      {/* Action strip — only the file tabs when there are multiple files; otherwise just a slim copy/download row. */}
      <div className="flex items-center gap-1 px-2 sm:px-2.5 py-1 border-b border-border/60 bg-background/40">
        {isMultiFile ? (
          <div className="flex flex-1 gap-1 overflow-x-auto">
            {files.map((file) => (
              <button
                key={file.name}
                type="button"
                className={`
                  inline-flex items-center gap-1.5 select-none cursor-pointer
                  font-mono text-[10px] tracking-[0.14em] px-2 py-0.5 border
                  ${
                    file.name === currentFile
                      ? 'border-foreground bg-foreground/[0.06] text-foreground'
                      : 'border-border text-muted-foreground hover:text-foreground hover:border-foreground/60'
                  }
                `}
                onClick={() => setCurrentFile(file.name)}
              >
                <FileText className="h-3 w-3" />
                {file.name}
              </button>
            ))}
          </div>
        ) : (
          <div className="flex-1" />
        )}
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
                onClick={() => download(currentFile, currentFileContent || '')}
              >
                <Download className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Download</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
      <div className="flex flex-col flex-1 overflow-x-auto">
        <CodeView
          code={currentFileContent || ''}
          lang={currentFile.split('.').pop() || ''}
        />
      </div>
    </div>
  )
}

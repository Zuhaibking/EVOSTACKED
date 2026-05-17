'use client'

import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { isFileInArray } from '@/lib/utils'
import { ArrowUp, Paperclip, Square, X } from 'lucide-react'
import { SetStateAction, useEffect, useMemo, useState } from 'react'
import TextareaAutosize from 'react-textarea-autosize'

export function ChatInput({
  retry,
  isErrored,
  errorMessage,
  isLoading,
  isRateLimited,
  stop,
  input,
  handleInputChange,
  handleSubmit,
  isMultiModal,
  files,
  handleFileChange,
  children,
}: {
  retry: () => void
  isErrored: boolean
  errorMessage: string
  isLoading: boolean
  isRateLimited: boolean
  stop: () => void
  input: string
  handleInputChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void
  handleSubmit: (e: React.FormEvent<HTMLFormElement>) => void
  isMultiModal: boolean
  files: File[]
  handleFileChange: (change: SetStateAction<File[]>) => void
  children: React.ReactNode
}) {
  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    handleFileChange((prev) => {
      const newFiles = Array.from(e.target.files || [])
      const uniqueFiles = newFiles.filter((file) => !isFileInArray(file, prev))
      return [...prev, ...uniqueFiles]
    })
  }

  function handleFileRemove(file: File) {
    handleFileChange((prev) => prev.filter((f) => f !== file))
  }

  function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const items = Array.from(e.clipboardData.items)

    for (const item of items) {
      if (item.type.indexOf('image') !== -1) {
        e.preventDefault()

        const file = item.getAsFile()
        if (file) {
          handleFileChange((prev) => {
            if (!isFileInArray(file, prev)) {
              return [...prev, file]
            }
            return prev
          })
        }
      }
    }
  }

  const [dragActive, setDragActive] = useState(false)

  function handleDrag(e: React.DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true)
    } else if (e.type === 'dragleave') {
      setDragActive(false)
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)

    const droppedFiles = Array.from(e.dataTransfer.files).filter((file) =>
      file.type.startsWith('image/'),
    )

    if (droppedFiles.length > 0) {
      handleFileChange((prev) => {
        const uniqueFiles = droppedFiles.filter(
          (file) => !isFileInArray(file, prev),
        )
        return [...prev, ...uniqueFiles]
      })
    }
  }

  const filePreview = useMemo(() => {
    if (files.length === 0) return null
    return Array.from(files).map((file) => {
      return (
        <div className="relative" key={file.name}>
          <span
            onClick={() => handleFileRemove(file)}
            className="absolute -top-1.5 -right-1.5 bg-foreground text-background rounded-full p-0.5 cursor-pointer"
          >
            <X className="h-2.5 w-2.5" />
          </span>
          <img
            src={URL.createObjectURL(file)}
            alt={file.name}
            className="rounded-none w-8 h-8 object-cover border border-border"
          />
        </div>
      )
    })
  }, [files])

  function onEnter(e: React.KeyboardEvent<HTMLFormElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      if (e.currentTarget.checkValidity()) {
        handleSubmit(e)
      } else {
        e.currentTarget.reportValidity()
      }
    }
  }

  useEffect(() => {
    if (!isMultiModal) {
      handleFileChange([])
    }
  }, [isMultiModal])

  return (
    <form
      onSubmit={handleSubmit}
      onKeyDown={onEnter}
      className="mb-3 mt-auto pt-3 flex flex-col bg-background"
      onDragEnter={isMultiModal ? handleDrag : undefined}
      onDragLeave={isMultiModal ? handleDrag : undefined}
      onDragOver={isMultiModal ? handleDrag : undefined}
      onDrop={isMultiModal ? handleDrop : undefined}
    >
      {isErrored && (
        <div
          className={`flex items-center text-[12px] font-mono tracking-[0.06em] px-3 py-2 mb-2 border ${
            isRateLimited
              ? 'border-orange-400/40 bg-orange-400/10 text-orange-500'
              : 'border-red-400/40 bg-red-400/10 text-red-500'
          }`}
        >
          <span className="flex-1">{errorMessage}</span>
          <button
            type="button"
            className={`ml-2 px-2 py-0.5 border text-[10px] uppercase tracking-[0.18em] ${
              isRateLimited
                ? 'border-orange-400/60 hover:bg-orange-400/20'
                : 'border-red-400/60 hover:bg-red-400/20'
            }`}
            onClick={retry}
          >
            Retry
          </button>
        </div>
      )}

      <div className="relative">
        {/* Brutalist offset block shadow */}
        <div
          aria-hidden
          className="absolute inset-0 translate-x-1 translate-y-1 bg-foreground/10 pointer-events-none"
        />
        <div
          className={`relative z-10 bg-card border border-foreground transition-colors ${
            dragActive ? 'ring-2 ring-brand ring-offset-0' : ''
          }`}
        >
          {/* Composer surface — no header, just typing space */}
          <div className="relative">
            <TextareaAutosize
              autoFocus
              minRows={2}
              maxRows={6}
              className="font-display text-[17px] sm:text-[18px] leading-[1.35] px-4 sm:px-5 pt-4 pb-3 resize-none ring-0 bg-inherit w-full m-0 outline-none placeholder:font-display placeholder:italic placeholder:text-muted-foreground/55"
              required
              placeholder="Describe a project, a constraint, an iteration…"
              disabled={isErrored}
              value={input}
              onChange={handleInputChange}
              onPaste={isMultiModal ? handlePaste : undefined}
            />
            {/* Editorial gutter mark */}
            <span
              aria-hidden
              className="hidden sm:block absolute left-1.5 top-3.5 font-display italic text-[13px] text-muted-foreground/40 select-none"
            >
              ¶
            </span>
          </div>

          {/* Footer: pickers (left) · attachments · send (right) */}
          <div className="flex items-center gap-2 px-2.5 sm:px-3 py-2 border-t border-border/70 bg-background/40">
            {/* Pickers cluster — children are <ChatPicker /> + <ChatSettings /> */}
            <div className="flex items-center gap-1 sm:gap-1.5 flex-1 min-w-0 overflow-hidden">
              {children}
            </div>

            {/* Attach */}
            <input
              type="file"
              id="multimodal"
              name="multimodal"
              accept="image/*"
              multiple
              className="hidden"
              onChange={handleFileInput}
            />
            {files.length > 0 && (
              <div className="flex items-center gap-1.5 shrink-0">{filePreview}</div>
            )}
            <TooltipProvider>
              <Tooltip delayDuration={0}>
                <TooltipTrigger asChild>
                  <Button
                    disabled={!isMultiModal || isErrored}
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="rounded-none h-7 w-7 sm:h-8 sm:w-8 text-muted-foreground hover:text-foreground shrink-0"
                    onClick={(e) => {
                      e.preventDefault()
                      document.getElementById('multimodal')?.click()
                    }}
                  >
                    <Paperclip className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Attach image</TooltipContent>
              </Tooltip>
            </TooltipProvider>

            {/* Dispatch / Halt */}
            {!isLoading ? (
              <Button
                disabled={isErrored}
                size="sm"
                type="submit"
                className="
                  group rounded-none font-mono text-[10px] sm:text-[11px] tracking-[0.22em] uppercase
                  h-7 sm:h-8 px-2.5 sm:px-3 shrink-0
                  bg-foreground text-background border border-foreground
                  hover:bg-brand hover:text-brand-foreground hover:border-brand
                  transition-colors
                "
              >
                <span className="hidden sm:inline">Dispatch</span>
                <span className="sm:hidden">Send</span>
                <ArrowUp className="h-3 w-3 sm:h-3.5 sm:w-3.5 ml-1 sm:ml-1.5 transition-transform group-hover:-translate-y-0.5" />
              </Button>
            ) : (
              <Button
                size="sm"
                variant="secondary"
                type="button"
                onClick={(e) => {
                  e.preventDefault()
                  stop()
                }}
                className="
                  rounded-none font-mono text-[10px] sm:text-[11px] tracking-[0.22em] uppercase
                  h-7 sm:h-8 px-2.5 sm:px-3 shrink-0
                  border border-foreground
                "
              >
                Halt
                <Square className="h-3 w-3 sm:h-3.5 sm:w-3.5 ml-1 sm:ml-1.5" />
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Tight footnote — single line, low-key */}
      <p className="mt-2 font-mono text-[9px] tracking-[0.2em] uppercase text-muted-foreground/60 text-center">
        ⌘+enter to dispatch · Apache-2.0 ·{' '}
        <a
          href="https://github.com/e2b-dev/fragments"
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-foreground transition-colors underline underline-offset-2 decoration-border hover:decoration-foreground"
        >
          forked from e2b
        </a>
      </p>
    </form>
  )
}

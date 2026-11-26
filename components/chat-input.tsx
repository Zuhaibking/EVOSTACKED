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
          <button
            type="button"
            aria-label={`Remove ${file.name}`}
            onClick={() => handleFileRemove(file)}
            className="absolute -right-1.5 -top-1.5 rounded-full bg-foreground p-0.5 text-background shadow-xs transition-transform hover:scale-110"
          >
            <X className="h-2.5 w-2.5" />
          </button>
          <img
            src={URL.createObjectURL(file)}
            alt={file.name}
            className="h-10 w-10 rounded-md border border-border object-cover"
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
      className="mt-auto flex flex-col"
      onDragEnter={isMultiModal ? handleDrag : undefined}
      onDragLeave={isMultiModal ? handleDrag : undefined}
      onDragOver={isMultiModal ? handleDrag : undefined}
      onDrop={isMultiModal ? handleDrop : undefined}
    >
      {isErrored && (
        <div
          role="alert"
          className={`mb-2 flex items-center gap-2 rounded-lg border px-3 py-2 text-xs leading-relaxed ${
            isRateLimited
              ? 'border-orange-400/40 bg-orange-400/10 text-orange-500'
              : 'border-red-400/40 bg-red-400/10 text-red-500'
          }`}
        >
          <span className="flex-1">{errorMessage}</span>
          <button
            type="button"
            className={`shrink-0 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
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
        <div
          className={`relative z-10 overflow-hidden rounded-xl border border-border bg-card shadow-xs transition-[border-color,box-shadow] duration-150 focus-within:border-ring/60 focus-within:ring-4 focus-within:ring-ring/10 ${
            dragActive ? 'border-ring ring-4 ring-ring/20' : ''
          }`}
        >
          {/* Composer surface — no header, just typing space */}
          <div className="relative">
            <TextareaAutosize
              autoFocus
              minRows={2}
              maxRows={6}
              className="m-0 block w-full resize-none bg-inherit px-4 pb-2 pt-3.5 text-sm leading-6 outline-none ring-0 placeholder:text-muted-foreground focus-visible:outline-none"
              required
              placeholder="Describe your idea, or tell us what to change…"
              disabled={isErrored}
              value={input}
              onChange={handleInputChange}
              onPaste={isMultiModal ? handlePaste : undefined}
            />
            {files.length > 0 && (
              <div className="flex flex-wrap items-center gap-2.5 px-4 pb-3 pt-1">{filePreview}</div>
            )}
          </div>

          {/* Footer: pickers (left) · attachments · send (right) */}
          <div className="flex items-center gap-1 px-2 pb-2 pt-1">
            {/* Pickers cluster — children are <ChatPicker /> + <ChatSettings /> */}
            <div className="flex min-w-0 flex-1 items-center gap-1">
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
            <TooltipProvider>
              <Tooltip delayDuration={0}>
                <TooltipTrigger asChild>
                  <Button
                    disabled={!isMultiModal || isErrored}
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Attach image"
                    className="h-8 w-8 shrink-0 rounded-md text-muted-foreground hover:text-foreground"
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
                disabled={isErrored || input.trim().length === 0}
                size="sm"
                type="submit"
                aria-label="Send prompt"
                className="group ml-0.5 h-8 w-8 shrink-0 rounded-lg bg-brand-accent p-0 text-brand-accent-foreground hover:bg-brand-accent/90 active:bg-brand-accent/80 disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100"
              >
                <ArrowUp className="h-4 w-4 transition-transform group-hover:-translate-y-0.5" />
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
                className="ml-0.5 h-8 shrink-0 gap-1.5 rounded-lg border border-border px-2.5 text-xs font-medium"
              >
                Stop
                <Square className="h-3 w-3" />
              </Button>
            )}
          </div>
        </div>
      </div>

      <p className="mt-2 hidden text-center text-[11px] text-muted-foreground sm:block">
        <kbd className="font-sans font-medium text-foreground/80">Enter</kbd> to send ·{' '}
        <kbd className="font-sans font-medium text-foreground/80">Shift + Enter</kbd> for a new line
      </p>
    </form>
  )
}

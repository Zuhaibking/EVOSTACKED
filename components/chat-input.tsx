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
            className="absolute top-[-8] right-[-8] bg-muted rounded-full p-1"
          >
            <X className="h-3 w-3 cursor-pointer" />
          </span>
          <img
            src={URL.createObjectURL(file)}
            alt={file.name}
            className="rounded-xl w-10 h-10 object-cover"
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
      className="mb-2 mt-auto flex flex-col bg-background"
      onDragEnter={isMultiModal ? handleDrag : undefined}
      onDragLeave={isMultiModal ? handleDrag : undefined}
      onDragOver={isMultiModal ? handleDrag : undefined}
      onDrop={isMultiModal ? handleDrop : undefined}
    >
      {isErrored && (
        <div
          className={`flex items-center p-1.5 text-sm font-medium mx-4 mb-10 rounded-xl ${
            isRateLimited
              ? 'bg-orange-400/10 text-orange-400'
              : 'bg-red-400/10 text-red-400'
          }`}
        >
          <span className="flex-1 px-1.5">{errorMessage}</span>
          <button
            className={`px-2 py-1 rounded-sm ${
              isRateLimited ? 'bg-orange-400/20' : 'bg-red-400/20'
            }`}
            onClick={retry}
          >
            Try again
          </button>
        </div>
      )}
      <div className="relative">
        {/* offset block shadow */}
        <div
          aria-hidden
          className="absolute inset-0 translate-x-1 translate-y-1 bg-foreground/10 pointer-events-none"
        />
        <div
          className={`relative z-10 bg-card border border-foreground ${
            dragActive
              ? 'before:absolute before:inset-0 before:border-2 before:border-dashed before:border-brand'
              : ''
          }`}
        >
          <header className="flex items-center justify-between border-b border-border px-3 py-1.5 bg-background/40">
            <span className="font-mono text-[10px] tracking-[0.24em] uppercase text-muted-foreground">
              § Brief · Single candidate
            </span>
            <div className="flex items-center gap-2">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full rounded-full bg-brand-accent opacity-75 animate-ping" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-brand-accent" />
              </span>
              <span className="font-mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground">
                Ready
              </span>
            </div>
          </header>
          <div className="flex items-center px-3 py-2 gap-1 border-b border-border/60">{children}</div>
          <TextareaAutosize
            autoFocus={true}
            minRows={1}
            maxRows={5}
            className="font-display text-lg leading-snug px-4 py-3 resize-none ring-0 bg-inherit w-full m-0 outline-none placeholder:font-display placeholder:italic placeholder:text-muted-foreground/60"
            required={true}
            placeholder="Describe a project, a constraint, an iteration…"
            disabled={isErrored}
            value={input}
            onChange={handleInputChange}
            onPaste={isMultiModal ? handlePaste : undefined}
          />
          <div className="flex p-3 gap-2 items-center border-t border-border/60 bg-background/40">
            <input
              type="file"
              id="multimodal"
              name="multimodal"
              accept="image/*"
              multiple={true}
              className="hidden"
              onChange={handleFileInput}
            />
            <div className="flex items-center flex-1 gap-2">
              <TooltipProvider>
                <Tooltip delayDuration={0}>
                  <TooltipTrigger asChild>
                    <Button
                      disabled={!isMultiModal || isErrored}
                      type="button"
                      variant="outline"
                      size="icon"
                      className="rounded-none h-9 w-9 border-border"
                      onClick={(e) => {
                        e.preventDefault()
                        document.getElementById('multimodal')?.click()
                      }}
                    >
                      <Paperclip className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Attach image</TooltipContent>
                </Tooltip>
              </TooltipProvider>
              {files.length > 0 && filePreview}
            </div>
            <div>
              {!isLoading ? (
                <TooltipProvider>
                  <Tooltip delayDuration={0}>
                    <TooltipTrigger asChild>
                      <Button
                        disabled={isErrored}
                        size="sm"
                        type="submit"
                        className="rounded-none font-mono text-[11px] tracking-[0.2em] uppercase h-9 px-3 bg-foreground text-background hover:bg-brand hover:text-brand-foreground"
                      >
                        Submit
                        <ArrowUp className="h-3.5 w-3.5 ml-1.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Submit specimen</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              ) : (
                <TooltipProvider>
                  <Tooltip delayDuration={0}>
                    <TooltipTrigger asChild>
                      <Button
                        size="sm"
                        variant="secondary"
                        className="rounded-none font-mono text-[11px] tracking-[0.2em] uppercase h-9 px-3"
                        onClick={(e) => {
                          e.preventDefault()
                          stop()
                        }}
                      >
                        Halt
                        <Square className="h-3.5 w-3.5 ml-1.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Halt generation</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
            </div>
          </div>
        </div>
      </div>
      <p className="mt-3 font-mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground/80 text-center">
        EvoStack · Apache-2.0 · Forked from{' '}
        <a
          href="https://github.com/e2b-dev/fragments"
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-4 decoration-border hover:text-foreground hover:decoration-foreground"
        >
          E2B Fragments
        </a>
      </p>
    </form>
  )
}

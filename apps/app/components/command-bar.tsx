'use client'

import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  ASK_QUICK_ACTIONS,
  applyAskQuickAction,
  type AskRequestKind,
} from '@/lib/ask-evostack'
import { isFileInArray } from '@/lib/utils'
import { ArrowUp, Paperclip, Square, X } from 'lucide-react'
import { SetStateAction, useEffect, useMemo, useState } from 'react'
import TextareaAutosize from 'react-textarea-autosize'

export function CommandBar({
  retry,
  isErrored,
  errorMessage,
  isLoading,
  isRateLimited,
  stop,
  input,
  handleInputChange,
  onDispatch,
  isMultiModal,
  files,
  handleFileChange,
  chipsEnabled,
  askKind,
  onAskKindChange,
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
  onDispatch: (
    e: React.FormEvent<HTMLFormElement>,
    kind: AskRequestKind | null,
  ) => void
  isMultiModal: boolean
  files: File[]
  handleFileChange: (change: SetStateAction<File[]>) => void
  chipsEnabled: boolean
  askKind: AskRequestKind | null
  onAskKindChange: (kind: AskRequestKind | null) => void
  children: React.ReactNode
}) {
  const [dragActive, setDragActive] = useState(false)

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
          handleFileChange((prev) =>
            isFileInArray(file, prev) ? prev : [...prev, file],
          )
        }
      }
    }
  }

  function handleDrag(e: React.DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true)
    } else {
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

  function toggleChip(next: AskRequestKind) {
    if (!chipsEnabled) return
    if (askKind === next) {
      onAskKindChange(null)
      return
    }
    const applied = applyAskQuickAction(next)
    onAskKindChange(applied.kind)
    handleInputChange({
      target: { value: applied.seedText },
    } as React.ChangeEvent<HTMLTextAreaElement>)
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLFormElement>) {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      if (e.currentTarget.checkValidity())
        onDispatch(e, chipsEnabled ? askKind : null)
      return
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (e.currentTarget.checkValidity())
        onDispatch(e, chipsEnabled ? askKind : null)
      else e.currentTarget.reportValidity()
    }
  }

  const filePreview = useMemo(() => {
    if (files.length === 0) return null
    return Array.from(files).map((file) => (
      <div className="relative" key={file.name}>
        <button
          type="button"
          onClick={() => handleFileRemove(file)}
          className="absolute -top-1.5 -right-1.5 bg-foreground text-background rounded-full p-0.5"
          aria-label={`Remove ${file.name}`}
        >
          <X className="h-2.5 w-2.5" />
        </button>
        <img
          src={URL.createObjectURL(file)}
          alt={file.name}
          className="w-8 h-8 object-cover border border-border"
        />
      </div>
    ))
  }, [files])

  useEffect(() => {
    if (!isMultiModal) handleFileChange([])
  }, [isMultiModal])

  useEffect(() => {
    if (!chipsEnabled && askKind) onAskKindChange(null)
  }, [chipsEnabled, askKind, onAskKindChange])

  return (
    <form
      onSubmit={(e) => onDispatch(e, chipsEnabled ? askKind : null)}
      onKeyDown={onKeyDown}
      className="shrink-0 border-t border-border arena-glass px-3 sm:px-4 py-2"
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
            className="ml-2 px-2 py-0.5 border text-[10px] uppercase tracking-[0.18em] border-current"
            onClick={retry}
          >
            Retry
          </button>
        </div>
      )}

      <div
        className={`border border-border bg-card/80 ${
          dragActive ? 'ring-1 ring-brand' : ''
        }`}
      >
        <TextareaAutosize
          autoFocus
          minRows={1}
          maxRows={4}
          className="font-display text-[15px] sm:text-[16px] leading-[1.35] px-4 pt-2.5 pb-1.5 resize-none ring-0 bg-transparent w-full outline-none placeholder:text-muted-foreground/55"
          required
          placeholder="What do you want to build or change?"
          disabled={isErrored}
          value={input}
          onChange={handleInputChange}
          onPaste={isMultiModal ? handlePaste : undefined}
        />

        <div className="flex flex-wrap items-center gap-2 px-2.5 py-1.5 border-t border-border/70">
          <div className="flex items-center gap-1 flex-wrap min-w-0">
            {ASK_QUICK_ACTIONS.map((action) => (
              <button
                key={action.id}
                type="button"
                disabled={!chipsEnabled || isErrored}
                onClick={() => toggleChip(action.id)}
                className={`h-6 px-2 font-mono text-[9px] tracking-[0.18em] uppercase border transition-colors disabled:opacity-35 ${
                  askKind === action.id
                    ? 'border-foreground bg-foreground text-background'
                    : 'border-border text-muted-foreground hover:text-foreground'
                }`}
              >
                {action.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1 sm:gap-1.5 flex-1 min-w-0 overflow-hidden">
            {children}
          </div>

          <input
            type="file"
            id="arena-multimodal"
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
                  className="rounded-none h-7 w-7 text-muted-foreground hover:text-foreground shrink-0"
                  onClick={() =>
                    document.getElementById('arena-multimodal')?.click()
                  }
                >
                  <Paperclip className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Attach image</TooltipContent>
            </Tooltip>
          </TooltipProvider>

          {!isLoading ? (
            <Button
              disabled={isErrored}
              size="sm"
              type="submit"
              className="rounded-none font-mono text-[10px] tracking-[0.22em] uppercase h-7 px-2.5 shrink-0 bg-foreground text-background border border-foreground hover:bg-brand hover:text-brand-foreground hover:border-brand"
            >
              Dispatch
              <ArrowUp className="h-3 w-3 ml-1.5" />
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
              className="rounded-none font-mono text-[10px] tracking-[0.22em] uppercase h-7 px-2.5 shrink-0 border border-foreground"
            >
              Halt
              <Square className="h-3 w-3 ml-1.5" />
            </Button>
          )}
        </div>
      </div>
    </form>
  )
}

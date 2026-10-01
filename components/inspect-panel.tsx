'use client'

import { Button } from '@/components/ui/button'
import {
  INSPECT_PILLS,
  InspectDraft,
  InspectSelection,
  draftDirty,
  locateProjectSourceSnippet,
  pillInstruction,
  serializeInspectApply,
  toColorInput,
} from '@/lib/inspect'
import { FragmentSchema } from '@/lib/schema'
import { DeepPartial } from 'ai'
import {
  Check,
  Crosshair,
  Eye,
  EyeOff,
  Redo2,
  RotateCcw,
  Trash2,
  Undo2,
  X,
} from 'lucide-react'
import { KeyboardEvent, ReactNode, useMemo, useState } from 'react'

const WEIGHTS = [
  { v: '400', l: 'Regular' },
  { v: '500', l: 'Medium' },
  { v: '600', l: 'Semi Bold' },
  { v: '700', l: 'Bold' },
]

const SHADOWS = [
  { v: 'none', l: 'None' },
  { v: '0 1px 2px rgb(0 0 0 / 0.12)', l: 'Small' },
  { v: '0 8px 24px rgb(0 0 0 / 0.18)', l: 'Medium' },
  { v: '0 18px 40px rgb(0 0 0 / 0.28)', l: 'Large' },
]

function Field({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <label className="flex flex-col gap-1 min-w-0">
      <span className="font-mono text-[9px] tracking-[0.18em] uppercase text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  )
}

const fieldClass =
  'h-8 w-full rounded-none border border-border bg-background px-2 font-mono text-[11px] outline-none focus:border-brand disabled:opacity-50'

function patch(
  draft: InspectDraft,
  key: keyof InspectDraft,
  value: InspectDraft[keyof InspectDraft],
) {
  return { ...draft, [key]: value }
}

export function InspectPanel({
  selection,
  draft,
  baseline,
  fragment,
  filePath,
  applying,
  error,
  compare,
  canUndo,
  canRedo,
  onClose,
  onReselect,
  onDraft,
  onApply,
  onUndo,
  onRedo,
  onReset,
  onDelete,
  onCompare,
  onGuides,
  guides,
}: {
  selection: InspectSelection | null
  draft: InspectDraft | null
  baseline: InspectDraft | null
  fragment?: DeepPartial<FragmentSchema>
  filePath?: string
  applying: boolean
  error?: string
  compare: boolean
  canUndo?: boolean
  canRedo?: boolean
  onClose: () => void
  onReselect: () => void
  onDraft: (draft: InspectDraft) => void
  onApply: (instruction: string, targetFile?: string) => void
  onUndo?: () => void
  onRedo?: () => void
  onReset?: () => void
  onDelete?: () => void
  onCompare: (on: boolean) => void
  onGuides?: (on: boolean) => void
  guides: boolean
}) {
  const [instruction, setInstruction] = useState('')
  const source = useMemo(
    () => locateProjectSourceSnippet(fragment, selection, filePath),
    [fragment, filePath, selection],
  )
  const dirty = draftDirty(baseline, draft)
  const canApply = Boolean(selection && draft && (dirty || instruction.trim()) && !applying)

  function set<K extends keyof InspectDraft>(key: K, value: InspectDraft[K]) {
    if (!draft) return
    onDraft(patch(draft, key, value))
  }

  function applyNow() {
    if (!selection || !draft || !baseline || !canApply) return
    onApply(serializeInspectApply(selection, baseline, draft, instruction), source.line || filePath ? source.filePath : undefined)
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      applyNow()
    }
  }

  return (
    <aside className="flex flex-col h-full min-h-0 w-[min(100%,20.5rem)] shrink-0 border-l border-border bg-background">
      <header className="shrink-0 flex items-center gap-2 px-3 h-10 border-b border-border">
        <span className="inline-flex items-center h-5 px-1.5 font-mono text-[10px] tracking-[0.12em] uppercase bg-brand text-brand-foreground">
          {selection?.tag || 'inspect'}
          {selection ? (
            <button
              type="button"
              className="ml-1 opacity-70 hover:opacity-100"
              aria-label="Clear selection"
              onClick={onReselect}
            >
              <X className="h-2.5 w-2.5" />
            </button>
          ) : null}
        </span>
        <span className="flex-1 min-w-0 truncate font-mono text-[10px] text-muted-foreground">
          {selection?.selector || 'Click an element in Preview'}
        </span>
        <button
          type="button"
          onClick={onReselect}
          className="h-7 w-7 inline-flex items-center justify-center text-muted-foreground hover:text-foreground"
          aria-label="Select element"
        >
          <Crosshair className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={onClose}
          className="h-7 w-7 inline-flex items-center justify-center text-muted-foreground hover:text-foreground"
          aria-label="Close inspect"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto">
        <section className="px-3 py-3 border-b border-border/70 space-y-2">
          <p className="font-mono text-[9px] tracking-[0.22em] uppercase text-muted-foreground">
            Source
          </p>
          <p className="font-mono text-[11px] truncate" title={source.filePath}>
            {source.filePath || '—'}
            {source.line ? `:${source.line}` : ''}
          </p>
          {source.snippet ? (
            <pre className="text-[10px] leading-relaxed whitespace-pre-wrap text-muted-foreground bg-muted/40 px-2 py-1.5">
              {source.snippet}
            </pre>
          ) : (
            <p className="text-[11px] text-muted-foreground">
              {selection
                ? 'No exact source match. Apply still patches this element.'
                : 'Select an element to locate it in source.'}
            </p>
          )}
        </section>

        <section className="px-3 py-3 border-b border-border/70 space-y-2">
          <p className="font-mono text-[9px] tracking-[0.22em] uppercase text-muted-foreground">
            Content
          </p>
          <textarea
            value={draft?.text ?? ''}
            disabled={!draft || applying}
            onChange={(e) => set('text', e.target.value)}
            rows={3}
            placeholder="Type the new text here, or click the element in Preview and type there."
            className="w-full resize-none rounded-none border border-border bg-background px-2 py-1.5 text-[12px] leading-relaxed outline-none focus:border-brand placeholder:text-muted-foreground disabled:opacity-50"
          />
        </section>

        <section className="px-3 py-3 border-b border-border/70 space-y-2.5">
          <p className="font-mono text-[9px] tracking-[0.22em] uppercase text-muted-foreground">
            Typography
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Font">
              <input
                className={fieldClass}
                disabled={!draft || applying}
                value={draft?.fontFamily ?? ''}
                onChange={(e) => set('fontFamily', e.target.value)}
              />
            </Field>
            <Field label="Size">
              <input
                className={fieldClass}
                disabled={!draft || applying}
                value={draft?.fontSize ?? ''}
                onChange={(e) => set('fontSize', e.target.value)}
              />
            </Field>
            <Field label="Weight">
              <select
                className={fieldClass}
                disabled={!draft || applying}
                value={draft?.fontWeight ?? '400'}
                onChange={(e) => set('fontWeight', e.target.value)}
              >
                {draft && !WEIGHTS.some((w) => w.v === draft.fontWeight) ? (
                  <option value={draft.fontWeight}>{draft.fontWeight}</option>
                ) : null}
                {WEIGHTS.map((w) => (
                  <option key={w.v} value={w.v}>
                    {w.l}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Line height">
              <input
                className={fieldClass}
                disabled={!draft || applying}
                value={draft?.lineHeight ?? ''}
                onChange={(e) => set('lineHeight', e.target.value)}
              />
            </Field>
            <Field label="Tracking">
              <input
                className={fieldClass}
                disabled={!draft || applying}
                value={draft?.letterSpacing ?? ''}
                onChange={(e) => set('letterSpacing', e.target.value)}
              />
            </Field>
            <Field label="Style">
              <select
                className={fieldClass}
                disabled={!draft || applying}
                value={draft?.fontStyle ?? 'normal'}
                onChange={(e) => set('fontStyle', e.target.value)}
              >
                <option value="normal">Normal</option>
                <option value="italic">Italic</option>
              </select>
            </Field>
          </div>
          <div className="flex gap-1">
            {(['left', 'center', 'right', 'justify'] as const).map((align) => (
              <button
                key={align}
                type="button"
                disabled={!draft || applying}
                onClick={() => set('textAlign', align)}
                className={`flex-1 h-7 inline-flex items-center justify-center font-mono text-[9px] uppercase border border-border ${
                  draft?.textAlign === align
                    ? 'bg-foreground text-background'
                    : 'text-muted-foreground'
                }`}
              >
                {align[0]}
              </button>
            ))}
          </div>
          <div className="flex gap-1">
            {(['none', 'uppercase', 'lowercase', 'capitalize'] as const).map((c) => (
              <button
                key={c}
                type="button"
                disabled={!draft || applying}
                onClick={() => set('textTransform', c)}
                className={`flex-1 h-7 px-1 inline-flex items-center justify-center font-mono text-[8px] uppercase border border-border ${
                  draft?.textTransform === c
                    ? 'bg-foreground text-background'
                    : 'text-muted-foreground'
                }`}
              >
                {c === 'none' ? 'Aa' : c.slice(0, 3)}
              </button>
            ))}
          </div>
          <div className="flex gap-1">
            {(['none', 'underline', 'line-through'] as const).map((d) => (
              <button
                key={d}
                type="button"
                disabled={!draft || applying}
                onClick={() => set('textDecoration', d)}
                className={`flex-1 h-7 inline-flex items-center justify-center font-mono text-[8px] uppercase border border-border ${
                  draft?.textDecoration === d
                    ? 'bg-foreground text-background'
                    : 'text-muted-foreground'
                }`}
              >
                {d === 'none' ? 'None' : d === 'underline' ? 'U' : 'S'}
              </button>
            ))}
          </div>
        </section>

        <section className="px-3 py-3 border-b border-border/70 space-y-2.5">
          <p className="font-mono text-[9px] tracking-[0.22em] uppercase text-muted-foreground">
            Color
          </p>
          <ColorRow
            label="Text"
            value={draft?.color ?? ''}
            disabled={!draft || applying}
            onChange={(v) => set('color', v)}
          />
          <ColorRow
            label="Fill"
            value={draft?.backgroundColor ?? ''}
            disabled={!draft || applying}
            onChange={(v) => set('backgroundColor', v)}
          />
        </section>

        <section className="px-3 py-3 border-b border-border/70 space-y-2.5">
          <p className="font-mono text-[9px] tracking-[0.22em] uppercase text-muted-foreground">
            Layout
          </p>
          <label className="flex items-center gap-2 text-[12px]">
            <input
              type="checkbox"
              checked={guides}
              onChange={(e) => onGuides?.(e.target.checked)}
              className="rounded-none"
            />
            Show paddings and margins
          </label>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Padding">
              <input
                className={fieldClass}
                disabled={!draft || applying}
                value={draft?.padding ?? ''}
                onChange={(e) => set('padding', e.target.value)}
              />
            </Field>
            <Field label="Margin">
              <input
                className={fieldClass}
                disabled={!draft || applying}
                value={draft?.margin ?? ''}
                onChange={(e) => set('margin', e.target.value)}
              />
            </Field>
            <Field label="Radius">
              <input
                className={fieldClass}
                disabled={!draft || applying}
                value={draft?.borderRadius ?? ''}
                onChange={(e) => set('borderRadius', e.target.value)}
              />
            </Field>
            <Field label="Opacity">
              <input
                className={fieldClass}
                disabled={!draft || applying}
                value={draft?.opacity ?? ''}
                onChange={(e) => set('opacity', e.target.value)}
              />
            </Field>
          </div>
        </section>

        <section className="px-3 py-3 border-b border-border/70 space-y-2.5">
          <p className="font-mono text-[9px] tracking-[0.22em] uppercase text-muted-foreground">
            Border / Shadow
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Width">
              <input
                className={fieldClass}
                disabled={!draft || applying}
                value={draft?.borderWidth ?? ''}
                onChange={(e) => set('borderWidth', e.target.value)}
              />
            </Field>
            <Field label="Style">
              <select
                className={fieldClass}
                disabled={!draft || applying}
                value={draft?.borderStyle ?? 'none'}
                onChange={(e) => set('borderStyle', e.target.value)}
              >
                <option value="none">None</option>
                <option value="solid">Solid</option>
                <option value="dashed">Dashed</option>
              </select>
            </Field>
          </div>
          <ColorRow
            label="Border"
            value={draft?.borderColor ?? ''}
            disabled={!draft || applying}
            onChange={(v) => set('borderColor', v)}
          />
          <Field label="Shadow">
            <select
              className={fieldClass}
              disabled={!draft || applying}
              value={draft?.boxShadow ?? 'none'}
              onChange={(e) => set('boxShadow', e.target.value)}
            >
              {draft && !SHADOWS.some((s) => s.v === draft.boxShadow) ? (
                <option value={draft.boxShadow}>Current</option>
              ) : null}
              {SHADOWS.map((s) => (
                <option key={s.l} value={s.v}>
                  {s.l}
                </option>
              ))}
            </select>
          </Field>
        </section>

        <section className="px-3 py-3 space-y-2.5">
          <p className="font-mono text-[9px] tracking-[0.22em] uppercase text-muted-foreground">
            Instructions
          </p>
          <div className="flex flex-wrap gap-1">
            {INSPECT_PILLS.map((pill) => (
              <button
                key={pill}
                type="button"
                disabled={applying}
                onClick={() =>
                  setInstruction((prev) =>
                    prev ? `${prev.trim()} ${pillInstruction(pill)}` : pillInstruction(pill),
                  )
                }
                className="h-6 px-1.5 font-mono text-[10px] border border-border text-muted-foreground hover:text-foreground hover:border-foreground"
              >
                {pill}
              </button>
            ))}
          </div>
          <textarea
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={onKeyDown}
            disabled={applying}
            rows={4}
            placeholder="Add instructions for this element… (↵ to apply, ⇧↵ for new line)"
            className="w-full resize-none rounded-none border border-border bg-background px-2 py-1.5 text-[12px] leading-relaxed outline-none focus:border-brand placeholder:text-muted-foreground"
          />
          {error ? (
            <p className="text-[11px] text-destructive">{error}</p>
          ) : null}
        </section>
      </div>

      <footer className="shrink-0 border-t border-border px-3 py-2 flex items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 rounded-none"
          disabled={!canUndo || applying}
          onClick={onUndo}
          aria-label="Undo"
        >
          <Undo2 className="h-3.5 w-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 rounded-none"
          disabled={!canRedo || applying}
          onClick={onRedo}
          aria-label="Redo"
        >
          <Redo2 className="h-3.5 w-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 rounded-none text-muted-foreground"
          disabled={!selection || applying}
          onClick={onDelete}
          aria-label="Delete element"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 rounded-none"
          disabled={applying || !dirty}
          onClick={onReset}
          aria-label="Reset pending edits"
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </Button>
        <span className="flex-1" />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={`h-8 w-8 rounded-none ${compare ? 'bg-muted' : ''}`}
          disabled={!dirty}
          onClick={() => onCompare(!compare)}
          aria-label={compare ? 'Show edits' : 'Compare original'}
        >
          {compare ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
        </Button>
        <Button
          type="button"
          className="h-8 px-3 rounded-none bg-brand text-brand-foreground hover:bg-brand/90"
          disabled={!canApply}
          onClick={applyNow}
        >
          <Check className="h-3.5 w-3.5 mr-1" />
          {applying ? 'Applying' : 'Apply'}
        </Button>
      </footer>
    </aside>
  )
}

function ColorRow({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string
  value: string
  disabled?: boolean
  onChange: (value: string) => void
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-10 font-mono text-[9px] uppercase text-muted-foreground">{label}</span>
      <input
        type="color"
        disabled={disabled}
        value={toColorInput(value)}
        onChange={(e) => onChange(e.target.value)}
        className="h-6 w-6 rounded-none border border-border bg-transparent p-0"
      />
      <input
        className={fieldClass}
        disabled={disabled}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
}

export function InspectToolbar({
  draft,
  applying,
  iframeBox,
  selection,
  onDraft,
}: {
  draft: InspectDraft | null
  applying: boolean
  iframeBox: DOMRect | null
  selection: InspectSelection | null
  onDraft: (draft: InspectDraft) => void
}) {
  if (!selection || !iframeBox || !draft) return null
  const top = Math.min(
    iframeBox.height - 44,
    Math.max(8, selection.rect.top + selection.rect.height + 8),
  )
  const left = Math.min(iframeBox.width - 16, Math.max(8, selection.rect.left))

  return (
    <div
      className="absolute z-20 flex items-center gap-1 h-9 px-1.5 border border-border bg-background shadow-sm"
      style={{ top, left }}
    >
      <input
        className="w-24 h-6 px-1 font-mono text-[10px] bg-transparent outline-none"
        disabled={applying}
        value={draft.fontFamily}
        onChange={(e) => onDraft({ ...draft, fontFamily: e.target.value })}
      />
      <input
        className="w-12 h-6 px-1 font-mono text-[10px] bg-transparent outline-none"
        disabled={applying}
        value={draft.fontSize}
        onChange={(e) => onDraft({ ...draft, fontSize: e.target.value })}
      />
      <button
        type="button"
        disabled={applying}
        className={`h-6 w-6 font-serif text-[12px] font-bold hover:bg-muted ${
          Number(draft.fontWeight) >= 600 ? 'bg-muted' : ''
        }`}
        onClick={() =>
          onDraft({
            ...draft,
            fontWeight: Number(draft.fontWeight) >= 600 ? '400' : '700',
          })
        }
      >
        B
      </button>
      <button
        type="button"
        disabled={applying}
        className={`h-6 w-6 font-serif text-[12px] italic hover:bg-muted ${
          draft.fontStyle === 'italic' ? 'bg-muted' : ''
        }`}
        onClick={() =>
          onDraft({
            ...draft,
            fontStyle: draft.fontStyle === 'italic' ? 'normal' : 'italic',
          })
        }
      >
        I
      </button>
      <input
        type="color"
        disabled={applying}
        value={toColorInput(draft.color)}
        onChange={(e) => onDraft({ ...draft, color: e.target.value })}
        className="h-4 w-4 border border-border p-0 bg-transparent"
      />
      <input
        type="color"
        disabled={applying}
        value={toColorInput(draft.backgroundColor)}
        onChange={(e) => onDraft({ ...draft, backgroundColor: e.target.value })}
        className="h-4 w-4 border border-border p-0 bg-transparent"
      />
    </div>
  )
}

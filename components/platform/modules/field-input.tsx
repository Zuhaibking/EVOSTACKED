'use client'

/**
 * FieldInput — controlled editor for any blueprint FieldType.
 * Values in/out use the API's shapes: number|null for number/money, `YYYY-MM-DD` for date,
 * ISO string for datetime, string[] for tags, boolean for boolean, record id for relation.
 */
import { ImageThumb } from './field-value'
import { currencySymbol, humanize, parseDate, toBool, toDateKey, toLocalInputValue, toTags, ToneDot, useRelationOptions } from './shared'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import type { Blueprint, Field } from '@/lib/platform/types'
import { cn } from '@/lib/utils'
import { X } from 'lucide-react'
import * as React from 'react'

export type FieldInputProps = {
  field: Field
  value: unknown
  onChange: (value: unknown) => void
  id?: string
  invalid?: boolean
  disabled?: boolean
  /** ISO 4217 code for money prefix; defaults to USD. */
  currency?: string
  /** Needed to load relation targets; without them relation falls back to a text input. */
  projectId?: string
  blueprint?: Blueprint
  autoFocus?: boolean
}

const NONE = '__evo_none__'
const invalidCls = 'border-destructive/70 focus-visible:ring-destructive/60 focus-within:ring-destructive/60'
const shellCls =
  'flex w-full items-center rounded-md border bg-transparent text-sm shadow-sm transition-colors focus-within:ring-1 focus-within:ring-ring'

const str = (v: unknown) => (v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v))

export function FieldInput(props: FieldInputProps) {
  const { field, value, onChange, id, invalid, disabled, currency = 'USD', autoFocus } = props
  const common = { id, disabled, autoFocus, 'aria-invalid': invalid || undefined }
  const base = cn('h-9 bg-background/60', invalid && invalidCls)

  switch (field.type) {
    case 'longtext':
      return (
        <Textarea
          {...common}
          value={str(value)}
          onChange={(e) => onChange(e.target.value)}
          rows={4}
          placeholder={`Add ${field.label.toLowerCase()}…`}
          className={cn('min-h-[92px] resize-y bg-background/60 leading-relaxed', invalid && invalidCls)}
        />
      )

    case 'number':
      return (
        <Input
          {...common}
          type="number"
          inputMode="decimal"
          step="any"
          value={str(value)}
          onChange={(e) => onChange(e.target.value === '' ? null : Number.isFinite(e.target.valueAsNumber) ? e.target.valueAsNumber : null)}
          onWheel={(e) => (e.target as HTMLInputElement).blur()}
          className={cn(base, 'tabular')}
          placeholder="0"
        />
      )

    case 'money':
      return <MoneyInput {...props} currency={currency} />

    case 'boolean': {
      const on = toBool(value)
      return (
        <div className="flex h-9 items-center gap-2.5">
          <Switch id={id} checked={on} disabled={disabled} onCheckedChange={(c) => onChange(c)} aria-invalid={invalid || undefined} />
          <span className="text-sm text-muted-foreground">{on ? 'Yes' : 'No'}</span>
        </div>
      )
    }

    case 'date': {
      const d = parseDate(value)
      return (
        <Input
          {...common}
          type="date"
          value={d ? toDateKey(d) : ''}
          onChange={(e) => onChange(e.target.value || null)}
          className={cn(base, 'tabular')}
        />
      )
    }

    case 'datetime': {
      const d = parseDate(value)
      return (
        <Input
          {...common}
          type="datetime-local"
          value={d ? toLocalInputValue(d) : ''}
          onChange={(e) => {
            const next = e.target.value ? new Date(e.target.value) : null
            onChange(next && !Number.isNaN(next.getTime()) ? next.toISOString() : null)
          }}
          className={cn(base, 'tabular')}
        />
      )
    }

    case 'enum':
      return <EnumSelect {...props} />

    case 'relation':
      return props.projectId && props.blueprint && field.relation ? (
        <RelationSelect {...props} />
      ) : (
        <Input {...common} value={str(value)} onChange={(e) => onChange(e.target.value)} className={base} placeholder="Record ID" />
      )

    case 'tags':
      return <TagsInput {...props} />

    case 'image':
      return (
        <div className="flex items-center gap-2">
          {str(value) ? <ImageThumb src={str(value)} size={36} /> : null}
          <Input
            {...common}
            type="url"
            value={str(value)}
            onChange={(e) => onChange(e.target.value)}
            placeholder="https://…/image.jpg"
            className={base}
          />
        </div>
      )

    case 'email':
      return <Input {...common} type="email" inputMode="email" autoComplete="off" value={str(value)} onChange={(e) => onChange(e.target.value)} className={base} placeholder="name@example.com" />

    case 'phone':
      return <Input {...common} type="tel" inputMode="tel" autoComplete="off" value={str(value)} onChange={(e) => onChange(e.target.value)} className={cn(base, 'tabular')} placeholder="+1 555 010 0199" />

    case 'url':
      return <Input {...common} type="url" inputMode="url" value={str(value)} onChange={(e) => onChange(e.target.value)} className={base} placeholder="https://" />

    default:
      return <Input {...common} type="text" value={str(value)} onChange={(e) => onChange(e.target.value)} className={base} />
  }
}

function MoneyInput({ value, onChange, id, invalid, disabled, currency = 'USD', autoFocus }: FieldInputProps) {
  const symbol = currencySymbol(currency)
  return (
    <div className={cn(shellCls, 'h-9 bg-background/60', invalid && invalidCls, disabled && 'opacity-50')}>
      <span className="select-none pl-3 pr-1.5 text-muted-foreground">{symbol}</span>
      <input
        id={id}
        type="number"
        inputMode="decimal"
        step="0.01"
        min={undefined}
        disabled={disabled}
        autoFocus={autoFocus}
        aria-invalid={invalid || undefined}
        value={str(value)}
        onChange={(e) => onChange(e.target.value === '' ? null : Number.isFinite(e.target.valueAsNumber) ? e.target.valueAsNumber : null)}
        onWheel={(e) => (e.target as HTMLInputElement).blur()}
        placeholder="0.00"
        className="h-full min-w-0 flex-1 bg-transparent pr-2 tabular outline-none placeholder:text-muted-foreground focus-visible:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      <span className="select-none pr-3 font-mono text-[10.5px] tracking-wide text-muted-foreground">{currency}</span>
    </div>
  )
}

function EnumSelect({ field, value, onChange, id, invalid, disabled }: FieldInputProps) {
  const current = str(value)
  const options = field.options.includes(current) || !current ? field.options : [current, ...field.options]
  const realNone = field.options.find((o) => o.trim().toLowerCase() === 'none')
  return (
    <Select value={current || (field.required ? '' : realNone ?? NONE)} onValueChange={(v) => onChange(v === NONE ? null : v)} disabled={disabled}>
      <SelectTrigger id={id} aria-invalid={invalid || undefined} className={cn('h-9 bg-background/60', invalid && invalidCls)}>
        <SelectValue placeholder={`Select ${field.label.toLowerCase()}`} />
      </SelectTrigger>
      <SelectContent className="max-h-72">
        {!field.required && !realNone && (
          <SelectItem value={NONE}>
            <span className="text-muted-foreground">None</span>
          </SelectItem>
        )}
        {options.map((o) => (
          <SelectItem key={o} value={o}>
            <span className="flex items-center gap-2">
              <ToneDot value={o} className="size-1.5" />
              <span>{humanize(o)}</span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function RelationSelect({ field, value, onChange, id, invalid, disabled, projectId, blueprint }: FieldInputProps) {
  const opts = useRelationOptions(projectId, blueprint, field.relation)
  const target = blueprint?.collections.find((c) => c.key === field.relation)
  const raw = str(value)
  const list = opts ?? []
  // Values may reference the target by title (seeds / website forms) — match on label too.
  const current = list.find((o) => o.id === raw)?.id ?? list.find((o) => o.label === raw)?.id ?? raw
  const withCurrent = current && !list.some((o) => o.id === current) ? [{ id: current, label: current }, ...list] : list
  return (
    <Select
      value={current || (field.required ? '' : NONE)}
      onValueChange={(v) => v !== current && onChange(v === NONE ? null : v)}
      disabled={disabled || opts === null}
    >
      <SelectTrigger id={id} aria-invalid={invalid || undefined} className={cn('h-9 bg-background/60', invalid && invalidCls)}>
        <SelectValue placeholder={opts === null ? 'Loading…' : `Select ${(target?.singular ?? field.label).toLowerCase()}`} />
      </SelectTrigger>
      <SelectContent className="max-h-72">
        {!field.required && (
          <SelectItem value={NONE}>
            <span className="text-muted-foreground">None</span>
          </SelectItem>
        )}
        {withCurrent.length === 0 && opts !== null && (
          <div className="px-2 py-3 text-center text-xs text-muted-foreground">No {(target?.label ?? 'records').toLowerCase()} yet</div>
        )}
        {withCurrent.map((o) => (
          <SelectItem key={o.id} value={o.id}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function TagsInput({ value, onChange, id, invalid, disabled, autoFocus }: FieldInputProps) {
  const tags = toTags(value)
  const [draft, setDraft] = React.useState('')
  const inputRef = React.useRef<HTMLInputElement>(null)

  const commit = (raw: string) => {
    const parts = raw.split(',').map((s) => s.trim().slice(0, 60)).filter(Boolean)
    setDraft('')
    if (!parts.length) return
    const next = [...tags]
    for (const p of parts) if (!next.some((t) => t.toLowerCase() === p.toLowerCase())) next.push(p)
    if (next.length !== tags.length) onChange(next)
  }

  return (
    <div
      className={cn(shellCls, 'min-h-9 cursor-text flex-wrap gap-1 bg-background/60 px-1.5 py-1', invalid && invalidCls, disabled && 'pointer-events-none opacity-50')}
      onClick={() => inputRef.current?.focus()}
    >
      {tags.map((t, i) => (
        <span key={t} className="evo-rise inline-flex h-6 items-center gap-1 rounded-md border bg-muted/60 pl-2 pr-1 text-xs font-medium">
          {t}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onChange(tags.filter((_, j) => j !== i))
            }}
            className="grid size-4 place-items-center rounded text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            aria-label={`Remove ${t}`}
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        id={id}
        value={draft}
        disabled={disabled}
        autoFocus={autoFocus}
        aria-invalid={invalid || undefined}
        onChange={(e) => {
          const v = e.target.value
          if (v.includes(',')) commit(v)
          else setDraft(v)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commit(draft)
          } else if (e.key === 'Backspace' && !draft && tags.length) {
            onChange(tags.slice(0, -1))
          }
        }}
        onBlur={() => commit(draft)}
        placeholder={tags.length ? 'Add…' : 'Type and press Enter'}
        className="h-6 min-w-[7rem] flex-1 bg-transparent px-1 text-sm outline-none placeholder:text-muted-foreground focus-visible:outline-none"
      />
    </div>
  )
}

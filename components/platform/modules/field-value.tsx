'use client'

/**
 * FieldValue — read-only rendering of any blueprint FieldType.
 * money → Intl currency · enum → toned status pill · boolean → check/dash · date(time) → relative
 * with absolute tooltip · image → thumbnail · email/url/phone → links · tags → chips · longtext → clamp.
 */
import { formatAbsolute, formatMoney, formatNumber, formatRelative, isBlank, isDateOnlyValue, parseDate, StatusPill, toBool, toTags, useNow } from './shared'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import type { Field } from '@/lib/platform/types'
import { cn } from '@/lib/utils'
import { ArrowUpRight, Check, ImageOff, Link2, Minus } from 'lucide-react'
import * as React from 'react'

export type FieldValueProps = {
  field: Pick<Field, 'type' | 'key' | 'label'> & Partial<Pick<Field, 'options' | 'relation'>>
  value: unknown
  /** ISO 4217 code (see `currencyOf(blueprint)`); defaults to USD. */
  currency?: string
  /** Resolved title of a related record (relation fields). */
  relationLabel?: string
  /** Tighter rendering for cards/chips (fewer tags, shorter text). */
  compact?: boolean
  className?: string
}

const stop = (e: React.SyntheticEvent) => e.stopPropagation()

function Empty({ className }: { className?: string }) {
  return <span className={cn('select-none text-muted-foreground/45', className)}>—</span>
}

/** http(s) only — website submissions must never become `javascript:` links. */
function safeHttpUrl(raw: string): string | null {
  const s = raw.trim()
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`
  try {
    const u = new URL(withScheme)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null
  } catch {
    return null
  }
}

function safeImageSrc(raw: string): string | null {
  const s = raw.trim()
  if (/^data:image\/(png|jpe?g|gif|webp|avif);base64,/i.test(s)) return s
  if (s.startsWith('/') && !s.startsWith('//')) return s
  return safeHttpUrl(s)
}

function prettyUrl(href: string) {
  try {
    const u = new URL(href)
    const path = u.pathname === '/' ? '' : u.pathname
    return (u.host.replace(/^www\./, '') + path).slice(0, 48)
  } catch {
    return href
  }
}

export function DateValue({ value, dateOnly, className }: { value: unknown; dateOnly?: boolean; className?: string }) {
  const now = useNow()
  const d = parseDate(value)
  if (!d) return isBlank(value) ? <Empty className={className} /> : <span className={className}>{String(value)}</span>
  const only = dateOnly ?? isDateOnlyValue(value)
  return (
    <TooltipProvider delayDuration={250}>
      <Tooltip>
        <TooltipTrigger asChild>
          <time dateTime={only ? String(value) : d.toISOString()} className={cn('whitespace-nowrap tabular', className)}>
            {now ? formatRelative(d, now, only) : '\u00a0'}
          </time>
        </TooltipTrigger>
        <TooltipContent side="top" className="border bg-popover text-popover-foreground shadow-md">
          {formatAbsolute(d, only)}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

export function ImageThumb({ src, alt = '', size = 28, className }: { src: string; alt?: string; size?: number; className?: string }) {
  const safe = safeImageSrc(src)
  const [broken, setBroken] = React.useState(false)
  const box = { width: size, height: size }
  if (!safe || broken) {
    return (
      <span style={box} className={cn('inline-grid shrink-0 place-items-center rounded-md border bg-muted/60 text-muted-foreground/60', className)}>
        <ImageOff className="size-3.5" />
      </span>
    )
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- arbitrary user/blueprint URLs
    <img
      src={safe}
      alt={alt}
      style={box}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setBroken(true)}
      className={cn('inline-block shrink-0 rounded-md border object-cover', className)}
    />
  )
}

export function TagChips({ tags, max = 3, className }: { tags: string[]; max?: number; className?: string }) {
  if (!tags.length) return <Empty />
  const shown = tags.slice(0, max)
  const rest = tags.length - shown.length
  return (
    <span className={cn('inline-flex max-w-full flex-wrap items-center gap-1', className)}>
      {shown.map((t) => (
        <span key={t} className="inline-flex h-5 max-w-[10rem] items-center truncate rounded-md border bg-muted/50 px-1.5 text-[11px] font-medium text-foreground/80">
          {t}
        </span>
      ))}
      {rest > 0 && <span className="text-[11px] text-muted-foreground">+{rest}</span>}
    </span>
  )
}

const linkCls =
  'inline-flex max-w-full items-center gap-0.5 truncate text-foreground underline decoration-border underline-offset-[3px] transition-colors hover:decoration-foreground/60'

export function FieldValue({ field, value, currency = 'USD', relationLabel, compact, className }: FieldValueProps) {
  if (field.type === 'boolean') {
    if (value === null || value === undefined || value === '') return <Empty className={className} />
    return toBool(value) ? (
      <span className={cn('inline-flex items-center text-foreground', className)} aria-label="Yes">
        <Check className="size-4" strokeWidth={2.25} />
      </span>
    ) : (
      <span className={cn('inline-flex items-center text-muted-foreground/50', className)} aria-label="No">
        <Minus className="size-4" />
      </span>
    )
  }
  if (isBlank(value)) return <Empty className={className} />
  const text = typeof value === 'object' && !Array.isArray(value) ? JSON.stringify(value) : String(value)

  switch (field.type) {
    case 'money':
      return <span className={cn('whitespace-nowrap font-medium tabular text-foreground', className)}>{formatMoney(value, currency)}</span>
    case 'number':
      return <span className={cn('whitespace-nowrap tabular', className)}>{formatNumber(value)}</span>
    case 'enum':
      return <StatusPill value={value} className={className} />
    case 'date':
    case 'datetime':
      return <DateValue value={value} dateOnly={field.type === 'date' || isDateOnlyValue(value)} className={className} />
    case 'image':
      return <ImageThumb src={text} alt={field.label} size={compact ? 24 : 28} className={className} />
    case 'email':
      return (
        <a href={`mailto:${text}`} onClick={stop} className={cn(linkCls, className)} title={text}>
          {text}
        </a>
      )
    case 'phone':
      return (
        <a href={`tel:${text.replace(/[^\d+]/g, '')}`} onClick={stop} className={cn(linkCls, 'tabular', className)}>
          {text}
        </a>
      )
    case 'url': {
      const href = safeHttpUrl(text)
      if (!href) return <span className={cn('truncate', className)}>{text}</span>
      return (
        <a href={href} target="_blank" rel="noreferrer noopener" onClick={stop} className={cn(linkCls, className)} title={href}>
          <span className="truncate">{prettyUrl(href)}</span>
          <ArrowUpRight className="size-3 shrink-0 text-muted-foreground" />
        </a>
      )
    }
    case 'tags':
      return <TagChips tags={toTags(value)} max={compact ? 2 : 3} className={className} />
    case 'longtext':
      return (
        <span className={cn('block truncate text-muted-foreground', compact ? 'max-w-[18ch]' : 'max-w-[32ch]', className)} title={text}>
          {text}
        </span>
      )
    case 'relation':
      return (
        <span className={cn('inline-flex max-w-full items-center gap-1 truncate', className)} title={relationLabel ?? text}>
          <Link2 className="size-3 shrink-0 text-muted-foreground" />
          <span className="truncate">{relationLabel ?? text}</span>
        </span>
      )
    default:
      return (
        <span className={cn('block truncate', className)} title={text.length > 40 ? text : undefined}>
          {text}
        </span>
      )
  }
}

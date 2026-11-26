'use client'

/**
 * Shared plumbing for the schema-driven data modules (table / kanban / calendar / drawer):
 * REST client + error parsing, value coercion, money/date formatting, status tones,
 * a self-contained stylesheet (keyframes + light/dark tone variables) and small UI atoms.
 */
import { Button } from '@/components/ui/button'
import type { Blueprint, Collection, Field, RecordRow } from '@/lib/platform/types'
import { cn } from '@/lib/utils'
import { Plus } from 'lucide-react'
import * as React from 'react'

export type ModuleProps = { projectId: string; collection: Collection; blueprint: Blueprint; refreshKey: number }
export type ListResponse = { rows: RecordRow[]; total: number }

/* ───────────────────────── REST client ───────────────────────── */
export class ApiError extends Error {
  status: number
  code: string | null
  fieldErrors: Record<string, string>
  constructor(status: number, message: string, code: string | null = null, fieldErrors: Record<string, string> = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.fieldErrors = fieldErrors
  }
}

export function recordsUrl(projectId: string, collection: string, recordId?: string) {
  const base = `/api/p/${encodeURIComponent(projectId)}/records/${encodeURIComponent(collection)}`
  return recordId ? `${base}/${encodeURIComponent(recordId)}` : base
}

export async function apiFetch<T>(url: string, init: Omit<RequestInit, 'body'> & { json?: unknown } = {}): Promise<T> {
  const { json, headers, ...rest } = init
  let res: Response
  try {
    res = await fetch(url, {
      cache: 'no-store',
      ...rest,
      headers: { accept: 'application/json', ...(json !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
      body: json !== undefined ? JSON.stringify(json) : undefined,
    })
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e
    throw new ApiError(0, 'Network error — check your connection and try again.', 'network')
  }
  const text = await res.text()
  let body: unknown = null
  if (text) {
    try {
      body = JSON.parse(text)
    } catch {
      body = text
    }
  }
  if (!res.ok) throw toApiError(res.status, body)
  return body as T
}

const STATUS_MESSAGES: Record<number, string> = {
  401: 'You need to sign in to see this data.',
  403: "You don't have access to this project.",
  404: 'Not found.',
  413: 'That payload is too large.',
  429: 'Too many requests — try again in a moment.',
}

function toApiError(status: number, body: unknown): ApiError {
  const fieldErrors: Record<string, string> = {}
  const add = (key: unknown, msg: unknown) => {
    const k = Array.isArray(key) ? String([...key].reverse().find((p) => typeof p === 'string') ?? '') : String(key ?? '')
    const m = Array.isArray(msg)
      ? msg.filter(Boolean).map(String).join(', ')
      : typeof msg === 'string'
        ? msg
        : msg && typeof msg === 'object' && 'message' in msg
          ? String((msg as { message: unknown }).message)
          : ''
    if (k && m && !fieldErrors[k]) fieldErrors[k] = m
  }
  const collect = (v: unknown) => {
    if (!v || typeof v !== 'object') return
    if (Array.isArray(v)) {
      for (const item of v) {
        if (item && typeof item === 'object') {
          const o = item as Record<string, unknown>
          add(o.field ?? o.key ?? o.path ?? o.name, o.message ?? o.error ?? o.msg)
        }
      }
    } else for (const [k, m] of Object.entries(v as Record<string, unknown>)) add(k, m)
  }

  let code: string | null = null
  let message = ''
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    const b = body as Record<string, unknown>
    if (typeof b.error === 'string') code = b.error
    if (typeof b.message === 'string') message = b.message
    else if (typeof b.detail === 'string') message = b.detail
    if (b.error && typeof b.error === 'object') {
      const e = b.error as Record<string, unknown>
      if (typeof e.message === 'string') message ||= e.message
      if (typeof e.code === 'string') code = e.code
      for (const k of ['fields', 'fieldErrors', 'errors', 'issues']) collect(e[k])
    }
    for (const k of ['fields', 'fieldErrors', 'errors', 'issues', 'details']) collect(b[k])
  } else if (typeof body === 'string' && body && !body.trimStart().startsWith('<')) {
    message = body.slice(0, 240)
  }

  if (!message) {
    if (code === 'not_provisioned') message = "This project's backend hasn't been launched yet."
    else if (code && /^[a-z0-9_]+$/i.test(code)) message = humanize(code) + '.'
    else message = STATUS_MESSAGES[status] ?? (status >= 500 ? 'The server hit an error. Try again.' : `Request failed (${status}).`)
  }
  return new ApiError(status, message, code, fieldErrors)
}

/* ───────────────────────── value coercion ───────────────────────── */
export function toNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v.replace(/[^\d.eE+-]/g, ''))
    return Number.isFinite(n) ? n : null
  }
  return null
}

export function toBool(v: unknown): boolean {
  return v === true || v === 1 || (typeof v === 'string' && ['true', '1', 'yes', 'on'].includes(v.trim().toLowerCase()))
}

export function toTags(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x ?? '').trim()).filter(Boolean)
  if (typeof v === 'string' && v.trim()) {
    const s = v.trim()
    if (s.startsWith('[')) {
      try {
        const parsed = JSON.parse(s)
        if (Array.isArray(parsed)) return parsed.map((x) => String(x ?? '').trim()).filter(Boolean)
      } catch {
        /* fall through to CSV */
      }
    }
    return s.split(',').map((x) => x.trim()).filter(Boolean)
  }
  return []
}

export function isBlank(v: unknown): boolean {
  return v === undefined || v === null || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0)
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/
const SQL_DATETIME = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2}(\.\d+)?)?$/

export function isDateOnlyValue(v: unknown) {
  return typeof v === 'string' && DATE_ONLY.test(v.trim())
}

/** Robust date parsing: date-only strings are local days, SQLite `YYYY-MM-DD HH:MM:SS` is UTC. */
export function parseDate(v: unknown): Date | null {
  if (v === null || v === undefined || v === '') return null
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v
  if (typeof v === 'number') {
    const d = new Date(v < 1e12 ? v * 1000 : v)
    return Number.isNaN(d.getTime()) ? null : d
  }
  const s = String(v).trim()
  if (DATE_ONLY.test(s)) {
    const [y, m, d] = s.split('-').map(Number)
    return new Date(y, m - 1, d)
  }
  const d = new Date(SQL_DATETIME.test(s) ? s.replace(' ', 'T') + 'Z' : s)
  return Number.isNaN(d.getTime()) ? null : d
}

const pad2 = (n: number) => String(n).padStart(2, '0')
export function toDateKey(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}
export function toLocalInputValue(d: Date) {
  return `${toDateKey(d)}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

/* ───────────────────────── formatting ───────────────────────── */
const SYMBOL_TO_CODE: Record<string, string> = { $: 'USD', '€': 'EUR', '£': 'GBP', '¥': 'JPY', '₹': 'INR', '₩': 'KRW', '₺': 'TRY', R$: 'BRL' }

/** Currency from the blueprint's `currency` setting; validated with Intl, defaults to USD. */
export function currencyOf(blueprint?: Blueprint | null): string {
  const settings = blueprint?.settings ?? []
  const s = settings.find((x) => x.key === 'currency') ?? settings.find((x) => /currency/i.test(x.key))
  const raw = String(s?.value ?? '').trim()
  const code = (SYMBOL_TO_CODE[raw] ?? raw).toUpperCase()
  if (/^[A-Z]{3}$/.test(code)) {
    try {
      new Intl.NumberFormat('en-US', { style: 'currency', currency: code })
      return code
    } catch {
      /* invalid ISO code */
    }
  }
  return 'USD'
}

const formatters = new Map<string, Intl.NumberFormat>()
function nf(key: string, opts: Intl.NumberFormatOptions) {
  let f = formatters.get(key)
  if (!f) {
    f = new Intl.NumberFormat(undefined, opts)
    formatters.set(key, f)
  }
  return f
}

export function formatMoney(v: unknown, currency = 'USD', opts: { compact?: boolean } = {}): string {
  const n = toNumber(v)
  if (n === null) return '—'
  if (opts.compact && Math.abs(n) >= 10_000) {
    return nf(`mc:${currency}`, { style: 'currency', currency, currencyDisplay: 'narrowSymbol', notation: 'compact', minimumFractionDigits: 0, maximumFractionDigits: 1 }).format(n)
  }
  return nf(`m:${currency}`, { style: 'currency', currency, currencyDisplay: 'narrowSymbol' }).format(n)
}

export function currencySymbol(currency = 'USD'): string {
  try {
    return nf(`m:${currency}`, { style: 'currency', currency, currencyDisplay: 'narrowSymbol' }).formatToParts(0).find((p) => p.type === 'currency')?.value ?? currency
  } catch {
    return currency
  }
}

export function formatNumber(v: unknown): string {
  const n = toNumber(v)
  return n === null ? '—' : nf('n', { maximumFractionDigits: 2 }).format(n)
}

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}
export function dayDiff(a: Date, b: Date) {
  const ua = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())
  const ub = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate())
  return Math.round((ua - ub) / 86_400_000)
}

export function formatTime(d: Date) {
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

function shortDate(d: Date, now: Date) {
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) })
}

/** Compact relative time: "just now", "12m ago", "in 3h", "Tomorrow, 7:00 PM", "Nov 3". */
export function formatRelative(d: Date, nowMs = Date.now(), dateOnly = false): string {
  const now = new Date(nowMs)
  const days = dayDiff(d, now)
  if (dateOnly) {
    if (days === 0) return 'Today'
    if (days === 1) return 'Tomorrow'
    if (days === -1) return 'Yesterday'
    if (Math.abs(days) < 7) return days > 0 ? `In ${days} days` : `${-days} days ago`
    return shortDate(d, now)
  }
  const diff = d.getTime() - nowMs
  const abs = Math.abs(diff)
  const future = diff > 0
  if (abs < 45_000) return future ? 'in a moment' : 'just now'
  if (abs < 3_600_000) {
    const m = Math.max(1, Math.round(abs / 60_000))
    return future ? `in ${m}m` : `${m}m ago`
  }
  if (sameDay(d, now) || abs < 6 * 3_600_000) {
    const h = Math.round(abs / 3_600_000)
    return future ? `in ${h}h` : `${h}h ago`
  }
  if (days === 1) return `Tomorrow, ${formatTime(d)}`
  if (days === -1) return `Yesterday, ${formatTime(d)}`
  if (Math.abs(days) < 7) return future ? `${d.toLocaleDateString(undefined, { weekday: 'short' })}, ${formatTime(d)}` : `${-days}d ago`
  return shortDate(d, now)
}

export function formatAbsolute(d: Date, dateOnly = false): string {
  return dateOnly
    ? d.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
    : d.toLocaleString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

/** "no_show" → "No show"; already-human labels ("In Progress") are kept. */
export function humanize(s: string): string {
  const t = String(s ?? '').trim()
  if (!t) return t
  if (/[A-Z]/.test(t) && !/[_-]/.test(t)) return t
  const spaced = t.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

/** "Order" → "order", "Menu Item" → "menu item", "FAQ" stays. */
export function lowerNoun(s: string): string {
  return String(s ?? '')
    .split(' ')
    .map((w) => (/^[A-Z][a-z]+$/.test(w) ? w.toLowerCase() : w))
    .join(' ')
}

/** Plain-text rendering of a value (card subtitles, chips, aria labels). */
export function plainValue(field: Field | undefined, v: unknown, currency = 'USD'): string {
  if (isBlank(v)) return ''
  switch (field?.type) {
    case 'money':
      return formatMoney(v, currency)
    case 'number':
      return formatNumber(v)
    case 'boolean':
      return toBool(v) ? 'Yes' : 'No'
    case 'enum':
      return humanize(String(v))
    case 'tags':
      return toTags(v).join(', ')
    case 'date':
    case 'datetime': {
      const d = parseDate(v)
      return d ? formatRelative(d, Date.now(), field.type === 'date' || isDateOnlyValue(v)) : String(v)
    }
    default:
      return typeof v === 'object' ? JSON.stringify(v) : String(v)
  }
}

/* ───────────────────────── status tones ───────────────────────── */
export type Tone = 'green' | 'amber' | 'red' | 'blue' | 'violet' | 'cyan' | 'slate'

const RED = new Set(['canceled', 'cancelled', 'refunded', 'no_show', 'noshow', 'lost', 'failed', 'failure', 'rejected', 'declined', 'expired', 'overdue', 'past_due', 'churned', 'blocked', 'closed_lost', 'disputed', 'void', 'voided', 'out_of_stock', 'sold_out', 'banned', 'error', 'spam', 'bounced', 'unsubscribed', 'dropped', 'abandoned', 'returned'])
const AMBER = new Set(['pending', 'requested', 'received', 'new_order', 'trialing', 'trial', 'waiting', 'waitlist', 'waitlisted', 'on_hold', 'hold', 'in_review', 'review', 'under_review', 'unpaid', 'due', 'partially_paid', 'partial', 'low_stock', 'tentative', 'backorder', 'backordered', 'invited', 'unconfirmed', 'unverified', 'awaiting_payment', 'needs_review', 'follow_up', 'quoted', 'pending_payment'])
const GREEN = new Set(['paid', 'confirmed', 'won', 'active', 'completed', 'complete', 'done', 'delivered', 'fulfilled', 'approved', 'published', 'resolved', 'success', 'succeeded', 'accepted', 'live', 'in_stock', 'available', 'served', 'enabled', 'closed_won', 'hired', 'verified', 'settled', 'checked_in', 'picked_up', 'attended', 'healthy', 'subscribed', 'signed', 'finished'])
const BLUE = new Set(['new', 'open', 'in_progress', 'processing', 'preparing', 'seated', 'scheduled', 'booked', 'contacted', 'assigned', 'started', 'cooking', 'upcoming', 'planned', 'lead', 'prospect', 'submitted', 'occupied', 'reserved'])
const CYAN = new Set(['ready', 'ready_for_pickup', 'qualified', 'sent', 'packed', 'awaiting_pickup', 'checked_out'])
const VIOLET = new Set(['shipped', 'shipping', 'in_transit', 'out_for_delivery', 'dispatched', 'proposal', 'proposal_sent', 'negotiation', 'onboarding'])
const SLATE = new Set(['draft', 'archived', 'inactive', 'closed', 'disabled', 'paused', 'other', 'none', 'unknown', 'hidden', 'retired', 'discontinued', 'out_of_service', 'maintenance', 'unavailable'])
const HASHED: Tone[] = ['blue', 'violet', 'cyan', 'slate']

export function toneFor(option: unknown): Tone {
  const k = String(option ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  if (!k) return 'slate'
  if (RED.has(k)) return 'red'
  if (AMBER.has(k)) return 'amber'
  if (GREEN.has(k)) return 'green'
  if (BLUE.has(k)) return 'blue'
  if (CYAN.has(k)) return 'cyan'
  if (VIOLET.has(k)) return 'violet'
  if (SLATE.has(k)) return 'slate'
  if (/cancel|refund|no_?show|fail|reject|declin|expir|overdue|churn|lost/.test(k)) return 'red'
  if (/pend|request|trial|await|wait|hold|review|unpaid|unconfirm/.test(k)) return 'amber'
  if (/paid|confirm|complet|deliver|fulfil|approv|publish|resolv|success|accept|won\b|active/.test(k)) return 'green'
  if (/progress|process|prepar|ship|transit|schedul|book|contact|qualif|propos|negotiat/.test(k)) return 'blue'
  let h = 0
  for (let i = 0; i < k.length; i++) h = (h * 31 + k.charCodeAt(i)) | 0
  return HASHED[Math.abs(h) % HASHED.length]
}

/* ───────────────────────── stylesheet (React 19 hoists + dedupes by href) ───────────────────────── */
const CSS = `
.evo-tone{--tone:30 8% 42%}
.evo-tone[data-tone=green]{--tone:152 62% 30%}
.evo-tone[data-tone=amber]{--tone:32 92% 36%}
.evo-tone[data-tone=red]{--tone:4 72% 46%}
.evo-tone[data-tone=blue]{--tone:222 78% 50%}
.evo-tone[data-tone=violet]{--tone:262 58% 52%}
.evo-tone[data-tone=cyan]{--tone:190 82% 31%}
.evo-tone[data-tone=slate]{--tone:30 8% 42%}
.dark .evo-tone,.dark .evo-tone[data-tone=slate]{--tone:35 10% 66%}
.dark .evo-tone[data-tone=green]{--tone:148 55% 58%}
.dark .evo-tone[data-tone=amber]{--tone:38 92% 62%}
.dark .evo-tone[data-tone=red]{--tone:5 85% 67%}
.dark .evo-tone[data-tone=blue]{--tone:220 92% 72%}
.dark .evo-tone[data-tone=violet]{--tone:262 85% 78%}
.dark .evo-tone[data-tone=cyan]{--tone:188 72% 60%}
.evo-pill{color:hsl(var(--tone));background:hsl(var(--tone)/.1);box-shadow:inset 0 0 0 1px hsl(var(--tone)/.22)}
.evo-dot{background:hsl(var(--tone))}
.evo-tone-fg{color:hsl(var(--tone))}
.evo-chip-active .evo-dot{box-shadow:0 0 0 2px hsl(var(--tone)/.25)}
.evo-event{background:hsl(var(--tone)/.13);box-shadow:inset 2px 0 0 hsl(var(--tone));transition:background-color .15s ease}
.evo-event:hover{background:hsl(var(--tone)/.22)}
.evo-col-sum{background:hsl(var(--tone)/.08)}
@keyframes evo-flash{0%{background-color:hsl(var(--brand)/.18)}70%{background-color:hsl(var(--brand)/.06)}100%{background-color:transparent}}
.evo-flash{animation:evo-flash 2.8s cubic-bezier(.2,.8,.2,1) 1}
@keyframes evo-card-in{0%{opacity:0;transform:translateY(-4px) scale(.98)}100%{opacity:1;transform:none}}
.evo-card-flash{animation:evo-card-in .35s cubic-bezier(.2,.8,.2,1),evo-flash 2.8s cubic-bezier(.2,.8,.2,1)}
@keyframes evo-fade-in{from{opacity:0}to{opacity:1}}
@keyframes evo-fade-out{from{opacity:1}to{opacity:0}}
@keyframes evo-sheet-in{from{transform:translateX(100%)}to{transform:translateX(0)}}
@keyframes evo-sheet-out{from{transform:translateX(0)}to{transform:translateX(100%)}}
.evo-overlay[data-state=open]{animation:evo-fade-in .2s ease-out}
.evo-overlay[data-state=closed]{animation:evo-fade-out .18s ease-in}
.evo-sheet[data-state=open]{animation:evo-sheet-in .32s cubic-bezier(.32,.72,0,1)}
.evo-sheet[data-state=closed]{animation:evo-sheet-out .22s cubic-bezier(.32,.72,0,1)}
@keyframes evo-progress{0%{transform:translateX(-100%)}100%{transform:translateX(300%)}}
.evo-progress{animation:evo-progress 1.1s cubic-bezier(.4,0,.2,1) infinite}
@keyframes evo-rise{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:none}}
.evo-rise{animation:evo-rise .22s ease-out both}
.evo-scroll{scrollbar-width:thin;scrollbar-color:hsl(var(--foreground)/.16) transparent}
.evo-scroll::-webkit-scrollbar{width:6px;height:6px}
.evo-scroll::-webkit-scrollbar-thumb{background:hsl(var(--foreground)/.16);border-radius:8px}
.evo-scroll::-webkit-scrollbar-track{background:transparent}
.evo-slot-hint{opacity:0;transition:opacity .12s ease}
.evo-slot:hover .evo-slot-hint{opacity:1}
`

export function ModuleStyles() {
  return (
    <style href="evo-platform-modules" precedence="medium">
      {CSS}
    </style>
  )
}

/* ───────────────────────── UI atoms ───────────────────────── */
export function StatusPill({ value, className }: { value: unknown; className?: string }) {
  const text = String(value ?? '').trim()
  if (!text) return <span className="text-muted-foreground/50">—</span>
  return (
    <span
      data-tone={toneFor(text)}
      className={cn('evo-tone evo-pill inline-flex max-w-full items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-[3px] text-[11.5px] font-medium leading-none', className)}
    >
      <ModuleStyles />
      <span className="evo-dot size-1.5 shrink-0 rounded-full" aria-hidden />
      <span className="truncate">{humanize(text)}</span>
    </span>
  )
}

export function ToneDot({ value, className }: { value: unknown; className?: string }) {
  return <span data-tone={toneFor(value)} className={cn('evo-tone evo-dot inline-block size-2 shrink-0 rounded-full', className)} aria-hidden />
}

export function ModuleHeader({
  collection,
  count,
  busy,
  onCreate,
  children,
}: {
  collection: Collection
  count: number | null
  busy?: boolean
  onCreate: () => void
  children?: React.ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      {/* The shell's top bar already carries icon + description; keep this row to label · count · actions. */}
      <div className="flex min-w-0 items-center gap-2">
        <h2 className="truncate text-base font-semibold tracking-tight text-foreground">{collection.label}</h2>
        <span className="rounded-md border bg-muted/50 px-1.5 py-px font-mono text-[11px] tabular text-muted-foreground">
          {count === null ? '—' : count.toLocaleString()}
        </span>
        {busy && <span className="size-1.5 animate-pulse rounded-full bg-brand" aria-label="Refreshing" />}
      </div>
      <div className="flex items-center gap-2">
        {children}
        <Button size="sm" onClick={onCreate} className="gap-1.5">
          <Plus className="size-3.5" strokeWidth={2.25} />
          New {lowerNoun(collection.singular || 'record')}
        </Button>
      </div>
    </div>
  )
}

export function ErrorState({ error, onRetry, label }: { error: ApiError | Error; onRetry: () => void; label: string }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="mb-3 grid size-10 place-items-center rounded-xl border border-destructive/30 bg-destructive/10 font-mono text-sm text-destructive">!</div>
      <h3 className="text-sm font-semibold text-foreground">Couldn&apos;t load {label}</h3>
      <p className="mt-1 max-w-sm text-[13px] text-muted-foreground">{error.message}</p>
      <Button variant="outline" size="sm" className="mt-4" onClick={onRetry}>
        Try again
      </Button>
    </div>
  )
}

/* ───────────────────────── schema helpers ───────────────────────── */
export function fieldByKey(collection: Collection, key: string | null | undefined): Field | undefined {
  return key ? collection.fields.find((f) => f.key === key) : undefined
}

export function statusFieldOf(collection: Collection): Field | null {
  const f = fieldByKey(collection, collection.statusField)
  return f && f.type === 'enum' && f.options.length ? f : null
}

export function dateFieldOf(collection: Collection): Field | null {
  const f = fieldByKey(collection, collection.dateField)
  if (f && (f.type === 'date' || f.type === 'datetime')) return f
  return collection.fields.find((x) => x.type === 'datetime') ?? collection.fields.find((x) => x.type === 'date') ?? null
}

export function moneyFieldOf(collection: Collection): Field | null {
  const money = collection.fields.filter((f) => f.type === 'money')
  return money.find((f) => f.showInTable) ?? money[0] ?? null
}

export function tableFieldsOf(collection: Collection): Field[] {
  const shown = collection.fields.filter((f) => f.showInTable)
  const list = shown.length ? shown : collection.fields.slice(0, 4)
  const title = fieldByKey(collection, collection.titleField)
  if (!title) return list
  return [title, ...list.filter((f) => f.key !== title.key)]
}

/** Secondary descriptive field for cards / chips (skips title, status, money, date). */
export function subtitleFieldOf(collection: Collection): Field | null {
  const skip = new Set([collection.titleField, collection.statusField, collection.dateField, moneyFieldOf(collection)?.key])
  const candidates = collection.fields.filter((f) => !skip.has(f.key) && !['longtext', 'image', 'boolean', 'tags'].includes(f.type))
  return candidates.find((f) => f.showInTable) ?? candidates[0] ?? null
}

export function titleOf(collection: Collection, record: RecordRow | null | undefined): string {
  if (!record) return ''
  const v = record[collection.titleField]
  if (!isBlank(v)) return String(v)
  for (const f of collection.fields) {
    if (['text', 'email', 'phone'].includes(f.type) && !isBlank(record[f.key])) return String(record[f.key])
  }
  return `${collection.singular || 'Record'} ${String(record.id).slice(0, 6)}`
}

/* ───────────────────────── hooks ───────────────────────── */
export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = React.useState(value)
  React.useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

/* One shared 30 s clock for every relative timestamp (no per-cell intervals, no Date.now() in render). */
let clockNow = 0
const clockListeners = new Set<() => void>()
let clockTimer: ReturnType<typeof setInterval> | null = null
function subscribeClock(cb: () => void) {
  clockListeners.add(cb)
  if (!clockTimer) {
    clockNow = Date.now()
    clockTimer = setInterval(() => {
      clockNow = Date.now()
      clockListeners.forEach((l) => l())
    }, 30_000)
  }
  return () => {
    clockListeners.delete(cb)
    if (!clockListeners.size && clockTimer) {
      clearInterval(clockTimer)
      clockTimer = null
      clockNow = 0 // never serve a stale time to the next subscriber
    }
  }
}
const clockSnapshot = () => clockNow || (clockNow = Date.now())
/** Current time in ms, re-rendering every 30 s. 0 during SSR/hydration (render placeholders then). */
export function useNow(): number {
  return React.useSyncExternalStore(subscribeClock, clockSnapshot, () => 0)
}

const noopSubscribe = () => () => {}
/** false on the server and during hydration, true once mounted on the client. */
export function useMounted(): boolean {
  return React.useSyncExternalStore(noopSubscribe, () => true, () => false)
}

/** Stale-while-revalidate list state keyed by request: loading ⇔ latest result is for another key. */
export type Loaded = { key: string; rows: RecordRow[] | null; total: number | null; error: ApiError | null }
export function toLoaded(key: string, r: ListResponse | null | undefined): Loaded {
  const rows = Array.isArray(r?.rows) ? r.rows : []
  const t = Number(r?.total)
  return { key, rows, total: Number.isFinite(t) ? t : rows.length, error: null }
}
export function toFailed(key: string, prev: Loaded | null, e: unknown, fallback: string): Loaded {
  return { key, rows: prev?.rows ?? null, total: prev?.total ?? null, error: e instanceof ApiError ? e : new ApiError(0, fallback) }
}

const FRESH_MS = 15_000
/** Rows created in the last few seconds (or saved locally) get a one-shot highlight. */
export function useFreshness() {
  const local = React.useRef(new Map<string, number>())
  const mark = React.useCallback((id: string) => local.current.set(String(id), Date.now()), [])
  const isFresh = React.useCallback((row: RecordRow) => {
    const now = Date.now()
    const at = local.current.get(String(row.id))
    if (at && now - at < FRESH_MS) return true
    const created = parseDate(row.created_at)?.getTime()
    return created !== undefined && now - created < FRESH_MS && now - created > -60_000
  }, [])
  return { mark, isFresh }
}

type RelOption = { id: string; label: string }
const relationCache = new Map<string, { at: number; promise: Promise<RelOption[]> }>()

export function loadRelationOptions(projectId: string, blueprint: Blueprint, target: string, force = false): Promise<RelOption[]> {
  const col = blueprint.collections.find((c) => c.key === target)
  if (!col) return Promise.resolve([])
  const key = `${projectId}:${target}`
  const hit = relationCache.get(key)
  if (hit && !force && Date.now() - hit.at < 30_000) return hit.promise
  const promise = apiFetch<ListResponse>(`${recordsUrl(projectId, target)}?limit=200`)
    .then((r) => (Array.isArray(r?.rows) ? r.rows : []).map((row) => ({ id: String(row.id), label: titleOf(col, row) })))
    .catch(() => [] as RelOption[])
  relationCache.set(key, { at: Date.now(), promise })
  return promise
}

/** Options for one relation target (FieldInput). */
export function useRelationOptions(projectId: string | undefined, blueprint: Blueprint | undefined, target: string | null | undefined) {
  const [opts, setOpts] = React.useState<RelOption[] | null>(null)
  React.useEffect(() => {
    if (!projectId || !target || !blueprint) return
    let alive = true
    // Cached for 30 s, so a new blueprint object identity doesn't refetch.
    loadRelationOptions(projectId, blueprint, target).then((o) => alive && setOpts(o))
    return () => {
      alive = false
    }
  }, [projectId, blueprint, target])
  return opts
}

/** id → label maps for every relation field in `fields` (TableModule / Kanban). */
export function useRelationLabels(projectId: string, blueprint: Blueprint, fields: Field[], refreshKey: number) {
  const [maps, setMaps] = React.useState<Record<string, Record<string, string>>>({})
  const targets = fields.filter((f) => f.type === 'relation' && f.relation).map((f) => `${f.key}:${f.relation}`).join('|')
  const lastRefresh = React.useRef(refreshKey)
  React.useEffect(() => {
    if (!targets) return
    let alive = true
    const force = lastRefresh.current !== refreshKey // live update → re-resolve labels
    lastRefresh.current = refreshKey
    const pairs = targets.split('|').map((p) => p.split(':') as [string, string])
    Promise.all(pairs.map(([, target]) => loadRelationOptions(projectId, blueprint, target, force))).then((all) => {
      if (!alive) return
      const next: Record<string, Record<string, string>> = {}
      // Seeds/website forms may reference by title instead of id — resolve both.
      pairs.forEach(([fieldKey], i) => (next[fieldKey] = Object.fromEntries(all[i].flatMap((o) => [[o.label, o.label], [o.id, o.label]]))))
      setMaps(next)
    })
    return () => {
      alive = false
    }
  }, [projectId, blueprint, targets, refreshKey])
  return maps
}

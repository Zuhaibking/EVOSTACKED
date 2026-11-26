/**
 * Record + setting validation for the per-project platform backend.
 *
 * Every write goes through here before it reaches SQLite: values are coerced by
 * field type, unknown / system keys are stripped, required fields are checked
 * with field-level errors, and public (website) creates keep only fields the
 * blueprint marks `publicWritable`.
 */
import { FIELD_TYPES, IDENT, type Collection, type Field, type Setting } from './types'

export type FieldErrors = Record<string, string>
export type ValidationResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; errors: FieldErrors; data: Record<string, unknown> }

export type ValidateOptions = {
  mode: 'create' | 'update'
  /** Website / anonymous create: only `publicWritable` fields are accepted. */
  public?: boolean
  /** Skip required checks and drop invalid values silently (seed + workflow rows). */
  lenient?: boolean
}

export const SYSTEM_KEYS = new Set(['id', 'created_at', 'updated_at'])

const MAX_LEN: Record<string, number> = {
  text: 500, longtext: 10_000, email: 254, phone: 40, url: 2048, enum: 120, relation: 200,
}
const MAX_IMAGE_LEN = 400_000 // data:image URIs (owner uploads)

const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g
const EMAIL = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/
const PHONE_CHARS = /^[+\d\s().\-\/x#*]+$/i
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})/

type Coerced = { ok: true; value: unknown } | { ok: false; error: string }
const ok = (value: unknown): Coerced => ({ ok: true, value })
const fail = (error: string): Coerced => ({ ok: false, error })

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isBlank(v: unknown): boolean {
  return v === undefined || v === null || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0)
}

function asText(v: unknown): string | null {
  if (typeof v === 'string') return v.replace(CONTROL_CHARS, '').trim()
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  return null
}

function pad(n: number) { return String(n).padStart(2, '0') }

function toDateOnly(v: unknown): string | null {
  if (typeof v === 'string') {
    const m = ISO_DATE.exec(v.trim())
    if (m) {
      const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
      return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] ? `${m[1]}-${m[2]}-${m[3]}` : null
    }
  }
  const d = v instanceof Date ? v : typeof v === 'string' || typeof v === 'number' ? new Date(v) : null
  if (!d || Number.isNaN(d.getTime())) return null
  // Same sane year range as toDateTime: free-form parsing accepts e.g. "Jan 1 20270".
  const y = d.getFullYear()
  if (y < 1900 || y > 2200) return null
  return `${y}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function toDateTime(v: unknown): string | null {
  const d = v instanceof Date ? v : typeof v === 'string' || typeof v === 'number' ? new Date(typeof v === 'string' ? v.trim() : v) : null
  if (!d || Number.isNaN(d.getTime())) return null
  const y = d.getUTCFullYear()
  return y < 1900 || y > 2200 ? null : d.toISOString()
}

/** Currency symbols, optionally led by a country prefix (US$, CA$, R$), and 3-letter ISO codes around an amount. */
const MONEY_AFFIX = /[A-Z]{0,3}[$\u00A2-\u00A5\u20A0-\u20C0]|^[A-Z]{3}(?=[\s\d+\-.])|[A-Z]{3}$/g
/** Plain decimal: optional sign, digits with optional consistent thousands separators (, _ or space), optional fraction. No exponent. */
const PLAIN_NUMBER = /^[+-]?(?:\d{1,3}(?:([,_\s])\d{3})(?:\1\d{3})*|\d+)?(?:\.\d*)?$/

/** "1,299.50" · "$1 299" · "-$5.00" · "84.00 €" · "USD 12" → number; "1e15", "(500)", "12abc", "1,5" → null. */
function parseNumber(v: unknown, money: boolean): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v !== 'string') return null
  let s = v.trim().replace(/[\u2212\u2012-\u2014\uFE63\uFF0D]/g, '-')
  if (money) s = s.replace(MONEY_AFFIX, '')
  // the sign may sit outside a stripped symbol: "-$5" / "- 5" → "-5"
  s = s.trim().replace(/^([+-])\s+/, '$1')
  if (!/\d/.test(s) || !PLAIN_NUMBER.test(s)) return null
  const n = Number(s.replace(/[,_\s]/g, ''))
  return Number.isFinite(n) ? n : null
}

/** Website (anonymous) creates: no negatives, bounded magnitudes and dates. */
export const PUBLIC_MAX = { number: 1e6, money: 1e7 } as const
const YEAR_MS = 365.25 * 86_400_000
const BIRTH_FIELD = /(^|_)(birth|birthday|birthdate|dob|born)(_|$)/

/** Accepted public date window: now-1y..now+2y (birth dates: the last 120 years). */
function publicDateWindow(key: string | undefined): { min: number; max: number } {
  const now = Date.now()
  return key && BIRTH_FIELD.test(key) ? { min: now - 120 * YEAR_MS, max: now } : { min: now - YEAR_MS, max: now + 2 * YEAR_MS }
}

const TRUE = new Set(['true', 'yes', 'y', 'on', '1', 'checked'])
const FALSE = new Set(['false', 'no', 'n', 'off', '0', ''])

function normalizeUrl(raw: string, allowRelative: boolean): string | null {
  const s = raw.trim()
  if (allowRelative && s.startsWith('/') && !s.startsWith('//')) return s
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(s) ? s : /^[^\s/]+\.[^\s]+$/.test(s) ? `https://${s}` : s
  try {
    const u = new URL(withScheme)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null
  } catch {
    return null
  }
}

/**
 * Coerce one raw value for a field. Blank → null (caller decides about `required`).
 * `public` (website create): numbers must be ≥ 0 and ≤ PUBLIC_MAX, dates within publicDateWindow.
 */
export function coerceValue(field: Pick<Field, 'type' | 'options' | 'label'> & { key?: string }, raw: unknown, opts: { public?: boolean } = {}): Coerced {
  const type = (FIELD_TYPES as readonly string[]).includes(field.type) ? field.type : 'text'
  if (type === 'boolean') {
    if (raw === undefined || raw === null) return ok(null)
    if (typeof raw === 'boolean') return ok(raw)
    if (raw === 1 || raw === 0) return ok(raw === 1)
    const s = typeof raw === 'string' ? raw.trim().toLowerCase() : null
    if (s !== null && TRUE.has(s)) return ok(true)
    if (s !== null && FALSE.has(s)) return ok(false)
    return fail('Must be true or false')
  }
  if (isBlank(raw)) return ok(type === 'tags' ? [] : null)

  switch (type) {
    case 'number':
    case 'money': {
      const n = parseNumber(raw, type === 'money')
      if (n === null) return fail(type === 'money' ? 'Must be an amount' : 'Must be a number')
      if (Math.abs(n) > 1e15) return fail('Number is too large')
      if (opts.public) {
        if (n < 0) return fail('Must be zero or more')
        if (n > PUBLIC_MAX[type]) return fail(type === 'money' ? 'Amount is too large' : 'Number is too large')
      }
      return ok(type === 'money' ? Math.round(n * 100) / 100 : n)
    }
    case 'date': {
      const d = toDateOnly(raw)
      if (!d) return fail('Must be a date (YYYY-MM-DD)')
      if (opts.public) {
        const w = publicDateWindow(field.key)
        // Compare instants, not strings ("20270-01-01" sorts between "2027-…" and "2028-…").
        const t = Date.parse(`${d}T00:00:00Z`)
        const dayStart = (ms: number) => Date.parse(`${new Date(ms).toISOString().slice(0, 10)}T00:00:00Z`)
        if (!Number.isFinite(t) || t < dayStart(w.min) || t > dayStart(w.max)) return fail('Date is out of range')
      }
      return ok(d)
    }
    case 'datetime': {
      const d = toDateTime(raw)
      if (!d) return fail('Must be a date and time')
      if (opts.public) {
        const w = publicDateWindow(field.key)
        const t = Date.parse(d)
        if (t < w.min || t > w.max) return fail('Date is out of range')
      }
      return ok(d)
    }
    case 'email': {
      const s = asText(raw)
      if (s === null || s.length > MAX_LEN.email || !EMAIL.test(s)) return fail('Must be a valid email address')
      return ok(s)
    }
    case 'phone': {
      const s = asText(raw)
      const digits = s ? s.replace(/\D/g, '').length : 0
      if (s === null || s.length > MAX_LEN.phone || !PHONE_CHARS.test(s) || digits < 5 || digits > 20) return fail('Must be a valid phone number')
      return ok(s)
    }
    case 'url': {
      const s = asText(raw)
      const u = s && s.length <= MAX_LEN.url ? normalizeUrl(s, false) : null
      return u ? ok(u) : fail('Must be a valid http(s) URL')
    }
    case 'image': {
      const s = asText(raw)
      if (s && /^data:image\/(png|jpe?g|gif|webp|avif|svg\+xml);base64,[a-z0-9+/=\s]+$/i.test(s)) {
        return s.length <= MAX_IMAGE_LEN ? ok(s) : fail('Image is too large')
      }
      const u = s && s.length <= MAX_LEN.url ? normalizeUrl(s, true) : null
      return u ? ok(u) : fail('Must be an image URL')
    }
    case 'enum': {
      const s = asText(raw)
      if (s === null) return fail('Must be text')
      const options = (field.options || []).filter((o) => typeof o === 'string' && o.trim())
      if (!options.length) return s.length <= MAX_LEN.enum ? ok(s) : fail(`Too long (max ${MAX_LEN.enum})`)
      const hit = options.find((o) => o === s) ?? options.find((o) => o.toLowerCase() === s.toLowerCase())
      return hit ? ok(hit) : fail(`Must be one of: ${options.join(', ')}`)
    }
    case 'relation': {
      const ref = isPlainObject(raw) ? raw.id : raw
      const s = asText(ref)
      if (s === null || !s) return fail('Must be a record reference')
      return s.length <= MAX_LEN.relation ? ok(s) : fail(`Too long (max ${MAX_LEN.relation})`)
    }
    case 'tags': {
      const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(',') : null
      if (!list) return fail('Must be a list of tags')
      const out: string[] = []
      for (const item of list) {
        const s = asText(item)
        if (s === null) return fail('Tags must be text')
        const t = s.slice(0, 60)
        if (t && !out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t)
      }
      return out.length > 30 ? fail('Too many tags (max 30)') : ok(out)
    }
    default: {
      // text, longtext (and any unknown type, treated as text)
      const s = asText(raw)
      if (s === null) return fail('Must be text')
      const max = MAX_LEN[type] ?? MAX_LEN.text
      return s.length <= max ? ok(s) : fail(`Too long (max ${max} characters)`)
    }
  }
}

/** Fields that can hold data (valid identifier, not a system column). */
export function dataFields(collection: Collection): Field[] {
  return (collection.fields || []).filter((f) => f && IDENT.test(f.key) && !SYSTEM_KEYS.has(f.key))
}

/**
 * Validate a create/update payload against a collection.
 * - unknown + system keys are stripped
 * - public creates keep only `publicWritable` fields (required is enforced only for those)
 * - creates default the statusField to its first option and booleans to false
 */
export function validateRecord(collection: Collection, input: unknown, opts: ValidateOptions): ValidationResult {
  const src = isPlainObject(input) ? input : {}
  const errors: FieldErrors = {}
  const data: Record<string, unknown> = {}
  const fields = dataFields(collection)

  for (const field of fields) {
    if (opts.public && !field.publicWritable) continue
    if (!Object.prototype.hasOwnProperty.call(src, field.key)) continue
    const r = coerceValue(field, src[field.key], { public: opts.public })
    if (r.ok) data[field.key] = r.value
    else if (!opts.lenient) errors[field.key] = r.error
  }

  if (opts.mode === 'create') {
    const status = collection.statusField ? fields.find((f) => f.key === collection.statusField) : undefined
    if (status && status.type === 'enum' && isBlank(data[status.key])) {
      const first = (status.options || []).find((o) => typeof o === 'string' && o.trim())
      if (first) data[status.key] = first
    }
    for (const f of fields) {
      if (f.type === 'boolean' && data[f.key] == null && !(f.key in errors)) data[f.key] = false
    }
    if (!opts.lenient) {
      for (const f of fields) {
        if (!f.required || (opts.public && !f.publicWritable) || f.key in errors) continue
        if (isBlank(data[f.key])) errors[f.key] = `${f.label || f.key} is required`
      }
    }
  } else if (!opts.lenient) {
    for (const f of fields) {
      if (f.required && f.key in data && isBlank(data[f.key]) && !(f.key in errors)) errors[f.key] = `${f.label || f.key} is required`
    }
  }

  return Object.keys(errors).length ? { ok: false, errors, data } : { ok: true, data }
}

/** "Email must be a valid email address; Name is required" */
export function describeErrors(collection: Collection, errors: FieldErrors): string {
  return Object.entries(errors)
    .map(([key, msg]) => {
      const label = collection.fields.find((f) => f.key === key)?.label || key
      return msg.startsWith(label) ? msg : `${label}: ${msg}`
    })
    .join('; ')
}

/** Coerce a settings value (stored as string). */
export function coerceSettingValue(setting: Setting, raw: unknown): { ok: true; value: string } | { ok: false; error: string } {
  const s = raw === null || raw === undefined ? '' : typeof raw === 'string' ? raw.replace(CONTROL_CHARS, '').trim() : String(raw)
  switch (setting.type) {
    case 'number':
    case 'money': {
      if (s === '') return { ok: true, value: '' }
      const n = parseNumber(s, setting.type === 'money')
      return n === null ? { ok: false, error: 'Must be a number' } : { ok: true, value: String(setting.type === 'money' ? Math.round(n * 100) / 100 : n) }
    }
    case 'boolean': {
      const v = s.toLowerCase()
      if (TRUE.has(v)) return { ok: true, value: 'true' }
      if (FALSE.has(v)) return { ok: true, value: 'false' }
      return { ok: false, error: 'Must be true or false' }
    }
    case 'select': {
      const options = setting.options || []
      if (!options.length) return s.length <= 200 ? { ok: true, value: s } : { ok: false, error: 'Too long' }
      const hit = options.find((o) => o === s) ?? options.find((o) => o.toLowerCase() === s.toLowerCase())
      return hit ? { ok: true, value: hit } : { ok: false, error: `Must be one of: ${options.join(', ')}` }
    }
    default:
      return s.length <= 2000 ? { ok: true, value: s } : { ok: false, error: 'Too long (max 2000 characters)' }
  }
}

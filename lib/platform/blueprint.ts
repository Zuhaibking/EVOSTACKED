/**
 * EvoStack Platform — Blueprint generation + normalization (BLUEPRINT agent).
 *
 * generateBlueprint({spec, brief, files}) → {blueprint, seed}
 *   1. pick a preset (spec.projectType, or keyword inference from the brief),
 *   2. let gpt-4.1 adapt/extend it for THIS business (generateObject + blueprintSchema, temp 0.2, 45 s hard timeout),
 *   3. normalizeBlueprint() the result (sanitized keys, valid references, caps, core modules),
 *   4. seed = preset rows for kept/renamed collections (conformed to the new fields) + deterministic
 *      synthesized rows for new collections. ANY failure → the normalized preset + its seed.
 *
 * Server-only (uses the server OpenAI key through getModelClient). See presets.ts for the
 * seed-value and workflow-action conventions the runtime relies on.
 */
import { generateObject, type LanguageModel } from 'ai'
import { z } from 'zod'

import { getModelClient } from '../models'
import {
  CORE_MODULE_KINDS, LUCIDE_ICONS, MODULE_GROUPS, PRESET_KEYS, collectionModule, coreModule, iconFor, inferGroup,
  inferModuleKind, presetKeyForType, rawPresetBlueprint, rawPresetSeed, seedClock, sortModules, stampCreatedAt,
  type CollectionModuleKind, type CoreModuleKind, type ModuleGroup, type PresetKey, type SeedClock,
} from './presets'
import {
  FIELD_TYPES, IDENT, MODULE_KINDS, PROJECT_TYPES, blueprintSchema, toIdent,
  type Blueprint, type Chart, type Collection, type Field, type FieldType, type Metric, type Module, type ProjectSpec,
  type ProjectType, type SeedData, type Setting, type Workflow,
} from './types'

export { PRESET_KEYS, presetKeyForType, type PresetKey }

export const BLUEPRINT_LIMITS = {
  collections: 10, fields: 20, workflows: 12, metrics: 8, charts: 8, settings: 16, options: 16, actions: 5,
} as const
const RESERVED_FIELD_KEYS = new Set(['id', 'created_at', 'updated_at', 'rowid', 'oid', '_rowid_'])
const NUMERIC: FieldType[] = ['number', 'money']
const TITLE_OK: FieldType[] = ['text', 'email', 'phone', 'url', 'number', 'money', 'enum', 'date', 'datetime']
const DATE_TYPES: FieldType[] = ['date', 'datetime']

// ───────────────────────── small coercion helpers ─────────────────────────
type Obj = Record<string, unknown>
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {})
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const str = (v: unknown, max = 200): string =>
  typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : typeof v === 'number' && Number.isFinite(v) ? String(v) : ''
const bool = (v: unknown, fallback = false): boolean =>
  typeof v === 'boolean' ? v : v === 'true' || v === 1 ? true : v === 'false' || v === 0 ? false : fallback
const humanize = (key: string) => key.replace(/_/g, ' ').replace(/\s+/g, ' ').trim().replace(/^\w/, c => c.toUpperCase())
const oneOf = <T extends string>(v: unknown, list: readonly T[]): T | null => (list as readonly string[]).includes(v as string) ? (v as T) : null
function uniqueKey(base: string, used: Set<string>): string {
  let k = base
  for (let i = 2; used.has(k); i++) k = `${base.slice(0, 36)}_${i}`
  used.add(k)
  return k
}
function uniqStrings(list: unknown[], max: number, maxLen = 40): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const v of list) {
    const s = str(v, maxLen)
    if (!s || seen.has(s.toLowerCase())) continue
    seen.add(s.toLowerCase())
    out.push(s)
    if (out.length >= max) break
  }
  return out
}
/** Case/format-insensitive match of a value against enum options → canonical option. */
function matchOption(options: string[], v: unknown): string | null {
  const s = str(v, 80)
  if (!s) return null
  const exact = options.find(o => o === s) ?? options.find(o => o.toLowerCase() === s.toLowerCase())
  if (exact) return exact
  const id = toIdent(s, '')
  return options.find(o => toIdent(o, '') === id) ?? null
}
/** Looser match for free-form labels ("Main Course" → "Mains", "Hair cuts" → "Haircut"). */
function fuzzyOption(options: string[], v: unknown): string | null {
  const exact = matchOption(options, v)
  if (exact) return exact
  const norm = (x: string) => x.toLowerCase().replace(/[^a-z]+/g, ' ').trim().split(' ').map(w => w.replace(/(es|s)$/, '')).join('')
  const s = norm(str(v, 80))
  if (s.length < 3) return null
  return options.find(o => { const n = norm(o); return n.length >= 3 && (s.includes(n) || n.includes(s)) }) ?? null
}
function validIcon(raw: unknown, fallback: string): string {
  const s = str(raw, 60)
  if (LUCIDE_ICONS.has(s)) return s
  const pascal = s.replace(/(^|[-_\s]+)([a-zA-Z0-9])/g, (_, __, c: string) => c.toUpperCase())
  return LUCIDE_ICONS.has(pascal) ? pascal : fallback
}
const GROUP_SYNONYMS: [RegExp, ModuleGroup][] = [
  [/^overview|home|dashboard/, 'Overview'], [/sale|revenue|billing|finance|marketing|commerce|pipeline|crm/, 'Sales'],
  [/catalog|product|inventory|menu|service|offer/, 'Catalog'], [/operation|ops|schedul|team|fleet|logistic|kitchen|delivery|work/, 'Operations'],
  [/customer|client|people|member|communit|audience|contact|guest/, 'Customers'], [/insight|analytic|report|data|metric/, 'Insights'],
  [/system|admin|setting|config|automation/, 'System'],
]
function normalizeGroup(raw: unknown): ModuleGroup | null {
  const s = str(raw, 40).toLowerCase()
  if (!s) return null
  const direct = MODULE_GROUPS.find(g => g.toLowerCase() === s)
  if (direct) return direct
  for (const [re, g] of GROUP_SYNONYMS) if (re.test(s)) return g
  return null
}

// ───────────────────────── normalizeBlueprint ─────────────────────────
type Resolver = (raw: unknown) => string | null
function makeResolver(keys: string[]): Resolver {
  return (raw: unknown) => {
    const s = toIdent(str(raw, 80), '')
    if (!s) return null
    if (keys.includes(s)) return s
    const variants = new Set([`${s}s`, `${s}es`, s.replace(/ies$/, 'y'), s.replace(/y$/, 'ies'), s.replace(/s$/, ''), s.replace(/es$/, '')])
    return keys.find(k => variants.has(k)) ?? null
  }
}

function normalizeField(raw: unknown, resolve: Resolver): Field | null {
  const o = obj(raw)
  const label = str(o.label, 60)
  const key = toIdent(str(o.key, 80) || label, '')
  if (!key || RESERVED_FIELD_KEYS.has(key)) return null
  let type: FieldType = oneOf(o.type, FIELD_TYPES) ?? 'text'
  let options: string[] = []
  let relation: string | null = null
  if (type === 'enum' || type === 'tags') {
    options = uniqStrings(arr(o.options), BLUEPRINT_LIMITS.options)
    if (type === 'enum' && options.length < 2) type = 'text'
    if (type === 'text') options = []
  }
  if (type === 'relation') {
    relation = resolve(o.relation)
    if (!relation) type = 'text'
  }
  return {
    key, label: label || humanize(key), type, required: bool(o.required), options, relation,
    showInTable: bool(o.showInTable, true), publicWritable: bool(o.publicWritable),
  }
}

const STRONG_DATE_RE = /start|scheduled|reserved|appointment|booking|slot|pickup_at|event_date|session/
function normalizeCollection(o: Obj, key: string, label: string, resolve: Resolver): Collection {
  const seen = new Set<string>()
  const fields: Field[] = []
  for (const rf of arr(o.fields)) {
    const f = normalizeField(rf, resolve)
    if (!f || seen.has(f.key)) continue
    seen.add(f.key)
    fields.push(f)
    if (fields.length >= BLUEPRINT_LIMITS.fields) break
  }
  if (!fields.length) fields.push({ key: 'name', label: 'Name', type: 'text', required: true, options: [], relation: null, showInTable: true, publicWritable: true })
  const byKey = (k: unknown) => fields.find(f => f.key === toIdent(str(k, 80), ''))

  // titleField: an identifying, scalar field
  let title = byKey(o.titleField)
  if (!title || !TITLE_OK.includes(title.type)) {
    title = fields.find(f => /^(name|title|full_name|subject|code|number|label|customer_name|guest_name)$/.test(f.key) && TITLE_OK.includes(f.type))
      ?? fields.find(f => f.type === 'text') ?? fields.find(f => f.type === 'email') ?? fields.find(f => TITLE_OK.includes(f.type))
  }
  if (!title) {
    title = { key: 'name', label: 'Name', type: 'text', required: true, options: [], relation: null, showInTable: true, publicWritable: true }
    fields.unshift(title)
    if (fields.length > BLUEPRINT_LIMITS.fields) fields.pop()
  }
  // statusField: must be an enum
  let status = byKey(o.statusField)
  if (!status || status.type !== 'enum') status = fields.find(f => f.type === 'enum' && /^(status|stage|state|pipeline_stage|phase)$/.test(f.key))
  // dateField: must be date/datetime
  let date = byKey(o.dateField)
  if (!date || !DATE_TYPES.includes(date.type)) {
    const wanted = o.dateField != null && str(o.dateField) !== ''
    date = fields.find(f => DATE_TYPES.includes(f.type) && STRONG_DATE_RE.test(f.key))
      ?? (wanted ? fields.find(f => DATE_TYPES.includes(f.type)) : undefined)
  }

  const publicCreate = bool(o.publicCreate)
  let publicRead = bool(o.publicRead)
  // Privacy: never expose collections holding personal contact data to anonymous reads.
  if (publicRead && fields.some(f => f.type === 'email' || f.type === 'phone')) publicRead = false
  if (publicCreate) {
    if (!fields.some(f => f.publicWritable)) for (const f of fields) if (f.key !== status?.key) f.publicWritable = true
    title.publicWritable = true
    // A website submission can't satisfy a required field it isn't allowed to write.
    for (const f of fields) if (f.required && !f.publicWritable) f.required = false
  }
  const singularRaw = str(o.singular, 60)
  return {
    key, label, singular: singularRaw || humanize(label.replace(/ies$/i, 'y').replace(/s$/i, '')),
    icon: validIcon(o.icon, iconFor(`${key} ${label}`)),
    description: str(o.description, 160) || `Manage ${label.toLowerCase()}`,
    titleField: title.key, statusField: status?.key ?? null, dateField: date?.key ?? null,
    publicCreate, publicRead, fields,
  }
}

function normalizeModules(raw: unknown[], cols: Collection[], resolve: Resolver): Module[] {
  const byKey = new Map(cols.map(c => [c.key, c]))
  const out: Module[] = []
  const seenCol = new Set<string>()
  const seenCore = new Set<string>()
  for (const rm of raw.slice(0, 40)) {
    const o = obj(rm)
    const kind = oneOf(o.kind, MODULE_KINDS)
    if (!kind) continue
    if ((CORE_MODULE_KINDS as readonly string[]).includes(kind)) {
      if (seenCore.has(kind)) continue
      seenCore.add(kind)
      const base = coreModule(kind as CoreModuleKind)
      out.push({ ...base, label: str(o.label, 40) || base.label, icon: validIcon(o.icon, base.icon), description: str(o.description, 160) || base.description })
      continue
    }
    const c = byKey.get(resolve(o.collection) ?? '')
    if (!c || seenCol.has(c.key)) continue
    let k = kind as CollectionModuleKind
    if (k === 'kanban' && !c.statusField) k = c.dateField && inferModuleKind(c) === 'calendar' ? 'calendar' : 'table'
    if (k === 'calendar' && !c.dateField) k = c.statusField && inferModuleKind(c) === 'kanban' ? 'kanban' : 'table'
    seenCol.add(c.key)
    const m = collectionModule(c, k, normalizeGroup(o.group) ?? inferGroup(c))
    out.push({ ...m, label: str(o.label, 40) || c.label, icon: validIcon(o.icon, c.icon), description: str(o.description, 160) || c.description })
  }
  if (!seenCore.has('overview')) out.unshift(coreModule('overview'))
  for (const c of cols) if (!seenCol.has(c.key)) out.push(collectionModule(c))
  for (const k of CORE_MODULE_KINDS) if (k !== 'overview' && !seenCore.has(k)) out.push(coreModule(k))
  const used = new Set<string>(CORE_MODULE_KINDS) // core modules own their kind as key
  const keyed = out.map(m => ({ ...m, key: m.collection ? uniqueKey(m.collection, used) : m.kind }))
  // core modules keep their own groups so every Control Center has the same System/Insights tail
  return sortModules(keyed.map(m => (m.collection ? m : { ...m, group: coreModule(m.kind as CoreModuleKind).group })))
}

function fieldOf(c: Collection, raw: unknown): Field | undefined {
  const k = toIdent(str(raw, 80), '')
  return k ? c.fields.find(f => f.key === k) : undefined
}
function normalizeFilter(c: Collection, raw: unknown): Metric['filter'] | undefined {
  if (raw == null) return null
  const o = obj(raw)
  const f = fieldOf(c, o.field)
  if (!f) return undefined
  if (f.type === 'enum') {
    const v = matchOption(f.options, o.equals)
    return v ? { field: f.key, equals: v } : undefined
  }
  if (f.type === 'boolean') return { field: f.key, equals: bool(o.equals) ? 'true' : 'false' }
  const v = str(o.equals, 80)
  return v ? { field: f.key, equals: v } : undefined
}

function normalizeMetrics(raw: unknown[], cols: Collection[], resolve: Resolver): Metric[] {
  const byKey = new Map(cols.map(c => [c.key, c]))
  const used = new Set<string>()
  const out: Metric[] = []
  for (const rm of raw) {
    if (out.length >= BLUEPRINT_LIMITS.metrics) break
    const o = obj(rm)
    const c = byKey.get(resolve(o.collection) ?? '')
    if (!c) continue
    const op = oneOf(o.op, ['count', 'sum', 'avg'] as const) ?? 'count'
    let field: Field | undefined
    if (op !== 'count') {
      field = fieldOf(c, o.field)
      if (!field || !NUMERIC.includes(field.type)) continue
    }
    const filter = normalizeFilter(c, o.filter)
    if (filter === undefined) continue
    let format = oneOf(o.format, ['number', 'money', 'percent'] as const) ?? (field?.type === 'money' ? 'money' : 'number')
    if (op === 'count' && format === 'money') format = 'number'
    if (field?.type === 'money') format = 'money'
    const label = str(o.label, 40)
    const key = uniqueKey(toIdent(str(o.key, 80) || label, `metric_${out.length + 1}`), used)
    out.push({ key, label: label || humanize(key), collection: c.key, op, field: field?.key ?? null, filter, format, icon: validIcon(o.icon, iconFor(`${key} ${c.key}`, 'Activity')) })
  }
  if (!out.length) {
    for (const c of cols.slice(0, 4)) out.push({ key: uniqueKey(toIdent(`total_${c.key}`, 'metric'), used), label: c.label, collection: c.key, op: 'count', field: null, filter: null, format: 'number', icon: c.icon })
  }
  return out
}

function normalizeCharts(raw: unknown[], cols: Collection[], resolve: Resolver): Chart[] {
  const byKey = new Map(cols.map(c => [c.key, c]))
  const used = new Set<string>()
  const out: Chart[] = []
  for (const rc of raw) {
    if (out.length >= BLUEPRINT_LIMITS.charts) break
    const o = obj(rc)
    const c = byKey.get(resolve(o.collection) ?? '')
    if (!c) continue
    const kind = oneOf(o.kind, ['timeseries', 'breakdown'] as const) ?? 'timeseries'
    const op = oneOf(o.op, ['count', 'sum'] as const) ?? 'count'
    let field: Field | undefined
    if (op === 'sum') {
      field = fieldOf(c, o.field)
      if (!field || !NUMERIC.includes(field.type)) continue
    }
    let groupBy: Field | undefined
    if (kind === 'breakdown') {
      groupBy = fieldOf(c, o.groupBy)
      if (!groupBy || groupBy.type !== 'enum') continue
    }
    const label = str(o.label, 60)
    const key = uniqueKey(toIdent(str(o.key, 80) || label, `chart_${out.length + 1}`), used)
    out.push({ key, label: label || humanize(key), kind, collection: c.key, op, field: field?.key ?? null, groupBy: groupBy?.key ?? null })
  }
  if (!out.length && cols.length) {
    const main = cols.find(c => c.publicCreate) ?? cols[0]
    out.push({ key: uniqueKey(`${main.key}_over_time`.slice(0, 40), used), label: main.label, kind: 'timeseries', collection: main.key, op: 'count', field: null, groupBy: null })
    const withStatus = cols.find(c => c.statusField)
    if (withStatus) out.push({ key: uniqueKey(`${withStatus.key}_by_status`.slice(0, 40), used), label: `${withStatus.label} by status`, kind: 'breakdown', collection: withStatus.key, op: 'count', field: null, groupBy: withStatus.statusField })
  }
  return out
}

const SYSTEM_PLACEHOLDERS = new Set(['id', 'created_at', 'updated_at'])
/** Keep {{field}} placeholders that exist on the trigger record; repair near-misses, drop the rest. */
function fixTemplate(msg: string, c: Collection): string {
  let dropped = false
  const out = msg.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, raw: string) => {
    const k = toIdent(raw.replace(/^(record|row|item|data)\./, ''), '')
    if (k && (SYSTEM_PLACEHOLDERS.has(k) || c.fields.some(f => f.key === k))) return `{{${k}}}`
    if (k && /^(title|name|record_title)$/.test(k)) return `{{${c.titleField}}}`
    const near = k ? c.fields.find(f => f.key.endsWith(`_${k}`) || f.key.startsWith(`${k}_`) || k.endsWith(`_${f.key}`)) : undefined
    if (near) return `{{${near.key}}}`
    dropped = true
    return ''
  })
  return (dropped ? out.replace(/\s+([,.!?])/g, '$1').replace(/\(\s*\)/g, '').replace(/\s{2,}/g, ' ') : out).trim()
}
function coerceSettingValue(type: Setting['type'] | FieldType, v: unknown, options: string[]): string | null {
  if (type === 'boolean') return bool(v) ? 'true' : 'false'
  if (type === 'number' || type === 'money') {
    const n = typeof v === 'number' ? v : parseFloat(str(v, 40))
    return Number.isFinite(n) ? String(n) : null
  }
  if (type === 'enum' || type === 'select') return matchOption(options, v)
  return str(v, 200)
}

type Action = Workflow['actions'][number]
function normalizeAction(raw: unknown, trigger: Collection, byKey: Map<string, Collection>, resolve: Resolver): Action | null {
  const o = obj(raw)
  const type = oneOf(o.type, ['set_field', 'create_record', 'notify', 'adjust_number'] as const)
  if (!type) return null
  const message = str(o.message, 240)
  const linked = (target: Collection) => target.key === trigger.key || trigger.fields.some(f => f.type === 'relation' && f.relation === target.key)
  if (type === 'notify') {
    const fixed = fixTemplate(message, trigger)
    return { type, collection: null, field: null, value: null, message: fixed || `${trigger.singular} update: {{${trigger.titleField}}}` }
  }
  if (type === 'set_field' || type === 'adjust_number') {
    const target = o.collection != null && str(o.collection) ? byKey.get(resolve(o.collection) ?? '') : trigger
    if (!target || !linked(target)) return null
    const f = fieldOf(target, o.field)
    if (!f) return null
    if (type === 'adjust_number') {
      if (!NUMERIC.includes(f.type)) return null
      const n = parseFloat(str(o.value, 40))
      if (!Number.isFinite(n) || n === 0) return null
      return { type, collection: target.key, field: f.key, value: String(n), message: message || null }
    }
    if (f.type === 'relation' || f.type === 'tags') return null
    const value = coerceSettingValue(f.type, o.value, f.options)
    if (value == null) return null
    return { type, collection: target.key === trigger.key ? null : target.key, field: f.key, value, message: message || null }
  }
  // create_record: value = JSON object (field → literal or {{placeholder}} from the trigger record)
  const target = byKey.get(resolve(o.collection) ?? '')
  if (!target) return null
  let data: Obj = {}
  try { data = obj(JSON.parse(str(o.value, 2000) || '{}')) } catch { data = {} }
  const clean: Obj = {}
  for (const [k, v] of Object.entries(data)) {
    const f = fieldOf(target, k)
    if (f && (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')) clean[f.key] = typeof v === 'string' ? fixTemplate(v, trigger) || v : v
  }
  if (!Object.keys(clean).length) {
    for (const f of target.fields) if (trigger.fields.some(t => t.key === f.key)) clean[f.key] = `{{${f.key}}}`
    if (target.fields.some(f => f.type === 'relation' && f.relation === trigger.key)) {
      const rel = target.fields.find(f => f.type === 'relation' && f.relation === trigger.key)!
      clean[rel.key] = `{{${trigger.titleField}}}`
    }
  }
  if (!Object.keys(clean).length) return null
  return { type, collection: target.key, field: null, value: JSON.stringify(clean), message: message || null }
}

function normalizeWorkflows(raw: unknown[], cols: Collection[], resolve: Resolver): Workflow[] {
  const byKey = new Map(cols.map(c => [c.key, c]))
  const used = new Set<string>()
  const out: Workflow[] = []
  for (const rw of raw) {
    if (out.length >= BLUEPRINT_LIMITS.workflows) break
    const o = obj(rw)
    const t = obj(o.trigger)
    const c = byKey.get(resolve(t.collection) ?? '')
    if (!c) continue
    let event = oneOf(t.event, ['created', 'updated', 'status_changed'] as const) ?? 'created'
    let toStatus: string | null = null
    if (event === 'status_changed') {
      const sf = c.statusField ? c.fields.find(f => f.key === c.statusField) : undefined
      if (!sf) event = 'updated'
      else if (t.toStatus != null && str(t.toStatus)) {
        toStatus = matchOption(sf.options, t.toStatus)
        if (!toStatus) continue // a status this pipeline doesn't have → the workflow would never fire as intended
      }
    }
    const actions = arr(o.actions).map(a => normalizeAction(a, c, byKey, resolve)).filter((a): a is Action => !!a).slice(0, BLUEPRINT_LIMITS.actions)
    if (!actions.length) continue
    const name = str(o.name, 80)
    const key = uniqueKey(toIdent(str(o.key, 80) || name, `workflow_${out.length + 1}`), used)
    // Workflows have no conditions: a rule that reads as conditional ("large party → review", "VIP only")
    // would fire on EVERY record — ship it disabled so the owner opts in knowingly.
    const description = str(o.description, 200)
    const conditional = /\b(large|big|vip|high[-_ ]?value|over|under|above|below|more[-_ ]than|less[-_ ]than|only|if|threshold|exceeds?)\b/i
      .test(`${key.replace(/_/g, ' ')} ${name}`)
    const enabled = bool(o.enabled, true) && !conditional
    out.push({ key, name: name || humanize(key), description, trigger: { collection: c.key, event, toStatus }, actions, enabled })
  }
  return out
}

const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'INR', 'JPY']
function normalizeSettings(raw: unknown[]): Setting[] {
  const used = new Set<string>()
  const out: Setting[] = []
  for (const rs of raw) {
    if (out.length >= BLUEPRINT_LIMITS.settings) break
    const o = obj(rs)
    const label = str(o.label, 60)
    const key = toIdent(str(o.key, 80) || label, '')
    if (!key || used.has(key)) continue
    let type = oneOf(o.type, ['text', 'number', 'boolean', 'select', 'money'] as const) ?? 'text'
    let options = type === 'select' ? uniqStrings(arr(o.options), 24, 60) : []
    if (type === 'select' && !options.length) { type = 'text'; options = [] }
    let value = coerceSettingValue(type, o.value, options) ?? (type === 'select' ? options[0] : type === 'boolean' ? 'false' : type === 'text' ? '' : '0')
    if (type === 'text' && /email/.test(key) && value.includes('@')) value = value.replace(/\s+/g, '')
    used.add(key)
    out.push({ key, label: label || humanize(key), type, value, options, group: str(o.group, 40) || 'General', description: str(o.description, 160) })
  }
  if (!used.has('currency')) {
    out.splice(1, 0, { key: 'currency', label: 'Currency', type: 'select', value: 'USD', options: CURRENCIES, group: out[0]?.group || 'General', description: 'Used for prices, totals and revenue' })
  }
  return out
}

/**
 * Sanitize any (LLM / user / stored) blueprint into a fully consistent one:
 * keys → toIdent + deduped; titleField / statusField (enum) / dateField (date|datetime) valid;
 * relations, modules, metrics, charts and workflows only reference real collections/fields;
 * core modules present (overview first); caps: ≤10 collections, ≤20 fields each, ≤12 workflows.
 * Idempotent: normalizeBlueprint(normalizeBlueprint(x)) deep-equals normalizeBlueprint(x).
 */
export function normalizeBlueprint(raw: unknown): Blueprint {
  const o = obj(raw)
  const usedCols = new Set<string>()
  const heads: { o: Obj; key: string; label: string }[] = []
  for (const [i, rc] of arr(o.collections).entries()) {
    if (heads.length >= BLUEPRINT_LIMITS.collections) break
    const co = obj(rc)
    const label = str(co.label, 60)
    const key = toIdent(str(co.key, 80) || label, `collection_${i + 1}`)
    if (usedCols.has(key) || RESERVED_FIELD_KEYS.has(key)) continue
    usedCols.add(key)
    heads.push({ o: co, key, label: label || humanize(key) })
  }
  const resolve = makeResolver(heads.map(h => h.key))
  const collections = heads.map(h => normalizeCollection(h.o, h.key, h.label, resolve))
  return {
    projectType: oneOf(o.projectType, PROJECT_TYPES) ?? 'custom',
    appName: str(o.appName, 60) || 'My Business',
    collections,
    modules: normalizeModules(arr(o.modules), collections, resolve),
    metrics: normalizeMetrics(arr(o.metrics), collections, resolve),
    charts: normalizeCharts(arr(o.charts), collections, resolve),
    workflows: normalizeWorkflows(arr(o.workflows), collections, resolve),
    settings: normalizeSettings(arr(o.settings)),
  }
}

/** Invariant check (empty array = valid). Used by tests and as a guard before provisioning. */
export function blueprintProblems(b: Blueprint): string[] {
  const p: string[] = []
  const parsed = blueprintSchema.safeParse(b)
  if (!parsed.success) p.push(`schema: ${parsed.error.issues.slice(0, 3).map(i => `${i.path.join('.')} ${i.message}`).join('; ')}`)
  if (!b.collections.length) p.push('no collections')
  if (b.collections.length > BLUEPRINT_LIMITS.collections) p.push('too many collections')
  if (b.workflows.length > BLUEPRINT_LIMITS.workflows) p.push('too many workflows')
  const cols = new Map(b.collections.map(c => [c.key, c]))
  if (cols.size !== b.collections.length) p.push('duplicate collection keys')
  for (const c of b.collections) {
    if (!IDENT.test(c.key)) p.push(`bad collection key ${c.key}`)
    if (c.fields.length > BLUEPRINT_LIMITS.fields) p.push(`${c.key}: too many fields`)
    const fk = new Map(c.fields.map(f => [f.key, f]))
    if (fk.size !== c.fields.length) p.push(`${c.key}: duplicate field keys`)
    for (const f of c.fields) {
      if (!IDENT.test(f.key) || RESERVED_FIELD_KEYS.has(f.key)) p.push(`${c.key}.${f.key}: bad key`)
      if (f.type === 'enum' && f.options.length < 2) p.push(`${c.key}.${f.key}: enum without options`)
      if (f.type === 'relation' && !cols.has(f.relation ?? '')) p.push(`${c.key}.${f.key}: dangling relation`)
    }
    if (!fk.has(c.titleField)) p.push(`${c.key}: bad titleField`)
    if (c.statusField && fk.get(c.statusField)?.type !== 'enum') p.push(`${c.key}: statusField not enum`)
    if (c.dateField && !DATE_TYPES.includes(fk.get(c.dateField)?.type as FieldType)) p.push(`${c.key}: dateField not date`)
  }
  if (b.modules[0]?.kind !== 'overview') p.push('overview module not first')
  for (const k of CORE_MODULE_KINDS) if (!b.modules.some(m => m.kind === k)) p.push(`missing core module ${k}`)
  if (new Set(b.modules.map(m => m.key)).size !== b.modules.length) p.push('duplicate module keys')
  for (const c of b.collections) if (!b.modules.some(m => m.collection === c.key)) p.push(`no module for ${c.key}`)
  for (const m of b.modules) {
    if (!m.collection) continue
    const c = cols.get(m.collection)
    if (!c) p.push(`module ${m.key}: unknown collection`)
    else if (m.kind === 'kanban' && !c.statusField) p.push(`module ${m.key}: kanban without statusField`)
    else if (m.kind === 'calendar' && !c.dateField) p.push(`module ${m.key}: calendar without dateField`)
  }
  const numeric = (c: string, f: string | null) => !!f && NUMERIC.includes(cols.get(c)?.fields.find(x => x.key === f)?.type as FieldType)
  for (const m of b.metrics) {
    if (!cols.has(m.collection)) p.push(`metric ${m.key}: unknown collection`)
    else if (m.op !== 'count' && !numeric(m.collection, m.field)) p.push(`metric ${m.key}: non-numeric field`)
    if (m.filter) {
      const f = cols.get(m.collection)?.fields.find(x => x.key === m.filter!.field)
      if (!f) p.push(`metric ${m.key}: unknown filter field`)
      else if (f.type === 'enum' && !f.options.includes(m.filter.equals)) p.push(`metric ${m.key}: filter value not an option`)
    }
  }
  for (const ch of b.charts) {
    if (!cols.has(ch.collection)) p.push(`chart ${ch.key}: unknown collection`)
    else if (ch.op === 'sum' && !numeric(ch.collection, ch.field)) p.push(`chart ${ch.key}: non-numeric field`)
    if (ch.kind === 'breakdown' && cols.get(ch.collection)?.fields.find(x => x.key === ch.groupBy)?.type !== 'enum') p.push(`chart ${ch.key}: groupBy not enum`)
  }
  for (const w of b.workflows) {
    const c = cols.get(w.trigger.collection)
    if (!c) { p.push(`workflow ${w.key}: unknown collection`); continue }
    if (w.trigger.toStatus && !c.fields.find(f => f.key === c.statusField)?.options.includes(w.trigger.toStatus)) p.push(`workflow ${w.key}: bad toStatus`)
    for (const a of w.actions) {
      const target = a.collection ? cols.get(a.collection) : c
      if (!target) p.push(`workflow ${w.key}: action on unknown collection`)
      else if ((a.type === 'set_field' || a.type === 'adjust_number') && !target.fields.some(f => f.key === a.field)) p.push(`workflow ${w.key}: action on unknown field`)
    }
  }
  return p
}

// ───────────────────────── presets (public API) ─────────────────────────
/** Normalized preset blueprint for a project type (ecommerce|saas|…|custom) or preset key (…|generic). */
export function presetBlueprint(type?: ProjectType | PresetKey | string | null): Blueprint {
  return normalizeBlueprint(rawPresetBlueprint(type))
}
/** Seed rows for the preset (8–20 per collection), conformed to presetBlueprint(type). */
export function presetSeed(type?: ProjectType | PresetKey | string | null, now = Date.now()): SeedData {
  const bp = presetBlueprint(type)
  return conformSeed(bp, bp, rawPresetSeed(type, now), now)
}

// ───────────────────────── preset inference ─────────────────────────
const PRESET_HINTS: [PresetKey, RegExp][] = [
  ['restaurant', /restaurant|bistro|caf[eé]|coffee shop|bakery|pizzeria|diner|eatery|trattoria|osteria|sushi|taqueria|brunch|food truck|takeout|take-away|dine-in|menu|kitchen|chef|catering|reservations? (for|of) tables?/g],
  ['booking', /booking|appointment|salon|spa\b|barber|groom|clinic|dentist|therap|massage|yoga|pilates|gym|fitness|lesson|tutor|coach|session|schedul|calendar|photograph|consultation|veterinar|physio|nail|beauty|class(es)? |studio rental|rental|slot/g],
  ['ecommerce', /shop|store|e-?commerce|cart|checkout|merch|sneaker|apparel|boutique|catalog|inventory|marketplace|products?|sell(ing)? |shipping|sku/g],
  ['saas', /saas|software|platform|subscription|api\b|startup|waitlist|b2b|dashboard|analytics tool|ai tool|productivity|workspace|mrr|trial/g],
  ['agency', /agency|freelanc|consultanc|consulting|portfolio|design firm|marketing firm|law firm|architect|contractor|lead gen|creative studio|proposals?|retainer/g],
]
/** Pick a preset from free text by keyword hits (generic when nothing matches). */
export function inferPresetKey(text: string): PresetKey {
  const s = String(text || '').toLowerCase()
  let best: PresetKey = 'generic'
  let bestScore = 0
  for (const [key, re] of PRESET_HINTS) {
    const score = new Set(s.match(re) ?? []).size
    if (score > bestScore) { best = key; bestScore = score }
  }
  return best
}
const PRESET_TO_TYPE: Record<PresetKey, ProjectType> = { ecommerce: 'ecommerce', saas: 'saas', restaurant: 'restaurant', agency: 'agency', booking: 'booking', generic: 'custom' }

function specText(spec: ProjectSpec | null): string {
  if (!spec) return ''
  return [spec.name, spec.tagline, spec.summary, spec.industry, ...spec.entities.map(e => `${e.name} ${e.description}`),
    ...spec.features.map(f => f.name), ...spec.workflows.map(w => `${w.trigger} ${w.outcome}`)].join(' ')
}
function choosePreset(spec: ProjectSpec | null, brief: string): { presetKey: PresetKey; projectType: ProjectType } {
  const declared = spec?.projectType && spec.projectType !== 'custom' ? spec.projectType : null
  if (declared) return { presetKey: presetKeyForType(declared), projectType: declared }
  const presetKey = inferPresetKey(`${specText(spec)} ${brief}`)
  return { presetKey, projectType: spec?.projectType ?? PRESET_TO_TYPE[presetKey] }
}

// ───────────────────────── website form hints ─────────────────────────
const NON_FORM_NAMES = /^(viewport|description|keywords|author|robots|generator|theme-color|application-name|format-detection|referrer|color-scheme|og:|twitter:|apple-|msapplication|csrf|_)/
export type FormHints = { forms: Record<string, string[]>; names: string[] }
/** Grep generated website files for `data-evo-collection` forms and input `name=` attributes. */
export function extractFormHints(files: { file_path: string; file_content: string }[] = []): FormHints {
  const forms: Record<string, Set<string>> = {}
  const names = new Set<string>()
  const nameRe = /\bname\s*=\s*\{?\s*["'`]([a-z][A-Za-z0-9_\-[\]]{0,40})["'`]/g
  for (const file of files.slice(0, 60)) {
    const src = String(file?.file_content ?? '').slice(0, 250_000)
    if (!src) continue
    for (const m of src.matchAll(/data-evo-collection\s*=\s*\{?\s*["'`]([^"'`]{1,60})["'`]/g)) {
      const key = toIdent(m[1], '')
      if (!key) continue
      const region = src.slice(m.index ?? 0, (m.index ?? 0) + 8000)
      const end = region.search(/<\/form>/i)
      const scope = end > 0 ? region.slice(0, end) : region
      const set = (forms[key] ??= new Set())
      for (const n of scope.matchAll(nameRe)) if (!NON_FORM_NAMES.test(n[1])) set.add(n[1])
      for (const n of scope.matchAll(/data-evo-field\s*=\s*\{?\s*["'`]([^"'`]{1,40})["'`]/g)) set.add(n[1])
    }
    for (const n of src.matchAll(nameRe)) if (!NON_FORM_NAMES.test(n[1])) names.add(n[1])
    for (const n of src.matchAll(/data-evo-field\s*=\s*\{?\s*["'`]([^"'`]{1,40})["'`]/g)) names.add(n[1])
  }
  return { forms: Object.fromEntries(Object.entries(forms).map(([k, v]) => [k, [...v].slice(0, 30)])), names: [...names].slice(0, 80) }
}

// ───────────────────────── LLM adaptation ─────────────────────────
const ICON_SUGGESTIONS = 'ShoppingCart, ShoppingBag, Package, Tag, Users, UserCog, UserPlus, Building2, CalendarDays, CalendarCheck, Clock, UtensilsCrossed, ChefHat, Briefcase, Target, KanbanSquare, FolderKanban, ListTodo, Receipt, CreditCard, Percent, DollarSign, LifeBuoy, Inbox, Sparkles, Scissors, PawPrint, Truck, MapPin, Star, GraduationCap, Ticket, Home, Gauge, Layers, BarChart3, Activity, Workflow, Settings, LayoutDashboard'
const INSTRUCTIONS = `You are an expert operations architect. You design the backend (database collections + automations) and the admin Control Center for ONE specific small business whose public website has already been generated.

You receive a PRESET blueprint for the closest business archetype. Adapt and extend it so it fits THIS business exactly:
- Rename domain terms in labels/descriptions to the business's own vocabulary. KEEP existing collection and field keys whose meaning is unchanged (sample data is keyed by them); rename keys only when the concept really changes.
- Remove collections, fields, metrics or workflows that make no sense here; add domain-specific fields, collections (≤ 7 total, ≤ 12 fields each), workflows and settings the business clearly needs (from the spec's entities, workflows, features, integrations and the brief).
- keys: snake_case /^[a-z][a-z0-9_]*$/; collection keys plural. Never define id, created_at or updated_at fields (system columns).
- Field types: text, longtext, number, money, boolean, date, datetime, email, phone, url, image, enum, relation, tags. enum needs ≥2 options (FIRST option = default for new records; statuses lowercase snake_case). relation sets "relation" to the target collection key and stores the target's title. options [] and relation null when not applicable.
- titleField = the field that names a record. statusField = an enum field for a lifecycle/pipeline (or null). dateField = the date/datetime field that places records on a calendar (appointments, reservations, deliveries, due dates) or null.
- Website alignment: publicCreate = true only for collections the website submits to (orders, bookings, leads, signups, contact/quote forms); in those, set publicWritable = true on exactly the fields the website form sends and USE THE WEBSITE FORM FIELD NAMES given below as field keys where they fit. publicRead = true only for catalog-like collections the website displays (products, menu, services, plans) — never for collections with emails/phones.
- Modules: "overview" first; exactly one module per collection — "kanban" for pipelines with a statusField (leads, projects, tickets, kitchen orders, jobs), "calendar" for scheduled things with a dateField (appointments, reservations, visits), otherwise "table"; then "analytics", "activity", "workflows", "settings". group ∈ Overview | Sales | Catalog | Operations | Customers | Insights | System. icon = a lucide-react PascalCase name, e.g. ${ICON_SUGGESTIONS}.
- Metrics (4–7 KPIs the owner checks daily): op count | sum | avg (sum/avg only over number/money fields); filter null or {field: an enum field, equals: one of its options}; format money for currency amounts.
- Charts (3–5): "timeseries" (records per day; op count or sum of a number/money field) or "breakdown" (groupBy an enum field). groupBy null for timeseries; field null for count.
- Workflows (3–8 automations): trigger {collection, event created|updated|status_changed, toStatus: one of the statusField options or null}. Workflows have NO conditions — they fire on EVERY matching event, so never model rules like "only large parties" or "only VIPs". Actions (unused props null):
  · notify {message using {{field_key}} placeholders of the triggering record}
  · set_field {collection null = the triggering record, field, value}
  · adjust_number {collection = a collection the trigger record links to via a relation field, field = number field, value like "-1"}
  · create_record {collection, value = JSON object string mapping target fields to literals or {{field_key}} placeholders}
- Settings (5–10): business name, currency (select), taxes, opening hours, booking/buffer rules, policies, notification toggles — whatever this business configures. All values are strings.
- Be concise (output size matters): labels 1–3 words, collection/workflow/setting descriptions ≤ 8 words, module descriptions "". Return the COMPLETE blueprint.`

function compactSpec(spec: ProjectSpec | null): string {
  if (!spec) return '(no structured spec — infer from the brief)'
  const list = (xs: string[], n = 12) => xs.slice(0, n).join('; ') || '—'
  return [
    `name: ${spec.name} — ${spec.tagline}`,
    `type: ${spec.projectType} · industry: ${spec.industry}`,
    `summary: ${spec.summary}`,
    `customers: ${list(spec.audience.customers)} · operators: ${list(spec.audience.operators)}`,
    `entities: ${list(spec.entities.map(e => `${e.name} (${e.description})`), 14)}`,
    `workflows: ${list(spec.workflows.map(w => `${w.name}: when ${w.trigger} → ${w.outcome}`), 10)}`,
    `features: ${list(spec.features.map(f => `${f.name} [${f.priority}]`), 16)}`,
    `integrations: ${list(spec.integrations)}`,
    `pages: ${list(spec.pages)}`,
    `constraints: ${list(spec.constraints, 8)}`,
  ].join('\n')
}
function compactPreset(bp: Blueprint): string {
  // Drop defaulted noise to save tokens; the schema reinstates every property on output.
  return JSON.stringify(bp, (k, v) => (k === 'description' && typeof v === 'string' && v.length > 70 ? `${v.slice(0, 70)}…` : v))
}
function buildPrompt(spec: ProjectSpec | null, brief: string, hints: FormHints, preset: Blueprint, presetKey: PresetKey): string {
  const formLines = Object.entries(hints.forms).map(([c, f]) => `- form data-evo-collection="${c}": ${f.join(', ') || '(no named inputs)'}`)
  return [
    'BUSINESS SPEC', compactSpec(spec), '',
    'BRIEF', (brief || '').slice(0, 3000) || '—', '',
    'WEBSITE FORMS (from the generated site code)',
    formLines.length ? formLines.join('\n') : '- (no data-evo-collection forms found)',
    `- all input names: ${hints.names.join(', ') || '—'}`, '',
    `PRESET (${presetKey}) — starting point:`, compactPreset(preset), '',
    `Return the adapted blueprint for "${spec?.name || 'this business'}" (projectType "${preset.projectType}").`,
  ].join('\n')
}

/** On-domain catalog names/prices (parallel, small call) so seeded menus/products/services fit THIS business. */
const catalogSampleSchema = z.object({
  items: z.array(z.object({ name: z.string(), brand: z.string(), category: z.string(), price: z.number(), description: z.string() })),
})
export type CatalogSample = z.infer<typeof catalogSampleSchema>['items'][number]
const CATALOG_NOUN: Record<PresetKey, string> = {
  ecommerce: 'products it sells', saas: 'pricing plans', restaurant: 'menu dishes and drinks', agency: '',
  booking: 'bookable services or packages', generic: 'products, services or packages it offers',
}
async function sampleCatalog(model: LanguageModel, spec: ProjectSpec | null, brief: string, presetKey: PresetKey, signal: AbortSignal): Promise<CatalogSample[]> {
  if (!CATALOG_NOUN[presetKey]) return []
  const { object } = await generateObject({
    model, schema: catalogSampleSchema, schemaName: 'catalog', temperature: 0.4, maxRetries: 0, abortSignal: signal,
    prompt: `Business:\n${compactSpec(spec)}\n\nBrief: ${brief.slice(0, 1200) || '—'}\n\nList 12 realistic ${CATALOG_NOUN[presetKey]} for THIS business (believable names a real owner would use, varied categories, realistic prices in USD as plain numbers, brand/maker when the business sells branded goods else "", one-line descriptions ≤ 12 words).`,
  })
  return object.items.filter(i => str(i.name)).slice(0, 16)
}

const NAME_SETTING_RE = /(^|_)(store|shop|business|restaurant|agency|studio|salon|clinic|product|company|brand|app|site)_name$/
function withAppName(bp: Blueprint, spec: ProjectSpec | null): Blueprint {
  const name = str(spec?.name, 60)
  if (!name) return bp
  return { ...bp, appName: name, settings: bp.settings.map(s => (NAME_SETTING_RE.test(s.key) && s.type === 'text' ? { ...s, value: name } : s)) }
}

export type GenerateBlueprintInput = {
  spec: ProjectSpec | null
  brief: string
  files?: { file_path: string; file_content: string }[]
  /** hard timeout for the LLM call (default 45 s) */
  timeoutMs?: number
  /** diagnostics hook: where the blueprint came from, timing, failure reason */
  onInfo?: (info: { source: 'llm' | 'preset'; presetKey: PresetKey; ms: number; error?: string }) => void
}

/** Generate the project's Blueprint + seed rows. Never throws: any failure → normalized preset. */
export async function generateBlueprint(input: GenerateBlueprintInput): Promise<{ blueprint: Blueprint; seed: SeedData }> {
  const started = Date.now()
  const spec = input?.spec ?? null
  const brief = String(input?.brief ?? '')
  const { presetKey, projectType } = choosePreset(spec, brief)
  const now = Date.now()
  const preset = withAppName(normalizeBlueprint({ ...rawPresetBlueprint(presetKey), projectType }), spec)
  const pSeed = rawPresetSeed(presetKey, now)
  let catalog: Promise<CatalogSample[]> = Promise.resolve([])
  const settled = (ms: number) => Promise.race([catalog, new Promise<CatalogSample[]>(r => setTimeout(() => r([]), ms).unref?.())])
  const fallback = async (error: string) => {
    input?.onInfo?.({ source: 'preset', presetKey, ms: Date.now() - started, error })
    return { blueprint: preset, seed: conformSeed(preset, preset, pSeed, now, await settled(0)) }
  }
  const ctrl = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const hints = extractFormHints(Array.isArray(input?.files) ? input.files : [])
    const model = getModelClient({ id: 'gpt-4.1', provider: 'EvoStack', providerId: 'openai', name: 'Asta' }, {}) as LanguageModel
    catalog = sampleCatalog(model, spec, brief, presetKey, ctrl.signal).catch(() => [] as CatalogSample[])
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { ctrl.abort(); reject(new Error(`timed out after ${input?.timeoutMs ?? 45_000} ms`)) }, input?.timeoutMs ?? 45_000)
    })
    const result = await Promise.race([
      generateObject({
        model, schema: blueprintSchema, schemaName: 'blueprint', schemaDescription: 'Backend + Control Center blueprint',
        instructions: INSTRUCTIONS, prompt: buildPrompt(spec, brief, hints, preset, presetKey),
        temperature: 0.2, maxRetries: 0, abortSignal: ctrl.signal,
      }),
      timeout,
    ])
    const blueprint = withAppName(normalizeBlueprint({ ...result.object, projectType }), spec)
    const problems = blueprintProblems(blueprint)
    if (problems.length) return await fallback(`invalid after normalize: ${problems.slice(0, 3).join('; ')}`)
    // the catalog call is much smaller and normally done already; never wait more than a few seconds for it
    const samples = await settled(4_000)
    input?.onInfo?.({ source: 'llm', presetKey, ms: Date.now() - started })
    return { blueprint, seed: conformSeed(blueprint, preset, pSeed, now, samples) }
  } catch (err) {
    console.warn('[blueprint] generation failed, using preset:', presetKey, err instanceof Error ? err.message : err)
    return await fallback(err instanceof Error ? err.message : String(err))
  } finally {
    if (timer) clearTimeout(timer)
    ctrl.abort() // cancel anything still in flight (no-op when finished)
  }
}

// ───────────────────────── seed: conform preset rows + synthesize new ones ─────────────────────────
const FIRST = ['Ava', 'Liam', 'Sofia', 'Noah', 'Maya', 'Ethan', 'Chloe', 'Lucas', 'Isla', 'Mateo', 'Zara', 'Owen', 'Priya', 'Leo', 'Hana', 'Diego', 'Grace', 'Omar', 'Elena', 'Jonah', 'Mia', 'Kofi', 'Nora', 'Sam']
const LAST = ['Thompson', 'Patel', 'Rossi', 'Kim', 'Garcia', 'Nguyen', 'Brooks', 'Martin', 'Okafor', 'Schmidt', 'Haddad', 'Lindqvist', 'Costa', 'Reyes', 'Walsh', 'Tanaka', 'Moreau', 'Bell', 'Fischer', 'Clarke', 'Mensah', 'Diaz', 'Novak', 'Hughes']
const COMPANIES = ['Brightloop', 'Fernway', 'Northpeak', 'Copperline', 'Helio Health', 'Atlas Robotics', 'Greenline', 'Kumo Studio', 'Solace', 'Tradewind', 'Pixelcraft', 'Baseframe']
const CITIES = ['Portland', 'Austin', 'Denver', 'Seattle', 'Chicago', 'Boston', 'Nashville', 'San Diego', 'Atlanta', 'Brooklyn']
const STREETS = ['Elm St', 'Maple Ave', 'Oak Dr', 'Cedar Ln', 'Pine St', 'Harbor Rd', 'Lake Shore Dr', 'Market St', 'Bedford Ave', 'Sunset Blvd']
const AREAS = ['Downtown', 'Northside', 'Westside', 'Eastside', 'Riverside', 'Uptown', 'Midtown', 'Southside']
const PET_NAMES = ['Biscuit', 'Luna', 'Max', 'Bella', 'Cooper', 'Daisy', 'Milo', 'Rosie', 'Teddy', 'Pepper', 'Charlie', 'Nala']
const BREEDS = ['Golden Retriever', 'French Bulldog', 'Labradoodle', 'Poodle', 'Cocker Spaniel', 'Shih Tzu', 'Border Collie', 'Dachshund', 'Bernese Mountain Dog', 'Maltese', 'Australian Shepherd', 'Yorkshire Terrier']
const VEHICLES = ['Ford Transit', 'Mercedes Sprinter', 'Ram ProMaster', 'Nissan NV200', 'Ford E-Transit', 'Chevrolet Express']
const COLORS = ['Black', 'White', 'Navy', 'Olive', 'Sand', 'Charcoal', 'Red', 'Sky']
const ROLES = ['Manager', 'Lead', 'Specialist', 'Coordinator', 'Associate', 'Technician']
const ADJ = ['Classic', 'Signature', 'Express', 'Deluxe', 'Essential', 'Premium', 'Seasonal', 'Complete', 'Mini', 'Ultimate', 'Starter', 'Custom']
const SUBJECTS = ['Question about availability', 'Request for a quote', 'Follow-up on last visit', 'Change of plans', 'Pricing for a group', 'Special request', 'Feedback on service', 'Partnership inquiry', 'Billing question', 'Scheduling help']
const BLURBS = ['Popular with regulars.', 'Limited availability this month.', 'Our most requested option.', 'Includes everything in the standard tier.', 'Great for first-timers.', 'Seasonal favourite.', 'Best value for groups.', 'Recently updated.', 'Available on request.', 'Staff pick this season.']
const PET_NOTES = ['Nervous around dryers — hand dry.', 'Matting behind the ears.', 'Sensitive skin, hypoallergenic shampoo only.', 'Senior dog, go gently on the hips.', 'Loves treats, very food motivated.', 'Park in the driveway, side gate is open.', 'Nail trim only if calm.', 'Second dog in the same household.']
const NOTES = ['Prefers morning slots.', 'Returning customer — very happy last time.', 'Asked for a call before arrival.', 'Gate code 4417.', 'Allergic to fragrances.', 'Pays by card on file.', 'Referred by a friend.', 'Wants a reminder the day before.', 'First time — explain the process.', 'Flexible on timing.']
const PERSON_RE = /customer|client|user|member|guest|patient|student|contact|lead|staff|employee|team|groomer|driver|attendee|volunteer|donor|owner|people|person|subscriber|signup|waitlist|inquir|enquir|appointment|booking|reservation|order|applicant|candidate|tenant|parent|instructor|stylist|therapist|technician/
const APPT_RE = /appointment|reservation|booking|session|class|lesson|visit|meeting|shift|schedule|slot|groom|consult|tour|rental|event|job|route|delivery|pickup/

function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  return h >>> 0
}
const pick = <T,>(list: T[], n: number): T => list[Math.abs(n) % list.length]
const slug = (s: string) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'item'
const round = (n: number, step: number) => Math.round(n / step) * step

function personFor(c: Collection, i: number, salt = 0) {
  const h = hash(c.key) + salt * 7
  const first = pick(FIRST, i * 5 + h)
  const last = pick(LAST, i * 7 + (h >>> 3))
  return { first, last, full: `${first} ${last}`, email: `${slug(first)}.${slug(last)}@example.com`.replace(/-/g, ''), phone: `+1 555 01${String((i * 13 + h) % 100).padStart(2, '0')}` }
}

/** Deterministic fake value for a field (row i). Relations get '' and are reconciled to real titles later. */
function synthValue(c: Collection, f: Field, i: number, clock: SeedClock, ctx = ''): unknown {
  const k = `${f.key} ${f.label}`.toLowerCase()
  const colName = `${c.key} ${c.label}`.toLowerCase()
  const shoes = /sneaker|shoe|kick|footwear|trainer/.test(ctx)
  const pets = /dog|pet|groom|puppy|canine|cat\b|vet/.test(ctx)
  const h = hash(`${c.key}.${f.key}`) + i * 31
  const person = personFor(c, i)
  const isPersonCol = PERSON_RE.test(`${c.key} ${c.label}`.toLowerCase()) || c.fields.some(x => x.type === 'email' || x.type === 'phone')
  const apptCol = APPT_RE.test(`${c.key} ${c.label}`.toLowerCase())
  switch (f.type) {
    case 'email': return person.email
    case 'phone': return person.phone
    case 'url': return `https://example.com/${slug(c.singular)}-${i + 1}`
    case 'image': return `https://picsum.photos/seed/${slug(`${c.key}-${i + 1}`)}/640/480`
    case 'boolean': return /cancel|archiv|delete|block|suspend|disabled|overdue|late/.test(k) ? i % 5 === 0 : i % 5 !== 3
    case 'enum': return f.key === c.statusField ? pick(f.options, i * 3 + (i % 2)) : pick(f.options, i * 7 + (h % 3))
    case 'tags': {
      const pool = f.options.length ? f.options : /size/.test(k) ? (shoes ? ['7', '8', '9', '10', '11', '12'] : ['S', 'M', 'L', 'XL']) : /special|skill/.test(k) ? ['Senior', 'Certified', 'Bilingual'] : ['featured', 'new', 'popular']
      return [...new Set([pick(pool, i), pick(pool, i * 3 + 1), pick(pool, i * 3 + 2)])].slice(0, /size/.test(k) ? 3 : 1 + (i % 2))
    }
    case 'relation': return ''
    case 'number': {
      if (/qty|quantity|party|guests|people|pax|headcount/.test(k)) return 1 + (h % 6)
      if (/stock|inventory|units|on_hand/.test(k)) return h % 60
      if (/duration|minutes|mins|length/.test(k)) return pick([30, 45, 60, 75, 90, 120], h)
      if (/age|years_old/.test(k)) return 1 + (h % 14)
      if (/rating|stars|score/.test(k)) return 3 + (h % 3)
      if (/progress|percent|discount|rate|pct/.test(k)) return pick([10, 15, 20, 25, 40, 50, 75, 90], h)
      if (/weight|kg|lbs/.test(k)) return 4 + (h % 36)
      if (/year/.test(k)) return 2015 + (h % 10)
      if (/capacity|seats|size/.test(k)) return 2 + (h % 10)
      if (/mileage|odometer|miles|km/.test(k)) return round(12_000 + ((h * 731) % 90_000), 10)
      if (/hours/.test(k)) return 1 + (h % 8)
      return 1 + (h % 40)
    }
    case 'money': {
      if (/mrr|monthly|subscription/.test(k)) return pick([29, 49, 99, 199, 299], h)
      if (/budget|deal|contract|value|retainer|salary/.test(k)) return round(1_500 + ((h * 977) % 28_000), 100)
      if (/total|amount|revenue|spent|lifetime|invoice|paid|balance/.test(k)) return round(35 + ((h * 37) % 420), 0.5)
      if (/tip|deposit|fee/.test(k)) return pick([5, 10, 15, 20, 25, 35, 50], h)
      return pick([25, 35, 45, 55, 65, 75, 85, 95, 120, 150], h)
    }
    case 'date': {
      if (/due|expir|renew|next|follow|deadline|until|end/.test(k)) return clock.day(1 + (h % 30))
      if (/birth|dob/.test(k)) return clock.day(-(365 * (2 + (h % 10)) + (h % 200)))
      if (/last|start|joined|signup|since|issued|purchas|visit|registered|hired|created|opened/.test(k)) return clock.day(-(1 + (h % 90)))
      return clock.day(apptCol ? -6 + ((i * 2) % 19) : -(h % 30))
    }
    case 'datetime': {
      if (apptCol || STRONG_DATE_RE.test(f.key) || /time|when|at$/.test(f.key)) return clock.at(-6 + ((i * 2) % 19), 9 + ((i * 3) % 9), (i % 2) * 30)
      return clock.at(-(h % 30), 8 + (h % 10), (h % 2) * 30)
    }
    case 'longtext': {
      if (/items|line_items|order/.test(k)) return `${1 + (h % 3)} × ${c.singular} ${pick(ADJ, h)}`
      if (/address/.test(k)) return `${100 + (h % 900)} ${pick(STREETS, h)}, ${pick(CITIES, h >>> 2)}`
      if (/note|comment|instruction|special|request|message|feedback/.test(k)) return pick(pets ? PET_NOTES : NOTES, h)
      return pick(BLURBS, h)
    }
    default: { // text
      if (/first_name/.test(k)) return person.first
      if (/instagram|twitter|tiktok|handle|username|social/.test(k)) return `@${slug(person.first)}${slug(person.last)}`.replace(/-/g, '')
      if (/last_name|surname/.test(k)) return person.last
      if (/pet|dog|cat|puppy|animal_name/.test(k) && !/breed|type|size|species|owner/.test(k)) return pick(PET_NAMES, i + (h % 5))
      if (/(^|_|\s)(name|title)(\s|$)/.test(k) && /(^|_|\s)(pets?|dogs?|cats?|puppies|animals?)(\s|$)/.test(colName)) return pick(PET_NAMES, i + (h % 5))
      if (/(^|_|\s)(name|title|label)(\s|$)/.test(k) && /van|truck|vehicle|fleet|car\b|cars\b|bike/.test(colName)) return `${c.singular} ${String(i + 1).padStart(2, '0')}`
      if (/temperament|personality|mood|behavio/.test(k)) return pick(['Calm', 'Friendly', 'Playful', 'Nervous', 'Energetic', 'Gentle'], h)
      if (/level|skill|experience/.test(k)) return pick(['Beginner', 'Intermediate', 'Advanced'], h)
      if (/condition/.test(k)) return pick(['New', 'Like new', 'Good', 'Fair'], h)
      if (/frequency|cadence/.test(k)) return pick(['Weekly', 'Every 2 weeks', 'Monthly', 'Every 6 weeks'], h)
      if (/method|payment/.test(k)) return pick(['Card', 'Cash', 'Apple Pay', 'Bank transfer'], h)
      if (/colorway/.test(k)) return pick(['Black/White', 'Triple White', 'University Blue', 'Sail/Gum', 'Bred', 'Volt/Black'], i + h)
      if (/(^|_|\s)brand(\s|$)/.test(k) && shoes) return pick(['Nike', 'Adidas', 'New Balance', 'Asics', 'Puma', 'Converse', 'Salomon'], i + h)
      if (/breed/.test(k)) return pick(BREEDS, i + (h % 4))
      if (/species|animal_type/.test(k)) return pick(['Dog', 'Dog', 'Cat'], h)
      if (/company|business|organization|organisation|employer|brand|account|firm/.test(k)) return pick(COMPANIES, i + (h % 5))
      if (/(^|_|\s)(customer|client|guest|owner|contact|patient|student|member|attendee|parent|assignee|staff|groomer|driver|technician|stylist|therapist|rep|host)(_name)?(\s|$)/.test(k)) return personFor(c, i, /assignee|staff|groomer|driver|technician|stylist|therapist|rep|host/.test(k) ? 3 : 0).full
      if (/city|town/.test(k)) return pick(CITIES, h)
      if (/address|street|location/.test(k)) return `${100 + (h % 900)} ${pick(STREETS, h)}`
      if (/zip|postal|postcode/.test(k)) return String(10_000 + ((h * 37) % 89_999))
      if (/area|zone|region|neighbo|territory|district/.test(k)) return pick(AREAS, i + h)
      if (/plate|license|registration/.test(k)) return `${String.fromCharCode(65 + (h % 26))}${String.fromCharCode(65 + ((h >>> 3) % 26))}${100 + (h % 900)}`
      if (/vehicle|van|truck|car|model/.test(k)) return pick(VEHICLES, i + h)
      if (/colou?r/.test(k)) return pick(COLORS, h)
      if (/size/.test(k)) return shoes ? pick(['8', '8.5', '9', '9.5', '10', '10.5', '11', '12'], i + h) : pick(['Small', 'Medium', 'Large', 'X-Large'], h)
      if (/role|position|job_title/.test(k)) return /staff|team|employee|member|user/i.test(c.singular) ? pick(ROLES, h) : `${pick(['Senior ', 'Lead ', '', 'Junior '], h)}${c.singular}`
      if (/sku|code|ref|reference|number|invoice|order_no/.test(k)) return `${c.singular.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase() || 'REC'}-${1001 + i}`
      if (/subject|summary|headline|topic/.test(k)) return pick(SUBJECTS, i + h)
      if (/source|channel|referr/.test(k)) return pick(['Website', 'Referral', 'Instagram', 'Google', 'Walk-in'], h)
      if (/(^|_|\s)(name|full_name|title)(\s|$)/.test(k) && isPersonCol) return person.full
      if (/(^|_|\s)(name|title|label)(\s|$)/.test(k)) return `${pick(ADJ, i + (h % 3))} ${c.singular}`
      return `${c.singular} ${i + 1}`
    }
  }
}

/** Coerce an existing seed value to the field's type; undefined → caller synthesizes. */
function coerceSeedValue(f: Field, v: unknown): unknown {
  if (v === undefined) return undefined
  if (v === null || v === '') return f.required ? undefined : null
  switch (f.type) {
    case 'number': case 'money': { const n = typeof v === 'number' ? v : parseFloat(String(v)); return Number.isFinite(n) ? n : undefined }
    case 'boolean': return typeof v === 'boolean' ? v : v === 'true' ? true : v === 'false' ? false : undefined
    case 'enum': return matchOption(f.options, v) ?? undefined
    case 'tags': return Array.isArray(v) ? v.map(String) : typeof v === 'string' ? v.split(',').map(s => s.trim()).filter(Boolean) : undefined
    case 'date': return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : undefined
    case 'datetime': return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? (v.length >= 16 ? v.slice(0, 16) : `${v.slice(0, 10)}T09:00`) : undefined
    case 'relation': return typeof v === 'string' ? v : undefined
    default: return typeof v === 'string' || typeof v === 'number' ? String(v) : undefined
  }
}

/** The collection the website shows as its catalog (menu, products, services, plans…). */
function primaryCatalog(bp: Blueprint): Collection | undefined {
  return bp.collections.find(c => c.publicRead && !c.publicCreate && !c.dateField)
    ?? bp.collections.find(c => bp.modules.some(m => m.collection === c.key && m.group === 'Catalog'))
}

/**
 * Seed rows for `bp`: preset rows for collections whose key is unchanged, conformed field-by-field
 * (missing/invalid values synthesized); deterministic synthesized rows for new/renamed collections;
 * optional on-domain catalog samples applied to the primary catalog; relation values reconciled to
 * real titles of the target collection (and mentions of the old title in the same row rewritten).
 */
export function conformSeed(bp: Blueprint, _preset: Blueprint, pSeed: SeedData, now = Date.now(), samples: CatalogSample[] = []): SeedData {
  const clock = seedClock(now)
  const ctx = `${bp.appName} ${bp.collections.map(c => `${c.key} ${c.label}`).join(' ')}`.toLowerCase()
  const out: SeedData = {}
  const synthesized = new Set<string>()
  for (const c of bp.collections) {
    const src = pSeed[c.key]?.length ? pSeed[c.key].slice(0, 20) : null
    const base = src ?? Array.from({ length: 10 }, () => ({} as Record<string, unknown>))
    if (!src) synthesized.add(c.key)
    out[c.key] = stampCreatedAt(base.map((row, i) => {
      const r: Record<string, unknown> = {}
      for (const f of c.fields) {
        const v = coerceSeedValue(f, row[f.key])
        r[f.key] = v === undefined ? synthValue(c, f, i, clock, ctx) : v
      }
      if (typeof row.created_at === 'string') r.created_at = row.created_at
      return r
    }), clock)
  }
  const cat = samples.length >= 4 ? primaryCatalog(bp) : undefined
  const renames = new Map<string, string>() // old catalog title → new on-domain title
  if (cat && ['text', 'longtext'].includes(cat.fields.find(f => f.key === cat.titleField)?.type ?? '')) {
    const priceFs = cat.fields.filter(f => f.type === 'money' && /price|cost|rate|fee|amount/.test(f.key))
    if (!priceFs.length) { const m = cat.fields.find(f => f.type === 'money'); if (m) priceFs.push(m) }
    const catF = cat.fields.find(f => (f.type === 'enum' || f.type === 'text') && /categor|type|kind|section|course|department|collection|group|class/.test(f.key) && f.key !== cat.titleField)
    const brandF = cat.fields.find(f => f.type === 'text' && /brand|maker|manufacturer|designer|label|vendor/.test(f.key) && f.key !== cat.titleField)
    const descF = cat.fields.find(f => (f.type === 'longtext' || f.type === 'text') && /descr|detail|summary|about|blurb|features/.test(f.key) && f.key !== cat.titleField)
    const base = out[cat.key]
    const picked = samples.slice(0, 16)
    base.forEach((row, j) => { const old = row[cat.titleField]; if (typeof old === 'string' && old) renames.set(old, str(picked[j % picked.length].name, 80)) })
    out[cat.key] = picked.map((sample, i) => {
      const r = { ...(base[i % Math.max(1, base.length)] ?? {}) }
      r[cat.titleField] = str(sample.name, 80)
      if (Number.isFinite(sample.price) && sample.price >= 0) {
        // price, price_medium, price_large… scale up with each additional tier
        priceFs.forEach((f, k) => { r[f.key] = k === 0 ? Math.round(sample.price * 100) / 100 : round(sample.price * (1 + 0.3 * k), 5) })
      }
      if (catF?.type === 'enum') { const m = fuzzyOption(catF.options, sample.category); if (m || !catF.required) r[catF.key] = m }
      else if (catF) r[catF.key] = str(sample.category, 60)
      if (brandF && str(sample.brand)) r[brandF.key] = str(sample.brand, 60)
      if (descF) r[descF.key] = str(sample.description, 200)
      for (const f of cat.fields) if (f.type === 'image') r[f.key] = `https://picsum.photos/seed/${slug(sample.name)}/640/480`
      return r
    })
  }
  if (renames.size) {
    // kept rows that mention old catalog titles (relations, "2 × Margherita DOP") follow the new names
    const pairs = [...renames].filter(([o]) => o.length >= 4).sort((a, b) => b[0].length - a[0].length)
      .map(([o, n]) => [new RegExp(`(?<![\\p{L}\\p{N}])${o.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'gu'), n] as const)
    for (const c of bp.collections) {
      if (c.key === cat?.key) continue
      for (const r of out[c.key]) for (const f of c.fields) {
        const v = r[f.key]
        if (typeof v !== 'string' || !v) continue
        if (f.type === 'relation' && f.relation === cat?.key) { if (renames.has(v)) r[f.key] = renames.get(v) }
        else if (f.type === 'text' || f.type === 'longtext') r[f.key] = pairs.reduce((acc, [re, n]) => acc.replace(re, n), v)
      }
    }
  }
  // relations → titles that actually exist in the target collection
  const titles = new Map(bp.collections.map(c => [c.key, (out[c.key] ?? []).map(r => r[c.titleField]).filter((t): t is string | number => (typeof t === 'string' && t !== '') || typeof t === 'number').map(String)]))
  for (const c of bp.collections) {
    for (const f of c.fields) {
      if (f.type !== 'relation' || !f.relation) continue
      const pool = titles.get(f.relation) ?? []
      out[c.key].forEach((r, i) => {
        const v = r[f.key]
        if (typeof v === 'string' && v && pool.includes(v)) return
        if ((v === null || v === undefined) && !f.required && !synthesized.has(c.key)) return
        const next = pool.length ? pick(pool, i * 5 + hash(f.key)) : null
        r[f.key] = next
        // keep free text consistent: "1 × Merino Crew Sweater" → "1 × <new title>"
        if (typeof v === 'string' && v && next) {
          for (const g of c.fields) if ((g.type === 'text' || g.type === 'longtext') && typeof r[g.key] === 'string') r[g.key] = (r[g.key] as string).split(v).join(next)
        }
      })
    }
  }
  return out
}

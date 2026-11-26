/**
 * Blueprint workflow engine. Runs enabled workflows after records are created / updated /
 * change status, executes their actions (set_field, create_record, adjust_number, notify),
 * logs a `workflow.ran` event per run, cascades with a depth + re-entrancy guard and
 * NEVER throws into the request.
 */
import {
  createRecord, currencyOf, displayValue, emitEvent, findRecordsByField, findRecordsByRef, formatMoney,
  getCollection, getMeta, getWorkflows, lcFirst, titleOf, updateRecord,
} from './db'
import { toIdent, type Collection, type EventSource, type Field, type PlatformMeta, type RecordRow, type Workflow } from './types'
import { coerceValue, PUBLIC_MAX, validateRecord } from './validate'

export type WorkflowTrigger =
  | { kind: 'created'; collection: string; record: RecordRow; source: EventSource }
  | { kind: 'updated'; collection: string; record: RecordRow; before: RecordRow; source: EventSource }

type Action = Workflow['actions'][number]
type ActionResult = { type: Action['type']; ok: boolean; detail: string }
/** `origin` = source of the root trigger; cascades inherit it (website input stays website input). */
type Ctx = { projectId: string; meta: PlatformMeta; depth: number; budget: { actions: number }; origin: EventSource }

const MAX_DEPTH = 3
/** Counts that must never be decremented below zero by a workflow. */
const STOCK_LIKE = /(^|_)(stock|inventory|qty|quantity|on_hand|available|remaining|units|seats|spots|slots|capacity|count|uses)(_|$)/
const MAX_ACTIONS_PER_ROOT = 40
const g = globalThis as typeof globalThis & { __evoWorkflowActive?: Set<string> }
const active: Set<string> = g.__evoWorkflowActive ?? (g.__evoWorkflowActive = new Set())

function eqCI(a: unknown, b: unknown) {
  return String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase()
}

function matches(wf: Workflow, c: Collection, t: WorkflowTrigger): boolean {
  if (wf.trigger.collection !== t.collection) return false
  if (wf.trigger.event === 'created') return t.kind === 'created'
  if (wf.trigger.event === 'updated') return t.kind === 'updated'
  if (wf.trigger.event === 'status_changed') {
    if (t.kind !== 'updated' || !c.statusField) return false
    const now = t.record[c.statusField]
    if (eqCI(now, t.before[c.statusField])) return false
    return !wf.trigger.toStatus || eqCI(now, wf.trigger.toStatus)
  }
  return false
}

/** Run every enabled workflow matching the trigger. Safe to call from any request. */
export function runWorkflows(projectId: string, trigger: WorkflowTrigger): ActionResult[][] {
  return run({ projectId, meta: null as unknown as PlatformMeta, depth: 0, budget: { actions: 0 }, origin: trigger.source }, trigger)
}

function run(base: Ctx, t: WorkflowTrigger): ActionResult[][] {
  const out: ActionResult[][] = []
  try {
    if (base.depth > MAX_DEPTH) return out
    const meta = getMeta(base.projectId)
    if (!meta) return out
    const ctx: Ctx = { ...base, meta }
    const c = getCollection(meta, t.collection)
    if (!c) return out
    const workflows = getWorkflows(base.projectId).filter((w) => w.enabled && matches(w, c, t))
    for (const wf of workflows) {
      const guard = `${base.projectId}:${wf.key}:${t.record.id}`
      if (active.has(guard)) continue // re-entrant loop (A → B → A on the same record)
      active.add(guard)
      try {
        out.push(runOne(ctx, wf, c, t))
      } catch (e) {
        safeEmitRan(ctx, wf, c, t, [{ type: 'notify', ok: false, detail: `failed: ${errMsg(e)}` }])
      } finally {
        active.delete(guard)
      }
    }
  } catch (e) {
    console.error('[platform] workflow run failed', e)
  }
  return out
}

function runOne(ctx: Ctx, wf: Workflow, c: Collection, t: WorkflowTrigger): ActionResult[] {
  const results: ActionResult[] = []
  let current = t.record
  for (const action of Array.isArray(wf.actions) ? wf.actions : []) {
    if (++ctx.budget.actions > MAX_ACTIONS_PER_ROOT) {
      results.push({ type: action.type, ok: false, detail: 'skipped: action budget exhausted' })
      break
    }
    try {
      const r = runAction(ctx, wf, action, c, current)
      results.push(r.result)
      if (r.record) current = r.record
    } catch (e) {
      results.push({ type: action.type, ok: false, detail: `${action.type} failed: ${errMsg(e)}` })
    }
  }
  safeEmitRan(ctx, wf, c, t, results)
  return results
}

function safeEmitRan(ctx: Ctx, wf: Workflow, c: Collection, t: WorkflowTrigger, results: ActionResult[]) {
  try {
    const failed = results.filter((r) => !r.ok).length
    const details = results.map((r) => r.detail).filter(Boolean)
    emitEvent(ctx.projectId, {
      type: 'workflow.ran',
      collection: c.key,
      recordId: t.record.id,
      source: 'workflow',
      summary: `Workflow “${wf.name || wf.key}” ran on ${lcFirst(c.singular)} ${titleOf(c, t.record)}${details.length ? ` · ${details.join(' · ')}` : ''}${failed ? ` · ${failed} failed` : ''}`,
      payload: { workflow: wf.key, trigger: t.kind, event: wf.trigger.event, ok: failed === 0, results },
    })
  } catch (e) {
    console.error('[platform] could not log workflow run', e)
  }
}

function errMsg(e: unknown) {
  return String((e as Error)?.message || e).slice(0, 160)
}

// ───────────────────────── actions ─────────────────────────
function runAction(ctx: Ctx, wf: Workflow, action: Action, src: Collection, rec: RecordRow): { result: ActionResult; record?: RecordRow } {
  switch (action.type) {
    case 'notify': {
      const message = interpolate(ctx, action.message || action.value || wf.name || 'Workflow notification', src, rec)
      emitEvent(ctx.projectId, {
        type: 'notify', collection: src.key, recordId: rec.id, source: 'workflow', summary: message,
        payload: { workflow: wf.key, channel: action.field || 'dashboard', record: { id: rec.id, title: titleOf(src, rec) } },
      })
      return { result: { type: 'notify', ok: true, detail: `notified “${message.slice(0, 80)}”` } }
    }

    case 'set_field': {
      const target = action.collection && action.collection !== src.key ? getCollection(ctx.meta, action.collection) : src
      if (!target) return fail(action, `unknown collection ${action.collection}`)
      const field = target.fields.find((f) => f.key === action.field)
      if (!field) return fail(action, `unknown field ${action.field}`)
      const coerced = coerceValue(field, interpolate(ctx, action.value ?? '', src, rec))
      if (!coerced.ok) return fail(action, `${field.label}: ${coerced.error}`)
      const targets = target.key === src.key ? [rec] : related(ctx, src, rec, target)
      if (!targets.length) return fail(action, `no matching ${lcFirst(target.singular)}`)
      let self: RecordRow | undefined
      for (const r of targets) {
        const res = updateRecord(ctx.projectId, target.key, r.id, { [field.key]: coerced.value }, 'workflow')
        if (!res) continue
        if (target.key === src.key && r.id === rec.id) self = res.record
        if (Object.keys(res.changes).length) cascade(ctx, { kind: 'updated', collection: target.key, record: res.record, before: res.before, source: 'workflow' })
      }
      return { result: { type: 'set_field', ok: true, detail: `set ${field.label} = ${displayValue(ctx.projectId, field, coerced.value)}` }, record: self }
    }

    case 'adjust_number': {
      const target = action.collection ? getCollection(ctx.meta, action.collection) : src
      if (!target) return fail(action, `unknown collection ${action.collection}`)
      const field = target.fields.find((f) => f.key === action.field)
      if (!field || (field.type !== 'number' && field.type !== 'money')) return fail(action, `${action.field} is not a number field`)
      // Website-triggered: an amount read from the record keeps the configured sign and is capped
      // at what a website may enter itself (a "-quantity" can never add stock or move it by 1e15).
      const delta = resolveDelta(action.value, src, rec, ctx.origin === 'website' ? PUBLIC_MAX[field.type === 'money' ? 'money' : 'number'] : undefined)
      if (delta === null) return fail(action, `invalid amount “${action.value}”`)
      if (delta === 0) return { result: { type: 'adjust_number', ok: true, detail: `${field.label} unchanged` } }
      const targets = target.key === src.key ? [rec] : related(ctx, src, rec, target)
      if (!targets.length) return fail(action, `no matching ${lcFirst(target.singular)}`)
      const floor = delta < 0 && STOCK_LIKE.test(field.key)
      const names: string[] = []
      let self: RecordRow | undefined
      for (const r of targets.slice(0, 10)) {
        const base = typeof r[field.key] === 'number' ? (r[field.key] as number) : 0
        const raw = Math.round((base + delta) * 100) / 100
        const next = floor ? Math.max(0, raw) : raw
        const res = updateRecord(ctx.projectId, target.key, r.id, { [field.key]: next }, 'workflow')
        if (!res) continue
        names.push(titleOf(target, res.record) + (next !== raw ? ' (stopped at 0)' : ''))
        if (target.key === src.key && r.id === rec.id) self = res.record
        if (Object.keys(res.changes).length) cascade(ctx, { kind: 'updated', collection: target.key, record: res.record, before: res.before, source: 'workflow' })
      }
      const amount = field.type === 'money' ? formatMoney(Math.abs(delta), currencyOf(ctx.projectId)) : String(Math.abs(delta))
      return { result: { type: 'adjust_number', ok: names.length > 0, detail: `${field.label} ${delta > 0 ? '+' : '−'}${amount} on ${names.join(', ') || '—'}` }, record: self }
    }

    case 'create_record': {
      const target = action.collection ? getCollection(ctx.meta, action.collection) : null
      if (!target) return fail(action, `unknown collection ${action.collection}`)
      const data = mapFields(src, rec, target)
      if (action.field && action.value !== null && action.value !== undefined && target.fields.some((f) => f.key === action.field)) {
        data[action.field] = interpolate(ctx, action.value, src, rec)
      }
      const v = validateRecord(target, data, { mode: 'create', lenient: true })
      // People-like targets (have an email) are de-duplicated by email.
      const email = target.fields.find((f) => f.type === 'email' && typeof v.data[f.key] === 'string')
      if (email) {
        const existing = findRecordsByField(ctx.projectId, target.key, email.key, v.data[email.key], 1)[0]
        if (existing) return { result: { type: 'create_record', ok: true, detail: `${lcFirst(target.singular)} ${titleOf(target, existing)} already exists` } }
      }
      const created = createRecord(ctx.projectId, target.key, v.data, 'workflow')
      cascade(ctx, { kind: 'created', collection: target.key, record: created, source: 'workflow' })
      return { result: { type: 'create_record', ok: true, detail: `created ${lcFirst(target.singular)} ${titleOf(target, created)}` } }
    }

    default:
      return fail(action, `unsupported action ${String((action as Action).type)}`)
  }
}

function fail(action: Action, detail: string): { result: ActionResult } {
  return { result: { type: action.type, ok: false, detail: `${action.type.replace('_', ' ')} skipped: ${detail}` } }
}

function cascade(ctx: Ctx, t: WorkflowTrigger) {
  run({ ...ctx, depth: ctx.depth + 1 }, t)
}

/**
 * "-1" → -1 · "+2.5" → 2.5 · "-quantity" / "-{{quantity}}" → -(record.quantity ?? 1).
 * `maxAmount` (website-triggered runs): a record-derived amount is clamped to 0..maxAmount.
 */
function resolveDelta(value: string | null, src: Collection, rec: RecordRow, maxAmount?: number): number | null {
  const s = String(value ?? '').trim()
  if (!s) return -1
  const literal = Number(s.replace(/\s+/g, ''))
  if (Number.isFinite(literal)) return literal
  const m = /^([+-]?)\s*\{{0,2}\s*([a-z][a-z0-9_]*)\s*\}{0,2}$/.exec(s)
  if (!m) return null
  const f = src.fields.find((x) => x.key === m[2])
  if (!f) return null
  const n = typeof rec[f.key] === 'number' ? (rec[f.key] as number) : Number(rec[f.key])
  let amount = Number.isFinite(n) && rec[f.key] !== null && rec[f.key] !== '' ? n : 1
  if (maxAmount !== undefined) amount = Math.min(maxAmount, Math.max(0, amount))
  return m[1] === '-' ? -amount : amount
}

/**
 * Records in `target` related to `rec`:
 * 1. relation fields on rec → target (id or title match)
 * 2. relation fields on target → rec's collection (children)
 * 3. text-ish fields on rec named after the target ("product", "product_name", "item")
 * 4. any text-ish field value on rec equal to a target title
 */
function related(ctx: Ctx, src: Collection, rec: RecordRow, target: Collection): RecordRow[] {
  const found = new Map<string, RecordRow>()
  const add = (rows: RecordRow[]) => rows.forEach((r) => found.set(r.id, r))
  const refsOf = (fields: Field[]) => fields.flatMap((f) => {
    const v = rec[f.key]
    return Array.isArray(v) ? v.map(String) : v === null || v === undefined || v === '' ? [] : [String(v)]
  })

  for (const ref of refsOf(src.fields.filter((f) => f.type === 'relation' && f.relation === target.key))) add(findRecordsByRef(ctx.projectId, target.key, ref))
  if (found.size) return [...found.values()]

  for (const f of target.fields.filter((x) => x.type === 'relation' && x.relation === src.key)) {
    add(findRecordsByField(ctx.projectId, target.key, f.key, rec.id))
    if (src.titleField && src.titleField !== 'id' && rec[src.titleField]) add(findRecordsByField(ctx.projectId, target.key, f.key, rec[src.titleField]))
  }
  if (found.size) return [...found.values()]

  const textish = src.fields.filter((f) => ['text', 'relation', 'enum', 'tags', 'longtext'].includes(f.type))
  const hint = [toIdent(target.singular, ''), toIdent(target.key, ''), toIdent(target.label, '')].filter(Boolean)
  const named = textish.filter((f) => hint.some((h) => f.key.includes(h) || h.includes(f.key)) || /item|product|service|menu/.test(f.key))
  for (const ref of refsOf(named)) add(findRecordsByRef(ctx.projectId, target.key, ref))
  if (found.size) return [...found.values()]

  for (const ref of refsOf(textish.filter((f) => f.type !== 'longtext' && !named.includes(f)))) add(findRecordsByRef(ctx.projectId, target.key, ref, 2))
  return [...found.values()]
}

/** Copy values from rec into a new target record: same key, or "<target singular>_<key>" (customer_name → name). */
function mapFields(src: Collection, rec: RecordRow, target: Collection): Record<string, unknown> {
  const data: Record<string, unknown> = {}
  const prefix = toIdent(target.singular, '')
  for (const tf of target.fields) {
    if (tf.type === 'relation' && tf.relation === src.key) { data[tf.key] = rec.id; continue }
    const candidates = [tf.key, prefix && `${prefix}_${tf.key}`, tf.key.startsWith(`${prefix}_`) ? tf.key.slice(prefix.length + 1) : '']
    for (const k of candidates) {
      if (!k || !src.fields.some((f) => f.key === k)) continue
      const v = rec[k]
      if (v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && !v.length)) { data[tf.key] = v; break }
    }
  }
  if (target.titleField && target.titleField !== 'id' && data[target.titleField] === undefined) {
    data[target.titleField] = `${src.singular} ${titleOf(src, rec)}`
  }
  return data
}

/** "New order from {{customer_name}} · {{total}}" → values (money formatted); also {{id}} {{now}} {{today}}. */
function interpolate(ctx: Ctx, template: string, c: Collection, rec: RecordRow): string {
  return String(template ?? '')
    .replace(/\{\{\s*([a-z][a-z0-9_]*)\s*\}\}|\{([a-z][a-z0-9_]*)\}/g, (_m, a: string | undefined, b: string | undefined) => {
      const key = (a || b) as string
      if (key === 'id') return rec.id
      if (key === 'now') return new Date().toISOString()
      if (key === 'today') return new Date().toISOString().slice(0, 10)
      if (key === 'title') return titleOf(c, rec)
      const f = c.fields.find((x) => x.key === key)
      return f ? displayValue(ctx.projectId, f, rec[key]) : ''
    })
    .replace(/\s{2,}/g, ' ')
    .trim()
}

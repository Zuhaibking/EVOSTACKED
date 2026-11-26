/**
 * Per-project isolated backend storage: ONE SQLite file per project at
 * `.data/platform/<projectId>.sqlite` (node:sqlite, no dependency).
 *
 * - internal tables: _meta, _events, _settings, _workflows
 * - one real SQL table per blueprint collection (typed columns + indexes)
 * - identifiers are validated against IDENT and double-quoted; values are ALWAYS bound
 */
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync, type StatementSync } from 'node:sqlite'
import {
  FIELD_TYPES, IDENT,
  type Blueprint, type Collection, type EventSource, type Field, type FieldType, type PlatformEvent,
  type PlatformMeta, type ProjectSpec, type RecordRow, type SeedData, type Setting, type Workflow,
} from './types'
import { coerceSettingValue, validateRecord } from './validate'
import { HIDDEN_STATUSES, isHiddenStatus, isInternalField, visibilityFlags } from './visibility'

export const PROJECT_ID = /^[A-Za-z0-9_-]{1,128}$/
const RECORD_ID = /^[A-Za-z0-9_-]{1,64}$/
const DERIVED_IDENT = /^[a-z][a-z0-9_]{0,120}$/
const DAY = 86_400_000

export class PlatformError extends Error {
  constructor(public status: number, public code: string, message?: string, public details?: unknown) {
    super(message ?? code)
  }
}

export function isValidProjectId(id: unknown): id is string {
  return typeof id === 'string' && PROJECT_ID.test(id)
}
function assertProjectId(id: string) {
  if (!isValidProjectId(id)) throw new PlatformError(400, 'invalid_project_id', 'projectId must match ^[A-Za-z0-9_-]{1,128}$')
}

/** Quote a validated identifier: `"orders"`. Throws on anything that is not IDENT. */
export function quoteIdent(ident: string): string {
  if (typeof ident !== 'string' || !IDENT.test(ident)) throw new PlatformError(400, 'invalid_identifier', `Invalid identifier: ${String(ident).slice(0, 60)}`)
  return `"${ident}"`
}
function quoteDerived(name: string): string {
  if (!DERIVED_IDENT.test(name)) throw new PlatformError(500, 'invalid_identifier', 'Invalid derived identifier')
  return `"${name}"`
}

// ───────────────────────── handles (cached on globalThis; survive HMR) ─────────────────────────
type Handle = { db: DatabaseSync; file: string; stmts: Map<string, StatementSync>; meta: PlatformMeta | null }
const g = globalThis as typeof globalThis & { __evoPlatformDbs?: Map<string, Handle> }
const handles: Map<string, Handle> = g.__evoPlatformDbs ?? (g.__evoPlatformDbs = new Map())

function dataDir() {
  return process.env.EVOSTACK_PLATFORM_DIR || path.join(process.cwd(), '.data', 'platform')
}
export function dbPath(projectId: string) {
  assertProjectId(projectId)
  return path.join(dataDir(), `${projectId}.sqlite`)
}

const INTERNAL_SCHEMA = `
CREATE TABLE IF NOT EXISTS "_meta" (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS "_events" (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, type TEXT NOT NULL, collection TEXT,
  record_id TEXT, source TEXT NOT NULL, summary TEXT NOT NULL, payload TEXT
);
CREATE TABLE IF NOT EXISTS "_settings" (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS "_workflows" (key TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 1);
`

const MAX_OPEN_HANDLES = 100

function openHandle(projectId: string, create: boolean): Handle | null {
  assertProjectId(projectId)
  const cached = handles.get(projectId)
  if (cached) {
    // LRU: re-insert so the Map's insertion order is least recently used first.
    handles.delete(projectId)
    handles.set(projectId, cached)
    return cached
  }
  const file = dbPath(projectId)
  if (!create && !fs.existsSync(file)) return null
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const db = new DatabaseSync(file, { timeout: 5000 })
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = OFF;')
  db.exec(INTERNAL_SCHEMA)
  const h: Handle = { db, file, stmts: new Map(), meta: null }
  handles.set(projectId, h)
  // Close least-recently-used handles beyond the cap (all access is synchronous, so none is mid-use;
  // the one just opened is the most recent). Closed projects simply reopen on their next access.
  for (const [id, old] of handles) {
    if (handles.size <= MAX_OPEN_HANDLES) break
    if (old === h || old.db.isTransaction) continue
    handles.delete(id)
    try { old.db.close() } catch { /* ignore */ }
  }
  return h
}

function prep(h: Handle, sql: string): StatementSync {
  let s = h.stmts.get(sql)
  if (!s) {
    if (h.stmts.size > 300) h.stmts.clear()
    s = h.db.prepare(sql)
    h.stmts.set(sql, s)
  }
  return s
}

function tx<T>(h: Handle, fn: () => T): T {
  if (h.db.isTransaction) return fn()
  h.db.exec('BEGIN IMMEDIATE')
  try {
    const out = fn()
    h.db.exec('COMMIT')
    return out
  } catch (e) {
    try { h.db.exec('ROLLBACK') } catch { /* already rolled back */ }
    throw e
  }
}

export function closeProject(projectId: string) {
  const h = handles.get(projectId)
  if (!h) return
  handles.delete(projectId)
  try { h.db.close() } catch { /* ignore */ }
}

/** Raw handle for read-only aggregate queries (metrics). Null when not provisioned. */
export function dbFor(projectId: string): { all: (sql: string, params?: SqlValue[]) => Record<string, unknown>[]; get: (sql: string, params?: SqlValue[]) => Record<string, unknown> | undefined } | null {
  if (!isValidProjectId(projectId)) return null
  const h = openHandle(projectId, false)
  if (!h) return null
  return {
    all: (sql, params = []) => prep(h, sql).all(...params) as Record<string, unknown>[],
    get: (sql, params = []) => prep(h, sql).get(...params) as Record<string, unknown> | undefined,
  }
}

type SqlValue = string | number | null

// ───────────────────────── blueprint sanitizing (DB safety net) ─────────────────────────
const SQLITE_RESERVED = /^sqlite_/

function sanitizeCollection(c: Collection): Collection | null {
  if (!c || typeof c.key !== 'string' || !IDENT.test(c.key) || SQLITE_RESERVED.test(c.key)) return null
  const seen = new Set<string>()
  const fields: Field[] = []
  for (const f of Array.isArray(c.fields) ? c.fields : []) {
    if (!f || typeof f.key !== 'string' || !IDENT.test(f.key) || f.key === 'id' || f.key === 'created_at' || f.key === 'updated_at' || seen.has(f.key)) continue
    seen.add(f.key)
    const type: FieldType = (FIELD_TYPES as readonly string[]).includes(f.type) ? f.type : 'text'
    fields.push({
      ...f,
      type,
      label: String(f.label || f.key),
      required: Boolean(f.required),
      options: Array.isArray(f.options) ? f.options.filter((o) => typeof o === 'string' && o.trim()).map((o) => o.trim()) : [],
      relation: typeof f.relation === 'string' && IDENT.test(f.relation) ? f.relation : null,
      showInTable: f.showInTable !== false,
      publicWritable: Boolean(f.publicWritable),
    })
  }
  const byKey = new Map(fields.map((f) => [f.key, f]))
  const status = c.statusField ? byKey.get(c.statusField) : undefined
  const date = c.dateField ? byKey.get(c.dateField) : undefined
  const title = c.titleField && (c.titleField === 'id' || byKey.has(c.titleField))
    ? c.titleField
    : fields.find((f) => f.type === 'text')?.key ?? 'id'
  return {
    ...c,
    label: String(c.label || c.key),
    singular: String(c.singular || c.label || c.key),
    titleField: title,
    statusField: status && status.type === 'enum' && status.options.length ? status.key : null,
    dateField: date && (date.type === 'date' || date.type === 'datetime') ? date.key : null,
    publicCreate: Boolean(c.publicCreate),
    publicRead: Boolean(c.publicRead),
    fields,
  }
}

function sanitizeBlueprint(bp: Blueprint): Blueprint {
  const seen = new Set<string>()
  const collections: Collection[] = []
  for (const raw of Array.isArray(bp.collections) ? bp.collections : []) {
    const c = sanitizeCollection(raw)
    if (c && !seen.has(c.key)) { seen.add(c.key); collections.push(c) }
  }
  const uniq = <T extends { key: string }>(list: T[] | undefined) => {
    const keys = new Set<string>()
    return (Array.isArray(list) ? list : []).filter((x) => x && typeof x.key === 'string' && x.key && !keys.has(x.key) && keys.add(x.key))
  }
  return {
    ...bp,
    appName: String(bp.appName || 'My App'),
    collections,
    modules: Array.isArray(bp.modules) ? bp.modules : [],
    metrics: Array.isArray(bp.metrics) ? bp.metrics : [],
    charts: Array.isArray(bp.charts) ? bp.charts : [],
    workflows: uniq(bp.workflows),
    settings: uniq(bp.settings),
  }
}

// ───────────────────────── value mapping ─────────────────────────
function sqlType(t: FieldType) {
  return t === 'number' || t === 'money' ? 'REAL' : t === 'boolean' ? 'INTEGER' : 'TEXT'
}

function toDb(field: Field | undefined, v: unknown): SqlValue {
  if (v === undefined || v === null) return null
  switch (field?.type) {
    case 'number':
    case 'money': {
      const n = typeof v === 'number' ? v : Number(v)
      return Number.isFinite(n) ? n : null
    }
    case 'boolean':
      return v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0
    case 'tags':
      return JSON.stringify(Array.isArray(v) ? v.map(String) : [String(v)])
    default:
      return typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : JSON.stringify(v)
  }
}

function fromDb(c: Collection, row: Record<string, unknown>): RecordRow {
  const out: RecordRow = { id: String(row.id), created_at: String(row.created_at), updated_at: String(row.updated_at) }
  for (const f of c.fields) {
    const v = row[f.key]
    switch (f.type) {
      case 'number':
      case 'money':
        out[f.key] = v === null || v === undefined ? null : Number(v)
        break
      case 'boolean':
        out[f.key] = v === 1 || v === true || v === '1'
        break
      case 'tags': {
        let list: unknown = []
        try { list = typeof v === 'string' ? JSON.parse(v) : [] } catch { list = [] }
        out[f.key] = Array.isArray(list) ? list.map(String) : []
        break
      }
      default:
        out[f.key] = v === undefined ? null : v
    }
  }
  return out
}

const ID_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz'
/** "orders" → "ord", "products" → "prd", "customers" → "cst", "staff" → "stf" */
export function idPrefix(collectionKey: string): string {
  const letters = collectionKey.replace(/[^a-z]/g, '')
  if (!letters) return 'rec'
  let p = letters[0]
  for (const ch of letters.slice(1)) {
    if (p.length >= 3) break
    if (!'aeiou'.includes(ch) && ch !== p[p.length - 1]) p += ch
  }
  return p.length >= 3 ? p : (p + letters.slice(1)).slice(0, 3)
}
export function newRecordId(collectionKey: string): string {
  const bytes = randomBytes(6)
  let s = ''
  for (const b of bytes) s += ID_ALPHABET[b % 36]
  return `${idPrefix(collectionKey)}_${s}`
}

// ───────────────────────── meta / provisioning ─────────────────────────
function safeJson(s: unknown): unknown {
  if (typeof s !== 'string') return null
  try { return JSON.parse(s) } catch { return null }
}

export function isProvisioned(projectId: string): boolean {
  return getMeta(projectId) !== null
}

export function getMeta(projectId: string): PlatformMeta | null {
  if (!isValidProjectId(projectId)) return null
  const h = openHandle(projectId, false)
  if (!h) return null
  if (h.meta) return h.meta
  const rows = prep(h, 'SELECT key, value FROM "_meta"').all() as { key: string; value: string }[]
  const m: Record<string, unknown> = {}
  for (const r of rows) m[r.key] = safeJson(r.value)
  const blueprint = m.blueprint as Blueprint | null
  if (!blueprint || typeof m.ownerId !== 'string') return null
  h.meta = {
    projectId,
    ownerId: m.ownerId,
    appName: typeof m.appName === 'string' ? m.appName : blueprint.appName,
    projectType: (m.projectType as PlatformMeta['projectType']) || blueprint.projectType,
    spec: (m.spec as ProjectSpec | null) ?? null,
    blueprint,
    createdAt: typeof m.createdAt === 'string' ? m.createdAt : new Date(0).toISOString(),
  }
  return h.meta
}

export function getCollection(meta: PlatformMeta, key: string): Collection | null {
  return meta.blueprint.collections.find((c) => c.key === key) ?? null
}

function resolve(projectId: string, collectionKey: string): { h: Handle; meta: PlatformMeta; c: Collection } {
  const meta = getMeta(projectId)
  if (!meta) throw new PlatformError(404, 'not_provisioned', 'Backend is not provisioned for this project')
  const c = getCollection(meta, collectionKey)
  if (!c) throw new PlatformError(404, 'unknown_collection', `Unknown collection: ${String(collectionKey).slice(0, 60)}`)
  return { h: handles.get(projectId)!, meta, c }
}

export type ProvisionInput = {
  projectId: string
  ownerId: string
  spec: ProjectSpec | null
  blueprint: Blueprint
  seed?: SeedData | null
  /** Wipe + re-create when the project already exists (default: return existing meta). */
  force?: boolean
}

export function provisionProject(input: ProvisionInput): PlatformMeta {
  const { projectId, ownerId } = input
  assertProjectId(projectId)
  if (!ownerId || typeof ownerId !== 'string') throw new PlatformError(400, 'invalid_owner', 'ownerId is required')
  const existing = getMeta(projectId)
  if (existing && !input.force) return existing

  closeProject(projectId)
  const file = dbPath(projectId)
  for (const suffix of ['', '-wal', '-shm', '-journal']) fs.rmSync(file + suffix, { force: true })

  const bp = sanitizeBlueprint(input.blueprint)
  if (!bp.collections.length) throw new PlatformError(400, 'invalid_blueprint', 'Blueprint has no valid collections')
  const h = openHandle(projectId, true)!
  const now = Date.now()
  const createdAt = new Date(now).toISOString()
  let seeded = 0

  tx(h, () => {
    for (const c of bp.collections) {
      const cols = ['"id" TEXT PRIMARY KEY', '"created_at" TEXT NOT NULL', '"updated_at" TEXT NOT NULL', ...c.fields.map((f) => `${quoteIdent(f.key)} ${sqlType(f.type)}`)]
      h.db.exec(`CREATE TABLE IF NOT EXISTS ${quoteIdent(c.key)} (${cols.join(', ')})`)
      h.db.exec(`CREATE INDEX IF NOT EXISTS ${quoteDerived(`ix_${c.key}_created_at`)} ON ${quoteIdent(c.key)} ("created_at")`)
      for (const k of [c.statusField, c.dateField]) {
        if (k) h.db.exec(`CREATE INDEX IF NOT EXISTS ${quoteDerived(`ix_${c.key}_${k}`)} ON ${quoteIdent(c.key)} (${quoteIdent(k)})`)
      }
    }
    const meta: Record<string, unknown> = { ownerId, spec: input.spec ?? null, blueprint: bp, appName: bp.appName, projectType: bp.projectType, createdAt }
    const putMeta = prep(h, 'INSERT OR REPLACE INTO "_meta" (key, value) VALUES (?, ?)')
    for (const [k, v] of Object.entries(meta)) putMeta.run(k, JSON.stringify(v))
    const putSetting = prep(h, 'INSERT OR REPLACE INTO "_settings" (key, value) VALUES (?, ?)')
    for (const s of bp.settings) putSetting.run(s.key, String(s.value ?? ''))
    const putWf = prep(h, 'INSERT OR REPLACE INTO "_workflows" (key, enabled) VALUES (?, ?)')
    for (const w of bp.workflows) putWf.run(w.key, w.enabled === false ? 0 : 1)

    for (const c of bp.collections) {
      const rows = Array.isArray(input.seed?.[c.key]) ? input.seed![c.key].slice(0, 500) : []
      for (const raw of rows) {
        if (!raw || typeof raw !== 'object') continue
        const v = validateRecord(c, raw, { mode: 'create', lenient: true })
        const rawCreated = (raw as Record<string, unknown>).created_at
        const parsed = typeof rawCreated === 'string' ? Date.parse(rawCreated) : NaN
        // Spread seed rows over the last 14 days (biased toward recent → a believable growth curve).
        const ts = new Date(Number.isFinite(parsed) ? parsed : now - Math.floor(Math.pow(Math.random(), 1.4) * 14 * DAY)).toISOString()
        const rawId = (raw as Record<string, unknown>).id
        const id = typeof rawId === 'string' && RECORD_ID.test(rawId) ? rawId : newRecordId(c.key)
        try {
          insertRow(h, c, { ...v.data, id, created_at: ts, updated_at: ts })
          seeded++
        } catch { /* duplicate seed id etc. — skip the row */ }
      }
    }
  })

  h.meta = null
  const meta = getMeta(projectId)!
  emitEvent(projectId, {
    type: 'provisioned',
    collection: null,
    recordId: null,
    source: 'system',
    summary: `Backend provisioned for ${bp.appName} · ${bp.collections.length} collection${bp.collections.length === 1 ? '' : 's'} · ${seeded} sample record${seeded === 1 ? '' : 's'}`,
    payload: { collections: bp.collections.map((c) => c.key), seeded },
  })
  return meta
}

function insertRow(h: Handle, c: Collection, row: Record<string, unknown>) {
  const fields = c.fields.filter((f) => Object.prototype.hasOwnProperty.call(row, f.key))
  const cols = ['id', 'created_at', 'updated_at', ...fields.map((f) => f.key)]
  const sql = `INSERT INTO ${quoteIdent(c.key)} (${cols.map(quoteIdent).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`
  prep(h, sql).run(String(row.id), String(row.created_at), String(row.updated_at), ...fields.map((f) => toDb(f, row[f.key])))
}

// ───────────────────────── records ─────────────────────────
export type ListOptions = {
  q?: string | null
  sort?: string | null
  dir?: string | null
  limit?: number | string | null
  offset?: number | string | null
  status?: string | null
  /** Optional inclusive range on the dateField (or created_at). */
  from?: string | null
  to?: string | null
  /** Website (non-owner) read: hide switched-off / hidden-status rows; never search or sort by internal columns. */
  publicOnly?: boolean
}

const SEARCHABLE: FieldType[] = ['text', 'longtext', 'email', 'phone', 'url', 'enum', 'relation', 'tags']

function clampInt(v: unknown, def: number, min: number, max: number) {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.floor(n))) : def
}

export function listRecords(projectId: string, collectionKey: string, opts: ListOptions = {}): { rows: RecordRow[]; total: number } {
  const { h, c } = resolve(projectId, collectionKey)
  const where: string[] = []
  const params: SqlValue[] = []
  const pub = !!opts.publicOnly
  const fields = pub ? c.fields.filter((f) => !isInternalField(f.key)) : c.fields
  if (pub) {
    for (const f of visibilityFlags(c)) where.push(`COALESCE(${quoteIdent(f.key)}, 0) <> 0`)
    if (c.statusField) {
      const col = quoteIdent(c.statusField)
      where.push(`(${col} IS NULL OR lower(${col}) NOT IN (${HIDDEN_STATUSES.map(() => '?').join(', ')}))`)
      params.push(...HIDDEN_STATUSES)
    }
  }
  const q = typeof opts.q === 'string' ? opts.q.trim().slice(0, 200) : ''
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`
    const cols = ['id', ...fields.filter((f) => SEARCHABLE.includes(f.type)).map((f) => f.key)]
    where.push(`(${cols.map((k) => `${quoteIdent(k)} LIKE ? ESCAPE '\\'`).join(' OR ')})`)
    for (let i = 0; i < cols.length; i++) params.push(like)
  }
  // A website asking for draft / archived / … rows gets the normal public list instead.
  if (opts.status && c.statusField && !(pub && isHiddenStatus(opts.status))) {
    where.push(`${quoteIdent(c.statusField)} = ?`)
    params.push(String(opts.status))
  }
  const rangeCol = c.dateField || 'created_at'
  if (opts.from) { where.push(`${quoteIdent(rangeCol)} >= ?`); params.push(String(opts.from)) }
  if (opts.to) { where.push(`${quoteIdent(rangeCol)} <= ?`); params.push(String(opts.to)) }

  const sortable = new Set(['id', 'created_at', 'updated_at', ...fields.map((f) => f.key)])
  const sort = opts.sort && sortable.has(opts.sort) ? opts.sort : 'created_at'
  const dir = String(opts.dir || '').toLowerCase() === 'asc' ? 'ASC' : 'DESC'
  const limit = clampInt(opts.limit, 50, 1, 1000)
  const offset = clampInt(opts.offset, 0, 0, 1_000_000)
  const whereSql = where.length ? ` WHERE ${where.join(' AND ')}` : ''
  const table = quoteIdent(c.key)

  const total = Number((prep(h, `SELECT COUNT(*) AS n FROM ${table}${whereSql}`).get(...params) as { n: number }).n)
  const rows = prep(h, `SELECT * FROM ${table}${whereSql} ORDER BY ${quoteIdent(sort)} ${dir}, "id" ${dir} LIMIT ? OFFSET ?`).all(...params, limit, offset) as Record<string, unknown>[]
  return { rows: rows.map((r) => fromDb(c, r)), total }
}

export function getRecord(projectId: string, collectionKey: string, recordId: string): RecordRow | null {
  const { h, c } = resolve(projectId, collectionKey)
  if (typeof recordId !== 'string' || !RECORD_ID.test(recordId)) return null
  const row = prep(h, `SELECT * FROM ${quoteIdent(c.key)} WHERE "id" = ?`).get(recordId) as Record<string, unknown> | undefined
  return row ? fromDb(c, row) : null
}

/** Records whose id equals `ref` or whose title equals it (case-insensitive). Used by workflows. */
export function findRecordsByRef(projectId: string, collectionKey: string, ref: string, limit = 5): RecordRow[] {
  const { h, c } = resolve(projectId, collectionKey)
  const value = String(ref ?? '').trim()
  if (!value) return []
  const byId = prep(h, `SELECT * FROM ${quoteIdent(c.key)} WHERE "id" = ?`).get(value) as Record<string, unknown> | undefined
  if (byId) return [fromDb(c, byId)]
  if (!c.titleField || c.titleField === 'id') return []
  const rows = prep(h, `SELECT * FROM ${quoteIdent(c.key)} WHERE lower(${quoteIdent(c.titleField)}) = lower(?) ORDER BY "created_at" DESC LIMIT ?`).all(value, limit) as Record<string, unknown>[]
  return rows.map((r) => fromDb(c, r))
}

/** Records where `field` equals `value` (text compare is case-insensitive). */
export function findRecordsByField(projectId: string, collectionKey: string, field: string, value: unknown, limit = 25): RecordRow[] {
  const { h, c } = resolve(projectId, collectionKey)
  const f = c.fields.find((x) => x.key === field)
  if (!f || value === null || value === undefined || value === '') return []
  const bound = toDb(f, value)
  const text = !['number', 'money', 'boolean'].includes(f.type)
  const sql = `SELECT * FROM ${quoteIdent(c.key)} WHERE ${text ? `lower(${quoteIdent(f.key)}) = lower(?)` : `${quoteIdent(f.key)} = ?`} ORDER BY "created_at" DESC LIMIT ?`
  return (prep(h, sql).all(bound, limit) as Record<string, unknown>[]).map((r) => fromDb(c, r))
}

function pickKnown(c: Collection, data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const f of c.fields) if (data && Object.prototype.hasOwnProperty.call(data, f.key)) out[f.key] = data[f.key]
  return out
}

/** Insert a record (callers validate first with validateRecord). Emits `record.created`. */
export function createRecord(projectId: string, collectionKey: string, data: Record<string, unknown>, source: EventSource = 'dashboard'): RecordRow {
  const { h, meta, c } = resolve(projectId, collectionKey)
  const values = pickKnown(c, data)
  const now = new Date().toISOString()
  for (let attempt = 0; ; attempt++) {
    const id = newRecordId(c.key)
    try {
      return tx(h, () => {
        insertRow(h, c, { ...values, id, created_at: now, updated_at: now })
        const record = getRecord(projectId, c.key, id)!
        emitEvent(projectId, {
          type: 'record.created', collection: c.key, recordId: id, source,
          summary: summarizeCreated(projectId, c, record, source),
          payload: { record },
        })
        return record
      })
    } catch (e) {
      if (attempt < 4 && /UNIQUE constraint failed/i.test(String((e as Error)?.message))) continue
      throw e
    }
  }
}

export type Changes = Record<string, { from: unknown; to: unknown }>
export type UpdateResult = { record: RecordRow; before: RecordRow; changes: Changes }

function sameValue(a: unknown, b: unknown) {
  if ((a === null || a === undefined) && (b === null || b === undefined)) return true
  if (Array.isArray(a) || Array.isArray(b)) return JSON.stringify(a ?? []) === JSON.stringify(b ?? [])
  return a === b
}

/** Patch a record. Returns null when missing. Emits `record.updated` only when something changed. */
export function updateRecord(projectId: string, collectionKey: string, recordId: string, patch: Record<string, unknown>, source: EventSource = 'dashboard'): UpdateResult | null {
  const { h, c } = resolve(projectId, collectionKey)
  const before = getRecord(projectId, c.key, recordId)
  if (!before) return null
  const values = pickKnown(c, patch)
  const fields = c.fields.filter((f) => f.key in values)
  // Normalize via DB round-trip semantics before diffing.
  const changes: Changes = {}
  for (const f of fields) {
    const next = fromDb({ ...c, fields: [f] }, { id: '', created_at: '', updated_at: '', [f.key]: toDb(f, values[f.key]) })[f.key]
    if (!sameValue(before[f.key], next)) changes[f.key] = { from: before[f.key], to: next }
  }
  const changed = fields.filter((f) => f.key in changes)
  if (!changed.length) return { record: before, before, changes }
  const now = new Date().toISOString()
  return tx(h, () => {
    const sets = [...changed.map((f) => `${quoteIdent(f.key)} = ?`), '"updated_at" = ?']
    prep(h, `UPDATE ${quoteIdent(c.key)} SET ${sets.join(', ')} WHERE "id" = ?`).run(...changed.map((f) => toDb(f, values[f.key])), now, recordId)
    const record = getRecord(projectId, c.key, recordId)!
    emitEvent(projectId, {
      type: 'record.updated', collection: c.key, recordId, source,
      summary: summarizeUpdated(projectId, c, record, changes, source),
      payload: { record, changes },
    })
    return { record, before, changes }
  })
}

export function deleteRecord(projectId: string, collectionKey: string, recordId: string, source: EventSource = 'dashboard'): RecordRow | null {
  const { h, c } = resolve(projectId, collectionKey)
  const before = getRecord(projectId, c.key, recordId)
  if (!before) return null
  tx(h, () => {
    prep(h, `DELETE FROM ${quoteIdent(c.key)} WHERE "id" = ?`).run(recordId)
    emitEvent(projectId, {
      type: 'record.deleted', collection: c.key, recordId, source,
      summary: `Deleted ${lcFirst(c.singular)} ${titleOf(c, before)}${sourceSuffix(source)}`,
      payload: { record: before },
    })
  })
  return before
}

export function countRecords(projectId: string): Record<string, number> {
  const meta = getMeta(projectId)
  if (!meta) return {}
  const h = handles.get(projectId)!
  const out: Record<string, number> = {}
  for (const c of meta.blueprint.collections) {
    try {
      out[c.key] = Number((prep(h, `SELECT COUNT(*) AS n FROM ${quoteIdent(c.key)}`).get() as { n: number }).n)
    } catch {
      out[c.key] = 0
    }
  }
  return out
}

// ───────────────────────── events ─────────────────────────
export type EmitInput = {
  type: PlatformEvent['type']
  collection: string | null
  recordId: string | null
  source: EventSource
  summary: string
  payload?: unknown
}

export function emitEvent(projectId: string, e: EmitInput): PlatformEvent | null {
  const h = openHandle(projectId, false)
  if (!h) return null
  const ts = new Date().toISOString()
  const summary = String(e.summary || e.type).slice(0, 500)
  const res = prep(h, 'INSERT INTO "_events" (ts, type, collection, record_id, source, summary, payload) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(ts, e.type, e.collection, e.recordId, e.source, summary, e.payload === undefined ? null : JSON.stringify(e.payload))
  return { id: Number(res.lastInsertRowid), ts, type: e.type, collection: e.collection, recordId: e.recordId, source: e.source, summary, payload: e.payload ?? null }
}

function rowToEvent(r: Record<string, unknown>): PlatformEvent {
  return {
    id: Number(r.id),
    ts: String(r.ts),
    type: r.type as PlatformEvent['type'],
    collection: (r.collection as string | null) ?? null,
    recordId: (r.record_id as string | null) ?? null,
    source: r.source as EventSource,
    summary: String(r.summary),
    payload: safeJson(r.payload),
  }
}

/**
 * Events, newest last. `after > 0` pages forward from that id (stream catch-up);
 * `after <= 0` returns the most recent `limit` events.
 */
export function listEvents(projectId: string, after = 0, limit = 50): PlatformEvent[] {
  const h = getMeta(projectId) ? handles.get(projectId) : null
  if (!h) return []
  const n = clampInt(limit, 50, 1, 500)
  const a = clampInt(after, 0, 0, Number.MAX_SAFE_INTEGER)
  const rows = a > 0
    ? (prep(h, 'SELECT * FROM "_events" WHERE id > ? ORDER BY id ASC LIMIT ?').all(a, n) as Record<string, unknown>[])
    : (prep(h, 'SELECT * FROM (SELECT * FROM "_events" ORDER BY id DESC LIMIT ?) ORDER BY id ASC').all(n) as Record<string, unknown>[])
  return rows.map(rowToEvent)
}

/** Strictly forward page (id > after, oldest first) — used by the SSE stream. */
export function listEventsAfter(projectId: string, after: number, limit = 100): PlatformEvent[] {
  const h = getMeta(projectId) ? handles.get(projectId) : null
  if (!h) return []
  const rows = prep(h, 'SELECT * FROM "_events" WHERE id > ? ORDER BY id ASC LIMIT ?')
    .all(clampInt(after, 0, 0, Number.MAX_SAFE_INTEGER), clampInt(limit, 100, 1, 500)) as Record<string, unknown>[]
  return rows.map(rowToEvent)
}

export function latestEventId(projectId: string): number {
  const h = getMeta(projectId) ? handles.get(projectId) : null
  if (!h) return 0
  const row = prep(h, 'SELECT MAX(id) AS id FROM "_events"').get() as { id: number | null }
  return Number(row?.id ?? 0)
}

// ───────────────────────── settings / workflows ─────────────────────────
export function getSettings(projectId: string): Setting[] {
  const meta = getMeta(projectId)
  if (!meta) throw new PlatformError(404, 'not_provisioned', 'Backend is not provisioned for this project')
  const h = handles.get(projectId)!
  const stored = new Map((prep(h, 'SELECT key, value FROM "_settings"').all() as { key: string; value: string | null }[]).map((r) => [r.key, r.value]))
  return meta.blueprint.settings.map((s) => ({ ...s, value: stored.has(s.key) ? String(stored.get(s.key) ?? '') : String(s.value ?? '') }))
}

export function getSetting(projectId: string, matcher: (s: Setting) => boolean): string | null {
  try {
    const s = getSettings(projectId).find(matcher)
    return s ? s.value : null
  } catch {
    return null
  }
}

/** Accepts `{key: value}` or `[{key, value}]`. Unknown keys are rejected; values coerced by setting type. */
export function updateSettings(projectId: string, input: Record<string, unknown> | { key: string; value: unknown }[], source: EventSource = 'dashboard'): Setting[] {
  const current = getSettings(projectId)
  const h = handles.get(projectId)!
  const entries: [string, unknown][] = Array.isArray(input)
    ? input.filter((x) => x && typeof x.key === 'string').map((x) => [x.key, x.value])
    : Object.entries(input || {})
  const errors: Record<string, string> = {}
  const updates: [Setting, string][] = []
  for (const [key, raw] of entries) {
    const s = current.find((x) => x.key === key)
    if (!s) { errors[key] = 'Unknown setting'; continue }
    const r = coerceSettingValue(s, raw)
    if (!r.ok) errors[key] = r.error
    else if (r.value !== s.value) updates.push([s, r.value])
  }
  if (Object.keys(errors).length) throw new PlatformError(400, 'validation_failed', 'Some settings are invalid', errors)
  if (!updates.length) return current
  tx(h, () => {
    const put = prep(h, 'INSERT OR REPLACE INTO "_settings" (key, value) VALUES (?, ?)')
    for (const [s, v] of updates) put.run(s.key, v)
    const labels = updates.map(([s]) => s.label || s.key)
    emitEvent(projectId, {
      type: 'settings.updated', collection: null, recordId: null, source,
      summary: `Settings updated · ${labels.slice(0, 3).join(', ')}${labels.length > 3 ? ` +${labels.length - 3} more` : ''}`,
      payload: { changes: Object.fromEntries(updates.map(([s, v]) => [s.key, { from: s.value, to: v }])) },
    })
  })
  return getSettings(projectId)
}

export function getWorkflows(projectId: string): Workflow[] {
  const meta = getMeta(projectId)
  if (!meta) return []
  const h = handles.get(projectId)!
  const stored = new Map((prep(h, 'SELECT key, enabled FROM "_workflows"').all() as { key: string; enabled: number }[]).map((r) => [r.key, r.enabled]))
  return meta.blueprint.workflows.map((w) => ({ ...w, enabled: stored.has(w.key) ? stored.get(w.key) === 1 : w.enabled !== false }))
}

export function setWorkflowEnabled(projectId: string, key: string, enabled: boolean): Workflow[] {
  const meta = getMeta(projectId)
  if (!meta) throw new PlatformError(404, 'not_provisioned', 'Backend is not provisioned for this project')
  if (!meta.blueprint.workflows.some((w) => w.key === key)) throw new PlatformError(404, 'unknown_workflow', `Unknown workflow: ${String(key).slice(0, 60)}`)
  prep(handles.get(projectId)!, 'INSERT OR REPLACE INTO "_workflows" (key, enabled) VALUES (?, ?)').run(key, enabled ? 1 : 0)
  return getWorkflows(projectId)
}

// ───────────────────────── human summaries ─────────────────────────
/** "Pickup Order" → "pickup order", "FAQ Entry" → "FAQ entry" (acronyms kept). */
export function lcFirst(s: string) {
  return String(s || '')
    .split(' ')
    .map((w) => (w.length > 1 && w === w.toUpperCase() && /[A-Z]/.test(w) ? w : w.charAt(0).toLowerCase() + w.slice(1)))
    .join(' ')
}

export function titleOf(c: Collection, r: RecordRow): string {
  const v = c.titleField && c.titleField !== 'id' ? r[c.titleField] : null
  const s = v === null || v === undefined ? '' : String(Array.isArray(v) ? v.join(', ') : v).trim()
  return s ? (s.length > 60 ? `${s.slice(0, 57)}…` : s) : r.id
}

function sourceSuffix(source: EventSource) {
  return source === 'website' ? ' · from website' : source === 'workflow' ? ' · by workflow' : ''
}

export function currencyOf(projectId: string): string {
  const v = getSetting(projectId, (s) => /currency/i.test(s.key))
  const code = (v || '').trim().toUpperCase()
  return /^[A-Z]{3}$/.test(code) ? code : 'USD'
}

export function formatMoney(n: number, currency = 'USD'): string {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(n)
  } catch {
    return `$${n.toFixed(2)}`
  }
}

export function displayValue(projectId: string, f: Field, v: unknown): string {
  if (v === null || v === undefined || v === '') return '—'
  if (f.type === 'money' && typeof v === 'number') return formatMoney(v, currencyOf(projectId))
  if (f.type === 'boolean') return v ? 'yes' : 'no'
  if (f.type === 'enum') return humanize(String(v))
  if ((f.type === 'date' || f.type === 'datetime') && typeof v === 'string') return formatWhen(v, f.type === 'datetime')
  if (Array.isArray(v)) return v.join(', ')
  // Relations hold either the related record's id (dashboard picker) or its title (seed data,
  // website forms). Human-readable summaries always show the title.
  if (f.type === 'relation' && f.relation && typeof v === 'string') {
    try {
      const meta = getMeta(projectId)
      const target = meta ? getCollection(meta, f.relation) : null
      const hit = target ? findRecordsByRef(projectId, f.relation, v, 1)[0] : undefined
      if (target && hit) return titleOf(target, hit)
    } catch { /* fall back to the stored reference */ }
  }
  return String(v)
}

/** "no_show" → "no show" (enum options stay canonical in data; only sentences are humanized). */
export function humanize(s: string): string {
  return /^[a-z0-9]+(_[a-z0-9]+)+$/.test(s) ? s.replace(/_/g, ' ') : s
}

/** "2026-11-26T19:30:00.000Z" → "Nov 26, 7:30 PM" · "2026-11-26" → "Nov 26, 2026" (UTC, as stored). */
export function formatWhen(v: string, withTime: boolean): string {
  const d = new Date(v.length === 10 ? `${v}T00:00:00Z` : v)
  if (Number.isNaN(d.getTime())) return v
  return new Intl.DateTimeFormat('en-US', withTime
    ? { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }
    : { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(d)
}

function moneyField(c: Collection, r: RecordRow): Field | undefined {
  const money = c.fields.filter((f) => f.type === 'money' && typeof r[f.key] === 'number')
  return money.find((f) => /total|amount|price|value|revenue|budget|fee/.test(f.key)) ?? money[0]
}

function summarizeCreated(projectId: string, c: Collection, r: RecordRow, source: EventSource) {
  const m = moneyField(c, r)
  const money = m ? ` · ${formatMoney(r[m.key] as number, currencyOf(projectId))}` : ''
  return `New ${lcFirst(c.singular)} ${titleOf(c, r)}${money}${sourceSuffix(source)}`
}

function summarizeUpdated(projectId: string, c: Collection, r: RecordRow, changes: Changes, source: EventSource) {
  const keys = Object.keys(changes)
  const name = `${c.singular} ${titleOf(c, r)}`
  if (c.statusField && keys.includes(c.statusField)) {
    return `${name} moved to ${humanize(String(r[c.statusField] ?? '—'))}${sourceSuffix(source)}`
  }
  if (keys.length === 1) {
    const f = c.fields.find((x) => x.key === keys[0])!
    if (['number', 'money', 'enum', 'boolean', 'date'].includes(f.type)) {
      return `${name} · ${f.label} ${displayValue(projectId, f, changes[f.key].from)} → ${displayValue(projectId, f, changes[f.key].to)}${sourceSuffix(source)}`
    }
  }
  const labels = keys.map((k) => c.fields.find((f) => f.key === k)?.label || k)
  return `Updated ${lcFirst(name)} · ${labels.slice(0, 3).join(', ')}${labels.length > 3 ? ` +${labels.length - 3} more` : ''}${sourceSuffix(source)}`
}


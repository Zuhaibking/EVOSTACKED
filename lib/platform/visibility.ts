/**
 * What anonymous / website (non-owner) readers may see of a `publicRead` collection.
 * Owner reads are never filtered. No schema change: everything is inferred from field keys.
 * - rows switched off by a boolean flag (active / available / published / visible / in_stock = false)
 *   or parked in a hidden status (draft, archived, …) are not returned
 * - internal-looking columns (cost, margin, notes, internal_*, …) are stripped
 */
import type { Collection, Field, RecordRow } from './types'

const VISIBILITY_FLAGS = new Set(['active', 'available', 'published', 'visible', 'in_stock'])
export const HIDDEN_STATUSES = ['draft', 'archived', 'inactive', 'deleted', 'hidden', 'unpublished', 'discontinued']
const INTERNAL_FIELD = /(^|_)(internal|cost|margin|notes?|private|secret|admin)(_|$)/

export function isHiddenStatus(v: unknown): boolean {
  return typeof v === 'string' && HIDDEN_STATUSES.includes(v.trim().toLowerCase())
}

/** Boolean fields that hide a row from the website when false (or unset). */
export function visibilityFlags(c: Collection): Field[] {
  return c.fields.filter((f) => f.type === 'boolean' && VISIBILITY_FLAGS.has(f.key))
}

export function isInternalField(key: string): boolean {
  return INTERNAL_FIELD.test(key)
}

export function isPubliclyVisible(c: Collection, row: RecordRow): boolean {
  if (visibilityFlags(c).some((f) => row[f.key] !== true)) return false
  return !(c.statusField && isHiddenStatus(row[c.statusField]))
}

/** The row without internal-looking columns. */
export function publicView(c: Collection, row: RecordRow): RecordRow {
  const out: RecordRow = { ...row }
  for (const f of c.fields) if (isInternalField(f.key)) delete out[f.key]
  return out
}

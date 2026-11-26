import { deleteRecord, getRecord, updateRecord } from '@/lib/platform/db'
import { describeErrors, validateRecord } from '@/lib/platform/validate'
import { isPubliclyVisible, publicView } from '@/lib/platform/visibility'
import { runWorkflows } from '@/lib/platform/workflows'
import {
  access, collectionOr404, dataOf, errorResponse, json, OWNER_BODY_LIMIT, preflight, publicCollection, readBody, requireOwner,
} from '../../../_lib/http'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ projectId: string; collection: string; recordId: string }> }

export function OPTIONS() {
  return preflight()
}

/** GET /api/p/{id}/records/{collection}/{recordId} — owner, or public when collection.publicRead → { record } */
export async function GET(req: Request, { params }: Ctx) {
  const { projectId, collection, recordId } = await params
  try {
    const a = await access(req, projectId, true)
    if (a instanceof Response) return a
    const c = a.owner ? collectionOr404(a.meta, collection, true) : publicCollection(req, a, collection, 'read')
    if (c instanceof Response) return c
    const record = getRecord(projectId, c.key, recordId)
    if (!record || (!a.owner && !isPubliclyVisible(c, record))) return json({ error: 'not_found' }, { status: 404, cors: true })
    return json({ record: a.owner ? record : publicView(c, record) }, { cors: true })
  } catch (e) {
    return errorResponse(e, true)
  }
}

/** PATCH (owner) body { data } → { record }; runs updated / status_changed workflows. */
export async function PATCH(req: Request, { params }: Ctx) {
  const { projectId, collection, recordId } = await params
  try {
    const a = await requireOwner(req, projectId)
    if (a instanceof Response) return a
    const c = collectionOr404(a.meta, collection)
    if (c instanceof Response) return c
    const r = await readBody(req, OWNER_BODY_LIMIT)
    if (r instanceof Response) return r
    const v = validateRecord(c, dataOf(r.body), { mode: 'update' })
    if (!v.ok) return json({ error: 'validation_failed', message: describeErrors(c, v.errors), errors: v.errors }, { status: 400 })
    const res = updateRecord(projectId, c.key, recordId, v.data, 'dashboard')
    if (!res) return json({ error: 'not_found' }, { status: 404 })
    if (Object.keys(res.changes).length) {
      runWorkflows(projectId, { kind: 'updated', collection: c.key, record: res.record, before: res.before, source: 'dashboard' })
    }
    return json({ record: getRecord(projectId, c.key, recordId) ?? res.record })
  } catch (e) {
    return errorResponse(e)
  }
}

/** DELETE (owner) → { ok, id } */
export async function DELETE(req: Request, { params }: Ctx) {
  const { projectId, collection, recordId } = await params
  try {
    const a = await requireOwner(req, projectId)
    if (a instanceof Response) return a
    const c = collectionOr404(a.meta, collection)
    if (c instanceof Response) return c
    const gone = deleteRecord(projectId, c.key, recordId, 'dashboard')
    if (!gone) return json({ error: 'not_found' }, { status: 404 })
    return json({ ok: true, id: gone.id })
  } catch (e) {
    return errorResponse(e)
  }
}

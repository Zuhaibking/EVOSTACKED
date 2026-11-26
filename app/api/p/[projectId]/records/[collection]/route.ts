import { createRecord, getRecord, listRecords } from '@/lib/platform/db'
import { describeErrors, validateRecord } from '@/lib/platform/validate'
import { publicView } from '@/lib/platform/visibility'
import { runWorkflows } from '@/lib/platform/workflows'
import {
  access, collectionOr404, dataOf, errorResponse, json, OWNER_BODY_LIMIT, preflight, PUBLIC_BODY_LIMIT, publicCollection, readBody,
} from '../../_lib/http'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ projectId: string; collection: string }> }

export function OPTIONS() {
  return preflight()
}

/**
 * GET /api/p/{id}/records/{collection}?q=&sort=&dir=&limit=&offset=&status=
 * owner, or public when collection.publicRead → { rows, total }
 * Non-owners: rate limited, uniform 404 for unknown / private collections, and only publicly
 * visible rows without internal columns (lib/platform/visibility).
 */
export async function GET(req: Request, { params }: Ctx) {
  const { projectId, collection } = await params
  try {
    const a = await access(req, projectId, true)
    if (a instanceof Response) return a
    const c = a.owner ? collectionOr404(a.meta, collection, true) : publicCollection(req, a, collection, 'read')
    if (c instanceof Response) return c
    const sp = new URL(req.url).searchParams
    const result = listRecords(projectId, c.key, {
      q: sp.get('q'),
      sort: sp.get('sort'),
      dir: sp.get('dir'),
      limit: a.owner ? sp.get('limit') : Math.min(100, Number(sp.get('limit') || 50) || 50),
      offset: sp.get('offset'),
      status: sp.get('status'),
      from: sp.get('from'),
      to: sp.get('to'),
      publicOnly: !a.owner,
    })
    return json(a.owner ? result : { ...result, rows: result.rows.map((r) => publicView(c, r)) }, { cors: true })
  } catch (e) {
    return errorResponse(e, true)
  }
}

/**
 * POST /api/p/{id}/records/{collection} body { data }
 * owner, or public when collection.publicCreate (only publicWritable fields kept;
 * `x-evo-source: website` forces public semantics) → 201 { record }
 */
export async function POST(req: Request, { params }: Ctx) {
  const { projectId, collection } = await params
  try {
    const a = await access(req, projectId, true)
    if (a instanceof Response) return a
    const c = a.owner ? collectionOr404(a.meta, collection, true) : publicCollection(req, a, collection, 'create')
    if (c instanceof Response) return c
    const r = await readBody(req, a.owner ? OWNER_BODY_LIMIT : PUBLIC_BODY_LIMIT, true)
    if (r instanceof Response) return r
    const input = dataOf(r.body)
    // Honeypot for website forms: pretend success, store nothing.
    if (!a.owner && (input._hp || input._gotcha)) return json({ record: null, ok: true }, { status: 202, cors: true })

    const v = validateRecord(c, input, { mode: 'create', public: !a.owner })
    if (!v.ok) return json({ error: 'validation_failed', message: describeErrors(c, v.errors), errors: v.errors }, { status: 400, cors: true })

    const source = a.owner ? 'dashboard' : 'website'
    const record = createRecord(projectId, c.key, v.data, source)
    runWorkflows(projectId, { kind: 'created', collection: c.key, record, source })
    return json({ record: getRecord(projectId, c.key, record.id) ?? record }, { status: 201, cors: true })
  } catch (e) {
    return errorResponse(e, true)
  }
}

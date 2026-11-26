import { countRecords } from '@/lib/platform/db'
import { errorResponse, json, requireOwner } from './_lib/http'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ projectId: string }> }

/** GET /api/p/{id} (owner) → { meta, counts } · 404 { error: 'not_provisioned' } */
export async function GET(req: Request, { params }: Ctx) {
  const { projectId } = await params
  try {
    const a = await requireOwner(req, projectId)
    if (a instanceof Response) return a
    return json({ meta: a.meta, counts: countRecords(projectId) })
  } catch (e) {
    return errorResponse(e)
  }
}

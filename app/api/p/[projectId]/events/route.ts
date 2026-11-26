import { listEvents } from '@/lib/platform/db'
import { errorResponse, json, requireOwner } from '../_lib/http'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ projectId: string }> }

/** GET /api/p/{id}/events?after=0&limit=50 (owner) → { events } newest last. after=0 → latest `limit`. */
export async function GET(req: Request, { params }: Ctx) {
  const { projectId } = await params
  try {
    const a = await requireOwner(req, projectId)
    if (a instanceof Response) return a
    const sp = new URL(req.url).searchParams
    return json({ events: listEvents(projectId, Number(sp.get('after') || 0), Number(sp.get('limit') || 50)) })
  } catch (e) {
    return errorResponse(e)
  }
}

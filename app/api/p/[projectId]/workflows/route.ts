import { getWorkflows, setWorkflowEnabled } from '@/lib/platform/db'
import { errorResponse, json, OWNER_BODY_LIMIT, readBody, requireOwner } from '../_lib/http'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ projectId: string }> }

/** GET /api/p/{id}/workflows (owner) → { workflows } */
export async function GET(req: Request, { params }: Ctx) {
  const { projectId } = await params
  try {
    const a = await requireOwner(req, projectId)
    if (a instanceof Response) return a
    return json({ workflows: getWorkflows(projectId) })
  } catch (e) {
    return errorResponse(e)
  }
}

/** PATCH /api/p/{id}/workflows (owner) body { key, enabled } → { workflows } */
export async function PATCH(req: Request, { params }: Ctx) {
  const { projectId } = await params
  try {
    const a = await requireOwner(req, projectId)
    if (a instanceof Response) return a
    const r = await readBody(req, OWNER_BODY_LIMIT)
    if (r instanceof Response) return r
    const { key, enabled } = (r.body ?? {}) as { key?: unknown; enabled?: unknown }
    if (typeof key !== 'string' || typeof enabled !== 'boolean') {
      return json({ error: 'invalid_body', message: 'Expected { key: string, enabled: boolean }' }, { status: 400 })
    }
    return json({ workflows: setWorkflowEnabled(projectId, key, enabled) })
  } catch (e) {
    return errorResponse(e)
  }
}

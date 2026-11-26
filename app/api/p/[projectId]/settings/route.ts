import { getSettings, updateSettings } from '@/lib/platform/db'
import { errorResponse, json, OWNER_BODY_LIMIT, readBody, requireOwner } from '../_lib/http'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ projectId: string }> }

/** GET /api/p/{id}/settings (owner) → { settings: Setting[] } */
export async function GET(req: Request, { params }: Ctx) {
  const { projectId } = await params
  try {
    const a = await requireOwner(req, projectId)
    if (a instanceof Response) return a
    return json({ settings: getSettings(projectId) })
  } catch (e) {
    return errorResponse(e)
  }
}

/** PUT /api/p/{id}/settings (owner) body { settings: Setting[] | {key: value} } → { settings } */
export async function PUT(req: Request, { params }: Ctx) {
  const { projectId } = await params
  try {
    const a = await requireOwner(req, projectId)
    if (a instanceof Response) return a
    const r = await readBody(req, OWNER_BODY_LIMIT)
    if (r instanceof Response) return r
    const body = (r.body ?? {}) as Record<string, unknown>
    const input = body.settings ?? body.values ?? body
    if (!input || typeof input !== 'object') return json({ error: 'invalid_body', message: 'Expected { settings }' }, { status: 400 })
    return json({ settings: updateSettings(projectId, input as Record<string, unknown>, 'dashboard') })
  } catch (e) {
    return errorResponse(e)
  }
}

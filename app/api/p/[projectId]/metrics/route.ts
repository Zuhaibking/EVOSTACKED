import { computeMetrics } from '@/lib/platform/metrics'
import { errorResponse, json, requireOwner } from '../_lib/http'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ projectId: string }> }

/** GET /api/p/{id}/metrics (owner) → MetricsResponse */
export async function GET(req: Request, { params }: Ctx) {
  const { projectId } = await params
  try {
    const a = await requireOwner(req, projectId)
    if (a instanceof Response) return a
    return json(computeMetrics(projectId))
  } catch (e) {
    return errorResponse(e)
  }
}

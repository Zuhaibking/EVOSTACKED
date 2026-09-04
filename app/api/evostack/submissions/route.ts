import { canAccessProject, clerkConfigured } from '@/lib/auth-guard'
import { projectRequiresDataLayer } from '@/lib/candidate-store'
import { listSubmissions } from '@/lib/submissions'
import { NextRequest } from 'next/server'

export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get('projectId') || ''
  if (!projectId) {
    return Response.json({ submissions: [], count: 0, requires_data_layer: false })
  }
  const allowed = await canAccessProject(projectId)
  if (!allowed) {
    return Response.json(
      { error: 'sign in required', submissions: [], count: 0, requires_data_layer: false },
      { status: clerkConfigured() ? 401 : 403 },
    )
  }
  const needed = await projectRequiresDataLayer(projectId)
  const rows = needed ? await listSubmissions(projectId) : []
  return Response.json({
    requires_data_layer: needed,
    count: rows.length,
    submissions: rows,
  })
}

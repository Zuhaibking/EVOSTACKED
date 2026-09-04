import { listCandidateSnapshots } from '@/lib/candidate-store'
import {
  loadProjectMeta,
  saveProjectMeta,
  setActiveCandidate,
} from '@/lib/project-meta'
import { NextRequest } from 'next/server'

export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get('projectId') || ''
  if (!projectId) return Response.json({ error: 'projectId required' }, { status: 400 })
  const meta = await loadProjectMeta(projectId)
  const snaps = await listCandidateSnapshots(projectId)
  return Response.json({
    projectId,
    ownerId: meta?.ownerId,
    activeCandidateId: meta?.activeCandidateId || null,
    activeVersionId: meta?.activeVersionId || null,
    runId: meta?.runId || null,
    candidates: meta?.candidates || {},
    persisted: snaps.map((s) => ({
      candidateId: s.candidateId,
      updatedAt: s.updatedAt,
      versionId: s.versions[0]?.id,
      versionCount: s.versions.length,
      requires_data_layer: Boolean(s.requires_data_layer),
    })),
  })
}

export async function POST(req: Request) {
  let body: {
    projectId?: string
    ownerId?: string
    activeCandidateId?: string
    activeVersionId?: string
    clearActive?: boolean
  } = {}
  try {
    body = (await req.json()) as typeof body
  } catch {
    return Response.json({ error: 'invalid json' }, { status: 400 })
  }
  const projectId = body.projectId || ''
  if (!projectId) return Response.json({ error: 'projectId required' }, { status: 400 })

  if (body.clearActive) {
    const prev = await loadProjectMeta(projectId)
    const candidates = { ...(prev?.candidates ?? {}) }
    for (const id of Object.keys(candidates)) {
      candidates[id] = { ...candidates[id], status: 'resting' }
    }
    const row = await saveProjectMeta({
      projectId,
      ownerId: body.ownerId,
      activeCandidateId: '',
      activeVersionId: '',
      candidates,
    })
    return Response.json(row)
  }

  if (body.activeCandidateId) {
    const row = await setActiveCandidate({
      projectId,
      activeCandidateId: body.activeCandidateId,
      activeVersionId: body.activeVersionId,
      ownerId: body.ownerId,
    })
    return Response.json(row)
  }

  const row = await saveProjectMeta({
    projectId,
    ownerId: body.ownerId,
  })
  return Response.json(row)
}

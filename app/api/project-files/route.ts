import { loadCandidateSnapshot } from '@/lib/candidate-store'
import { persistCandidateFiles } from '@/lib/persist-candidate'
import { FragmentSchema } from '@/lib/schema'
import { DeepPartial } from 'ai'
import { NextRequest } from 'next/server'

export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get('projectId') || ''
  const candidateId = req.nextUrl.searchParams.get('candidateId') || ''
  const snap = await loadCandidateSnapshot(projectId, candidateId)
  if (!snap) {
    return Response.json({
      files: [],
      versions: [],
      updatedAt: null,
      requires_data_layer: false,
    })
  }
  return Response.json({
    projectId: snap.projectId,
    candidateId: snap.candidateId,
    runId: snap.runId,
    template: snap.template,
    requires_data_layer: Boolean(snap.requires_data_layer),
    updatedAt: snap.updatedAt,
    files: snap.files,
    versions: snap.versions,
  })
}

export async function POST(req: Request) {
  let body: {
    projectId?: string
    candidateId?: string
    runId?: string
    fragment?: DeepPartial<FragmentSchema>
    label?: string
    score?: number
    isWinner?: boolean
  } = {}
  try {
    body = (await req.json()) as typeof body
  } catch {
    return Response.json({ error: 'invalid json' }, { status: 400 })
  }
  if (!body.projectId || !body.candidateId || !body.fragment) {
    return Response.json({ error: 'projectId, candidateId, fragment required' }, { status: 400 })
  }
  const snap = await persistCandidateFiles({
    projectId: body.projectId,
    candidateId: body.candidateId,
    runId: body.runId,
    fragment: body.fragment,
    label: body.label,
    score: body.score,
    isWinner: body.isWinner,
  })
  return Response.json({
    ok: true,
    projectId: snap.projectId,
    candidateId: snap.candidateId,
    versionId: snap.versions[0]?.id,
    requires_data_layer: Boolean(snap.requires_data_layer),
    fileCount: snap.files.length,
  })
}

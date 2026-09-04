import { withCaptureLayer } from '@/lib/capture-layer'
import { loadCandidateSnapshot } from '@/lib/candidate-store'
import { withDeployScaffold } from '@/lib/deploy-scaffold'
import {
  loadDeploy,
  saveDeploy,
  type DeployRecord,
} from '@/lib/deploy-store'
import {
  assignVercelAlias,
  createVercelDeployment,
  ensureVercelProject,
  getVercelDeployment,
  publicCaptureUrl,
  upsertVercelEnv,
  vercelConfigured,
} from '@/lib/deploy-vercel'
import { requireSignedIn } from '@/lib/auth-guard'
import { deploySlug } from '@/lib/project-meta'
import { NextRequest } from 'next/server'

export const maxDuration = 60

function toClient(row: DeployRecord | null) {
  if (!row) {
    return { status: 'idle' as const, url: null, error: null }
  }
  return {
    status: row.status,
    url: row.url || null,
    error: row.error || null,
    slug: row.slug,
    updatedAt: row.updatedAt,
  }
}

async function refresh(row: DeployRecord): Promise<DeployRecord> {
  if (row.status !== 'building' || !row.deploymentId || !vercelConfigured()) {
    return row
  }
  const st = await getVercelDeployment(row.deploymentId)
  if (st.readyState === 'READY') {
    let url = st.url ? (st.url.startsWith('http') ? st.url : `https://${st.url}`) : row.url
    const domain = (process.env.EVOSTACK_DEPLOY_DOMAIN || '').replace(/^\./, '')
    if (domain && row.deploymentId) {
      const alias = `${row.slug}.${domain}`
      const ok = await assignVercelAlias(row.deploymentId, alias)
      if (ok) url = `https://${alias}`
    }
    return saveDeploy({ ...row, status: 'live', url, error: undefined, aliasPending: false })
  }
  if (st.readyState === 'ERROR' || st.readyState === 'CANCELED') {
    return saveDeploy({
      ...row,
      status: 'failed',
      error: st.readyStateReason || st.readyState,
    })
  }
  return row
}

export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get('projectId') || ''
  const candidateId = req.nextUrl.searchParams.get('candidateId') || ''
  const row = await loadDeploy(projectId, candidateId)
  try {
    return Response.json(toClient(row ? await refresh(row) : null))
  } catch (e) {
    return Response.json(
      toClient(
        row
          ? {
              ...row,
              status: 'failed',
              error: e instanceof Error ? e.message : 'Deploy status failed',
            }
          : null,
      ),
    )
  }
}

export async function POST(req: Request) {
  let body: {
    projectId?: string
    candidateId?: string
    origin?: string
  } = {}
  try {
    body = (await req.json()) as typeof body
  } catch {
    return Response.json({ error: 'invalid json' }, { status: 400 })
  }
  const gated = await requireSignedIn()
  if (!gated.ok) {
    return Response.json({ error: 'sign in required' }, { status: 401 })
  }
  const projectId = body.projectId || ''
  const candidateId = body.candidateId || ''
  if (!projectId || !candidateId) {
    return Response.json({ error: 'projectId and candidateId required' }, { status: 400 })
  }

  const snap = await loadCandidateSnapshot(projectId, candidateId)
  if (!snap?.files?.length) {
    return Response.json(
      { status: 'failed', url: null, error: 'No persisted files to deploy' },
      { status: 400 },
    )
  }

  if (!vercelConfigured()) {
    const failed = await saveDeploy({
      projectId,
      candidateId,
      slug: deploySlug(projectId, candidateId),
      status: 'failed',
      error: 'Set VERCEL_TOKEN to deploy persisted files.',
      provider: 'vercel',
      updatedAt: Date.now(),
    })
    return Response.json(toClient(failed), { status: 400 })
  }

  const current = await loadDeploy(projectId, candidateId)
  if (current?.status === 'building') {
    return Response.json(toClient(await refresh(current)))
  }

  const slug = deploySlug(projectId, candidateId)
  let files = snap.files.map((f) => ({
    file_path: f.file_path,
    file_content: f.file_content,
  }))
  if (snap.requires_data_layer) {
    files = withCaptureLayer(files, {
      projectId,
      candidateId,
      runId: snap.runId || projectId,
    })
  }
  files = withDeployScaffold(files)

  const started = await saveDeploy({
    projectId,
    candidateId,
    slug,
    status: 'building',
    provider: 'vercel',
    error: undefined,
    url: current?.url,
    updatedAt: Date.now(),
  })

  try {
    await ensureVercelProject(slug)
    if (snap.requires_data_layer) {
      const capture = publicCaptureUrl(body.origin)
      const vars: Record<string, string> = {
        EVOSTACK_PROJECT_ID: projectId,
        EVOSTACK_RUN_ID: snap.runId || projectId,
      }
      if (capture) vars.EVOSTACK_CAPTURE_URL = capture
      await upsertVercelEnv(slug, vars)
    }
    const created = await createVercelDeployment({ name: slug, files })
    const next = await saveDeploy({
      ...started,
      deploymentId: created.id,
      url: created.url
        ? created.url.startsWith('http')
          ? created.url
          : `https://${created.url}`
        : started.url,
      status: created.readyState === 'READY' ? 'live' : 'building',
    })
    return Response.json(toClient(await refresh(next)))
  } catch (e) {
    const failed = await saveDeploy({
      ...started,
      status: 'failed',
      error: e instanceof Error ? e.message : 'Deploy failed',
    })
    return Response.json(toClient(failed), { status: 502 })
  }
}

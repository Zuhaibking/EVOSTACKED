import { injectInspectBridge, writePlatformConfig } from '@/lib/inspect-bridge'
import { getMeta, isValidProjectId } from '@/lib/platform/db'
import type { PlatformMeta } from '@/lib/platform/types'
import { requireUserId } from '@/lib/server-auth'
import { NotFoundError, Sandbox } from 'e2b'
import { isWebsiteRequest } from '../_lib/http'

export const runtime = 'nodejs'
export const maxDuration = 30

type Ctx = { params: Promise<{ projectId: string }> }

const SANDBOX_ID = /^[A-Za-z0-9_-]{1,128}$/

/** Public slice of the blueprint the website may target (schema only; mirrors components/fragment-web.tsx). */
function platformConfig(meta: PlatformMeta, apiBase: string) {
  return {
    projectId: meta.projectId,
    apiBase,
    appName: meta.appName,
    collections: meta.blueprint.collections
      .filter((c) => c.publicCreate || c.publicRead)
      .map((c) => ({
        key: c.key,
        label: c.label,
        singular: c.singular,
        publicCreate: c.publicCreate,
        publicRead: c.publicRead,
        fields: c.fields.map((f) => ({ key: f.key, label: f.label, type: f.type, options: f.options, publicWritable: f.publicWritable, required: f.required })),
      })),
  }
}

/** Origin the browser used to reach EvoStack (proxy-aware), so the sandboxed site can call back. */
function requestOrigin(req: Request): string {
  const url = new URL(req.url)
  const first = (value: string | null) => (value || '').split(',')[0].trim()
  const proto = first(req.headers.get('x-forwarded-proto')) || url.protocol.replace(/:$/, '')
  const host = first(req.headers.get('x-forwarded-host')) || first(req.headers.get('host')) || url.host
  if (!/^https?$/.test(proto) || !/^[A-Za-z0-9.-]+(:\d{1,5})?$/.test(host)) return url.origin
  return `${proto}://${host}`
}

/**
 * POST /api/p/{projectId}/connect  {sbxId} (project owner, who must also own the sandbox)
 * → {connected: true, config}. Writes public/__evo_platform.json into the sandbox and makes
 * sure the inspect/data bridge is injected, so website submissions reach this project.
 */
export async function POST(req: Request, { params }: Ctx) {
  const { projectId } = await params
  if (!isValidProjectId(projectId)) return Response.json({ error: 'invalid_project_id' }, { status: 400 })
  // Generated sites and cross-site pages never get to (re)wire a project.
  if (isWebsiteRequest(req)) return Response.json({ error: 'forbidden', message: 'Owner access required' }, { status: 403 })
  const auth = await requireUserId()
  if ('response' in auth) return auth.response
  const { userId } = auth

  const meta = getMeta(projectId)
  if (!meta) return Response.json({ error: 'not_provisioned' }, { status: 404 })
  if (meta.ownerId !== userId) return Response.json({ error: 'forbidden', message: 'Only the project owner can do this' }, { status: 403 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'invalid_json', message: 'Body must be valid JSON' }, { status: 400 })
  }
  const raw = body && typeof body === 'object' ? (body as { sbxId?: unknown }).sbxId : undefined
  const sbxId = typeof raw === 'string' ? raw.trim() : ''
  if (!SANDBOX_ID.test(sbxId)) return Response.json({ error: 'invalid_sbx_id', message: 'sbxId is required' }, { status: 400 })

  try {
    const info = await Sandbox.getInfo(sbxId, { requestTimeoutMs: 10_000 })
    if (info.metadata?.userID !== userId) {
      return Response.json({ error: 'forbidden', message: 'This preview belongs to another account' }, { status: 403 })
    }
  } catch (error) {
    if (error instanceof NotFoundError) return Response.json({ error: 'sandbox_not_found', message: 'The preview sandbox no longer exists' }, { status: 404 })
    console.error('[connect] sandbox lookup failed', error)
    return Response.json({ error: 'sandbox_unavailable', message: 'Could not reach the preview sandbox' }, { status: 502 })
  }

  const config = platformConfig(meta, requestOrigin(req))
  try {
    const sbx = await Sandbox.connect(sbxId, { requestTimeoutMs: 15_000 })
    await writePlatformConfig(sbx, config)
    await injectInspectBridge(sbx)
  } catch (error) {
    console.error('[connect] could not write the platform config', error)
    return Response.json({ error: 'connect_failed', message: 'Could not connect the preview to its backend' }, { status: 502 })
  }
  return Response.json({ connected: true, config }, { headers: { 'Cache-Control': 'no-store' } })
}

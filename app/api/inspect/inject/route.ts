import { injectInspectBridge } from '@/lib/inspect-bridge'
import { requireUserId } from '@/lib/server-auth'
import { Sandbox } from '@e2b/code-interpreter'

export const maxDuration = 30

export async function POST(req: Request) {
  const authz = await requireUserId()
  if ('response' in authz) return authz.response
  let sbxId: unknown
  try {
    sbxId = (await req.json())?.sbxId
  } catch {
    return new Response('Invalid request.', { status: 400 })
  }

  if (typeof sbxId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(sbxId)) {
    return new Response('sbxId is required.', { status: 400 })
  }

  try {
    // Same ownership rule as downloadAccess: only the sandbox's creator may touch it.
    const info = await Sandbox.getInfo(sbxId, { requestTimeoutMs: 10_000 })
    if (info.metadata?.userID !== authz.userId) {
      return new Response('This preview belongs to another account.', { status: 403 })
    }
    const sbx = await Sandbox.connect(sbxId, { requestTimeoutMs: 10_000 })
    await injectInspectBridge(sbx)
    return Response.json({ ok: true, sbxId })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Inject failed'
    return new Response(message, { status: 410 })
  }
}

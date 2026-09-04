import { injectInspectBridge } from '@/lib/inspect-bridge'
import { Sandbox } from '@e2b/code-interpreter'

export const maxDuration = 30

export async function POST(req: Request) {
  const {
    sbxId,
    teamID,
    accessToken,
  }: {
    sbxId?: string
    teamID?: string
    accessToken?: string
  } = await req.json()

  if (!sbxId) {
    return new Response('sbxId is required.', { status: 400 })
  }

  try {
    const sbx = await Sandbox.connect(sbxId, {
      ...(teamID && accessToken
        ? {
            headers: {
              'X-Supabase-Team': teamID,
              'X-Supabase-Token': accessToken,
            },
          }
        : {}),
    })
    await injectInspectBridge(sbx)
    return Response.json({ ok: true, sbxId })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Inject failed'
    return new Response(message, { status: 410 })
  }
}

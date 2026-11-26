import { downloadAccess, projectZipName, readProjectZip } from '@/lib/project-archive'
import { auth } from '@clerk/nextjs/server'
import { NotFoundError, Sandbox } from 'e2b'

export const maxDuration = 180

const ROOT = '/home/user'

export async function POST(req: Request) {
  let body: Record<string, unknown>
  try {
    body = await req.json()
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Invalid body')
  } catch {
    return Response.json({ error: 'Invalid download request.' }, { status: 400 })
  }
  const sbxId = body.sbxId
  if (typeof sbxId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(sbxId)) {
    return Response.json({ error: 'Invalid preview.' }, { status: 400 })
  }
  const title = typeof body.title === 'string' ? body.title : undefined
  const projectID = typeof body.projectID === 'string' ? body.projectID : undefined
  const candidateID = typeof body.candidateID === 'string' ? body.candidateID : undefined
  const clerk = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY)
  let userId = ''
  if (clerk) {
    try {
      userId = (await auth()).userId || ''
    } catch {
      return Response.json({ error: 'Sign in to download this project.' }, { status: 401 })
    }
    if (!userId) return Response.json({ error: 'Sign in to download this project.' }, { status: 401 })
  }
  try {
    const info = await Sandbox.getInfo(sbxId, { requestTimeoutMs: 10_000 })
    const access = downloadAccess({ clerk, userId, metadata: info.metadata || {}, projectID, candidateID })
    if (!access.ok) return Response.json({ error: access.error }, { status: access.status })
    const sbx = await Sandbox.connect(sbxId, { timeoutMs: 180_000, requestTimeoutMs: 15_000 })
    const zip = await readProjectZip({
      list: (path) => sbx.files.list(path, { requestTimeoutMs: 20_000 }),
      read: (path) => sbx.files.read(path, { format: 'bytes', requestTimeoutMs: 60_000 }),
    }, ROOT)
    const filename = projectZipName(title)
    return new Response(Buffer.from(zip), {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': String(zip.byteLength),
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    if (error instanceof NotFoundError || isMissing(error)) {
      return Response.json({ error: 'This preview is no longer available. Open the preview again, then download.' }, { status: 404 })
    }
    const message = error instanceof Error ? error.message : ''
    if (/too many files|too large|missing package\.json|no project files/.test(message)) {
      return Response.json({ error: message }, { status: 413 })
    }
    console.warn('[EvoStack][DOWNLOAD]', error instanceof Error ? error.name : 'Error')
    return Response.json({ error: 'Could not download this project. Open the preview again, then retry.' }, { status: 503 })
  }
}

function isMissing(error: unknown) {
  if (!error || typeof error !== 'object') return false
  const value = error as { status?: number; statusCode?: number; code?: number }
  return value.status === 404 || value.statusCode === 404 || value.code === 404
}

import { generateBlueprint } from '@/lib/platform/blueprint'
import { getMeta, isValidProjectId, provisionProject } from '@/lib/platform/db'
import { projectSpecSchema, type PlatformMeta } from '@/lib/platform/types'
import ratelimit, { rateLimitKey } from '@/lib/ratelimit'
import { getUserId } from '@/lib/server-auth'
import { errorResponse, isWebsiteRequest, json, readBody } from '../_lib/http'

export const runtime = 'nodejs'
export const maxDuration = 120

type Ctx = { params: Promise<{ projectId: string }> }

const MAX_BODY = 4 * 1024 * 1024
const MAX_FILES = 80
const MAX_FILE_CHARS = 200_000
const MAX_TOTAL_CHARS = 2_000_000
/** Each generation = 2 LLM calls + a new SQLite file. */
const PROVISIONS_PER_HOUR = 10

// Concurrent provisions of the same project by the same user share one job (double clicks, retries).
type Job = { ownerId: string; job: Promise<PlatformMeta> }
const g = globalThis as typeof globalThis & { __evoProvisionJobs?: Map<string, Job> }
const inflight: Map<string, Job> = g.__evoProvisionJobs ?? (g.__evoProvisionJobs = new Map())

/**
 * POST /api/p/{id}/provision[?force=1] (signed-in user → owner)
 * body { spec: ProjectSpec | null, brief: string, files?: { file_path, file_content }[] } → { meta }
 * Idempotent: an existing backend is returned unchanged unless ?force=1.
 */
export async function POST(req: Request, { params }: Ctx) {
  const { projectId } = await params
  try {
    if (!isValidProjectId(projectId)) return json({ error: 'invalid_project_id' }, { status: 400 })
    if (isWebsiteRequest(req)) return json({ error: 'forbidden' }, { status: 403 })
    const userId = await getUserId()
    if (!userId) return json({ error: 'unauthorized', message: 'Sign in to continue.' }, { status: 401 })

    const existing = getMeta(projectId)
    if (existing && existing.ownerId !== userId) return json({ error: 'forbidden', message: 'Only the project owner can do this' }, { status: 403 })
    const force = new URL(req.url).searchParams.get('force') === '1'
    if (existing && !force) return json({ meta: existing, existing: true })

    // Join the same user's in-flight job; never hand another user's in-flight meta (ownerId, spec) out.
    const joinOrRefuse = async (p: Job) => p.ownerId !== userId
      ? json({ error: 'conflict', message: 'This project is being set up by another account' }, { status: 409 })
      : json({ meta: await p.job })
    const pending = inflight.get(projectId)
    if (pending) return await joinOrRefuse(pending)

    const limited = await ratelimit(`${rateLimitKey(req, userId)}:provision`, PROVISIONS_PER_HOUR, '1h')
    if (limited) {
      return json(
        { error: 'rate_limited', message: 'Too many backend setups, try again later.' },
        { status: 429, headers: { 'Retry-After': String(Math.max(1, Math.ceil((limited.reset - Date.now()) / 1000))) } },
      )
    }

    const r = await readBody(req, MAX_BODY)
    if (r instanceof Response) return r
    const body = (r.body ?? {}) as Record<string, unknown>
    const parsedSpec = projectSpecSchema.safeParse(body.spec)
    const spec = parsedSpec.success ? parsedSpec.data : null
    const brief = typeof body.brief === 'string' ? body.brief.slice(0, 20_000) : ''
    let total = 0
    const files = (Array.isArray(body.files) ? body.files : [])
      .filter((f): f is { file_path: string; file_content: string } => !!f && typeof f.file_path === 'string' && typeof f.file_content === 'string')
      .slice(0, MAX_FILES)
      .map((f) => ({ file_path: f.file_path.slice(0, 300), file_content: f.file_content.slice(0, MAX_FILE_CHARS) }))
      .filter((f) => (total += f.file_content.length) <= MAX_TOTAL_CHARS)
    if (!spec && !brief && !files.length) return json({ error: 'invalid_body', message: 'Provide a spec, a brief or files' }, { status: 400 })

    // Re-check synchronously after the awaits above, right before claiming the slot.
    const raced = inflight.get(projectId)
    if (raced) return await joinOrRefuse(raced)
    const current = getMeta(projectId)
    if (current && current.ownerId !== userId) return json({ error: 'forbidden', message: 'Only the project owner can do this' }, { status: 403 })

    const job = (async () => {
      const { blueprint, seed } = await generateBlueprint({ spec, brief, files })
      return provisionProject({ projectId, ownerId: userId, spec, blueprint, seed, force: true })
    })()
    const entry: Job = { ownerId: userId, job }
    inflight.set(projectId, entry)
    try {
      return json({ meta: await job }, { status: existing ? 200 : 201 })
    } finally {
      if (inflight.get(projectId) === entry) inflight.delete(projectId)
    }
  } catch (e) {
    return errorResponse(e)
  }
}

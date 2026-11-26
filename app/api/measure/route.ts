import { measureSandbox, type MeasureHealth } from '@/lib/evidence/measure'
import type { EvidenceMetrics } from '@/lib/evidence/types'
import { requireUserId } from '@/lib/server-auth'
import { NotFoundError, Sandbox } from 'e2b'

export const runtime = 'nodejs'
export const maxDuration = 60

const ID_RE = /^[A-Za-z0-9_-]{1,128}$/
const MEASURE_BUDGET_MS = 45_000

// ponytail: process-local guards; multiple hosts need a shared store.
const inflight = new Map<string, Promise<EvidenceMetrics>>()
const recent = new Map<string, number[]>()
const RATE_LIMIT = 20 // measurements per user per minute

function rateLimited(userId: string): boolean {
  const now = Date.now()
  const hits = (recent.get(userId) ?? []).filter((t) => now - t < 60_000)
  if (hits.length >= RATE_LIMIT) {
    recent.set(userId, hits)
    return true
  }
  hits.push(now)
  recent.set(userId, hits)
  if (recent.size > 500) for (const [k, v] of recent) if (!v.some((t) => now - t < 60_000)) recent.delete(k)
  return false
}

function sanitizeHealth(raw: unknown): MeasureHealth | null {
  if (!raw || typeof raw !== 'object') return null
  const h = raw as Record<string, unknown>
  const status = (v: unknown) => (v === 'passed' || v === 'failed' || v === 'skipped' ? v : undefined)
  const count = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.min(Math.round(v), 1000) : undefined)
  return {
    buildStatus: status(h.buildStatus),
    runtimeStatus: status(h.runtimeStatus),
    repairAttempts: count(h.repairAttempts),
    typecheckOk: typeof h.typecheckOk === 'boolean' ? h.typecheckOk : undefined,
    repairs: count(h.repairs),
    runtimeErrors: count(h.runtimeErrors),
  }
}

function portFor(template: string | undefined): number {
  if (template === 'streamlit-developer') return 8501
  if (template === 'gradio-developer') return 7860
  return 3000
}

export async function POST(req: Request) {
  const authed = await requireUserId()
  if ('response' in authed) return authed.response
  const { userId } = authed

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const { sbxId, projectID, candidateID } = body ?? {}
  if (typeof sbxId !== 'string' || !ID_RE.test(sbxId)) {
    return Response.json({ error: 'sbxId is required' }, { status: 400 })
  }
  for (const [name, v] of [['projectID', projectID], ['candidateID', candidateID]] as const) {
    if (v !== undefined && v !== null && (typeof v !== 'string' || v.length > 128)) {
      return Response.json({ error: `Invalid ${name}` }, { status: 400 })
    }
  }

  // Ownership: the sandbox must have been created for this user (metadata set by /api/sandbox).
  let template: string | undefined
  try {
    const info = await Sandbox.getInfo(sbxId, { requestTimeoutMs: 10_000 })
    const meta = info.metadata ?? {}
    if (meta.userID !== userId) return Response.json({ error: 'Sandbox not found' }, { status: 404 })
    if (typeof projectID === 'string' && meta.projectID && meta.projectID !== projectID) {
      return Response.json({ error: 'Sandbox does not belong to this project' }, { status: 403 })
    }
    if (typeof candidateID === 'string' && meta.candidateID && meta.candidateID !== candidateID) {
      return Response.json({ error: 'Sandbox does not belong to this candidate' }, { status: 403 })
    }
    template = meta.template || info.templateId
  } catch (error) {
    const name = (error as { name?: string })?.name
    const message = error instanceof Error ? error.message : ''
    if (error instanceof NotFoundError || name === 'NotFoundError' || name === 'SandboxNotFoundError' || /not found|invalid sandbox id/i.test(message)) {
      return Response.json({ error: 'Sandbox not found' }, { status: 404 })
    }
    console.error('[measure] getInfo failed', error)
    return Response.json({ error: 'Could not reach the sandbox service' }, { status: 502 })
  }

  if (template === 'code-interpreter-v1') {
    return Response.json({ error: 'Interpreter sandboxes have no web server to measure' }, { status: 422 })
  }

  let job = inflight.get(sbxId)
  if (!job) {
    if (rateLimited(userId)) {
      return Response.json({ error: 'Too many measurements — try again in a minute' }, { status: 429 })
    }
    job = measureSandbox(sbxId, {
      port: portFor(template),
      health: sanitizeHealth(body.health),
      budgetMs: MEASURE_BUDGET_MS,
    }).finally(() => inflight.delete(sbxId))
    inflight.set(sbxId, job)
  }

  try {
    const evidence = await job
    return Response.json({ evidence }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('[measure] failed', error)
    return Response.json({ error: 'Measurement failed' }, { status: 500 })
  }
}

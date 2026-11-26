import { latestEventId, listEventsAfter } from '@/lib/platform/db'
import { errorResponse, json, requireOwner } from '../_lib/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ projectId: string }> }

const POLL_MS = 1000
const PING_MS = 15_000
/** Concurrent streams per user + project (each one polls SQLite every second). */
const MAX_STREAMS = 5
const g = globalThis as typeof globalThis & { __evoPlatformStreams?: Map<string, number> }
const openStreams: Map<string, number> = g.__evoPlatformStreams ?? (g.__evoPlatformStreams = new Map())

/**
 * GET /api/p/{id}/stream?after=<eventId> (owner) — Server-Sent Events.
 * Each new PlatformEvent → `id: N\ndata: {json}\n\n`; heartbeat `: ping` every 15 s.
 * Without ?after (or Last-Event-ID) only events newer than "now" are sent.
 */
export async function GET(req: Request, { params }: Ctx) {
  const { projectId } = await params
  try {
    const a = await requireOwner(req, projectId)
    if (a instanceof Response) return a
    const sp = new URL(req.url).searchParams
    const resume = sp.get('after') ?? req.headers.get('last-event-id')
    let after = resume !== null && resume !== '' && Number.isFinite(Number(resume)) ? Math.max(0, Math.floor(Number(resume))) : latestEventId(projectId)
    const encoder = new TextEncoder()
    const slot = `${a.userId}:${projectId}`
    const inUse = openStreams.get(slot) ?? 0
    if (inUse >= MAX_STREAMS) {
      return json({ error: 'too_many_streams', message: `At most ${MAX_STREAMS} live connections per project; close another tab.` }, { status: 429, headers: { 'Retry-After': '30' } })
    }
    openStreams.set(slot, inUse + 1)
    let released = false
    const release = () => {
      if (released) return
      released = true
      const n = (openStreams.get(slot) ?? 1) - 1
      if (n > 0) openStreams.set(slot, n)
      else openStreams.delete(slot)
    }
    let cleanup = release

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let closed = false
        const send = (chunk: string) => {
          if (closed) return
          try { controller.enqueue(encoder.encode(chunk)) } catch { cleanup() }
        }
        const poll = () => {
          if (closed) return
          try {
            for (let page = 0; page < 5; page++) {
              const events = listEventsAfter(projectId, after, 100)
              for (const e of events) {
                send(`id: ${e.id}\ndata: ${JSON.stringify(e)}\n\n`)
                after = e.id
              }
              if (events.length < 100) break
            }
          } catch (e) {
            console.error('[platform] stream poll failed', e)
          }
        }
        const pollTimer = setInterval(poll, POLL_MS)
        const pingTimer = setInterval(() => send(': ping\n\n'), PING_MS)
        cleanup = () => {
          if (closed) return
          closed = true
          release()
          clearInterval(pollTimer)
          clearInterval(pingTimer)
          req.signal.removeEventListener('abort', cleanup)
          try { controller.close() } catch { /* already closed */ }
        }
        req.signal.addEventListener('abort', cleanup)
        send(`retry: 2000\n: connected after=${after}\n\n`)
        poll()
      },
      cancel() {
        cleanup()
      },
    })

    // Already gone (client aborted before the stream started) → don't hold the slot.
    if (req.signal.aborted) cleanup()

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    })
  } catch (e) {
    return errorResponse(e)
  }
}

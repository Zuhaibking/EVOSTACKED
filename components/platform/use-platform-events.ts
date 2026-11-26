'use client'

import type { PlatformEvent } from '@/lib/platform/types'
import { useEffect, useRef, useState } from 'react'

export type RealtimeMode = 'connecting' | 'live' | 'polling' | 'offline'

export type PlatformEventsState = {
  /** SSE stream is open. */
  connected: boolean
  /** live = SSE · polling = SSE down, 3 s fallback poll working · offline = both failing. */
  mode: RealtimeMode
  /** Oldest → newest (capped). */
  events: PlatformEvent[]
  lastEventByCollection: Record<string, PlatformEvent>
  /** Initial history has loaded. */
  ready: boolean
}

const MAX_EVENTS = 300
const POLL_MS = 3000
const LIVE_WINDOW_MS = 90_000 // replayed history older than this never toasts

function isEvent(x: unknown): x is PlatformEvent {
  return !!x && typeof x === 'object' && typeof (x as PlatformEvent).id === 'number' && typeof (x as PlatformEvent).type === 'string'
}

/**
 * Realtime feed for one provisioned project.
 * 1. seeds history from GET /events?after=0,
 * 2. subscribes to the SSE stream (reconnects with exponential backoff + jitter),
 * 3. while SSE is down, polls /events?after=<lastId> every 3 s.
 * `onEvent` fires once per genuinely new event (deduped by id, never for seeded history).
 */
export function usePlatformEvents(
  projectId: string | null | undefined,
  opts: { onEvent?: (e: PlatformEvent) => void; enabled?: boolean } = {},
): PlatformEventsState {
  const enabled = opts.enabled !== false && !!projectId
  const onEventRef = useRef(opts.onEvent)
  useEffect(() => {
    onEventRef.current = opts.onEvent
  })

  const [state, setState] = useState<PlatformEventsState>({
    connected: false,
    mode: 'connecting',
    events: [],
    lastEventByCollection: {},
    ready: false,
  })

  useEffect(() => {
    if (!enabled || !projectId) return
    const base = `/api/p/${encodeURIComponent(projectId)}`
    const seen = new Set<number>()
    let lastId = 0
    let ready = false
    let disposed = false
    let es: EventSource | null = null
    let failures = 0
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let pollTimer: ReturnType<typeof setInterval> | null = null
    let polling = false
    let sseOpen = false

    const setMode = (mode: RealtimeMode) =>
      setState((s) => (s.mode === mode && s.connected === (mode === 'live') ? s : { ...s, mode, connected: mode === 'live' }))

    const ingest = (incoming: unknown[], live: boolean) => {
      if (disposed) return // late responses from a torn-down subscription (Strict Mode, id change)
      const fresh = incoming.filter(isEvent).filter((e) => !seen.has(e.id)).sort((a, b) => a.id - b.id)
      if (!fresh.length) return
      for (const e of fresh) {
        seen.add(e.id)
        if (e.id > lastId) lastId = e.id
      }
      setState((s) => {
        const byId = new Map<number, PlatformEvent>()
        for (const e of s.events) byId.set(e.id, e)
        for (const e of fresh) byId.set(e.id, e)
        const events = [...byId.values()].sort((a, b) => a.id - b.id).slice(-MAX_EVENTS)
        const lastEventByCollection = { ...s.lastEventByCollection }
        for (const e of fresh) if (e.collection) lastEventByCollection[e.collection] = e
        return { ...s, events, lastEventByCollection }
      })
      if (!live) return
      const now = Date.now()
      for (const e of fresh) {
        const age = now - new Date(e.ts).getTime()
        if (Number.isFinite(age) && age > LIVE_WINDOW_MS) continue
        try {
          onEventRef.current?.(e)
        } catch {
          /* listener errors must not break the stream */
        }
      }
    }

    const fetchSince = async (after: number, limit = 50) => {
      const res = await fetch(`${base}/events?after=${after}&limit=${limit}`, { cache: 'no-store' })
      if (!res.ok) throw new Error(String(res.status))
      const body = (await res.json()) as { events?: unknown[] }
      return Array.isArray(body.events) ? body.events : []
    }

    const poll = async () => {
      if (disposed || sseOpen) return
      try {
        ingest(await fetchSince(lastId), ready)
        if (!sseOpen) setMode('polling')
      } catch {
        if (!sseOpen) setMode('offline')
      }
    }
    const startPolling = () => {
      if (polling || disposed) return
      polling = true
      void poll()
      pollTimer = setInterval(poll, POLL_MS)
    }
    const stopPolling = () => {
      polling = false
      if (pollTimer) clearInterval(pollTimer)
      pollTimer = null
    }

    const connect = () => {
      if (disposed || typeof EventSource === 'undefined') {
        startPolling()
        return
      }
      try {
        // First connect: no `after` → server streams only events newer than "now" (history comes
        // from /events). Reconnects resume from the last id we saw so nothing is lost.
        es = new EventSource(lastId > 0 ? `${base}/stream?after=${lastId}` : `${base}/stream`)
      } catch {
        startPolling()
        return
      }
      es.onopen = () => {
        sseOpen = true
        failures = 0
        stopPolling()
        setMode('live')
        // close any gap opened while we were disconnected
        if (ready) fetchSince(lastId).then((evs) => ingest(evs, true)).catch(() => {})
      }
      es.onmessage = (msg) => {
        try {
          ingest([JSON.parse(msg.data)], ready)
        } catch {
          /* heartbeat or malformed frame */
        }
      }
      es.onerror = () => {
        sseOpen = false
        es?.close()
        es = null
        if (disposed) return
        failures += 1
        if (failures >= 2) startPolling()
        setMode(polling ? 'polling' : 'connecting')
        const delay = Math.min(30_000, 1000 * 2 ** Math.min(failures - 1, 5)) + Math.random() * 400
        reconnectTimer = setTimeout(connect, delay)
      }
    }

    // Seed history, then go live. SSE connects in parallel; ids dedupe any overlap.
    fetchSince(0, 100)
      .then((evs) => ingest(evs, false))
      .catch(() => {})
      .finally(() => {
        if (disposed) return
        ready = true
        setState((s) => ({ ...s, ready: true }))
      })
    connect()

    const onVisible = () => {
      if (document.visibilityState === 'visible' && !sseOpen && !es && !disposed) {
        if (reconnectTimer) clearTimeout(reconnectTimer)
        connect()
      }
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      disposed = true
      document.removeEventListener('visibilitychange', onVisible)
      es?.close()
      if (reconnectTimer) clearTimeout(reconnectTimer)
      stopPolling()
    }
  }, [enabled, projectId])

  return state
}

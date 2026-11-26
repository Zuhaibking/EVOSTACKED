import { InspectToolbar } from './inspect-panel'
import { CopyButton } from './ui/copy-button'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  INSPECT_SOURCE,
  InspectDraft,
  InspectSelection,
  isInspectMessage,
  livePayload,
  stableInspectSrc,
} from '@/lib/inspect'
import type { PlatformMeta } from '@/lib/platform/types'
import { projectIdFromPath } from '@/lib/projects'
import { ExecutionResultWeb } from '@/lib/types'
import { ExternalLink, LoaderCircle, RotateCw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

// ───────── Website → Control Center relay (data bridge in lib/inspect-bridge-script.js) ─────────
const DATA_SOURCE = 'evostack-data'
const COLLECTION_KEY = /^[a-z][a-z0-9_]{0,39}$/
const LIST_PARAMS = ['q', 'sort', 'dir', 'limit', 'offset', 'status'] as const
type PreviewReply = (message: Record<string, unknown>) => void

/** The public slice of a blueprint a generated website may target: schema only, never records. */
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

const platformMetaCache = new Map<string, { expires: number; meta: Promise<PlatformMeta | null> }>()
function platformMeta(projectId: string): Promise<PlatformMeta | null> {
  const hit = platformMetaCache.get(projectId)
  if (hit && hit.expires > Date.now()) return hit.meta
  const entry = { expires: Date.now() + 15_000, meta: Promise.resolve<PlatformMeta | null>(null) }
  entry.meta = fetch(`/api/p/${encodeURIComponent(projectId)}`, { cache: 'no-store' })
    .then(async (res) => (res.ok ? ((await res.json()) as { meta?: PlatformMeta }).meta ?? null : null))
    .catch(() => null)
    .then((meta) => {
      if (!meta) entry.expires = Date.now() + 4_000 // not provisioned yet: re-check soon
      return meta
    })
  platformMetaCache.set(projectId, entry)
  return entry.meta
}

/** Relay a preview's data-bridge message to this project's platform API, answering via `reply`. */
async function relayPlatformData(data: { type?: unknown; id?: unknown; collection?: unknown; data?: unknown; params?: unknown }, reply: PreviewReply) {
  const projectId = projectIdFromPath(window.location.pathname)
  if (data.type === 'config-request') {
    const meta = projectId ? await platformMeta(projectId) : null
    reply({ type: 'platform-config', config: meta ? platformConfig(meta, window.location.origin) : null })
    return
  }
  if (data.type !== 'submit' && data.type !== 'list') return
  const id = typeof data.id === 'string' && data.id.length <= 80 ? data.id : null
  if (!id) return
  const ack = (body: Record<string, unknown>) => reply({ type: 'data-ack', id, ...body })
  // Outside a saved project the bridge posts to its own configured apiBase instead.
  if (!projectId) return ack({ ok: false, fallback: true, error: 'not_connected' })
  const collection = typeof data.collection === 'string' && COLLECTION_KEY.test(data.collection) ? data.collection : null
  if (!collection) return ack({ ok: false, status: 400, error: 'invalid_collection' })
  const url = `/api/p/${encodeURIComponent(projectId)}/records/${collection}`
  // Anonymous + `x-evo-source: website` = public semantics: generated code never borrows the owner's session.
  let res: Response
  try {
    if (data.type === 'submit') {
      const record = data.data
      if (!record || typeof record !== 'object' || Array.isArray(record)) return ack({ ok: false, status: 400, error: 'invalid_data' })
      const body = JSON.stringify({ data: record })
      if (body.length > 32 * 1024) return ack({ ok: false, status: 413, error: 'payload_too_large' })
      res = await fetch(url, { method: 'POST', credentials: 'omit', cache: 'no-store', headers: { 'content-type': 'application/json', 'x-evo-source': 'website' }, body })
    } else {
      const raw = data.params && typeof data.params === 'object' ? (data.params as Record<string, unknown>) : {}
      const query = new URLSearchParams()
      for (const key of LIST_PARAMS) {
        const value = raw[key]
        if (typeof value === 'string' || typeof value === 'number') query.set(key, String(value).slice(0, 200))
      }
      const qs = query.toString()
      res = await fetch(qs ? `${url}?${qs}` : url, { credentials: 'omit', cache: 'no-store', headers: { 'x-evo-source': 'website' } })
    }
  } catch {
    return ack({ ok: false, fallback: true, error: 'network_error' })
  }
  const result = (await res.json().catch(() => null)) as { message?: unknown; error?: unknown } | null
  ack({ ok: res.ok, status: res.status, result, ...(res.ok ? {} : { error: String(result?.message || result?.error || `HTTP ${res.status}`) }) })
}

export function FragmentWeb({
  result,
  inspectEnabled = false,
  selection = null,
  onSelection,
  draft = null,
  compare = false,
  onDraft,
  onText,
  applying = false,
  guides = false,
  teamID,
  accessToken,
  onRuntimeError,
}: {
  result: ExecutionResultWeb
  inspectEnabled?: boolean
  selection?: InspectSelection | null
  onSelection?: (selection: InspectSelection | null) => void
  draft?: InspectDraft | null
  compare?: boolean
  onDraft?: (draft: InspectDraft) => void
  onText?: (text: string) => void
  applying?: boolean
  guides?: boolean
  teamID?: string
  accessToken?: string
  onRuntimeError?: (message: string) => void
}) {
  const [iframeKey, setIframeKey] = useState(0)
  const [previewState, setPreviewState] = useState<'loading' | 'rendered' | 'unconfirmed' | 'error'>('loading')
  const [previewError, setPreviewError] = useState('')
  const documentLoadedRef = useRef(false)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [iframeBox, setIframeBox] = useState<DOMRect | null>(null)
  const selectionRef = useRef(selection)
  selectionRef.current = selection
  const srcRef = useRef(result.url)
  if (!inspectEnabled) srcRef.current = result.url
  const iframeSrc = stableInspectSrc(srcRef.current, result.url, inspectEnabled)

  function refreshIframe() {
    documentLoadedRef.current = false
    setPreviewState('loading')
    setPreviewError('')
    setIframeKey((prevKey) => prevKey + 1)
  }

  function postToPreview(data: Record<string, unknown>) {
    iframeRef.current?.contentWindow?.postMessage(
      { source: INSPECT_SOURCE, ...data },
      '*',
    )
  }

  useEffect(() => {
    documentLoadedRef.current = false
    setPreviewState('loading')
    setPreviewError('')
    const timer = window.setTimeout(() => setPreviewState((state) => state === 'loading' ? 'unconfirmed' : state), 45_000)
    return () => window.clearTimeout(timer)
  }, [iframeSrc, iframeKey])

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.source !== iframeRef.current?.contentWindow) return
      try {
        if (event.origin !== new URL(iframeSrc).origin) return
      } catch {
        return
      }
      const data = event.data
      const previewWindow = event.source as Window | null
      const previewOrigin = event.origin
      const reply: PreviewReply = (message) => {
        try {
          previewWindow?.postMessage({ source: INSPECT_SOURCE, ...message }, previewOrigin)
        } catch {
          // the preview reloaded or navigated away; the bridge falls back on its own
        }
      }
      if (data?.source === DATA_SOURCE && typeof data.type === 'string') {
        void relayPlatformData(data, reply)
        return
      }
      if (data?.source === INSPECT_SOURCE && data.type === 'runtime-error') {
        if (typeof data.payload?.message === 'string' && data.payload.message.trim()) {
          setPreviewError(data.payload.message.slice(0, 2000))
          setPreviewState('error')
          onRuntimeError?.(data.payload.message.slice(0, 2000))
        }
        return
      }
      if (data?.source === INSPECT_SOURCE && data.type === 'rendered') {
        if (documentLoadedRef.current && data.payload?.hasContent === true) setPreviewState((state) => state === 'error' ? state : 'rendered')
        return
      }
      if (!isInspectMessage(event.data)) return
      // A provisioned project hands its public schema to the site so forms land in the Control Center.
      if (event.data.type === 'ready') void relayPlatformData({ type: 'config-request' }, reply)
      if (event.data.type === 'ready' && inspectEnabled) {
        postToPreview({ type: 'enable' })
        postToPreview({ type: 'guides', on: guides })
      }
      if (event.data.type === 'select') {
        onSelection?.(event.data.payload)
      }
      if (event.data.type === 'text' && typeof event.data.payload === 'string') {
        onText?.(event.data.payload)
      }
      if (event.data.type === 'rect' && selectionRef.current) {
        onSelection?.({ ...selectionRef.current, rect: event.data.payload })
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [inspectEnabled, guides, onSelection, onText, iframeSrc, onRuntimeError])

  useEffect(() => {
    postToPreview({ type: inspectEnabled ? 'enable' : 'disable' })
  }, [inspectEnabled, iframeKey])

  useEffect(() => {
    postToPreview({ type: 'guides', on: guides })
  }, [guides, iframeKey])

  useEffect(() => {
    if (!inspectEnabled || !draft) return
    postToPreview({
      ...livePayload(draft, compare),
      selector: selectionRef.current?.selector || '',
    })
  }, [inspectEnabled, draft, compare, iframeKey])

  useEffect(() => {
    if (!inspectEnabled || !result.sbxId) return
    fetch('/api/inspect/inject', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sbxId: result.sbxId,
        teamID,
        accessToken,
      }),
    }).catch(() => {})
    // Inject the bridge without remounting. A reload here blanks the preview and drops applied edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inspectEnabled, result.sbxId])

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const measure = () => setIframeBox(el.getBoundingClientRect())
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [selection, iframeKey])

  if (!result) return null

  return (
    <div className="flex flex-col w-full h-full">
      {previewState !== 'rendered' && (
        <div role={previewState === 'loading' ? 'status' : 'alert'} className={'flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2 text-xs ' + (previewState === 'error' ? 'border-destructive/20 bg-destructive/5 text-destructive' : 'border-border bg-muted/30 text-muted-foreground')}>
          {previewState === 'loading' ? <LoaderCircle className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden="true" /> : null}
          <p className="min-w-0 flex-1 whitespace-pre-wrap break-words">{previewState === 'loading' ? 'Opening preview…' : previewState === 'error' ? previewError : 'The preview has not confirmed visible content yet. Reload it or open it in a new tab.'}</p>
          {previewState !== 'loading' && <><Button variant="outline" size="sm" className="h-7 text-xs" onClick={refreshIframe}>Reload</Button><a href={iframeSrc} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-foreground hover:bg-muted">Open preview<ExternalLink className="h-3 w-3" aria-hidden="true" /></a></>}
        </div>
      )}
      <div ref={wrapRef} className="relative flex-1 min-h-0">
        <iframe
          ref={iframeRef}
          key={iframeKey}
          className="h-full w-full"
          title="Generated app preview"
          sandbox="allow-forms allow-scripts allow-same-origin"
          loading="eager"
          src={iframeSrc}
          onLoad={() => {
            documentLoadedRef.current = true
            postToPreview({ type: 'preview-status' })
            if (inspectEnabled) postToPreview({ type: 'enable' })
          }}
          onError={() => { setPreviewState('error'); setPreviewError('The preview could not be loaded in this browser. Reload it or open it in a new tab.') }}
        />
        {inspectEnabled && onDraft ? (
          <InspectToolbar
            selection={selection}
            iframeBox={iframeBox}
            applying={applying}
            draft={draft}
            onDraft={onDraft}
          />
        ) : null}
      </div>
      {result.health?.state === 'FAILED' ? (
        <p role="alert" className="m-3 rounded-lg bg-destructive/5 px-3 py-3 text-xs leading-relaxed text-destructive border border-destructive/20">
          {result.health.log.slice(-3).join(' · ')}
        </p>
      ) : null}
      <div className="p-3 border-t border-border bg-card">
        <div className="flex items-center gap-1 bg-muted/60 rounded-lg border border-border">
          <TooltipProvider>
            <Tooltip delayDuration={0}>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground shrink-0 rounded-lg"
                  aria-label="Refresh preview"
                  onClick={refreshIframe}
                >
                  <RotateCw className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Refresh</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <span className="text-muted-foreground font-mono text-[11px] min-w-0 flex-1 text-ellipsis overflow-hidden whitespace-nowrap">
            {result.url}
          </span>
          <TooltipProvider>
            <Tooltip delayDuration={0}>
              <TooltipTrigger asChild>
                <CopyButton
                  variant="ghost"
                  content={result.url}
                  className="text-muted-foreground"
                />
              </TooltipTrigger>
              <TooltipContent>Copy URL</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>
    </div>
  )
}

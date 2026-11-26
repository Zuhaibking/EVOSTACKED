/**
 * Evidence measurement — runs a dependency-free Node benchmark INSIDE a candidate's
 * E2B sandbox (against its own dev server on localhost) and audits the served HTML.
 *
 * Server-only (uses the server E2B key). Never throws: on any failure it returns
 * whatever was measured so far plus plain-language `notes`.
 */
import { Sandbox } from 'e2b'
import type { EvidenceMetrics } from './types'

export type MeasureHealth = {
  // CandidateHealth-compatible fields (lib/candidate-health.ts)…
  buildStatus?: 'passed' | 'failed' | 'skipped'
  runtimeStatus?: 'passed' | 'failed' | 'skipped'
  repairAttempts?: number
  // …or already-resolved evidence fields.
  typecheckOk?: boolean | null
  repairs?: number | null
  runtimeErrors?: number | null
}

export type MeasureOptions = {
  port?: number
  health?: MeasureHealth | null
  /** Total wall-clock budget, default 45 s. */
  budgetMs?: number
  requests?: number
  concurrency?: number
  signal?: AbortSignal
}

/** Per-run paths: a file left in sticky /tmp by another sandbox user cannot be overwritten. */
const runPaths = () => {
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
  return { bench: `/tmp/evo-bench-${id}.mjs`, html: `/tmp/evo-bench-${id}.html` }
}
const DEFAULT_BUDGET_MS = 45_000
const DEFAULT_REQUESTS = 60
const DEFAULT_CONCURRENCY = 6

type BenchResult = {
  phase: string
  finalPath: string
  coldStartMs: number | null
  coldStatus: number | null
  ttfbP50Ms: number | null
  ttfbP95Ms: number | null
  totalP95Ms: number | null
  requests: number
  errors: number
  statuses: Record<string, number>
  rps: number | null
  htmlBytes: number | null
  jsBytes: number | null
  cssBytes: number | null
  imageCount: number | null
  assetsFailed: number
  htmlSaved: boolean
  notes: string[]
}

/** The in-sandbox benchmark. Plain ESM, Node built-ins only. */
export const BENCH_SCRIPT = String.raw`
import http from 'node:http'
import https from 'node:https'
import { writeFileSync } from 'node:fs'

const PORT = Number(process.env.EVO_PORT || 3000)
const BUDGET = Number(process.env.EVO_BUDGET_MS || 38000)
const N = Number(process.env.EVO_N || 60)
const C = Number(process.env.EVO_C || 6)
const HTML_OUT = process.env.EVO_HTML_OUT || '/tmp/evo-bench.html'
const BASE = 'http://localhost:' + PORT
const deadline = Date.now() + BUDGET
const left = () => deadline - Date.now()
const now = () => Number(process.hrtime.bigint()) / 1e6
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const agents = { 'http:': new http.Agent({ keepAlive: true, maxSockets: C }), 'https:': new https.Agent({ keepAlive: true, maxSockets: C }) }

const R = { phase: 'start', finalPath: '/', coldStartMs: null, coldStatus: null, ttfbP50Ms: null, ttfbP95Ms: null, totalP95Ms: null,
  requests: 0, errors: 0, statuses: {}, rps: null, htmlBytes: null, jsBytes: null, cssBytes: null, imageCount: null,
  assetsFailed: 0, htmlSaved: false, notes: [] }
const emit = (tag) => { try { process.stdout.write(tag + ' ' + JSON.stringify(R) + '\n') } catch {} }
const hard = setTimeout(() => { R.notes.push('Benchmark hit its time budget; results are partial'); emit('EVO_RESULT'); process.exit(0) }, BUDGET + 1500)

function get(url, { timeoutMs = 10000, keepBody = false } = {}) {
  return new Promise((resolve) => {
    const start = now()
    let ttfb = null, bytes = 0, done = false
    const chunks = keepBody ? [] : null
    let timer = null
    const finish = (r) => { if (done) return; done = true; if (timer) clearTimeout(timer); resolve({ ...r, ms: now() - start, ttfb, bytes }) }
    let u
    try { u = new URL(url) } catch { return finish({ ok: false, status: 0, error: 'bad url' }) }
    const mod = u.protocol === 'https:' ? https : u.protocol === 'http:' ? http : null
    if (!mod) return finish({ ok: false, status: 0, error: 'unsupported protocol' })
    const req = mod.get(u, { agent: agents[u.protocol], headers: { 'user-agent': 'EvoStack-Evidence/1.0', accept: '*/*', 'accept-encoding': 'identity' } }, (res) => {
      ttfb = now() - start
      const status = res.statusCode || 0
      res.on('data', (d) => { bytes += d.length; if (chunks) chunks.push(d) })
      res.on('end', () => finish({ ok: status >= 200 && status < 300, status, location: res.headers.location || null, body: chunks ? Buffer.concat(chunks) : null }))
      res.on('error', (e) => finish({ ok: false, status, error: String((e && e.message) || e) }))
      res.on('close', () => finish({ ok: false, status, error: 'connection closed' }))
    })
    timer = setTimeout(() => req.destroy(new Error('timeout')), Math.max(300, Math.min(timeoutMs, left())))
    req.on('error', (e) => finish({ ok: false, status: 0, error: String((e && e.message) || e) }))
  })
}

const pct = (arr, p) => {
  if (!arr.length) return null
  const s = [...arr].sort((a, b) => a - b)
  return Math.round(s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))] * 10) / 10
}
const decode = (s) => s.replace(/&amp;/g, '&').replace(/&#x2F;/gi, '/').replace(/&#47;/g, '/')

async function warmup() {
  R.phase = 'warmup'
  let path = '/', redirects = 0, chainMs = 0, waited = false
  while (left() > 2500) {
    const r = await get(BASE + path, { timeoutMs: Math.min(30000, left() - 1500), keepBody: true })
    if (r.status === 0) {
      if (!waited) { R.notes.push('Dev server was not accepting connections yet; waited for it'); waited = true }
      await sleep(500)
      continue
    }
    chainMs += r.ms
    if (r.status >= 300 && r.status < 400 && r.location && redirects < 3) {
      redirects++
      try { const next = new URL(r.location, BASE + path); if (next.host === new URL(BASE).host) { path = next.pathname + next.search; continue } } catch {}
    }
    R.coldStartMs = Math.round(chainMs)
    R.coldStatus = r.status
    R.finalPath = path
    if (redirects) R.notes.push('Root redirected to ' + path)
    return r
  }
  R.notes.push('Server never returned an HTTP response during warm-up')
  return null
}

async function burst() {
  R.phase = 'burst'
  const url = BASE + R.finalPath
  const ttfbs = [], totals = []
  let i = 0, ok = 0
  const started = now()
  async function worker() {
    while (i < N && left() > 1500) {
      i++
      R.requests++
      const r = await get(url, { timeoutMs: Math.min(15000, left() - 500) })
      R.statuses[r.status] = (R.statuses[r.status] || 0) + 1
      if (r.ok) { ok++; if (r.ttfb != null) ttfbs.push(r.ttfb); totals.push(r.ms) } else R.errors++
    }
  }
  await Promise.all(Array.from({ length: C }, worker))
  const wall = (now() - started) / 1000
  R.ttfbP50Ms = pct(ttfbs, 50)
  R.ttfbP95Ms = pct(ttfbs, 95)
  R.totalP95Ms = pct(totals, 95)
  R.rps = wall > 0 && R.requests ? Math.round((ok / wall) * 10) / 10 : null
  if (R.requests < N) R.notes.push('Load burst stopped early at ' + R.requests + '/' + N + ' requests (time budget)')
}

async function assets(html) {
  R.phase = 'assets'
  const pageUrl = BASE + R.finalPath
  const scripts = [...html.matchAll(/<script\b[^>]*?\bsrc\s*=\s*["']?([^"'\s>]+)/gi)].map((m) => ['js', m[1]])
  const styles = [...html.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0])
    .filter((t) => /\brel\s*=\s*["']?[^"'>]*\bstylesheet\b/i.test(t))
    .map((t) => (t.match(/\bhref\s*=\s*["']?([^"'\s>]+)/i) || [])[1]).filter(Boolean).map((h) => ['css', h])
  const seen = new Set(), list = []
  for (const [kind, raw] of [...scripts, ...styles]) {
    let abs
    try { abs = new URL(decode(raw), pageUrl).href } catch { continue }
    if (seen.has(abs) || !/^https?:/.test(abs)) continue
    seen.add(abs); list.push([kind, abs])
  }
  if (list.length > 60) R.notes.push('Only the first 60 of ' + list.length + ' assets were weighed')
  const queue = list.slice(0, 60)
  let js = 0, css = 0
  async function worker() {
    while (queue.length && left() > 1000) {
      const [kind, url] = queue.shift()
      const r = await get(url, { timeoutMs: Math.min(8000, left() - 500) })
      if (!r.ok) { R.assetsFailed++; continue }
      if (kind === 'js') js += r.bytes; else css += r.bytes
    }
  }
  await Promise.all(Array.from({ length: C }, worker))
  if (queue.length) R.notes.push(queue.length + ' assets were not weighed (time budget)')
  if (R.assetsFailed) R.notes.push(R.assetsFailed + ' referenced asset(s) failed to load')
  R.jsBytes = js
  R.cssBytes = css
}

try {
  const first = await warmup()
  emit('EVO_PARTIAL')
  if (first) {
    await burst()
    emit('EVO_PARTIAL')
    let page = first.ok && first.body ? first : null
    if (!page && left() > 2000) {
      const again = await get(BASE + R.finalPath, { timeoutMs: Math.min(10000, left() - 1000), keepBody: true })
      if (again.body && again.status > 0) page = again
    }
    if (!page && first.body) page = first
    if (page && page.body) {
      const html = page.body.toString('utf8')
      R.htmlBytes = page.body.length
      R.imageCount = (html.match(/<img\b/gi) || []).length
      try { writeFileSync(HTML_OUT, html.length > 3000000 ? html.slice(0, 3000000) : html); R.htmlSaved = true } catch (e) { R.notes.push('Could not save HTML for audit') }
      await assets(html)
    }
  }
  R.phase = 'done'
} catch (e) {
  R.notes.push('Benchmark error: ' + String((e && e.message) || e).slice(0, 200))
}
clearTimeout(hard)
emit('EVO_RESULT')
process.exit(0)
`

/* ───────────────────────────── HTML audits ───────────────────────────── */

type Check = { weight: number; pass: number /* 0..1 */; issue?: string }
type Audit = { score: number; issues: string[] }

function scoreChecks(checks: (Check | null)[]): Audit {
  const applicable = checks.filter((c): c is Check => !!c)
  const total = applicable.reduce((s, c) => s + c.weight, 0)
  const got = applicable.reduce((s, c) => s + c.weight * Math.max(0, Math.min(1, c.pass)), 0)
  return {
    score: total ? Math.round((100 * got) / total) : 100,
    issues: applicable.filter((c) => c.pass < 1 && c.issue).map((c) => c.issue as string),
  }
}

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`\\s${name}(?:\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+)))?(?=[\\s/>]|$)`, 'i'))
  if (!m) return null
  return (m[1] ?? m[2] ?? m[3] ?? '').trim()
}

function textOf(fragment: string): string {
  return fragment
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&[a-z]+;|&#\d+;/gi, 'x')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Has an accessible name: text, aria-label(ledby), title, img alt or svg <title>. */
function hasName(openTag: string, inner: string): boolean {
  if (attr(openTag, 'aria-label')) return true
  if (attr(openTag, 'aria-labelledby')) return true
  if (attr(openTag, 'title')) return true
  if (textOf(inner)) return true
  if (/<img\b[^>]*\salt\s*=\s*["'][^"']*\S[^"']*["']/i.test(inner)) return true
  if (/<svg\b[\s\S]*?<title>\s*\S/i.test(inner)) return true
  if (/\saria-label\s*=\s*["'][^"']*\S/i.test(inner)) return true
  return false
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

const DEFAULT_TITLES = /^(create next app|next\.?js( app)?|react app|vite( \+ react)?( app)?|document|untitled|my app|home)$/i
const DEFAULT_DESCRIPTIONS = /^(generated by create next app|web site created using create-react-app)$/i

/** Heuristic, Lighthouse-inspired audits on server-rendered HTML. Pure — safe to unit test. */
export function auditHtml(html: string): Pick<EvidenceMetrics, 'a11y' | 'seo' | 'bestPractices'> {
  const inlineScripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter((m) => !/\ssrc\s*=/i.test(m[1]) && !/type\s*=\s*["']?application\/(ld\+)?json/i.test(m[1]))
    .map((m) => m[2])
  const markup = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<template\b[^>]*>[\s\S]*?<\/template>/gi, ' ')
  const tags = (re: RegExp) => [...markup.matchAll(re)]
  const metaBy = (key: 'name' | 'property', value: string) =>
    tags(/<meta\b[^>]*>/gi).map((m) => m[0]).find((t) => (attr(t, key) || '').toLowerCase() === value)
  const linkRel = (rel: string) =>
    tags(/<link\b[^>]*>/gi).map((m) => m[0]).find((t) => (attr(t, 'rel') || '').toLowerCase().split(/\s+/).includes(rel))

  // ── headings ──
  const headings = tags(/<h([1-6])\b[^>]*>/gi).map((m) => Number(m[1]))
  const h1Count = headings.filter((h) => h === 1).length
  const skips: string[] = []
  for (let i = 1; i < headings.length; i++) {
    if (headings[i] > headings[i - 1] + 1) skips.push(`h${headings[i - 1]} → h${headings[i]}`)
  }

  // ── accessibility ──
  const htmlTag = markup.match(/<html\b[^>]*>/i)?.[0] ?? ''
  const lang = attr(htmlTag, 'lang')
  const imgs = tags(/<img\b[^>]*>/gi).map((m) => m[0])
  const imgsNoAlt = imgs.filter((t) => attr(t, 'alt') === null && (attr(t, 'role') || '') !== 'presentation' && attr(t, 'aria-hidden') !== 'true').length

  const labelRanges = tags(/<label\b[^>]*>[\s\S]*?<\/label>/gi).map((m) => [m.index ?? 0, (m.index ?? 0) + m[0].length] as const)
  const labelFor = new Set(tags(/<label\b[^>]*>/gi).map((m) => attr(m[0], 'for')).filter((v): v is string => !!v))
  const controls = tags(/<(input|select|textarea)\b[^>]*>/gi).filter((m) => {
    if (m[1].toLowerCase() !== 'input') return true
    const type = (attr(m[0], 'type') || 'text').toLowerCase()
    return !['hidden', 'submit', 'button', 'reset', 'image'].includes(type)
  })
  const unlabelled = controls.filter((m) => {
    const t = m[0]
    if (attr(t, 'aria-label') || attr(t, 'aria-labelledby') || attr(t, 'title') || attr(t, 'placeholder')) return false
    const id = attr(t, 'id')
    if (id && labelFor.has(id)) return false
    const at = m.index ?? 0
    return !labelRanges.some(([s, e]) => at > s && at < e)
  }).length

  const buttons = tags(/<button\b([^>]*)>([\s\S]*?)<\/button>/gi)
  const unnamedButtons = buttons.filter((m) => !hasName(m[1], m[2])).length
  const links = tags(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi).filter((m) => attr(m[1], 'href') !== null)
  const unnamedLinks = links.filter((m) => !hasName(m[1], m[2])).length

  const viewport = metaBy('name', 'viewport')
  const vpContent = (viewport && attr(viewport, 'content')) || ''
  const blocksZoom = /user-scalable\s*=\s*(no|0)/i.test(vpContent) || (() => {
    const max = vpContent.match(/maximum-scale\s*=\s*([\d.]+)/i)
    return !!max && Number(max[1]) < 2
  })()

  const a11y = scoreChecks([
    { weight: 10, pass: lang ? 1 : 0, issue: 'Missing <html lang> attribute' },
    imgs.length ? { weight: 10, pass: 1 - imgsNoAlt / imgs.length, issue: `${imgsNoAlt} of ${plural(imgs.length, 'image')} missing alt text` } : null,
    controls.length ? { weight: 10, pass: 1 - unlabelled / controls.length, issue: `${unlabelled} of ${plural(controls.length, 'form control')} without a label` } : null,
    buttons.length ? { weight: 10, pass: 1 - unnamedButtons / buttons.length, issue: `${plural(unnamedButtons, 'button')} without an accessible name` } : null,
    links.length ? { weight: 7, pass: 1 - unnamedLinks / links.length, issue: `${plural(unnamedLinks, 'link')} without discernible text` } : null,
    { weight: 6, pass: h1Count === 1 ? 1 : 0, issue: h1Count === 0 ? 'No <h1> heading' : `${h1Count} <h1> headings (expected one)` },
    headings.length > 1 ? { weight: 6, pass: skips.length ? 0 : 1, issue: `Heading levels skip (${skips.slice(0, 3).join(', ')})` } : null,
    { weight: 8, pass: viewport ? (blocksZoom ? 0.5 : 1) : 0, issue: viewport ? 'Viewport meta disables zoom' : 'Missing viewport meta tag' },
  ])

  // ── SEO ──
  const title = textOf(markup.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '')
  const descTag = metaBy('name', 'description')
  const desc = (descTag && attr(descTag, 'content')) || ''
  const ogTitle = metaBy('property', 'og:title')
  const canonical = linkRel('canonical')
  const seo = scoreChecks([
    {
      weight: 15,
      pass: !title ? 0 : DEFAULT_TITLES.test(title) ? 0.5 : 1,
      issue: !title ? 'Missing <title>' : `Title is a template default ("${title.slice(0, 40)}")`,
    },
    {
      weight: 15,
      pass: !desc ? 0 : DEFAULT_DESCRIPTIONS.test(desc) ? 0.5 : 1,
      issue: !desc ? 'Missing meta description' : 'Meta description is a template default',
    },
    { weight: 10, pass: h1Count === 1 ? 1 : 0, issue: h1Count === 0 ? 'No <h1> for search snippets' : `${h1Count} <h1> headings` },
    { weight: 8, pass: ogTitle && attr(ogTitle, 'content') ? 1 : 0, issue: 'Missing og:title (social previews)' },
    { weight: 7, pass: canonical && attr(canonical, 'href') ? 1 : 0, issue: 'Missing canonical link' },
  ])

  // ── best practices ──
  const doctype = /^\uFEFF?\s*<!doctype html/i.test(html)
  const charset = tags(/<meta\b[^>]*>/gi).some((m) => attr(m[0], 'charset') || /charset=/i.test(attr(m[0], 'content') || ''))
  const resourceUrls = [
    ...tags(/<(?:img|script|iframe|source|video|audio|embed)\b[^>]*>/gi).flatMap((m) => [attr(m[0], 'src'), ...(attr(m[0], 'srcset') || '').split(',').map((s) => s.trim().split(/\s+/)[0])]),
    ...tags(/<link\b[^>]*>/gi).map((m) => attr(m[0], 'href')),
    ...tags(/<form\b[^>]*>/gi).map((m) => attr(m[0], 'action')),
  ].filter((u): u is string => !!u)
  const insecure = resourceUrls.filter((u) => /^http:\/\//i.test(u)).length
  const handlerAttrs = tags(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*')/gi).map((m) => m[1])
  const dialogHits = [...inlineScripts, ...handlerAttrs].filter((s) => /(^|[^\w.$])alert\s*\(|document\.write(ln)?\s*\(/.test(s)).length
  const elementCount = tags(/<[a-zA-Z][a-zA-Z0-9-]*\b/g).length
  const bestPractices = scoreChecks([
    { weight: 10, pass: doctype ? 1 : 0, issue: 'Missing <!DOCTYPE html>' },
    { weight: 10, pass: charset ? 1 : 0, issue: 'No charset declared' },
    { weight: 10, pass: resourceUrls.length ? 1 - insecure / resourceUrls.length : 1, issue: `${plural(insecure, 'insecure http:// resource')} (mixed content)` },
    { weight: 10, pass: dialogHits ? 0 : 1, issue: 'Inline alert() / document.write() found' },
    {
      weight: 10,
      pass: elementCount <= 800 ? 1 : elementCount <= 1500 ? 0.5 : 0,
      issue: `Large DOM (${elementCount.toLocaleString('en-US')} elements)`,
    },
  ])

  return { a11y, seo, bestPractices }
}

/* ───────────────────────────── orchestration ───────────────────────────── */

function healthFields(h?: MeasureHealth | null): Pick<EvidenceMetrics, 'typecheckOk' | 'repairs' | 'runtimeErrors'> {
  if (!h || typeof h !== 'object') return { typecheckOk: null, repairs: null, runtimeErrors: null }
  const typecheckOk =
    typeof h.typecheckOk === 'boolean' ? h.typecheckOk
      : h.buildStatus === 'passed' ? true : h.buildStatus === 'failed' ? false : null
  const repairs =
    typeof h.repairs === 'number' && Number.isFinite(h.repairs) ? Math.max(0, Math.round(h.repairs))
      : typeof h.repairAttempts === 'number' && Number.isFinite(h.repairAttempts) ? Math.max(0, Math.round(h.repairAttempts)) : null
  const runtimeErrors =
    typeof h.runtimeErrors === 'number' && Number.isFinite(h.runtimeErrors) ? Math.max(0, Math.round(h.runtimeErrors))
      : h.runtimeStatus === 'failed' ? 1 : h.runtimeStatus === 'passed' ? 0 : null
  return { typecheckOk, repairs, runtimeErrors }
}

const NOT_AUDITED = (why: string) => ({ score: 0, issues: [why] })

export function emptyMetrics(health?: MeasureHealth | null): EvidenceMetrics {
  return {
    measuredAt: new Date().toISOString(),
    coldStartMs: null,
    ttfbP50Ms: null,
    ttfbP95Ms: null,
    requests: 0,
    errorRate: 0,
    rps: null,
    htmlBytes: null,
    jsBytes: null,
    cssBytes: null,
    imageCount: null,
    a11y: NOT_AUDITED('Not audited — no HTML was served'),
    seo: NOT_AUDITED('Not audited — no HTML was served'),
    bestPractices: NOT_AUDITED('Not audited — no HTML was served'),
    ...healthFields(health),
    notes: [],
  }
}

function errMessage(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  return msg.replace(/\s+/g, ' ').slice(0, 200)
}

function parseBench(line: string): BenchResult | null {
  const m = line.match(/^EVO_(?:PARTIAL|RESULT) (\{.*\})\s*$/)
  if (!m) return null
  try {
    return JSON.parse(m[1]) as BenchResult
  } catch {
    return null
  }
}

function applyBench(metrics: EvidenceMetrics, r: BenchResult) {
  metrics.coldStartMs = r.coldStartMs ?? null
  metrics.ttfbP50Ms = r.ttfbP50Ms ?? null
  metrics.ttfbP95Ms = r.ttfbP95Ms ?? null
  metrics.requests = r.requests || 0
  metrics.errorRate = r.requests ? Math.round((r.errors / r.requests) * 1000) / 1000 : r.coldStartMs == null ? 1 : 0
  metrics.rps = r.rps ?? null
  metrics.htmlBytes = r.htmlBytes ?? null
  metrics.jsBytes = r.jsBytes ?? null
  metrics.cssBytes = r.cssBytes ?? null
  metrics.imageCount = r.imageCount ?? null
}

/**
 * Measure a running candidate sandbox. `port` defaults to 3000 (Next.js dev server).
 * Always resolves with (possibly partial) metrics; failures are explained in `notes`.
 */
export async function measureSandbox(sbxId: string, opts: MeasureOptions = {}): Promise<EvidenceMetrics> {
  const started = Date.now()
  const budgetMs = Math.max(8_000, Math.min(opts.budgetMs ?? DEFAULT_BUDGET_MS, 55_000))
  const deadline = started + budgetMs
  const left = () => deadline - Date.now()
  const port = Number.isInteger(opts.port) && opts.port! > 0 && opts.port! < 65536 ? opts.port! : 3000
  const n = Math.max(1, Math.min(opts.requests ?? DEFAULT_REQUESTS, 200))
  const c = Math.max(1, Math.min(opts.concurrency ?? DEFAULT_CONCURRENCY, 16))
  const metrics = emptyMetrics(opts.health)
  const notes = metrics.notes

  let sbx: Sandbox
  try {
    sbx = await Sandbox.connect(sbxId, { requestTimeoutMs: Math.min(15_000, left()), signal: opts.signal })
  } catch (e) {
    notes.push(`Could not connect to the sandbox: ${errMessage(e)}`)
    return metrics
  }

  const paths = runPaths()
  let last: BenchResult | null = null
  let buffer = ''
  const onStdout = (data: string) => {
    buffer += data
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) last = parseBench(line) ?? last
  }

  try {
    await sbx.files.write(paths.bench, BENCH_SCRIPT, { requestTimeoutMs: Math.min(10_000, left()) })
    // Leave headroom for reading the HTML back + auditing after the script exits.
    const scriptBudget = Math.max(3_000, left() - 6_000)
    const result = await sbx.commands.run(`node ${paths.bench}`, {
      envs: {
        EVO_PORT: String(port),
        EVO_BUDGET_MS: String(scriptBudget),
        EVO_N: String(n),
        EVO_C: String(c),
        EVO_HTML_OUT: paths.html,
      },
      timeoutMs: scriptBudget + 3_000,
      requestTimeoutMs: scriptBudget + 5_000,
      onStdout,
    })
    onStdout('\n')
    if (!last) last = (result.stdout || '').split('\n').map(parseBench).filter(Boolean).pop() ?? null
  } catch (e) {
    onStdout('\n')
    notes.push(`Benchmark did not finish cleanly: ${errMessage(e)}`)
  }

  if (!last) {
    notes.push('No benchmark output — the sandbox may be paused, out of memory, or missing Node.js')
    return metrics
  }
  const bench: BenchResult = last
  applyBench(metrics, bench)
  notes.push(...(bench.notes || []))
  if (bench.coldStatus && (bench.coldStatus < 200 || bench.coldStatus >= 300)) {
    notes.push(`First request returned HTTP ${bench.coldStatus}`)
  }
  const failedStatuses = Object.entries(bench.statuses || {}).filter(([s]) => !(Number(s) >= 200 && Number(s) < 300))
  if (failedStatuses.length) {
    notes.push(`Non-2xx in burst: ${failedStatuses.map(([s, k]) => `${s === '0' ? 'network error' : `HTTP ${s}`} ×${k}`).join(', ')}`)
  }
  if (bench.totalP95Ms != null) notes.push(`Full-response p95 ${Math.round(bench.totalP95Ms)} ms (TTFB is time to headers)`)
  notes.push('Cold start = first request after deploy (includes on-demand dev compile if the page was not yet warmed)')

  if (bench.htmlSaved && left() > 500) {
    try {
      const html = await sbx.files.read(paths.html, { requestTimeoutMs: Math.max(1_000, Math.min(8_000, left())) })
      Object.assign(metrics, auditHtml(html))
    } catch (e) {
      notes.push(`Could not read the served HTML for auditing: ${errMessage(e)}`)
    }
  }
  // Best-effort cleanup; never blocks the response.
  void sbx.commands.run(`rm -f ${paths.bench} ${paths.html}`, { timeoutMs: 5_000 }).catch(() => {})
  metrics.measuredAt = new Date().toISOString()
  notes.push(`Measured in ${((Date.now() - started) / 1000).toFixed(1)} s`)
  return metrics
}

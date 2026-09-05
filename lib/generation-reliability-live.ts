/**
 * Live A/B/C generation + sandbox probe. Needs pnpm dev and provider/E2B keys.
 * Does not print secrets.
 */
import { promises as fs } from 'fs'
import path from 'path'
import templates from './templates'

const PROMPTS = [
  {
    id: 'menu',
    text: 'A restaurant menu site for Harbor & Rye. Dish grid, a dish detail dialog, and an order tray. Mock dishes only. First paint must work with nothing selected.',
  },
]

type CandidateReport = {
  id: string
  generate: 'ok' | 'fail'
  generateMs: number
  generateError?: string
  salvaged?: boolean
  codeChars?: number
  sandbox: 'ok' | 'fail' | 'skipped'
  sandboxMs?: number
  sandboxStage?: string
  installError?: string
  runError?: string
  url?: string
}

function parseSse(buffer: string) {
  const events: any[] = []
  const parts = buffer.split('\n\n')
  for (const raw of parts) {
    const line = raw.split('\n').find((l) => l.startsWith('data: '))
    if (!line) continue
    try {
      events.push(JSON.parse(line.slice(6)))
    } catch {
      /* ignore */
    }
  }
  return events
}

async function postTournament(base: string, prompt: string, projectId: string) {
  const started = Date.now()
  const res = await fetch(`${base}/api/tournament`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      projectId,
      messages: [{ role: 'user', content: prompt }],
      template: templates,
      model: {
        id: 'gpt-4.1',
        name: 'Asta 1.2',
        provider: 'EvoStack',
        providerId: 'openai',
      },
      config: { model: 'gpt-4.1' },
    }),
  })
  if (!res.ok || !res.body) {
    throw new Error(`tournament ${res.status}: ${await res.text().catch(() => '')}`)
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let raw = ''
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    raw += decoder.decode(value, { stream: true })
  }
  return { events: parseSse(raw), ms: Date.now() - started }
}

async function postSandbox(base: string, projectId: string, candidateId: string, fragment: any) {
  const started = Date.now()
  const res = await fetch(`${base}/api/sandbox`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fragment,
      userID: 'live-check',
      projectId,
      candidateId,
      runId: projectId,
    }),
  })
  const body = await res.json().catch(() => ({}))
  return { ok: res.ok, body, ms: Date.now() - started }
}

async function probeUrl(url: string) {
  try {
    const res = await fetch(url, { redirect: 'follow' })
    const text = await res.text()
    if (!res.ok) return `http ${res.status}`
    if (!text || text.length < 20) return 'empty response'
    return null
  } catch (e: any) {
    return e?.message || 'fetch failed'
  }
}

async function detectBase() {
  const guessed = process.env.EVOSTACK_LIVE_URL || 'http://localhost:3000'
  for (const base of [guessed, 'http://localhost:3000', 'http://localhost:3333']) {
    try {
      const res = await fetch(base, { method: 'GET' })
      if (res.ok || res.status === 307 || res.status === 401 || res.status === 404) return base
    } catch {
      /* try next */
    }
  }
  throw new Error('dev server not reachable on 3000 or 3333')
}

async function main() {
  const base = await detectBase()
  const reports: { prompt: string; totalMs: number; candidates: CandidateReport[] }[] = []

  for (const prompt of PROMPTS) {
    const projectId = `live-${prompt.id}-${Date.now()}`
    const t0 = Date.now()
    const { events, ms: genMs } = await postTournament(base, prompt.text, projectId)
    const byId: Record<string, CandidateReport> = {
      minimal: { id: 'minimal', generate: 'fail', generateMs: genMs, sandbox: 'skipped' },
      rich: { id: 'rich', generate: 'fail', generateMs: genMs, sandbox: 'skipped' },
      playful: { id: 'playful', generate: 'fail', generateMs: genMs, sandbox: 'skipped' },
    }
    const frags: Record<string, any> = {}
    for (const evt of events) {
      if (evt.type === 'candidate_done' && evt.id) {
        const code = typeof evt.fragment?.code === 'string' ? evt.fragment.code : ''
        byId[evt.id] = {
          ...byId[evt.id],
          generate: 'ok',
          salvaged: Boolean(evt.warning),
          codeChars: code.length,
        }
        frags[evt.id] = evt.fragment
      }
      if (evt.type === 'candidate_error' && evt.id && byId[evt.id].generate !== 'ok') {
        byId[evt.id].generateError = evt.error
      }
    }

    for (const id of ['minimal', 'rich', 'playful']) {
      const fragment = frags[id]
      if (!fragment) continue
      const sbx = await postSandbox(base, projectId, id, fragment)
      byId[id].sandboxMs = sbx.ms
      if (!sbx.ok) {
        byId[id].sandbox = 'fail'
        byId[id].sandboxStage = 'sandbox_http'
        byId[id].runError = sbx.body?.error || `http ${sbx.ok}`
        continue
      }
      byId[id].url = sbx.body?.url
      byId[id].installError = sbx.body?.installError
      if (sbx.body?.runError) {
        byId[id].runError = sbx.body.runError
      }
      if (sbx.body?.url) {
        const runError = await probeUrl(sbx.body.url)
        byId[id].sandbox = runError ? 'fail' : 'ok'
        byId[id].sandboxStage = 'run'
        byId[id].runError = runError || byId[id].runError
      } else {
        byId[id].sandbox = 'fail'
        byId[id].sandboxStage = 'run'
        byId[id].runError = 'no preview url'
      }
    }

    reports.push({
      prompt: prompt.id,
      totalMs: Date.now() - t0,
      candidates: Object.values(byId),
    })
    console.log(
      JSON.stringify({
        prompt: prompt.id,
        totalMs: Date.now() - t0,
        candidates: Object.values(byId).map((c) => ({
          id: c.id,
          generate: c.generate,
          sandbox: c.sandbox,
          generateError: c.generateError,
          installError: c.installError,
          runError: c.runError,
        })),
      }),
    )
  }

  const outDir = path.join(process.cwd(), '.data', 'generation-logs')
  await fs.mkdir(outDir, { recursive: true })
  const out = path.join(outDir, 'live-report.json')
  await fs.writeFile(out, JSON.stringify({ base, at: new Date().toISOString(), reports }, null, 2))
  console.log(`wrote ${out}`)
}

main().catch((err) => {
  console.error(err?.message || err)
  process.exit(1)
})

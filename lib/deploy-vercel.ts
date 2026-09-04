import { WrittenFile } from './fragment-files'
import { isStaticSite } from './deploy-scaffold'

type VercelJson = Record<string, unknown>

function token() {
  return process.env.VERCEL_TOKEN || ''
}

function teamQ() {
  const id = process.env.VERCEL_TEAM_ID || process.env.VERCEL_ORG_ID || ''
  return id ? `teamId=${encodeURIComponent(id)}` : ''
}

export function vercelConfigured() {
  return Boolean(token())
}

async function vercel(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ ok: boolean; status: number; json: VercelJson }> {
  const q = teamQ()
  const sep = path.includes('?') ? '&' : '?'
  const url = `https://api.vercel.com${path}${q ? `${sep}${q}` : ''}`
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token()}`,
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  let json: VercelJson = {}
  try {
    json = (await res.json()) as VercelJson
  } catch {
    json = {}
  }
  return { ok: res.ok, status: res.status, json }
}

function errMessage(json: VercelJson, fallback: string) {
  const err = json.error
  if (err && typeof err === 'object' && err !== null && 'message' in err) {
    return String((err as { message: unknown }).message)
  }
  if (typeof json.message === 'string') return json.message
  return fallback
}

export async function ensureVercelProject(name: string) {
  const existing = await vercel('GET', `/v9/projects/${encodeURIComponent(name)}`)
  if (existing.ok) return
  const created = await vercel('POST', '/v11/projects', {
    name,
    framework: 'nextjs',
  })
  if (!created.ok && created.status !== 409) {
    throw new Error(errMessage(created.json, 'Could not create Vercel project'))
  }
}

export async function upsertVercelEnv(
  project: string,
  vars: Record<string, string>,
) {
  const listed = await vercel(
    'GET',
    `/v9/projects/${encodeURIComponent(project)}/env`,
  )
  const rows = Array.isArray(listed.json.envs)
    ? (listed.json.envs as Array<{ id?: string; key?: string }>)
    : []
  const target = ['production', 'preview', 'development']
  for (const [key, value] of Object.entries(vars)) {
    const hit = rows.find((r) => r.key === key)
    const res = hit?.id
      ? await vercel(
          'PATCH',
          `/v9/projects/${encodeURIComponent(project)}/env/${hit.id}`,
          { value, type: 'plain', target },
        )
      : await vercel('POST', `/v10/projects/${encodeURIComponent(project)}/env`, {
          key,
          value,
          type: 'plain',
          target,
        })
    if (!res.ok) {
      throw new Error(errMessage(res.json, `Could not set ${key}`))
    }
  }
}

export async function createVercelDeployment(args: {
  name: string
  files: WrittenFile[]
}) {
  const files = args.files
    .filter((f) => f.file_path && !f.file_path.includes('..'))
    .map((f) => ({
      file: f.file_path.replace(/\\/g, '/'),
      data: f.file_content ?? '',
    }))
  const created = await vercel(
    'POST',
    '/v13/deployments?forceNew=1&skipAutoDetectionConfirmation=1',
    {
      name: args.name,
      files,
      target: 'production',
      projectSettings: {
        framework: isStaticSite(args.files) ? null : 'nextjs',
      },
    },
  )
  if (!created.ok) {
    throw new Error(errMessage(created.json, 'Vercel deploy failed'))
  }
  return {
    id: String(created.json.id || ''),
    url: typeof created.json.url === 'string' ? created.json.url : '',
    readyState: String(created.json.readyState || 'QUEUED'),
  }
}

export async function getVercelDeployment(id: string) {
  const res = await vercel('GET', `/v13/deployments/${encodeURIComponent(id)}`)
  if (!res.ok) {
    throw new Error(errMessage(res.json, 'Could not read deployment'))
  }
  return {
    id: String(res.json.id || id),
    url: typeof res.json.url === 'string' ? res.json.url : '',
    readyState: String(res.json.readyState || ''),
    readyStateReason:
      typeof res.json.readyStateReason === 'string'
        ? res.json.readyStateReason
        : '',
  }
}

export async function assignVercelAlias(deploymentId: string, alias: string) {
  const res = await vercel(
    'POST',
    `/v2/deployments/${encodeURIComponent(deploymentId)}/aliases`,
    { alias },
  )
  return res.ok
}

export function publicCaptureUrl(origin?: string) {
  const fromEnv =
    process.env.EVOSTACK_PUBLIC_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    ''
  const base = (fromEnv || origin || '').replace(/\/$/, '')
  if (!base || /localhost|127\.0\.0\.1/.test(base)) return ''
  return `${base.startsWith('http') ? base : `https://${base}`}/api/evostack/submit`
}

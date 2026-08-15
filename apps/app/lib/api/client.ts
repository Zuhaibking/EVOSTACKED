const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3333'

export function apiUrl(path: string) {
  return `${API_URL}${path}`
}

export async function apiFetch(
  path: string,
  opts: RequestInit & { token?: string } = {},
) {
  const { token, headers: initHeaders, ...rest } = opts
  const headers = new Headers(initHeaders)
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (rest.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  return fetch(apiUrl(path), { ...rest, headers })
}

export async function createRun(token?: string, id?: string) {
  const res = await apiFetch('/v1/runs', {
    method: 'POST',
    token,
    body: JSON.stringify(id ? { id } : {}),
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json() as Promise<{ id: string; memoryVersion: number }>
}

export async function getRun(runId: string, token?: string) {
  const res = await apiFetch(`/v1/runs/${runId}`, { token })
  if (!res.ok) throw new Error(await res.text())
  return res.json() as Promise<{
    runId: string
    memoryRevision: number
    selectedCandidate?: string | null
    activeVersion?: number | null
    hasTournament: boolean
  }>
}

export async function patchRun(
  runId: string,
  patch: {
    selectedCandidate?: string | null
    hasTournament?: boolean
    activeVersion?: number | null
    status?: string
  },
  token?: string,
) {
  const res = await apiFetch(`/v1/runs/${runId}`, {
    method: 'PATCH',
    token,
    body: JSON.stringify(patch),
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json() as Promise<{
    runId: string
    memoryRevision: number
    selectedCandidate?: string | null
    activeVersion?: number | null
    hasTournament: boolean
  }>
}

export async function getRunMessages(runId: string, token?: string) {
  const res = await apiFetch(`/v1/runs/${runId}/messages`, { token })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function getRunBrain(runId: string, token?: string) {
  const res = await apiFetch(`/v1/runs/${runId}/brain`, { token })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function saveRunBrain(
  runId: string,
  data: unknown,
  token?: string,
) {
  return apiFetch(`/v1/runs/${runId}/brain`, {
    method: 'POST',
    token,
    body: JSON.stringify({ data }),
  })
}

export async function getRunVersions(runId: string, token?: string) {
  const res = await apiFetch(`/v1/runs/${runId}/versions`, { token })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function getRunVersion(
  runId: string,
  version: number,
  token?: string,
) {
  const res = await apiFetch(`/v1/runs/${runId}/versions/${version}`, { token })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function saveRunVersion(
  runId: string,
  version: number,
  data: unknown,
  token?: string,
) {
  return apiFetch(`/v1/runs/${runId}/versions`, {
    method: 'POST',
    token,
    body: JSON.stringify({ version, data }),
  })
}

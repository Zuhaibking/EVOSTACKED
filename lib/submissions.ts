import { promises as fs } from 'fs'
import path from 'path'

export type Submission = {
  id: string
  project_id: string
  run_id: string
  candidate_id: string
  form_id: string
  payload: Record<string, unknown>
  created_at: number
}

const ROOT = path.join(process.cwd(), '.data', 'submissions')
const ID = /^[a-zA-Z0-9._-]+$/

function safeId(value: string | undefined, fallback: string) {
  const raw = (value || fallback).trim() || fallback
  return ID.test(raw) ? raw : fallback
}

function fileFor(projectId: string) {
  return path.join(ROOT, `${safeId(projectId, 'project')}.json`)
}

async function readAll(projectId: string): Promise<Submission[]> {
  try {
    const raw = await fs.readFile(fileFor(projectId), 'utf8')
    const rows = JSON.parse(raw)
    return Array.isArray(rows) ? rows : []
  } catch {
    return []
  }
}

export async function saveSubmission(input: {
  project_id?: string
  run_id?: string
  candidate_id?: string
  form_id?: string
  payload?: unknown
}): Promise<Submission> {
  const project_id = safeId(input.project_id, 'project')
  const row: Submission = {
    id: `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    project_id,
    run_id: safeId(input.run_id, 'run'),
    candidate_id: safeId(input.candidate_id, 'solo'),
    form_id: String(input.form_id || 'form').slice(0, 80),
    payload:
      input.payload && typeof input.payload === 'object' && !Array.isArray(input.payload)
        ? (input.payload as Record<string, unknown>)
        : { value: input.payload ?? null },
    created_at: Date.now(),
  }
  const rows = [row, ...(await readAll(project_id))].slice(0, 2000)
  await fs.mkdir(ROOT, { recursive: true })
  await fs.writeFile(fileFor(project_id), JSON.stringify(rows), 'utf8')
  return row
}

export async function listSubmissions(projectId: string): Promise<Submission[]> {
  return readAll(projectId)
}

import { promises as fs } from 'fs'
import path from 'path'

export type DeployStatus = 'idle' | 'building' | 'live' | 'failed'

export type DeployRecord = {
  projectId: string
  candidateId: string
  slug: string
  status: DeployStatus
  url?: string
  error?: string
  provider?: 'vercel'
  deploymentId?: string
  aliasPending?: boolean
  updatedAt: number
}

const ROOT = path.join(process.cwd(), '.data', 'deploys')
const ID = /^[a-zA-Z0-9._-]+$/

function safeId(value: string | undefined, fallback: string) {
  const raw = (value || fallback).trim() || fallback
  return ID.test(raw) ? raw : fallback
}

function fileFor(projectId: string, candidateId: string) {
  return path.join(
    ROOT,
    safeId(projectId, 'project'),
    `${safeId(candidateId, 'solo')}.json`,
  )
}

export async function loadDeploy(
  projectId: string | undefined,
  candidateId: string | undefined,
): Promise<DeployRecord | null> {
  const pid = safeId(projectId, '')
  const cid = safeId(candidateId, '')
  if (!pid || !cid) return null
  try {
    const raw = await fs.readFile(fileFor(pid, cid), 'utf8')
    const row = JSON.parse(raw) as DeployRecord
    return row && row.projectId ? row : null
  } catch {
    return null
  }
}

export async function saveDeploy(row: DeployRecord): Promise<DeployRecord> {
  const next = { ...row, updatedAt: Date.now() }
  await fs.mkdir(path.dirname(fileFor(next.projectId, next.candidateId)), {
    recursive: true,
  })
  await fs.writeFile(
    fileFor(next.projectId, next.candidateId),
    JSON.stringify(next),
    'utf8',
  )
  return next
}

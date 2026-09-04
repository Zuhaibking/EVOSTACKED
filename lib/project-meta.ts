import { loadCandidateSnapshot } from './candidate-store'
import { promises as fs } from 'fs'
import path from 'path'

export type CandidateLifecycle = 'resting' | 'active'

export type ProjectCandidateMeta = {
  id: string
  label?: string
  title?: string
  status: CandidateLifecycle
  score?: number
  isWinner?: boolean
  latestVersionId?: string
  requires_data_layer?: boolean
  template?: string
}

export type ProjectMeta = {
  projectId: string
  ownerId?: string
  activeCandidateId?: string
  activeVersionId?: string
  runId?: string
  candidates?: Record<string, ProjectCandidateMeta>
  updatedAt: number
}

const ROOT = path.join(process.cwd(), '.data', 'projects')
const ID = /^[a-zA-Z0-9._-]+$/

function safeId(value: string | undefined, fallback: string) {
  const raw = (value || fallback).trim() || fallback
  return ID.test(raw) ? raw : fallback
}

function fileFor(projectId: string) {
  return path.join(ROOT, `${safeId(projectId, 'project')}.json`)
}

export function deploySlug(projectId: string, candidateId: string) {
  const a = safeId(projectId, 'project')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 10)
  const b = safeId(candidateId, 'solo')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 12)
  return `evo-${a || 'proj'}-${b || 'solo'}`.slice(0, 52)
}

export async function loadProjectMeta(
  projectId: string | undefined,
): Promise<ProjectMeta | null> {
  const pid = safeId(projectId, '')
  if (!pid) return null
  try {
    const raw = await fs.readFile(fileFor(pid), 'utf8')
    const row = JSON.parse(raw) as ProjectMeta
    return row && row.projectId ? row : null
  } catch {
    return null
  }
}

export async function saveProjectMeta(
  patch: Partial<ProjectMeta> & { projectId: string },
): Promise<ProjectMeta> {
  const projectId = safeId(patch.projectId, 'project')
  const prev = await loadProjectMeta(projectId)
  const candidates = {
    ...(prev?.candidates ?? {}),
    ...(patch.candidates ?? {}),
  }
  const row: ProjectMeta = {
    projectId,
    ownerId: patch.ownerId || prev?.ownerId,
    activeCandidateId:
      patch.activeCandidateId !== undefined
        ? patch.activeCandidateId
        : prev?.activeCandidateId,
    activeVersionId:
      patch.activeVersionId !== undefined
        ? patch.activeVersionId
        : prev?.activeVersionId,
    runId: patch.runId || prev?.runId,
    candidates,
    updatedAt: Date.now(),
  }
  await fs.mkdir(ROOT, { recursive: true })
  await fs.writeFile(fileFor(projectId), JSON.stringify(row), 'utf8')
  return row
}

export async function touchProjectMeta(args: {
  projectId: string
  ownerId?: string
}): Promise<ProjectMeta> {
  return saveProjectMeta({
    projectId: args.projectId,
    ownerId: args.ownerId,
  })
}

export async function setActiveCandidate(args: {
  projectId: string
  activeCandidateId: string
  activeVersionId?: string
  ownerId?: string
}): Promise<ProjectMeta> {
  const prev = await loadProjectMeta(args.projectId)
  const candidates: Record<string, ProjectCandidateMeta> = {
    ...(prev?.candidates ?? {}),
  }
  for (const id of Object.keys(candidates)) {
    candidates[id] = {
      ...candidates[id],
      status: id === args.activeCandidateId ? 'active' : 'resting',
    }
  }
  if (!candidates[args.activeCandidateId]) {
    candidates[args.activeCandidateId] = {
      id: args.activeCandidateId,
      status: 'active',
    }
  } else {
    candidates[args.activeCandidateId] = {
      ...candidates[args.activeCandidateId],
      status: 'active',
    }
  }
  let activeVersionId = args.activeVersionId
  if (!activeVersionId) {
    const snap = await loadCandidateSnapshot(args.projectId, args.activeCandidateId)
    activeVersionId = snap?.versions[0]?.id
  }
  return saveProjectMeta({
    projectId: args.projectId,
    ownerId: args.ownerId,
    activeCandidateId: args.activeCandidateId,
    activeVersionId,
    candidates,
  })
}

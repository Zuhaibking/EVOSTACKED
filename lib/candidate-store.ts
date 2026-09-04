import { promises as fs } from 'fs'
import path from 'path'
import { WrittenFile } from './fragment-files'

export type PersistedFile = WrittenFile & { updated_at: number }

export type CandidateVersionMeta = {
  id: string
  runId: string
  candidateId: string
  createdAt: number
  label: string
  fileCount: number
}

export type CandidateSnapshot = {
  projectId: string
  candidateId: string
  runId: string
  template?: string
  requires_data_layer?: boolean
  files: PersistedFile[]
  updatedAt: number
  versions: CandidateVersionMeta[]
}

export type ResolveFilesResult = {
  files: WrittenFile[]
  rehydrated: boolean
  persist: boolean
}

const ROOT = path.join(process.cwd(), '.data', 'candidates')
const ID = /^[a-zA-Z0-9._-]+$/

function safeId(value: string | undefined, fallback: string) {
  const raw = (value || fallback).trim() || fallback
  return ID.test(raw) ? raw : fallback
}

function snapshotPath(projectId: string, candidateId: string) {
  return path.join(ROOT, safeId(projectId, 'project'), `${safeId(candidateId, 'solo')}.json`)
}

function kvKey(projectId: string, candidateId: string) {
  return `evo:files:${safeId(projectId, 'project')}:${safeId(candidateId, 'solo')}`
}

function stamp(files: WrittenFile[], at = Date.now()): PersistedFile[] {
  return files.map((f) => ({
    file_path: f.file_path,
    file_content: f.file_content,
    updated_at: at,
  }))
}

export function mergeFiles(base: WrittenFile[], overlay: WrittenFile[]): WrittenFile[] {
  const map = new Map<string, WrittenFile>()
  for (const f of base) {
    if (f.file_path) map.set(f.file_path, f)
  }
  for (const f of overlay) {
    if (f.file_path) map.set(f.file_path, f)
  }
  return [...map.values()]
}

export function mainsChanged(incoming: WrittenFile[], persisted: WrittenFile[]): boolean {
  if (!incoming.length) return false
  for (const f of incoming) {
    const prev = persisted.find((p) => p.file_path === f.file_path)
    if (!prev || prev.file_content !== f.file_content) return true
  }
  return false
}

/** Incoming edits win; unchanged persist is rehydrated as-is (keeps extra files). */
export function resolveSandboxFiles(
  incoming: WrittenFile[],
  persisted: WrittenFile[] | null | undefined,
): ResolveFilesResult {
  const next = incoming.filter((f) => f.file_path)
  const prev = (persisted ?? []).filter((f) => f.file_path)
  if (!prev.length && next.length) {
    return { files: next, rehydrated: false, persist: true }
  }
  if (prev.length && !next.length) {
    return { files: prev, rehydrated: true, persist: false }
  }
  if (prev.length && next.length && !mainsChanged(next, prev)) {
    return { files: prev, rehydrated: true, persist: false }
  }
  if (next.length) {
    return { files: mergeFiles(prev, next), rehydrated: false, persist: true }
  }
  return { files: [], rehydrated: false, persist: false }
}

async function readKv(key: string): Promise<CandidateSnapshot | null> {
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) return null
  try {
    const { kv } = await import('@vercel/kv')
    const row = await kv.get<CandidateSnapshot>(key)
    return row && Array.isArray(row.files) ? row : null
  } catch {
    return null
  }
}

async function writeKv(key: string, snap: CandidateSnapshot) {
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) return
  try {
    const { kv } = await import('@vercel/kv')
    await kv.set(key, snap)
  } catch (e) {
    console.warn('candidate-store kv write failed', e)
  }
}

export async function loadCandidateSnapshot(
  projectId: string | undefined,
  candidateId: string | undefined,
): Promise<CandidateSnapshot | null> {
  const pid = safeId(projectId, '')
  const cid = safeId(candidateId, '')
  if (!pid || !cid) return null
  const fromKv = await readKv(kvKey(pid, cid))
  if (fromKv) return fromKv
  try {
    const raw = await fs.readFile(snapshotPath(pid, cid), 'utf8')
    const snap = JSON.parse(raw) as CandidateSnapshot
    return snap && Array.isArray(snap.files) ? snap : null
  } catch {
    return null
  }
}

export async function saveCandidateSnapshot(args: {
  projectId: string
  candidateId: string
  runId?: string
  template?: string
  files: WrittenFile[]
  label?: string
  requires_data_layer?: boolean
}): Promise<CandidateSnapshot> {
  const projectId = safeId(args.projectId, 'project')
  const candidateId = safeId(args.candidateId, 'solo')
  const runId = safeId(args.runId, 'run')
  const now = Date.now()
  const prev = await loadCandidateSnapshot(projectId, candidateId)
  if (
    prev &&
    prev.files.length === args.files.length &&
    !mainsChanged(args.files, prev.files) &&
    args.files.every((f) =>
      prev.files.some((p) => p.file_path === f.file_path && p.file_content === f.file_content),
    ) &&
    (args.requires_data_layer === undefined ||
      Boolean(args.requires_data_layer) === Boolean(prev.requires_data_layer))
  ) {
    return prev
  }
  const version: CandidateVersionMeta = {
    id: `v_${now.toString(36)}`,
    runId,
    candidateId,
    createdAt: now,
    label: args.label || `${candidateId} · ${args.files.length} files`,
    fileCount: args.files.length,
  }
  const snap: CandidateSnapshot = {
    projectId,
    candidateId,
    runId,
    template: args.template || prev?.template,
    requires_data_layer:
      args.requires_data_layer ?? prev?.requires_data_layer ?? false,
    files: stamp(args.files, now),
    updatedAt: now,
    versions: [version, ...(prev?.versions ?? [])].slice(0, 40),
  }
  await fs.mkdir(path.dirname(snapshotPath(projectId, candidateId)), { recursive: true })
  await fs.writeFile(snapshotPath(projectId, candidateId), JSON.stringify(snap), 'utf8')
  await writeKv(kvKey(projectId, candidateId), snap)
  return snap
}

export async function listCandidateSnapshots(
  projectId: string | undefined,
): Promise<CandidateSnapshot[]> {
  const pid = safeId(projectId, '')
  if (!pid) return []
  try {
    const names = await fs.readdir(path.join(ROOT, pid))
    const out: CandidateSnapshot[] = []
    for (const name of names) {
      if (!name.endsWith('.json')) continue
      const snap = await loadCandidateSnapshot(pid, name.slice(0, -5))
      if (snap) out.push(snap)
    }
    return out
  } catch {
    return []
  }
}

export async function projectRequiresDataLayer(
  projectId: string | undefined,
): Promise<boolean> {
  const snaps = await listCandidateSnapshots(projectId)
  return snaps.some((s) => Boolean(s.requires_data_layer))
}

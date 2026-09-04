import { Message } from './messages'
import { FragmentSchema } from './schema'
import { VariantId, Verdict } from './tournament'
import { Candidate } from './tournament-client'
import { ExecutionResult } from './types'
import { DeepPartial } from 'ai'

export const PROJECTS_KEY = 'evostack.projects.v1'
const LEGACY_RUN_KEY = 'evostack:run:v1'
const SAVE_DEBOUNCE_MS = 280

export type ProjectWorkspace = {
  messages: Message[]
  fragment?: DeepPartial<FragmentSchema>
  result?: ExecutionResult
  selectedCandidate?: VariantId
  hasTournament: boolean
  currentTab: 'code' | 'fragment'
  chatInput: string
  tournament: {
    candidates?: Record<VariantId, Candidate>
    verdict?: Verdict
    phase: 'idle' | 'generating' | 'judging' | 'done'
  }
}

export type ProjectVersion = {
  id: string
  createdAt: number
  label: string
  fragment?: DeepPartial<FragmentSchema>
  result?: ExecutionResult
}

export type ProjectRecord = {
  id: string
  name: string
  purpose: string
  createdAt: number
  updatedAt: number
  versions: ProjectVersion[]
} & ProjectWorkspace

export type ProjectStore = {
  version: 1
  activeId: string
  projects: Record<string, ProjectRecord>
}

export function blankWorkspace(): ProjectWorkspace {
  return {
    messages: [],
    fragment: undefined,
    result: undefined,
    selectedCandidate: undefined,
    hasTournament: false,
    currentTab: 'code',
    chatInput: '',
    tournament: { phase: 'idle' },
  }
}

export function deriveProjectMeta(messages: Message[]): {
  name: string
  purpose: string
} {
  const text = messages
    .find((m) => m.role === 'user')
    ?.content.find((c) => c.type === 'text')?.text
    ?.trim()
  if (!text) return { name: 'Untitled', purpose: '' }
  return { name: text.slice(0, 48), purpose: text.slice(0, 160) }
}

function newId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export function createProject(
  workspace: ProjectWorkspace = blankWorkspace(),
): ProjectRecord {
  const t = Date.now()
  const meta = deriveProjectMeta(workspace.messages)
  return {
    id: newId(),
    name: meta.name,
    versions: [],
    purpose: meta.purpose,
    createdAt: t,
    updatedAt: t,
    ...workspace,
  }
}

function emptyStore(): ProjectStore {
  const project = createProject()
  return { version: 1, activeId: project.id, projects: { [project.id]: project } }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function sanitizeProject(raw: unknown): ProjectRecord | null {
  if (!isRecord(raw) || typeof raw.id !== 'string' || !raw.id) return null
  const ws = blankWorkspace()
  const messages = Array.isArray(raw.messages) ? (raw.messages as Message[]) : []
  const meta = deriveProjectMeta(messages)
  const tab = raw.currentTab === 'fragment' ? 'fragment' : 'code'
  const phase =
    raw.tournament && isRecord(raw.tournament) && typeof raw.tournament.phase === 'string'
      ? (raw.tournament.phase as ProjectWorkspace['tournament']['phase'])
      : 'idle'
  return {
    id: raw.id,
    name: typeof raw.name === 'string' && raw.name ? raw.name : meta.name,
    purpose: typeof raw.purpose === 'string' ? raw.purpose : meta.purpose,
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now(),
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : Date.now(),
    messages,
    fragment: (raw.fragment as ProjectRecord['fragment']) ?? ws.fragment,
    result: (raw.result as ProjectRecord['result']) ?? ws.result,
    selectedCandidate: raw.selectedCandidate as VariantId | undefined,
    hasTournament: Boolean(raw.hasTournament),
    currentTab: tab,
    chatInput: typeof raw.chatInput === 'string' ? raw.chatInput : '',
    tournament:
      raw.tournament && isRecord(raw.tournament)
        ? {
            candidates: raw.tournament.candidates as ProjectWorkspace['tournament']['candidates'],
            verdict: raw.tournament.verdict as Verdict | undefined,
            phase,
          }
        : ws.tournament,
    versions: sanitizeVersions(raw.versions),
  }
}

function sanitizeVersions(raw: unknown): ProjectVersion[] {
  if (!Array.isArray(raw)) return []
  const out: ProjectVersion[] = []
  for (const item of raw) {
    if (!isRecord(item) || typeof item.id !== 'string' || !item.id) continue
    out.push({
      id: item.id,
      createdAt: typeof item.createdAt === 'number' ? item.createdAt : Date.now(),
      label: typeof item.label === 'string' ? item.label : 'Version',
      fragment: item.fragment as ProjectVersion['fragment'],
      result: item.result as ProjectVersion['result'],
    })
  }
  return out.slice(0, 40)
}

function sanitizeStore(raw: unknown): ProjectStore | null {
  if (!isRecord(raw) || !isRecord(raw.projects)) return null
  const projects: Record<string, ProjectRecord> = {}
  for (const [id, value] of Object.entries(raw.projects)) {
    const p = sanitizeProject(value)
    if (p) projects[p.id] = p
    else if (id) console.warn('[projects] skipped corrupt project', id)
  }
  if (Object.keys(projects).length === 0) return null
  const activeId =
    typeof raw.activeId === 'string' && projects[raw.activeId]
      ? raw.activeId
      : mostRecentId(projects)
  return { version: 1, activeId, projects }
}

function mostRecentId(projects: Record<string, ProjectRecord>) {
  return Object.values(projects).sort((a, b) => b.updatedAt - a.updatedAt)[0].id
}

function readRaw(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch (e) {
    console.warn('[projects] localStorage.getItem failed', e)
    return null
  }
}

function writeRaw(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
    return true
  } catch (e) {
    console.warn('[projects] localStorage.setItem failed', e)
    return false
  }
}

function migrateLegacy(): ProjectStore | null {
  const raw = readRaw(LEGACY_RUN_KEY)
  if (!raw) return null
  try {
    const snap = JSON.parse(raw)
    if (!isRecord(snap)) return null
    const project = createProject({
      ...blankWorkspace(),
      messages: Array.isArray(snap.messages) ? snap.messages : [],
      fragment: snap.fragment as ProjectRecord['fragment'],
      result: snap.result as ProjectRecord['result'],
      selectedCandidate: snap.selectedCandidate as VariantId | undefined,
      hasTournament: Boolean(snap.hasTournament),
      tournament: isRecord(snap.tournament)
        ? {
            candidates: snap.tournament.candidates as ProjectWorkspace['tournament']['candidates'],
            verdict: snap.tournament.verdict as Verdict | undefined,
            phase:
              snap.tournament.phase === 'idle' ||
              snap.tournament.phase === 'generating' ||
              snap.tournament.phase === 'judging' ||
              snap.tournament.phase === 'done'
                ? snap.tournament.phase
                : 'done',
          }
        : { phase: 'idle' },
    })
    return { version: 1, activeId: project.id, projects: { [project.id]: project } }
  } catch (e) {
    console.warn('[projects] legacy migrate failed', e)
    return null
  }
}

export function loadStore(): ProjectStore {
  if (typeof window === 'undefined') return emptyStore()
  const raw = readRaw(PROJECTS_KEY)
  if (raw) {
    try {
      const parsed = sanitizeStore(JSON.parse(raw))
      if (parsed) return parsed
      console.warn('[projects] store failed validation, reseeding')
    } catch (e) {
      console.warn('[projects] store JSON parse failed', e)
    }
  }
  const migrated = migrateLegacy()
  const store = migrated ?? emptyStore()
  persistStore(store)
  return store
}

export function persistStore(store: ProjectStore) {
  if (typeof window === 'undefined') return
  writeRaw(PROJECTS_KEY, JSON.stringify(store))
}

export function listProjects(store: ProjectStore): ProjectRecord[] {
  return Object.values(store.projects).sort((a, b) => b.updatedAt - a.updatedAt)
}

export function getActive(store: ProjectStore): ProjectRecord {
  return store.projects[store.activeId] ?? store.projects[mostRecentId(store.projects)]
}

export function upsertProject(
  store: ProjectStore,
  project: ProjectRecord,
  makeActive = true,
): ProjectStore {
  const next: ProjectStore = {
    ...store,
    activeId: makeActive ? project.id : store.activeId,
    projects: { ...store.projects, [project.id]: project },
  }
  persistStore(next)
  return next
}

export function saveWorkspace(
  store: ProjectStore,
  id: string,
  workspace: ProjectWorkspace,
): ProjectStore {
  const prev = store.projects[id]
  if (!prev) return store
  const meta = deriveProjectMeta(workspace.messages)
  const nextProject: ProjectRecord = {
    ...prev,
    ...workspace,
    name: meta.name,
    purpose: meta.purpose,
    updatedAt: Date.now(),
  }
  return upsertProject(store, nextProject, store.activeId === id)
}

export function pushVersion(
  store: ProjectStore,
  id: string,
  version: ProjectVersion,
  workspace?: ProjectWorkspace,
): ProjectStore {
  const prev = store.projects[id]
  if (!prev) return store
  const nextProject: ProjectRecord = {
    ...prev,
    ...(workspace ?? {}),
    versions: [version, ...prev.versions].slice(0, 40),
    updatedAt: Date.now(),
  }
  return upsertProject(store, nextProject, store.activeId === id)
}

export function setActiveId(store: ProjectStore, id: string): ProjectStore {
  if (!store.projects[id]) return store
  const next = { ...store, activeId: id }
  persistStore(next)
  return next
}

export function deleteProject(
  store: ProjectStore,
  id: string,
): { store: ProjectStore; opened: ProjectRecord } {
  const projects = { ...store.projects }
  delete projects[id]
  if (Object.keys(projects).length === 0) {
    const fresh = createProject()
    const next = { version: 1 as const, activeId: fresh.id, projects: { [fresh.id]: fresh } }
    persistStore(next)
    return { store: next, opened: fresh }
  }
  const activeId =
    store.activeId === id ? mostRecentId(projects) : store.activeId in projects
      ? store.activeId
      : mostRecentId(projects)
  const next = { version: 1 as const, activeId, projects }
  persistStore(next)
  return { store: next, opened: next.projects[activeId] }
}

export function createDebouncedSaver(fn: () => void, ms = SAVE_DEBOUNCE_MS) {
  let t: ReturnType<typeof setTimeout> | undefined
  const schedule = () => {
    if (t) clearTimeout(t)
    t = setTimeout(fn, ms)
  }
  const flush = () => {
    if (t) clearTimeout(t)
    t = undefined
    fn()
  }
  const cancel = () => {
    if (t) clearTimeout(t)
    t = undefined
  }
  return { schedule, flush, cancel }
}

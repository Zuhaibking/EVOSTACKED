/**
 * Version Vault — local, restorable application version snapshots.
 *
 * ZERO provider / LLM / E2B / network calls.
 * Project Brain stays metadata-only; this module holds source fragments.
 */
import { getFragmentFiles } from '@/lib/fragment'
import type { ApplicationPlan } from '@/lib/plan'
import type { ProjectBrain } from '@/lib/project-brain'
import { sanitizeProjectBrain } from '@/lib/project-brain'
import type { FragmentSchema } from '@/lib/schema'
import { scrubSecrets } from '@/lib/source-diff'
import type { VariantId } from '@/lib/tournament'
import { VARIANTS } from '@/lib/tournament'
import type { ExecutionResult } from '@/lib/types'
import type { VerificationStatus } from '@/lib/verification'
import type { DeepPartial } from '@evostack/shared'

/**
 * Legacy global key — never used for current-project reads/writes.
 * Kept only so stale browser data can be ignored (or one-time migrated).
 */
export const VERSION_VAULT_LEGACY_KEY = 'evostack:versions:v1'
/** @deprecated Prefer vaultStorageKeyForRun(runId). Alias of legacy key. */
export const VERSION_VAULT_STORAGE_KEY = VERSION_VAULT_LEGACY_KEY
export const VERSION_VAULT_RUN_PREFIX = 'evostack:versions:run:'
export const VERSION_VAULT_SCHEMA = 1 as const

/** Soft cap under typical ~5MB localStorage quotas. */
export const MAX_VAULT_BYTES = 3_500_000
export const MAX_VAULT_SNAPSHOTS = 24

export type VaultStorage = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem?(key: string): void
}

/** Stable id for the current EvoStack project/run (scoped vault). */
export function createVaultRunId(now = Date.now()): string {
  return `run_${now.toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

export function vaultStorageKeyForRun(runId: string): string {
  return `${VERSION_VAULT_RUN_PREFIX}${runId}`
}

function resolveVaultKey(runId?: string | null): string | null {
  if (typeof runId !== 'string') return null
  const trimmed = runId.trim()
  if (!trimmed) return null
  return vaultStorageKeyForRun(trimmed)
}

export type VaultWriteOpts = {
  makeActive?: boolean
  /** Required — vault is never written to the legacy global key. */
  runId: string
}

export type VersionSnapshotMeta = {
  version: number
  parentVersion?: number
  createdAt: string
  label: string
  userRequest?: string
  summary?: string
  activeCandidateId?: VariantId
  activeCandidateLabel?: string
  compositeScore?: number
  runtimeStatus?: string
  smokeStatus?: string
  architectureStatus?: string
  previewReachable?: boolean
}

/**
 * Full restorable snapshot. Contains source files; never API keys.
 */
export type VersionSnapshot = VersionSnapshotMeta & {
  fragment: DeepPartial<FragmentSchema> | FragmentSchema
  plan?: ApplicationPlan
  /** Optional preview handle — may be expired; restore must tolerate that. */
  execution?: {
    sbxId?: string
    url?: string
    template?: string
  }
}

export type VersionVaultDocument = {
  schemaVersion: typeof VERSION_VAULT_SCHEMA
  updatedAt: string
  activeVersion: number | null
  snapshots: VersionSnapshot[]
  /** Run/project this vault belongs to (when known). */
  runId?: string
}

export type VersionTreeNode = {
  version: number
  label: string
  parentVersion?: number
  isActive: boolean
  children: VersionTreeNode[]
}

const SECRET_KEY_RE =
  /^(apiKey|api_key|accessToken|access_token|authorization|password|secret|NVIDIA_API_KEY|OPENAI_API_KEY|GOOGLE_.*API_KEY|CLERK_.*|E2B_.*)$/i

function memoryStorage(): VaultStorage {
  const map = new Map<string, string>()
  return {
    getItem: (k) => (map.has(k) ? map.get(k)! : null),
    setItem: (k, v) => {
      map.set(k, v)
    },
    removeItem: (k) => {
      map.delete(k)
    },
  }
}

let defaultStorage: VaultStorage | null = null

export function getDefaultVaultStorage(): VaultStorage {
  if (defaultStorage) return defaultStorage
  if (typeof window !== 'undefined' && window.localStorage) {
    defaultStorage = window.localStorage
    return defaultStorage
  }
  defaultStorage = memoryStorage()
  return defaultStorage
}

/** Test helper — inject an isolated in-memory store. */
export function createMemoryVaultStorage(): VaultStorage {
  return memoryStorage()
}

function emptyVault(now?: string, runId?: string | null): VersionVaultDocument {
  return {
    schemaVersion: VERSION_VAULT_SCHEMA,
    updatedAt: now || new Date().toISOString(),
    activeVersion: null,
    snapshots: [],
    ...(runId ? { runId } : {}),
  }
}

function banSecretKeys(obj: any): any {
  if (!obj || typeof obj !== 'object') return obj
  if (Array.isArray(obj)) return obj.map(banSecretKeys)
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    if (SECRET_KEY_RE.test(k)) continue
    out[k] = banSecretKeys(v)
  }
  return out
}

function scrubDeepStrings(value: unknown): unknown {
  if (typeof value === 'string') return scrubSecrets(value)
  if (!value || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(scrubDeepStrings)
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value)) {
    if (SECRET_KEY_RE.test(k)) continue
    out[k] = scrubDeepStrings(v)
  }
  return out
}

/** Sanitize a snapshot before persistence (no secrets, scrubbed strings). */
export function sanitizeVersionSnapshot(snap: VersionSnapshot): VersionSnapshot {
  const files = getFragmentFiles(snap.fragment).map((f) => ({
    file_path: f.file_path,
    file_content: scrubSecrets(f.file_content),
  }))
  const fragment = {
    ...(snap.fragment as object),
    code: files,
  } as DeepPartial<FragmentSchema>

  const cleaned = scrubDeepStrings(
    banSecretKeys({
      ...snap,
      fragment,
      label: scrubSecrets(snap.label || `v${snap.version}`),
      userRequest: snap.userRequest
        ? scrubSecrets(snap.userRequest)
        : undefined,
      summary: snap.summary ? scrubSecrets(snap.summary) : undefined,
      execution: snap.execution
        ? {
            sbxId: snap.execution.sbxId,
            url: snap.execution.url,
            template: snap.execution.template,
          }
        : undefined,
    }),
  ) as VersionSnapshot

  return cleaned
}

function byteLength(raw: string): number {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(raw).length
  }
  return raw.length
}

function sortNewestFirst(snaps: VersionSnapshot[]): VersionSnapshot[] {
  return [...snaps].sort((a, b) => {
    if (b.version !== a.version) return b.version - a.version
    return (b.createdAt || '').localeCompare(a.createdAt || '')
  })
}

function sortOldestFirst(snaps: VersionSnapshot[]): VersionSnapshot[] {
  return [...snaps].sort((a, b) => {
    if (a.version !== b.version) return a.version - b.version
    return (a.createdAt || '').localeCompare(b.createdAt || '')
  })
}

/**
 * Evict oldest snapshots until under byte + count limits.
 * Always keeps the active version when possible.
 */
export function enforceVaultLimits(
  doc: VersionVaultDocument,
  opts?: { maxBytes?: number; maxSnapshots?: number },
): VersionVaultDocument {
  const maxBytes = opts?.maxBytes ?? MAX_VAULT_BYTES
  const maxSnapshots = opts?.maxSnapshots ?? MAX_VAULT_SNAPSHOTS
  let snapshots = [...doc.snapshots].map(sanitizeVersionSnapshot)

  const dropOne = () => {
    if (snapshots.length <= 1) return false
    const oldest = sortOldestFirst(snapshots)
    const victim =
      oldest.find((s) => s.version !== doc.activeVersion) || oldest[0]
    snapshots = snapshots.filter(
      (s) =>
        !(
          s.version === victim.version &&
          s.createdAt === victim.createdAt
        ),
    )
    return true
  }

  while (snapshots.length > maxSnapshots) {
    if (!dropOne()) break
  }

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const probe: VersionVaultDocument = {
      ...doc,
      snapshots,
    }
    const raw = JSON.stringify(probe)
    if (byteLength(raw) <= maxBytes) break
    if (!dropOne()) break
  }

  return { ...doc, snapshots, updatedAt: new Date().toISOString() }
}

/**
 * Load a run-scoped vault. Without a runId, returns empty (never reads legacy global).
 */
export function loadVaultDocument(
  storage: VaultStorage = getDefaultVaultStorage(),
  runId?: string | null,
): VersionVaultDocument {
  const key = resolveVaultKey(runId)
  if (!key) return emptyVault(undefined, runId)
  try {
    const raw = storage.getItem(key)
    if (!raw) return emptyVault(undefined, runId)
    const parsed = JSON.parse(raw) as VersionVaultDocument
    if (!parsed || parsed.schemaVersion !== VERSION_VAULT_SCHEMA) {
      return emptyVault(undefined, runId)
    }
    if (!Array.isArray(parsed.snapshots)) {
      return emptyVault(undefined, runId)
    }
    return {
      schemaVersion: VERSION_VAULT_SCHEMA,
      updatedAt: parsed.updatedAt || new Date().toISOString(),
      activeVersion:
        typeof parsed.activeVersion === 'number' ? parsed.activeVersion : null,
      snapshots: parsed.snapshots.map((s) => sanitizeVersionSnapshot(s)),
      runId: typeof runId === 'string' ? runId : parsed.runId,
    }
  } catch {
    return emptyVault(undefined, runId)
  }
}

/** Peek at legacy global vault without treating it as the current project. */
export function loadLegacyVaultDocument(
  storage: VaultStorage = getDefaultVaultStorage(),
): VersionVaultDocument {
  try {
    const raw = storage.getItem(VERSION_VAULT_LEGACY_KEY)
    if (!raw) return emptyVault()
    const parsed = JSON.parse(raw) as VersionVaultDocument
    if (!parsed || parsed.schemaVersion !== VERSION_VAULT_SCHEMA) {
      return emptyVault()
    }
    if (!Array.isArray(parsed.snapshots)) return emptyVault()
    return {
      schemaVersion: VERSION_VAULT_SCHEMA,
      updatedAt: parsed.updatedAt || new Date().toISOString(),
      activeVersion:
        typeof parsed.activeVersion === 'number' ? parsed.activeVersion : null,
      snapshots: parsed.snapshots.map((s) => sanitizeVersionSnapshot(s)),
    }
  } catch {
    return emptyVault()
  }
}

/**
 * One-time migration: copy legacy global vault into a run-scoped key when
 * restoring a pre-scoped session that already had an active version.
 * Does NOT import legacy data into brand-new empty projects.
 */
export function migrateLegacyVaultIfNeeded(
  runId: string,
  opts: {
    storage?: VaultStorage
    /** Only migrate when the restored session already had an active version. */
    sessionHasActiveVersion: boolean
  },
): VersionVaultDocument {
  const storage = opts.storage ?? getDefaultVaultStorage()
  const scoped = loadVaultDocument(storage, runId)
  if (scoped.snapshots.length > 0) return scoped
  if (!opts.sessionHasActiveVersion) return scoped

  const legacy = loadLegacyVaultDocument(storage)
  if (!legacy.snapshots.length) return scoped

  const migrated = persistVaultDocument(
    { ...legacy, runId },
    storage,
    runId,
  )
  try {
    storage.removeItem?.(VERSION_VAULT_LEGACY_KEY)
  } catch {
    /* ignore */
  }
  return migrated
}

export function persistVaultDocument(
  doc: VersionVaultDocument,
  storage: VaultStorage = getDefaultVaultStorage(),
  runId?: string | null,
): VersionVaultDocument {
  const key = resolveVaultKey(runId ?? doc.runId)
  if (!key) {
    // Refuse writes without a run scope — never create phantom global v1.
    return emptyVault(undefined, runId)
  }
  const limited = enforceVaultLimits({
    ...doc,
    runId: runId || doc.runId,
    snapshots: doc.snapshots.map(sanitizeVersionSnapshot),
    updatedAt: new Date().toISOString(),
  })
  try {
    storage.setItem(key, JSON.stringify(limited))
  } catch {
    // Quota / missing storage — try aggressive eviction then one more write.
    let retry = limited
    while (retry.snapshots.length > 1) {
      retry = enforceVaultLimits(retry, {
        maxBytes: Math.floor(MAX_VAULT_BYTES * 0.5),
        maxSnapshots: Math.max(1, retry.snapshots.length - 1),
      })
      try {
        storage.setItem(key, JSON.stringify(retry))
        return retry
      } catch {
        /* continue evicting */
      }
    }
    // Give up silently — never crash the app.
  }
  return limited
}

export function listVersionSnapshots(
  storage: VaultStorage = getDefaultVaultStorage(),
  runId?: string | null,
): VersionSnapshot[] {
  return sortNewestFirst(loadVaultDocument(storage, runId).snapshots)
}

export function getVersionSnapshot(
  version: number,
  storage: VaultStorage = getDefaultVaultStorage(),
  runId?: string | null,
): VersionSnapshot | null {
  const found = loadVaultDocument(storage, runId).snapshots.find(
    (s) => s.version === version,
  )
  return found ? sanitizeVersionSnapshot(found) : null
}

export function getActiveVersion(
  storage: VaultStorage = getDefaultVaultStorage(),
  runId?: string | null,
): number | null {
  return loadVaultDocument(storage, runId).activeVersion
}

export function setActiveVersion(
  version: number | null,
  storage: VaultStorage = getDefaultVaultStorage(),
  runId?: string | null,
): VersionVaultDocument {
  const doc = loadVaultDocument(storage, runId)
  if (version != null && !doc.snapshots.some((s) => s.version === version)) {
    return persistVaultDocument(doc, storage, runId)
  }
  return persistVaultDocument({ ...doc, activeVersion: version }, storage, runId)
}

export function deleteVersionSnapshot(
  version: number,
  storage: VaultStorage = getDefaultVaultStorage(),
  runId?: string | null,
): VersionVaultDocument {
  const doc = loadVaultDocument(storage, runId)
  const snapshots = doc.snapshots.filter((s) => s.version !== version)
  const activeVersion =
    doc.activeVersion === version ? null : doc.activeVersion
  return persistVaultDocument({ ...doc, snapshots, activeVersion }, storage, runId)
}

/**
 * Upsert a snapshot by version id. Duplicate version replaces the previous body.
 * Requires runId — refuses to write the legacy global key.
 */
export function saveVersionSnapshot(
  snapshot: VersionSnapshot,
  storage: VaultStorage = getDefaultVaultStorage(),
  opts?: VaultWriteOpts,
): VersionVaultDocument {
  const runId = opts?.runId
  if (!runId) {
    return emptyVault()
  }
  const clean = sanitizeVersionSnapshot(snapshot)
  const doc = loadVaultDocument(storage, runId)
  const without = doc.snapshots.filter((s) => s.version !== clean.version)
  const next: VersionVaultDocument = {
    ...doc,
    runId,
    snapshots: [...without, clean],
    activeVersion:
      opts?.makeActive === false ? doc.activeVersion : clean.version,
  }
  return persistVaultDocument(next, storage, runId)
}

/** Clear all snapshots for a run (e.g. new project). */
export function clearVaultForRun(
  runId: string,
  storage: VaultStorage = getDefaultVaultStorage(),
): VersionVaultDocument {
  return persistVaultDocument(emptyVault(undefined, runId), storage, runId)
}

export type RestoreVersionResult = {
  snapshot: VersionSnapshot
  /** Project Brain with active pointer + metadata restored (still no source bodies). */
  brain: ProjectBrain
  fragment: DeepPartial<FragmentSchema> | FragmentSchema
  plan?: ApplicationPlan
  execution?: ExecutionResult
  /** True when a reusable preview URL/sbx was present in the snapshot. */
  hasStoredPreview: boolean
}

/**
 * Restore a vault snapshot into Project Brain + workspace payloads.
 * Does NOT call any provider. Does NOT delete other versions (branching-safe).
 */
export function restoreFromSnapshot(
  snapshot: VersionSnapshot,
  brain: ProjectBrain,
): RestoreVersionResult {
  const files = getFragmentFiles(snapshot.fragment)
  const runtimeStatus = (
    ['passed', 'partial', 'failed'] as VerificationStatus[]
  ).includes(snapshot.runtimeStatus as VerificationStatus)
    ? (snapshot.runtimeStatus as VerificationStatus)
    : brain.verification?.status

  const nextBrain = sanitizeProjectBrain({
    ...brain,
    updatedAt: new Date().toISOString(),
    plan: snapshot.plan || brain.plan,
    fileTree: files.map((f) => f.file_path).slice(0, 200),
    primaryFile:
      (typeof snapshot.fragment.file_path === 'string' &&
        snapshot.fragment.file_path) ||
      files[0]?.file_path ||
      brain.primaryFile,
    template:
      typeof snapshot.fragment.template === 'string'
        ? snapshot.fragment.template
        : brain.template,
    activeCandidateId: snapshot.activeCandidateId || brain.activeCandidateId,
    activeCandidateLabel:
      snapshot.activeCandidateLabel ||
      (snapshot.activeCandidateId
        ? VARIANTS.find((v) => v.id === snapshot.activeCandidateId)?.label
        : undefined) ||
      brain.activeCandidateLabel,
    currentWinnerId: snapshot.activeCandidateId || brain.currentWinnerId,
    currentWinnerLabel:
      snapshot.activeCandidateLabel || brain.currentWinnerLabel,
    /** Keep max version for branching (v4 after restore v2). */
    currentVersion: Math.max(brain.currentVersion || 0, snapshot.version),
    activeVersion: snapshot.version,
    verification: runtimeStatus
      ? {
          status: runtimeStatus,
          previewReachable: snapshot.previewReachable ?? false,
          errors: [],
          warnings: snapshot.execution?.url
            ? []
            : ['Restored locally — previous sandbox may have expired'],
          durationMs: brain.verification?.durationMs ?? 0,
        }
      : brain.verification,
    architectureCompliance: snapshot.architectureStatus
      ? {
          status: snapshot.architectureStatus as any,
          summary:
            snapshot.summary || brain.architectureCompliance?.summary || '',
        }
      : brain.architectureCompliance,
    smoke: snapshot.smokeStatus
      ? {
          status: snapshot.smokeStatus as any,
          summary: brain.smoke?.summary || snapshot.smokeStatus,
        }
      : brain.smoke,
  })

  let execution: ExecutionResult | undefined
  if (
    snapshot.execution?.sbxId &&
    snapshot.execution?.url &&
    snapshot.execution?.template
  ) {
    execution = {
      sbxId: snapshot.execution.sbxId,
      url: snapshot.execution.url,
      template: snapshot.execution.template,
    }
  }

  return {
    snapshot,
    brain: nextBrain,
    fragment: snapshot.fragment,
    plan: snapshot.plan,
    execution,
    hasStoredPreview: !!execution,
  }
}

export function restoreVersionSnapshot(
  version: number,
  brain: ProjectBrain,
  storage: VaultStorage = getDefaultVaultStorage(),
  runId?: string | null,
): RestoreVersionResult | null {
  const snapshot = getVersionSnapshot(version, storage, runId)
  if (!snapshot) return null

  setActiveVersion(version, storage, runId)
  return restoreFromSnapshot(snapshot, brain)
}

/** Build a snapshot from promoted workspace state (no network). */
export function buildVersionSnapshot(opts: {
  version: number
  parentVersion?: number
  label: string
  createdAt?: string
  userRequest?: string
  summary?: string
  fragment: DeepPartial<FragmentSchema> | FragmentSchema
  plan?: ApplicationPlan | null
  activeCandidateId?: VariantId
  compositeScore?: number
  runtimeStatus?: string
  smokeStatus?: string
  architectureStatus?: string
  previewReachable?: boolean
  execution?: ExecutionResult | null
}): VersionSnapshot {
  const label =
    opts.label ||
    (opts.activeCandidateId
      ? VARIANTS.find((v) => v.id === opts.activeCandidateId)?.label ||
        `v${opts.version}`
      : `v${opts.version}`)
  return sanitizeVersionSnapshot({
    version: opts.version,
    parentVersion: opts.parentVersion,
    createdAt: opts.createdAt || new Date().toISOString(),
    label,
    userRequest: opts.userRequest,
    summary: opts.summary,
    activeCandidateId: opts.activeCandidateId,
    activeCandidateLabel: opts.activeCandidateId
      ? VARIANTS.find((v) => v.id === opts.activeCandidateId)?.label
      : undefined,
    compositeScore: opts.compositeScore,
    runtimeStatus: opts.runtimeStatus,
    smokeStatus: opts.smokeStatus,
    architectureStatus: opts.architectureStatus,
    previewReachable: opts.previewReachable,
    fragment: opts.fragment,
    plan: opts.plan || undefined,
    execution:
      opts.execution && 'url' in opts.execution
        ? {
            sbxId: opts.execution.sbxId,
            url: (opts.execution as { url?: string }).url,
            template: opts.execution.template,
          }
        : opts.execution
          ? {
              sbxId: opts.execution.sbxId,
              template: opts.execution.template,
            }
          : undefined,
  })
}

/** Build a parent/child tree for compact UI (no graph editor). */
export function buildVersionTree(
  snapshots: VersionSnapshot[],
  activeVersion?: number | null,
): VersionTreeNode[] {
  const byParent = new Map<number | 'root', VersionSnapshot[]>()
  for (const s of snapshots) {
    const key =
      s.parentVersion == null || !snapshots.some((x) => x.version === s.parentVersion)
        ? 'root'
        : s.parentVersion
    const list = byParent.get(key) || []
    list.push(s)
    byParent.set(key, list)
  }

  const walk = (parentKey: number | 'root'): VersionTreeNode[] => {
    const kids = (byParent.get(parentKey) || []).sort(
      (a, b) => a.version - b.version,
    )
    return kids.map((s) => ({
      version: s.version,
      label: s.label,
      parentVersion: s.parentVersion,
      isActive: activeVersion === s.version,
      children: walk(s.version),
    }))
  }

  return walk('root')
}

/** Assert Project Brain still has no source bodies (test/helper). */
export function brainLooksMetadataOnly(brain: ProjectBrain): boolean {
  const raw = JSON.stringify(brain)
  if (/"file_content"\s*:/.test(raw)) return false
  if (/"code"\s*:\s*"/.test(raw)) return false
  return true
}

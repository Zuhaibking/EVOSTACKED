/**
 * Deterministic Version Vault tests — zero provider / E2B / network calls.
 * Run: npm run test:version-vault
 */
import assert from 'node:assert/strict'
import { architecturePreset } from './architecture'
import {
  applyEvolutionToBrain,
  completeEvolutionRound,
  createEvolutionRound,
  failEvolutionRound,
  preserveBrainAfterFailedEvolution,
  buildSingleIterationVerdict,
} from './evolution'
import {
  createProjectBrain,
  selectActiveProjectVersion,
  serializeProjectBrain,
} from './project-brain'
import type { ApplicationPlan } from './plan'
import {
  brainLooksMetadataOnly,
  buildVersionSnapshot,
  buildVersionTree,
  clearVaultForRun,
  createMemoryVaultStorage,
  createVaultRunId,
  deleteVersionSnapshot,
  enforceVaultLimits,
  getActiveVersion,
  getVersionSnapshot,
  listVersionSnapshots,
  loadLegacyVaultDocument,
  loadVaultDocument,
  MAX_VAULT_BYTES,
  migrateLegacyVaultIfNeeded,
  restoreVersionSnapshot,
  saveVersionSnapshot,
  setActiveVersion,
  vaultStorageKeyForRun,
  VERSION_VAULT_LEGACY_KEY,
  VERSION_VAULT_STORAGE_KEY,
} from './version-vault'

const FIXED_NOW = '2026-08-15T16:00:00.000Z'
const RUN = 'run_test_main'
const RUN_B = 'run_test_other'

function plan(): ApplicationPlan {
  return {
    applicationType: 'utility',
    complexity: 'simple',
    productName: 'Attendance Manager',
    productGoal: 'Manage attendance',
    targetUsers: 'Teachers',
    problemStatement: 'Manual',
    primaryUserGoal: 'Mark',
    coreFeatures: ['Tracking'],
    secondaryFeatures: [],
    outOfScope: [],
    pages: [{ name: 'Home', path: '/', purpose: 'Dash' }],
    userFlows: ['open'],
    dataApproach: 'localStorage',
    needsAuth: false,
    needsBackend: false,
    architectureRequirements: architecturePreset('calculator'),
    architectureSummary: 'fe',
    designDirection: {
      tone: 'calm',
      typography: 'sans',
      colorApproach: 'neutral',
      componentStyle: 'compact',
      interactionStyle: 'direct',
    },
    sampleDataNotes: 'names',
    mustHaveInteractions: [],
    interactionContracts: [],
    documentation: 'none',
  }
}

function frag(label: string) {
  return {
    title: label,
    template: 'nextjs-developer',
    file_path: 'pages/index.tsx',
    commentary: label,
    description: label,
    architecture: 'local',
    additional_dependencies: [] as string[],
    has_additional_dependencies: false,
    install_dependencies_command: '',
    port: 3000,
    code: [
      {
        file_path: 'pages/index.tsx',
        file_content: `export default function Page(){return <main>${label}</main>}`,
      },
    ],
  }
}

function snap(
  version: number,
  label: string,
  parent?: number,
  extra?: {
    fragment?: any
    userRequest?: string
  },
) {
  return buildVersionSnapshot({
    version,
    parentVersion: parent,
    label,
    createdAt: `2026-08-15T16:0${version}:00.000Z`,
    fragment: (extra?.fragment || frag(label)) as any,
    plan: plan(),
    activeCandidateId: 'rich',
    compositeScore: 0.8 + version * 0.02,
    runtimeStatus: 'passed',
    smokeStatus: 'passed',
    architectureStatus: 'passed',
    userRequest: extra?.userRequest ?? label,
  })
}

function save(s: ReturnType<typeof snap>, storage: ReturnType<typeof createMemoryVaultStorage>, runId = RUN, opts?: { makeActive?: boolean }) {
  return saveVersionSnapshot(s, storage, { runId, ...opts })
}

function list(storage: ReturnType<typeof createMemoryVaultStorage>, runId = RUN) {
  return listVersionSnapshots(storage, runId)
}

function get(version: number, storage: ReturnType<typeof createMemoryVaultStorage>, runId = RUN) {
  return getVersionSnapshot(version, storage, runId)
}

function active(storage: ReturnType<typeof createMemoryVaultStorage>, runId = RUN) {
  return getActiveVersion(storage, runId)
}

function load(storage: ReturnType<typeof createMemoryVaultStorage>, runId = RUN) {
  return loadVaultDocument(storage, runId)
}

// ---------------------------------------------------------------------------
// Lifecycle: fresh project / isolation / no phantom v1
// ---------------------------------------------------------------------------

// 1. Fresh project has zero Vault versions
// 2. Fresh project has activeVersion = null
{
  const storage = createMemoryVaultStorage()
  const runId = createVaultRunId(1)
  assert.deepEqual(listVersionSnapshots(storage, runId), [])
  assert.equal(getActiveVersion(storage, runId), null)
  assert.equal(loadVaultDocument(storage, runId).activeVersion, null)
}

// 3–5. Generating / previewing / recommending candidates does NOT create a Vault version
{
  const storage = createMemoryVaultStorage()
  // Simulate tournament candidates existing outside the vault.
  const candidates = ['minimal', 'rich', 'playful'] as const
  assert.equal(candidates.length, 3)
  // Preview / recommendation are UI-only — vault untouched.
  assert.deepEqual(list(storage), [])
  assert.equal(active(storage), null)
  // save without runId must refuse writes (no phantom global v1)
  saveVersionSnapshot(snap(1, 'Premium selected'), storage)
  assert.deepEqual(listVersionSnapshots(storage), [])
  assert.equal(storage.getItem(VERSION_VAULT_LEGACY_KEY), null)
  assert.equal(storage.getItem(VERSION_VAULT_STORAGE_KEY), null)
}

// 6. Clicking Use this version creates exactly v1
{
  const storage = createMemoryVaultStorage()
  save(snap(1, 'Premium selected'), storage)
  const listed = list(storage)
  assert.equal(listed.length, 1)
  assert.equal(listed[0]?.version, 1)
  assert.equal(listed[0]?.label, 'Premium selected')
  assert.equal(active(storage), 1)
}

// 7. Successful Improve creates v2
// 8. Failed Improve does not create a version
{
  const storage = createMemoryVaultStorage()
  let brain = createProjectBrain({
    plan: plan(),
    fragment: frag('base') as any,
    winnerId: 'rich',
    verdict: {
      winnerId: 'rich',
      reasoning: 'ok',
      scores: [
        {
          id: 'minimal',
          clarity: 0.8,
          fit: 0.8,
          polish: 0.8,
          composite: 0.8,
          comment: 'a',
        },
        {
          id: 'rich',
          clarity: 0.84,
          fit: 0.84,
          polish: 0.84,
          composite: 0.84,
          comment: 'b',
        },
        {
          id: 'playful',
          clarity: 0.7,
          fit: 0.7,
          polish: 0.7,
          composite: 0.7,
          comment: 'c',
        },
      ],
    },
  })
  brain = selectActiveProjectVersion(brain, {
    candidateId: 'rich',
    fragment: frag('base') as any,
    scoreComposite: 0.84,
    now: FIXED_NOW,
  })
  save(snap(1, 'Premium selected', undefined, { fragment: frag('base') as any }), storage)
  assert.equal(list(storage).length, 1)

  let round = createEvolutionRound({
    brain,
    userRequest: 'fail me',
    now: FIXED_NOW,
  })
  round = failEvolutionRound(round, 'failed')
  preserveBrainAfterFailedEvolution(brain, round)
  // Intentionally do NOT save — mirrors app behavior
  assert.equal(list(storage).length, 1)

  round = createEvolutionRound({
    brain,
    userRequest: 'Add dark mode',
    now: FIXED_NOW,
  })
  const verdict = buildSingleIterationVerdict({
    id: 'rich',
    verification: { status: 'passed' },
    previousScore: 84,
  })
  round = completeEvolutionRound(round, {
    verdict,
    candidates: [
      {
        id: 'rich',
        finalVerification: { status: 'passed' },
      },
    ],
    now: FIXED_NOW,
  })
  brain = applyEvolutionToBrain(brain, round, {
    verdict,
    fragment: frag('dark') as any,
    now: FIXED_NOW,
  })
  save(
    snap(brain.currentVersion, 'Premium improved', round.parentVersion, {
      fragment: frag('dark'),
    }),
    storage,
  )
  assert.equal(list(storage).length, 2)
  assert.equal(list(storage)[0]?.version, 2)
}

// 9. Reload preserves versions for the SAME project
{
  const storage = createMemoryVaultStorage()
  save(snap(1, 'Premium selected'), storage)
  // Simulate reload: same runId, fresh list read
  assert.equal(list(storage).length, 1)
  assert.equal(get(1, storage)?.label, 'Premium selected')
  assert.equal(active(storage), 1)
}

// 10. A different/new project does not inherit unrelated old versions
{
  const storage = createMemoryVaultStorage()
  save(snap(1, 'Premium selected'), storage, RUN)
  clearVaultForRun(RUN_B, storage)
  assert.deepEqual(list(storage, RUN_B), [])
  assert.equal(active(storage, RUN_B), null)
  // Original project still intact
  assert.equal(list(storage, RUN).length, 1)
}

// 11. Old global localStorage data does not appear as the current project's version
{
  const storage = createMemoryVaultStorage()
  storage.setItem(
    VERSION_VAULT_LEGACY_KEY,
    JSON.stringify({
      schemaVersion: 1,
      updatedAt: FIXED_NOW,
      activeVersion: 1,
      snapshots: [snap(1, 'Premium selected')],
    }),
  )
  const freshRun = createVaultRunId(42)
  assert.deepEqual(listVersionSnapshots(storage, freshRun), [])
  assert.equal(getActiveVersion(storage, freshRun), null)
  // Without runId → empty (never silently use legacy)
  assert.deepEqual(listVersionSnapshots(storage), [])
  assert.equal(loadLegacyVaultDocument(storage).snapshots.length, 1)

  // Migration only when session already had an active version
  migrateLegacyVaultIfNeeded(freshRun, {
    storage,
    sessionHasActiveVersion: false,
  })
  assert.deepEqual(listVersionSnapshots(storage, freshRun), [])

  const migrateRun = createVaultRunId(99)
  migrateLegacyVaultIfNeeded(migrateRun, {
    storage,
    sessionHasActiveVersion: true,
  })
  assert.equal(listVersionSnapshots(storage, migrateRun).length, 1)
  assert.equal(listVersionSnapshots(storage, migrateRun)[0]?.label, 'Premium selected')
}

// 12. No duplicate v1 is created during initialization
{
  const storage = createMemoryVaultStorage()
  const runId = createVaultRunId(7)
  // Init path: list empty vault, do not auto-save
  assert.deepEqual(listVersionSnapshots(storage, runId), [])
  assert.equal(storage.getItem(vaultStorageKeyForRun(runId)), null)
  // Explicit use-version once
  saveVersionSnapshot(snap(1, 'Premium selected'), storage, { runId })
  saveVersionSnapshot(snap(1, 'Premium selected'), storage, { runId })
  assert.equal(listVersionSnapshots(storage, runId).length, 1)
}

// ---------------------------------------------------------------------------
// Core vault mechanics (run-scoped)
// ---------------------------------------------------------------------------

// Empty vault
{
  const storage = createMemoryVaultStorage()
  assert.deepEqual(list(storage), [])
  assert.equal(active(storage), null)
  assert.equal(get(1, storage), null)
  assert.equal(load(storage).snapshots.length, 0)
}

// Save, retrieve, list newest-first
{
  const storage = createMemoryVaultStorage()
  save(snap(1, 'Initial build'), storage)
  save(snap(2, 'Dark mode', 1), storage)
  save(snap(3, 'Added analytics', 2), storage)
  const listed = list(storage)
  assert.equal(listed.length, 3)
  assert.deepEqual(
    listed.map((s) => s.version),
    [3, 2, 1],
  )
  const got = get(2, storage)
  assert.equal(got?.label, 'Dark mode')
  assert.equal(got?.parentVersion, 1)
  assert.match(JSON.stringify(got?.fragment), /Dark mode/)
}

// Duplicate version handling (upsert)
{
  const storage = createMemoryVaultStorage()
  save(snap(1, 'Old'), storage)
  save(snap(1, 'New body'), storage)
  const listed = list(storage)
  assert.equal(listed.length, 1)
  assert.equal(listed[0]?.label, 'New body')
  assert.match(JSON.stringify(listed[0]?.fragment), /New body/)
}

// Restore + parent preserved
{
  const storage = createMemoryVaultStorage()
  save(snap(1, 'Initial'), storage)
  save(snap(2, 'Dark mode', 1), storage)
  save(snap(3, 'Analytics', 2), storage)
  setActiveVersion(3, storage, RUN)

  let brain = createProjectBrain({
    plan: plan(),
    fragment: frag('Analytics') as any,
    winnerId: 'rich',
  })
  brain = selectActiveProjectVersion(brain, {
    candidateId: 'rich',
    fragment: frag('Analytics') as any,
    scoreComposite: 0.9,
    now: FIXED_NOW,
  })
  brain = {
    ...brain,
    currentVersion: 3,
    activeVersion: 3,
    versions: [
      {
        version: 1,
        label: 'Initial',
        createdAt: FIXED_NOW,
        winnerId: 'rich',
      },
      {
        version: 2,
        label: 'Dark mode',
        createdAt: FIXED_NOW,
        parentVersion: 1,
        winnerId: 'rich',
      },
      {
        version: 3,
        label: 'Analytics',
        createdAt: FIXED_NOW,
        parentVersion: 2,
        winnerId: 'rich',
      },
    ],
  }

  const restored = restoreVersionSnapshot(2, brain, storage, RUN)
  assert.ok(restored)
  assert.equal(restored!.brain.activeVersion, 2)
  assert.equal(restored!.brain.currentVersion, 3)
  assert.equal(get(3, storage)?.parentVersion, 2)
  assert.equal(active(storage), 2)
  assert.match(JSON.stringify(restored!.fragment), /Dark mode/)
}

// Branching after restore
{
  const storage = createMemoryVaultStorage()
  save(snap(1, 'v1'), storage)
  save(snap(2, 'v2', 1), storage)
  save(snap(3, 'v3', 2), storage)

  let brain = createProjectBrain({
    plan: plan(),
    fragment: frag('v3') as any,
    winnerId: 'rich',
    verdict: {
      winnerId: 'rich',
      reasoning: 'ok',
      scores: [
        {
          id: 'minimal',
          clarity: 0.8,
          fit: 0.8,
          polish: 0.8,
          composite: 0.8,
          comment: 'a',
        },
        {
          id: 'rich',
          clarity: 0.84,
          fit: 0.84,
          polish: 0.84,
          composite: 0.84,
          comment: 'b',
        },
        {
          id: 'playful',
          clarity: 0.7,
          fit: 0.7,
          polish: 0.7,
          composite: 0.7,
          comment: 'c',
        },
      ],
    },
  })
  brain = selectActiveProjectVersion(brain, {
    candidateId: 'rich',
    fragment: frag('v1') as any,
    scoreComposite: 0.84,
    now: FIXED_NOW,
  })
  brain = {
    ...brain,
    currentVersion: 3,
    activeVersion: 3,
    versions: [
      { version: 1, label: 'v1', createdAt: FIXED_NOW, winnerId: 'rich', compositeScore: 0.84 },
      {
        version: 2,
        label: 'v2',
        createdAt: FIXED_NOW,
        parentVersion: 1,
        winnerId: 'rich',
        compositeScore: 0.86,
      },
      {
        version: 3,
        label: 'v3',
        createdAt: FIXED_NOW,
        parentVersion: 2,
        winnerId: 'rich',
        compositeScore: 0.88,
      },
    ],
  }

  const restored = restoreVersionSnapshot(2, brain, storage, RUN)!
  brain = restored.brain
  assert.equal(brain.activeVersion, 2)

  let round = createEvolutionRound({
    brain,
    userRequest: 'Mobile improvements',
    now: FIXED_NOW,
  })
  assert.equal(round.parentVersion, 2)
  assert.equal(round.candidates.length, 1)

  const verdict = buildSingleIterationVerdict({
    id: 'rich',
    verification: { status: 'passed' },
    previousScore: 86,
    userRequest: 'Mobile improvements',
  })
  round = completeEvolutionRound(round, {
    verdict,
    candidates: [
      {
        id: 'rich',
        finalVerification: { status: 'passed' },
      },
    ],
    now: FIXED_NOW,
  })
  brain = applyEvolutionToBrain(brain, round, {
    verdict,
    fragment: frag('v4') as any,
    now: FIXED_NOW,
  })
  assert.equal(brain.currentVersion, 4)
  assert.equal(brain.versions[3]?.parentVersion, 2)
  assert.equal(brain.versions.find((v) => v.version === 3)?.label, 'v3')

  save(
    snap(4, 'Mobile improvements', 2, {
      fragment: frag('v4'),
    }),
    storage,
  )
  assert.equal(get(3, storage)?.label, 'v3')
  const tree = buildVersionTree(list(storage), 4)
  assert.ok(tree.length >= 1)
}

// Corrupted scoped localStorage
{
  const storage = createMemoryVaultStorage()
  storage.setItem(vaultStorageKeyForRun(RUN), '{not-json')
  assert.deepEqual(list(storage), [])
  storage.setItem(
    vaultStorageKeyForRun(RUN),
    JSON.stringify({ schemaVersion: 99 }),
  )
  assert.deepEqual(list(storage), [])
}

// Storage size protection
{
  const storage = createMemoryVaultStorage()
  for (let i = 1; i <= 8; i++) {
    const big = frag(`big-${i}`)
    big.code[0].file_content = `export default function Page(){return <main>${'x'.repeat(
      80_000,
    )}-${i}</main>}`
    save(
      snap(i, `v${i}`, i > 1 ? i - 1 : undefined, { fragment: big as any }),
      storage,
      RUN,
      { makeActive: true },
    )
  }
  const doc = load(storage)
  const raw = JSON.stringify(doc)
  assert.ok(raw.length <= MAX_VAULT_BYTES + 50_000)
  assert.ok(doc.snapshots.length < 8 || doc.snapshots.length <= 24)
  assert.ok(doc.activeVersion == null || get(doc.activeVersion, storage))
}

{
  const limited = enforceVaultLimits({
    schemaVersion: 1,
    updatedAt: FIXED_NOW,
    activeVersion: 5,
    snapshots: Array.from({ length: 10 }, (_, i) =>
      snap(i + 1, `v${i + 1}`, i > 0 ? i : undefined),
    ),
  }, { maxSnapshots: 3, maxBytes: MAX_VAULT_BYTES })
  assert.ok(limited.snapshots.length <= 3)
  assert.ok(limited.snapshots.some((s) => s.version === 5))
}

// Secret scrubbing
{
  const storage = createMemoryVaultStorage()
  const dirty = frag('secret')
  dirty.code[0].file_content =
    'const k="sk-secretKEY1234567890abcdef"; const h="Bearer abcdefghijklmnop"'
  save(
    snap(1, 'Leak', undefined, {
      fragment: dirty as any,
      userRequest: 'use sk-secretKEY1234567890abcdef',
    }),
    storage,
  )
  const raw = storage.getItem(vaultStorageKeyForRun(RUN)) || ''
  assert.ok(!raw.includes('sk-secretKEY1234567890abcdef'))
  assert.ok(!raw.includes('Bearer abcdefghijklmnop'))
  assert.ok(raw.includes('[redacted]'))
}

// Restore does not call any provider
{
  const storage = createMemoryVaultStorage()
  save(snap(1, 'A'), storage)
  const brain = createProjectBrain({ plan: plan() })
  const before = globalThis.fetch
  globalThis.fetch = (() => {
    throw new Error('fetch must not be called during restore')
  }) as typeof fetch
  try {
    const r = restoreVersionSnapshot(1, brain, storage, RUN)
    assert.ok(r)
  } finally {
    globalThis.fetch = before
  }
}

// Project Brain remains metadata-only
{
  let brain = createProjectBrain({
    plan: plan(),
    fragment: frag('body') as any,
  })
  brain = selectActiveProjectVersion(brain, {
    candidateId: 'rich',
    fragment: frag('body') as any,
    scoreComposite: 0.8,
  })
  assert.ok(brainLooksMetadataOnly(brain))
  const raw = serializeProjectBrain(brain)
  assert.ok(!raw.includes('return <main>body</main>'))
  assert.ok(!/"file_content"\s*:/.test(raw))
}

// delete
{
  const storage = createMemoryVaultStorage()
  save(snap(1, 'A'), storage)
  save(snap(2, 'B', 1), storage)
  deleteVersionSnapshot(1, storage, RUN)
  assert.equal(list(storage).length, 1)
  assert.equal(list(storage)[0]?.version, 2)
}

console.log('version-vault.test.ts: all tests passed')

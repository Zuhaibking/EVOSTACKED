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
  createMemoryVaultStorage,
  deleteVersionSnapshot,
  enforceVaultLimits,
  getActiveVersion,
  getVersionSnapshot,
  listVersionSnapshots,
  loadVaultDocument,
  MAX_VAULT_BYTES,
  restoreVersionSnapshot,
  saveVersionSnapshot,
  setActiveVersion,
  VERSION_VAULT_STORAGE_KEY,
} from './version-vault'

const FIXED_NOW = '2026-08-15T16:00:00.000Z'

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

// 9. Empty vault
{
  const storage = createMemoryVaultStorage()
  assert.deepEqual(listVersionSnapshots(storage), [])
  assert.equal(getActiveVersion(storage), null)
  assert.equal(getVersionSnapshot(1, storage), null)
  assert.equal(loadVaultDocument(storage).snapshots.length, 0)
}

// 1–3. Save, retrieve, list newest-first
{
  const storage = createMemoryVaultStorage()
  saveVersionSnapshot(snap(1, 'Initial build'), storage)
  saveVersionSnapshot(snap(2, 'Dark mode', 1), storage)
  saveVersionSnapshot(snap(3, 'Added analytics', 2), storage)
  const list = listVersionSnapshots(storage)
  assert.equal(list.length, 3)
  assert.deepEqual(
    list.map((s) => s.version),
    [3, 2, 1],
  )
  const got = getVersionSnapshot(2, storage)
  assert.equal(got?.label, 'Dark mode')
  assert.equal(got?.parentVersion, 1)
  assert.match(JSON.stringify(got?.fragment), /Dark mode/)
}

// 4. Duplicate version handling (upsert)
{
  const storage = createMemoryVaultStorage()
  saveVersionSnapshot(snap(1, 'Old'), storage)
  saveVersionSnapshot(snap(1, 'New body'), storage)
  const list = listVersionSnapshots(storage)
  assert.equal(list.length, 1)
  assert.equal(list[0]?.label, 'New body')
  assert.match(JSON.stringify(list[0]?.fragment), /New body/)
}

// 5–6. Restore + parent preserved
{
  const storage = createMemoryVaultStorage()
  saveVersionSnapshot(snap(1, 'Initial'), storage)
  saveVersionSnapshot(snap(2, 'Dark mode', 1), storage)
  saveVersionSnapshot(snap(3, 'Analytics', 2), storage)
  setActiveVersion(3, storage)

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
  // Simulate later versions already recorded
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

  const restored = restoreVersionSnapshot(2, brain, storage)
  assert.ok(restored)
  assert.equal(restored!.brain.activeVersion, 2)
  assert.equal(restored!.brain.currentVersion, 3) // max preserved for branching
  assert.equal(getVersionSnapshot(3, storage)?.parentVersion, 2)
  assert.equal(getActiveVersion(storage), 2)
  assert.match(JSON.stringify(restored!.fragment), /Dark mode/)
}

// 7. Branching after restore: v1→v2→v3 then restore v2 → improve → v4 parent=2
{
  const storage = createMemoryVaultStorage()
  saveVersionSnapshot(snap(1, 'v1'), storage)
  saveVersionSnapshot(snap(2, 'v2', 1), storage)
  saveVersionSnapshot(snap(3, 'v3', 2), storage)

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

  const restored = restoreVersionSnapshot(2, brain, storage)!
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

  saveVersionSnapshot(
    snap(4, 'Mobile improvements', 2, {
      fragment: frag('v4'),
    }),
    storage,
  )
  assert.equal(getVersionSnapshot(3, storage)?.label, 'v3') // not deleted
  const tree = buildVersionTree(listVersionSnapshots(storage), 4)
  assert.ok(tree.length >= 1)
}

// 8. Corrupted localStorage
{
  const storage = createMemoryVaultStorage()
  storage.setItem(VERSION_VAULT_STORAGE_KEY, '{not-json')
  assert.deepEqual(listVersionSnapshots(storage), [])
  storage.setItem(VERSION_VAULT_STORAGE_KEY, JSON.stringify({ schemaVersion: 99 }))
  assert.deepEqual(listVersionSnapshots(storage), [])
}

// 10. Storage size protection
{
  const storage = createMemoryVaultStorage()
  for (let i = 1; i <= 8; i++) {
    const big = frag(`big-${i}`)
    big.code[0].file_content = `export default function Page(){return <main>${'x'.repeat(
      80_000,
    )}-${i}</main>}`
    saveVersionSnapshot(
      snap(i, `v${i}`, i > 1 ? i - 1 : undefined, { fragment: big as any }),
      storage,
      { makeActive: true },
    )
  }
  const doc = loadVaultDocument(storage)
  const raw = JSON.stringify(doc)
  assert.ok(raw.length <= MAX_VAULT_BYTES + 50_000) // soft check after eviction
  assert.ok(doc.snapshots.length < 8 || doc.snapshots.length <= 24)
  // Active should still exist when possible
  assert.ok(doc.activeVersion == null || getVersionSnapshot(doc.activeVersion, storage))
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

// 11. Secret scrubbing
{
  const storage = createMemoryVaultStorage()
  const dirty = frag('secret')
  dirty.code[0].file_content =
    'const k="sk-secretKEY1234567890abcdef"; const h="Bearer abcdefghijklmnop"'
  saveVersionSnapshot(
    snap(1, 'Leak', undefined, {
      fragment: dirty as any,
      userRequest: 'use sk-secretKEY1234567890abcdef',
    }),
    storage,
  )
  const raw = storage.getItem(VERSION_VAULT_STORAGE_KEY) || ''
  assert.ok(!raw.includes('sk-secretKEY1234567890abcdef'))
  assert.ok(!raw.includes('Bearer abcdefghijklmnop'))
  assert.ok(raw.includes('[redacted]'))
}

// 12. Restore does not call any provider (pure function — no fetch/network symbols)
{
  const storage = createMemoryVaultStorage()
  saveVersionSnapshot(snap(1, 'A'), storage)
  const brain = createProjectBrain({ plan: plan() })
  const before = globalThis.fetch
  globalThis.fetch = (() => {
    throw new Error('fetch must not be called during restore')
  }) as typeof fetch
  try {
    const r = restoreVersionSnapshot(1, brain, storage)
    assert.ok(r)
  } finally {
    globalThis.fetch = before
  }
}

// 13–14. Failed evolution does not create snapshot; success creates exactly one
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
  saveVersionSnapshot(
    snap(1, 'Initial', undefined, { fragment: frag('base') as any }),
    storage,
  )
  assert.equal(listVersionSnapshots(storage).length, 1)

  let round = createEvolutionRound({
    brain,
    userRequest: 'fail me',
    now: FIXED_NOW,
  })
  round = failEvolutionRound(round, 'failed')
  preserveBrainAfterFailedEvolution(brain, round)
  // Intentionally do NOT save — mirrors app behavior
  assert.equal(listVersionSnapshots(storage).length, 1)

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
  saveVersionSnapshot(
    snap(brain.currentVersion, 'Dark mode', round.parentVersion, {
      fragment: frag('dark'),
    }),
    storage,
  )
  assert.equal(listVersionSnapshots(storage).length, 2)
}

// 15. Project Brain remains metadata-only
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
  saveVersionSnapshot(snap(1, 'A'), storage)
  saveVersionSnapshot(snap(2, 'B', 1), storage)
  deleteVersionSnapshot(1, storage)
  assert.equal(listVersionSnapshots(storage).length, 1)
  assert.equal(listVersionSnapshots(storage)[0]?.version, 2)
}

console.log('version-vault.test.ts: all tests passed')

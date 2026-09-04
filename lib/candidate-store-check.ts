import assert from 'node:assert/strict'
import {
  loadCandidateSnapshot,
  mergeFiles,
  mainsChanged,
  projectRequiresDataLayer,
  resolveSandboxFiles,
  saveCandidateSnapshot,
} from './candidate-store'

const index = { file_path: 'pages/index.tsx', file_content: 'export default function A(){return 1}' }
const edited = { file_path: 'pages/index.tsx', file_content: 'export default function A(){return 2}' }
const extra = { file_path: 'data/data.ts', file_content: 'export default []' }

assert.equal(mainsChanged([edited], [index]), true)
assert.equal(mainsChanged([index], [index]), false)

const first = resolveSandboxFiles([index], null)
assert.equal(first.rehydrated, false)
assert.equal(first.persist, true)
assert.equal(first.files[0].file_content, index.file_content)

const restart = resolveSandboxFiles([index], [index, extra])
assert.equal(restart.rehydrated, true)
assert.equal(restart.persist, false)
assert.equal(restart.files.length, 2)
assert.ok(restart.files.some((f) => f.file_path === 'data/data.ts'))

const edit = resolveSandboxFiles([edited], [index, extra])
assert.equal(edit.rehydrated, false)
assert.equal(edit.persist, true)
assert.equal(edit.files.find((f) => f.file_path === 'pages/index.tsx')?.file_content, edited.file_content)
assert.ok(edit.files.some((f) => f.file_path === 'data/data.ts'))

const emptyIncoming = resolveSandboxFiles([], [index, extra])
assert.equal(emptyIncoming.rehydrated, true)
assert.equal(emptyIncoming.files.length, 2)

assert.equal(mergeFiles([index], [edited])[0].file_content, edited.file_content)

async function restartCycle() {
  const projectId = 'check-persist'
  const candidateId = 'editorial'
  await saveCandidateSnapshot({
    projectId,
    candidateId,
    runId: 'run-1',
    files: [edited, extra],
    label: 'user edit',
    requires_data_layer: true,
  })
  const loaded = await loadCandidateSnapshot(projectId, candidateId)
  assert.ok(loaded)
  assert.match(loaded.files.find((f) => f.file_path === 'pages/index.tsx')!.file_content, /return 2/)
  assert.ok(loaded.versions.length >= 1)
  assert.equal(loaded.requires_data_layer, true)
  assert.equal(await projectRequiresDataLayer(projectId), true)

  // sandbox expired — incoming is the last known main file; extras must come back
  const afterKill = resolveSandboxFiles([edited], loaded.files)
  assert.equal(afterKill.rehydrated, true)
  assert.ok(afterKill.files.some((f) => f.file_path === 'data/data.ts'))
  assert.match(
    afterKill.files.find((f) => f.file_path === 'pages/index.tsx')!.file_content,
    /return 2/,
  )
}

restartCycle()
  .then(() => {
    console.log('candidate-store-check ok')
  })
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })

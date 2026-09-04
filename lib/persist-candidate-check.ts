import assert from 'node:assert/strict'
import { persistCandidateFiles } from './persist-candidate'
import { loadCandidateSnapshot } from './candidate-store'
import { loadProjectMeta, setActiveCandidate } from './project-meta'

async function main() {
  const projectId = 'check-lifecycle'
  const fragment = {
    title: 'Gym Club',
    file_path: 'pages/index.tsx',
    template: 'nextjs-developer',
    code: 'export default function Page(){return <form><input name="email" /></form>}',
  }

  const a = await persistCandidateFiles({
    projectId,
    candidateId: 'minimal',
    runId: projectId,
    fragment,
    label: 'Minimalist',
    score: 0.8,
  })
  const b = await persistCandidateFiles({
    projectId,
    candidateId: 'rich',
    runId: projectId,
    fragment: { ...fragment, title: 'Gym Membership' },
    label: 'Editorial',
    score: 0.95,
    isWinner: true,
  })
  assert.ok(a.files.length >= 1)
  assert.ok(b.requires_data_layer)

  const again = await persistCandidateFiles({
    projectId,
    candidateId: 'minimal',
    runId: projectId,
    fragment,
    label: 'Minimalist',
    score: 0.8,
  })
  assert.equal(again.versions[0]?.id, a.versions[0]?.id)

  const used = await setActiveCandidate({
    projectId,
    activeCandidateId: 'rich',
    activeVersionId: b.versions[0]?.id,
  })
  assert.equal(used.activeCandidateId, 'rich')
  assert.equal(used.candidates?.rich?.status, 'active')
  assert.equal(used.candidates?.minimal?.status, 'resting')

  const switched = await setActiveCandidate({
    projectId,
    activeCandidateId: 'minimal',
  })
  assert.equal(switched.activeCandidateId, 'minimal')
  assert.equal(switched.candidates?.rich?.status, 'resting')
  assert.equal(switched.candidates?.minimal?.status, 'active')

  const snap = await loadCandidateSnapshot(projectId, 'rich')
  assert.ok(snap?.files.some((f) => f.file_path.includes('evostack-capture')))
  const meta = await loadProjectMeta(projectId)
  assert.ok(meta)

  console.log('persist-candidate-check ok')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

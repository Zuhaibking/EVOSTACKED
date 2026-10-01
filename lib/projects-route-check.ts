import assert from 'node:assert/strict'
import type { Candidate } from './tournament-client'
import { createProject, getActive, getProjectById, projectIdFromPath, projectPath, prepareProjectForOpen, type ProjectStore } from './projects'

const project = createProject()
const legacy = { ...createProject(), id: 'p_m1abc_123xyz' }
const store: ProjectStore = { version: 1, activeId: project.id, projects: { [project.id]: project, [legacy.id]: legacy } }
for (const saved of [project, legacy]) {
  const path = projectPath(saved.id)
  assert.equal(projectIdFromPath(path), saved.id)
  assert.equal(projectIdFromPath(`${path}/`), saved.id)
  assert.equal(getProjectById(store, projectIdFromPath(path)!), saved)
}
assert.equal(getActive(store), project)
assert.equal(projectIdFromPath('/app'), null)
assert.equal(projectIdFromPath('/app/'), null)
assert.equal(projectIdFromPath('/app/%70_m1abc_123xyz'), legacy.id)
for (const path of ['/app/%', '/app/%2F', '/app/%2e%2e', '/app/%5c', '/app/a/b', '/app/with%20space', '/app/' + 'a'.repeat(129)]) assert.equal(projectIdFromPath(path), null)
assert.equal(getProjectById(store, 'missing-project'), undefined)
assert.equal(getProjectById(store, '__proto__'), undefined)
assert.equal(getProjectById(store, 'constructor'), undefined)
for (const id of ['', '../app', 'a/b', 'with space']) assert.throws(() => projectPath(id), /Invalid project ID/)
const health = { state: 'VERIFIED', buildStatus: 'passed', runtimeStatus: 'passed', dependencyStatus: 'passed', repairAttempts: 0, repaired: false, verified: true, log: [] } as const
const preview = (id: string) => ({ template: 'nextjs-developer', sbxId: id, url: `https://${id}.e2b.app` })
const candidate = (id: 'minimal' | 'rich' | 'playful') => ({
  id, label: id, sigil: id[0], status: 'done' as const, fragment: { code: `${id} original source` },
  sandboxStatus: 'ready' as const, sandboxError: 'stale failure', result: preview(id), health: { ...health, log: [] },
  recoveryFragment: { code: `${id} recovery source` },
})
const candidates = { minimal: candidate('minimal'), rich: candidate('rich'), playful: candidate('playful') }
const editedSource = { code: 'inspector edited source', title: 'Restored version' }
const saved = {
  ...createProject(), selectedCandidate: 'rich' as const, fragment: editedSource, result: preview('selected-edited'),
  messages: [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'Keep my saved work' }] }],
  versions: [{ id: 'version-1', createdAt: 1, label: 'Saved edit', fragment: editedSource }],
  chatInput: 'Unsaved next instruction', tournament: { phase: 'done' as const, candidates },
}
const opened = prepareProjectForOpen(saved)
assert.equal(opened.fragment, editedSource)
assert.equal(opened.messages, saved.messages)
assert.equal(opened.versions, saved.versions)
assert.equal(opened.chatInput, saved.chatInput)
assert.equal(opened.tournament.candidates?.rich.fragment, editedSource)
assert.equal(opened.tournament.candidates?.rich.result, saved.result)
for (const id of ['minimal', 'rich', 'playful'] as const) {
  const restored: Candidate = opened.tournament.candidates![id]
  assert.equal(restored.sandboxStatus, undefined)
  assert.equal(restored.sandboxError, undefined)
  assert.equal(restored.health, candidates[id].health)
  assert.equal((restored as ReturnType<typeof candidate>).recoveryFragment, candidates[id].recoveryFragment)
  if (id !== 'rich') assert.equal(restored.result, candidates[id].result)
  assert.equal(candidates[id].sandboxStatus, 'ready', 'opening must not mutate the persisted record')
}
const inferred = prepareProjectForOpen({ ...saved, selectedCandidate: undefined, fragment: candidates.minimal.fragment })
assert.equal(inferred.selectedCandidate, 'minimal')
assert.equal(prepareProjectForOpen({ ...saved, selectedCandidate: undefined }).selectedCandidate, undefined)
const starting = prepareProjectForOpen({ ...saved, tournament: { ...saved.tournament, candidates: { ...candidates, playful: { ...candidates.playful, result: undefined, sandboxStatus: 'starting' } } } })
assert.equal(starting.tournament.candidates?.playful.sandboxStatus, undefined)
assert.equal(prepareProjectForOpen(project), project)
assert.equal(getProjectById(store, 'missing-project'), undefined)
const sameEntry = { code: 'import Hero from "../components/Hero"; export default Hero', file_path: 'pages/index.tsx', template: 'nextjs-developer' }
const multiCandidates = {
  ...candidates,
  minimal: { ...candidates.minimal, fragment: { ...sameEntry, files: [{ file_path: 'components/Hero.tsx', file_content: 'export default function Hero() { return <h1>First</h1> }' }] } },
  rich: { ...candidates.rich, fragment: { ...sameEntry, files: [{ file_path: 'components/Hero.tsx', file_content: 'export default function Hero() { return <h1>Second</h1> }' }] } },
}
const openedMulti = prepareProjectForOpen({ ...saved, selectedCandidate: undefined, fragment: multiCandidates.rich.fragment, tournament: { phase: 'done', candidates: multiCandidates } })
assert.equal(openedMulti.selectedCandidate, 'rich', 'The complete project source must identify the saved design, not its shared entry file')
assert.equal(openedMulti.tournament.candidates?.rich.fragment?.files?.[0]?.file_content, multiCandidates.rich.fragment.files[0].file_content)
console.log('projects-route-check ok: URL routing and saved workspace preparation')

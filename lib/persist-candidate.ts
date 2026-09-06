import { withCaptureLayer } from './capture-layer'
import { saveCandidateSnapshot, CandidateSnapshot } from './candidate-store'
import { detectDataCollection } from './detect-data-collection'
import { fragmentFiles, withMissingLocalModules } from './fragment-files'
import { replaceBrokenRemoteImagesInFiles } from './images-validate'
import { repairGeneratedFiles } from './repair-fragment'
import { saveProjectMeta, type ProjectCandidateMeta } from './project-meta'
import { FragmentSchema } from './schema'
import { DeepPartial } from 'ai'

/** Persist a candidate file tree with no sandbox. Sandbox is compute only. */
export async function persistCandidateFiles(args: {
  projectId: string
  candidateId: string
  runId?: string
  fragment: DeepPartial<FragmentSchema>
  label?: string
  score?: number
  isWinner?: boolean
}): Promise<CandidateSnapshot> {
  let files = repairGeneratedFiles(withMissingLocalModules(fragmentFiles(args.fragment)))
  try {
    files = await replaceBrokenRemoteImagesInFiles(files)
  } catch {
    /* keep generated files if validation cannot run */
  }
  const requiresDataLayer = detectDataCollection(files)
  if (requiresDataLayer) {
    files = withCaptureLayer(files, {
      projectId: args.projectId,
      candidateId: args.candidateId,
      runId: args.runId || args.projectId,
    })
  }
  const snap = await saveCandidateSnapshot({
    projectId: args.projectId,
    candidateId: args.candidateId,
    runId: args.runId,
    template: typeof args.fragment.template === 'string' ? args.fragment.template : undefined,
    files,
    label: args.label || args.fragment.title || args.fragment.file_path,
    requires_data_layer: requiresDataLayer,
  })
  const meta: ProjectCandidateMeta = {
    id: args.candidateId,
    label: args.label,
    title: typeof args.fragment.title === 'string' ? args.fragment.title : undefined,
    status: 'resting',
    score: args.score,
    isWinner: args.isWinner,
    latestVersionId: snap.versions[0]?.id,
    requires_data_layer: requiresDataLayer,
    template: snap.template,
  }
  const prev = await saveProjectMeta({
    projectId: args.projectId,
    runId: args.runId || args.projectId,
    candidates: { [args.candidateId]: meta },
  })
  if (prev.activeCandidateId === args.candidateId) {
    await saveProjectMeta({
      projectId: args.projectId,
      activeVersionId: snap.versions[0]?.id,
      candidates: {
        [args.candidateId]: { ...meta, status: 'active' },
      },
    })
  }
  return snap
}

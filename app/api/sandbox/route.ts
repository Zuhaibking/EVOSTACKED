import { withCaptureLayer } from '@/lib/capture-layer'
import { detectDataCollection } from '@/lib/detect-data-collection'
import { injectInspectBridge } from '@/lib/inspect-bridge'
import {
  loadCandidateSnapshot,
  resolveSandboxFiles,
  saveCandidateSnapshot,
} from '@/lib/candidate-store'
import { touchProjectMeta } from '@/lib/project-meta'
import {
  fragmentFiles,
  withMissingLocalModules,
  WrittenFile,
} from '@/lib/fragment-files'
import { FragmentSchema } from '@/lib/schema'
import {
  isStaticHtml,
  resolveSandboxPort,
  resolveSandboxTemplate,
} from '@/lib/templates'
import { ExecutionResultInterpreter, ExecutionResultWeb } from '@/lib/types'
import { Sandbox } from '@e2b/code-interpreter'

const sandboxTimeout = 10 * 60 * 1000 // 10 minute in ms

export const maxDuration = 60

async function connectExisting(
  sbxId: string | undefined,
  teamID: string | undefined,
  accessToken: string | undefined,
) {
  if (!sbxId) return null
  try {
    return await Sandbox.connect(sbxId, {
      ...(teamID && accessToken
        ? {
            headers: {
              'X-Supabase-Team': teamID,
              'X-Supabase-Token': accessToken,
            },
          }
        : {}),
    })
  } catch {
    return null
  }
}

async function writeTree(sbx: Sandbox, files: WrittenFile[]) {
  for (const file of files) {
    await sbx.files.write(file.file_path, file.file_content)
    console.log(`Copied file to ${file.file_path} in ${sbx.sandboxId}`)
  }
}

function mountStaticHtml(files: WrittenFile[]): WrittenFile[] {
  const html =
    files.find((f) => /\.html?$/i.test(f.file_path))?.file_content ||
    files[0]?.file_content ||
    ''
  const iframe = `export default function Page() {
  return (
    <iframe
      src="/generated.html"
      title="preview"
      style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', border: 'none' }}
    />
  )
}
`
  const map = new Map(files.map((f) => [f.file_path, f]))
  map.set('public/generated.html', {
    file_path: 'public/generated.html',
    file_content: html,
  })
  map.set('pages/index.tsx', {
    file_path: 'pages/index.tsx',
    file_content: iframe,
  })
  return [...map.values()]
}

export async function POST(req: Request) {
  const {
    fragment,
    userID,
    teamID,
    accessToken,
    projectId,
    candidateId,
    runId,
    sbxId,
    rehydrateOnly,
  }: {
    fragment: FragmentSchema
    userID: string | undefined
    teamID: string | undefined
    accessToken: string | undefined
    projectId?: string
    candidateId?: string
    runId?: string
    sbxId?: string
    rehydrateOnly?: boolean
  } = await req.json()
  console.log('fragment', fragment)
  console.log('userID', userID)

  if (projectId && userID) {
    void touchProjectMeta({ projectId, ownerId: userID }).catch(() => {})
  }

  const sandboxTemplate = resolveSandboxTemplate(
    fragment.template,
    fragment.file_path,
  )

  const incoming = rehydrateOnly ? [] : fragmentFiles(fragment)
  const snap = await loadCandidateSnapshot(projectId, candidateId)
  if (rehydrateOnly && !snap?.files?.length) {
    return new Response(JSON.stringify({ error: 'No persisted files to rehydrate' }), {
      status: 400,
    })
  }
  const resolved = resolveSandboxFiles(incoming, snap?.files ?? null)

  let files = resolved.files
  if (!resolved.rehydrated) {
    files = withMissingLocalModules(files)
    if (sandboxTemplate !== 'code-interpreter-v1' && isStaticHtml(fragment)) {
      files = mountStaticHtml(files)
    }
  }

  const hadCapture = files.some((f) => f.file_path.includes('evostack-capture'))
  const requiresDataLayer =
    sandboxTemplate !== 'code-interpreter-v1' && detectDataCollection(files)
  if (requiresDataLayer && projectId && candidateId) {
    files = withCaptureLayer(files, {
      projectId,
      candidateId,
      runId: runId || projectId,
    })
  }

  let sbx = await connectExisting(sbxId, teamID, accessToken)
  const reused = Boolean(sbx)

  if (!sbx) {
    sbx = await Sandbox.create(sandboxTemplate, {
      metadata: {
        template: sandboxTemplate,
        userID: userID ?? '',
        teamID: teamID ?? '',
        projectId: projectId ?? '',
        candidateId: candidateId ?? '',
      },
      timeoutMs: sandboxTimeout,
      ...(teamID && accessToken
        ? {
            headers: {
              'X-Supabase-Team': teamID,
              'X-Supabase-Token': accessToken,
            },
          }
        : {}),
    })
  }

  if (fragment.has_additional_dependencies && !reused) {
    await sbx.commands.run(fragment.install_dependencies_command)
    console.log(
      `Installed dependencies: ${fragment.additional_dependencies.join(', ')} in sandbox ${sbx.sandboxId}`,
    )
  }

  // Always write on a fresh box (rehydrate or first run). On a live box, write only when files changed.
  if (!reused || !resolved.rehydrated || (requiresDataLayer && !hadCapture)) {
    await writeTree(sbx, files)
  }

  const captureAdded = requiresDataLayer && !hadCapture
  if (
    resolved.persist ||
    !snap ||
    snap.requires_data_layer !== requiresDataLayer ||
    captureAdded
  ) {
    if (projectId && candidateId) {
      await saveCandidateSnapshot({
        projectId,
        candidateId,
        runId,
        template: sandboxTemplate,
        files,
        label: fragment.title || fragment.file_path,
        requires_data_layer: requiresDataLayer,
      })
    }
  }

  if (sandboxTemplate !== 'code-interpreter-v1') {
    try {
      await injectInspectBridge(sbx)
    } catch (e) {
      console.warn('inspect bridge inject failed', e)
    }
  }

  if (sandboxTemplate === 'code-interpreter-v1') {
    const { logs, error, results } = await sbx.runCode(
      files[0]?.file_content || fragment.code || '',
    )

    return new Response(
      JSON.stringify({
        sbxId: sbx?.sandboxId,
        template: sandboxTemplate,
        stdout: logs.stdout,
        stderr: logs.stderr,
        runtimeError: error,
        cellResults: results,
        rehydrated: resolved.rehydrated,
      } as ExecutionResultInterpreter & { rehydrated: boolean }),
    )
  }

  return new Response(
    JSON.stringify({
      sbxId: sbx?.sandboxId,
      template: sandboxTemplate,
      url: `https://${sbx?.getHost(resolveSandboxPort(sandboxTemplate))}`,
      rehydrated: resolved.rehydrated,
    } as ExecutionResultWeb & { rehydrated: boolean }),
  )
}

import { withCaptureLayer } from '@/lib/capture-layer'
import { detectDataCollection } from '@/lib/detect-data-collection'
import { appendGenerationLog } from '@/lib/generation-log'
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
import { replaceBrokenRemoteImagesInFiles } from '@/lib/images-validate'
import { parseNextError, repairGeneratedFiles } from '@/lib/repair-fragment'
import { safeInstallCommand } from '@/lib/safe-install'
import { FragmentSchema } from '@/lib/schema'
import {
  isStaticHtml,
  resolveSandboxPort,
  resolveSandboxTemplate,
} from '@/lib/templates'
import { ExecutionResultInterpreter, ExecutionResultWeb } from '@/lib/types'
import { Sandbox } from '@e2b/code-interpreter'

const sandboxTimeout = 10 * 60 * 1000 // 10 minute in ms
/** Write + persist must finish even if npm is slow. */
const INSTALL_MS = 25_000

export const maxDuration = 90

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
  files = repairGeneratedFiles(files)
  try {
    files = await replaceBrokenRemoteImagesInFiles(files)
  } catch {
    /* keep generated files if validation cannot run */
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

  const logId = projectId || runId || 'sandbox'
  let sbx: Sandbox | null = null
  let installError: string | undefined
  let runError: string | undefined

  try {
    sbx = await connectExisting(sbxId, teamID, accessToken)
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

    const differsFromSnap =
      !snap ||
      files.some(
        (f) =>
          snap.files.find((p) => p.file_path === f.file_path)?.file_content !==
          f.file_content,
      )

    // Write first so a later install failure cannot erase a valid project.
    if (!reused || !resolved.rehydrated || (requiresDataLayer && !hadCapture) || differsFromSnap) {
      await writeTree(sbx, files)
      void appendGenerationLog(logId, {
        candidateId,
        stage: 'write',
        ok: true,
      })
    }

    const captureAdded = requiresDataLayer && !hadCapture
    if (
      resolved.persist ||
      !snap ||
      snap.requires_data_layer !== requiresDataLayer ||
      captureAdded ||
      differsFromSnap
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

    const installCmd = safeInstallCommand({
      code: typeof fragment.code === 'string' ? fragment.code : undefined,
      files,
      additional_dependencies: fragment.additional_dependencies,
      install_dependencies_command: fragment.install_dependencies_command,
      has_additional_dependencies: fragment.has_additional_dependencies,
    })
    if (installCmd) {
      try {
        await sbx.commands.run(installCmd, { timeoutMs: INSTALL_MS })
        void appendGenerationLog(logId, {
          candidateId,
          stage: 'install',
          ok: true,
          error: installCmd,
        })
        console.log(`Installed dependencies via ${installCmd} in sandbox ${sbx.sandboxId}`)
      } catch (e: any) {
        installError = e?.message ?? 'npm install failed'
        void appendGenerationLog(logId, {
          candidateId,
          stage: 'install_error',
          ok: false,
          error: installError,
        })
        console.warn('sandbox install failed; keeping written project', installError)
      }
    }

    // `sbx` is a `let`, so TS re-widens it to `Sandbox | null` inside closures.
    const box = sbx
    if (sandboxTemplate !== 'code-interpreter-v1') {
      try {
        await injectInspectBridge(box)
      } catch (e) {
        console.warn('inspect bridge inject failed', e)
      }
      runError = await probeAndRepair(box, files, async (next) => {
        files = next
        await writeTree(box, files)
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
      })
      if (runError) {
        void appendGenerationLog(logId, {
          candidateId,
          stage: 'run',
          ok: false,
          error: runError,
        })
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
          installError,
          runError,
        } as ExecutionResultInterpreter & {
          rehydrated: boolean
          installError?: string
          runError?: string
        }),
      )
    }

    return new Response(
      JSON.stringify({
        sbxId: sbx?.sandboxId,
        template: sandboxTemplate,
        url: `https://${sbx?.getHost(resolveSandboxPort(sandboxTemplate))}`,
        rehydrated: resolved.rehydrated,
        installError,
        runError,
      } as ExecutionResultWeb),
    )
  } catch (e: any) {
    if (sbx && sandboxTemplate !== 'code-interpreter-v1') {
      return new Response(
        JSON.stringify({
          sbxId: sbx.sandboxId,
          template: sandboxTemplate,
          url: `https://${sbx.getHost(resolveSandboxPort(sandboxTemplate))}`,
          rehydrated: resolved.rehydrated,
          installError: e?.message ?? 'sandbox stage failed',
          runError,
        } as ExecutionResultWeb),
      )
    }
    return new Response(
      JSON.stringify({ error: e?.message ?? 'sandbox failed' }),
      { status: 500 },
    )
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

async function curlPreview(sbx: Sandbox): Promise<{ status: string; body: string }> {
  const r = await sbx.commands.run(
    'curl -sS -m 8 -w "\\n%{http_code}" http://127.0.0.1:3000/',
    { timeoutMs: 10_000 },
  )
  const out = (r.stdout || '').replace(/\r/g, '').trimEnd()
  const nl = out.lastIndexOf('\n')
  if (nl === -1) return { status: out.trim(), body: '' }
  return { status: out.slice(nl + 1).trim(), body: out.slice(0, nl) }
}

function previewOk(status: string) {
  return status === '200' || status === '304'
}

async function probeAndRepair(
  sbx: Sandbox,
  files: WrittenFile[],
  rewrite: (next: WrittenFile[]) => Promise<void>,
): Promise<string | undefined> {
  try {
    let probe = await curlPreview(sbx)
    if (previewOk(probe.status)) return undefined
    await sleep(2000)
    probe = await curlPreview(sbx)
    if (previewOk(probe.status)) return undefined
    if (probe.status === '500') {
      const repaired = repairGeneratedFiles(files)
      await rewrite(repaired)
      await sleep(2000)
      probe = await curlPreview(sbx)
      if (previewOk(probe.status)) return undefined
    }
    return parseNextError(probe.body) || `preview http ${probe.status || 'unknown'}`
  } catch (e: any) {
    return e?.message ?? 'preview probe failed'
  }
}

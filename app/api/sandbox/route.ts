import { injectInspectBridge } from '@/lib/inspect-bridge'
import {
  detectPackageManager,
  extraNpmPackages,
  installCommand,
  type PackageManager,
} from '@/lib/fragment-deps'
import {
  fragmentFiles,
  fragmentWithFiles,
  withMissingLocalModules,
  type WrittenFile,
} from '@/lib/fragment-files'
import { IMAGE_DIR, IMAGE_PUBLIC, resolveImages } from '@/lib/images'
import { getModelClient, LLMModel, LLMModelConfig } from '@/lib/models'
import { FragmentSchema, fragmentSchema } from '@/lib/schema'
import {
  isStaticHtml,
  resolveSandboxPort,
  resolveSandboxTemplate,
} from '@/lib/templates'
import { ExecutionResult, ExecutionResultInterpreter, ExecutionResultWeb } from '@/lib/types'
import {
  CandidateHealth,
  filesFromModel,
  healCandidate,
  isBuildFailure,
  repairPrompt,
  unusedTemplateUiErrors,
  type ProbeResult,
  type RepairContext,
} from '@/lib/verify'
import { getUserId } from '@/lib/server-auth'
import { Sandbox as InterpreterSandbox } from '@e2b/code-interpreter'
import { LanguageModel, generateText } from 'ai'
import { NotFoundError, Sandbox as WebSandbox } from 'e2b'
import { createHash } from 'node:crypto'

const sandboxTimeout = 10 * 60 * 1000 // 10 minute in ms
// ponytail: process-local dedupe; multiple hosts need a shared durable job store.
type PreviewJob = { promise: Promise<Response>; expiresAt: number; waiters: number; cancel: AbortController }
const previewCreations = new Map<string, PreviewJob>()
function prunePreviewCreations() {
  for (const [key, job] of previewCreations) {
    if (job.expiresAt && job.expiresAt <= Date.now()) previewCreations.delete(key)
  }
  const completed = [...previewCreations].filter(([, job]) => job.expiresAt)
  for (const [key] of completed.slice(0, Math.max(0, completed.length - 32))) previewCreations.delete(key)
}
type Sandbox = {
  sandboxId: string
  getHost: (port: number) => string
  files: {
    write: {
      (path: string, data: string | ArrayBuffer, opts?: { requestTimeoutMs?: number }): Promise<unknown>
      (files: { path: string; data: string | ArrayBuffer }[], opts?: { requestTimeoutMs?: number }): Promise<unknown>
    }
    read: (path: string, opts?: { requestTimeoutMs?: number }) => Promise<string>
  }
  commands: {
    run: (cmd: string, opts?: { timeoutMs?: number; requestTimeoutMs?: number }) => Promise<{ exitCode: number; stdout: string; stderr: string }>
  }
}

export const maxDuration = 300

export async function POST(req: Request) {
  // The owner is always the verified session; a body userID is never trusted.
  const sessionUserId = await getUserId()
  if (!sessionUserId) return Response.json({ error: 'Sign in to open a preview.' }, { status: 401 })
  const ownerID: string = sessionUserId
  let body: Record<string, unknown>
  try {
    body = await req.json()
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Invalid body')
  } catch {
    return Response.json({ error: 'Invalid sandbox request.' }, { status: 400 })
  }
  const parsed = fragmentSchema.safeParse(body.fragment)
  if (!parsed.success) return Response.json({ error: 'Invalid project source.' }, { status: 400 })
  if (body.cachedResult !== undefined && (!body.cachedResult || typeof body.cachedResult !== 'object' ||
    !('sbxId' in body.cachedResult) || typeof body.cachedResult.sbxId !== 'string' ||
    !/^[a-zA-Z0-9_-]{1,128}$/.test(body.cachedResult.sbxId) ||
    !('template' in body.cachedResult) || typeof body.cachedResult.template !== 'string')) {
    return Response.json({ error: 'Invalid saved preview.' }, { status: 400 })
  }
  const {
    teamID,
    model,
    config,
    runtimeError,
    cachedResult,
    projectID,
    candidateID,
    runID,
  }: {
    teamID?: string
    model?: LLMModel
    config?: LLMModelConfig
    runtimeError?: string
    cachedResult?: ExecutionResult
    projectID?: string
    candidateID?: string
    runID?: string
  } = body as {
    teamID?: string; model?: LLMModel; config?: LLMModelConfig
    runtimeError?: string; cachedResult?: ExecutionResult; projectID?: string; candidateID?: string; runID?: string
  }
  let fragment = parsed.data
  let provisioningStarted = false
  let createdSandboxId: string | undefined
  let discarded = false
  let sourceFiles: WrittenFile[]
  try { sourceFiles = fragmentFiles(fragment) } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Invalid project source paths.' }, { status: 400 })
  }
  const cachedWeb = cachedResult && cachedResult.template !== 'code-interpreter-v1' ? cachedResult as ExecutionResultWeb : undefined
  // Strip any "-dev" suffix the prompt-side template ids carry in development.
  // E2B's hosted templates don't have the suffix; the -dev convention only
  // applies if a user has published a *-dev custom template to their account.
  const sandboxTemplate = resolveSandboxTemplate(
    fragment.template,
    fragment.file_path,
  )

  if (cachedWeb) {
    const savedActual = fragmentSchema.safeParse(cachedWeb.fragment)
    const savedPortable = fragmentSchema.safeParse(cachedWeb.recoveryFragment)
    if ((savedActual.success || savedPortable.success) &&
      !(savedActual.success && sameSource(fragment, savedActual.data)) &&
      !(savedPortable.success && sameSource(fragment, savedPortable.data))) {
      return Response.json({ error: 'The saved preview does not match this version. Generate a preview from its saved source.' }, { status: 409 })
    }
    try {
      const info = await WebSandbox.getInfo(cachedWeb.sbxId, { requestTimeoutMs: 10_000 })
      if (info.metadata.userID !== ownerID ||
        (typeof projectID === 'string' && info.metadata.projectID && info.metadata.projectID !== projectID) ||
        (typeof candidateID === 'string' && info.metadata.candidateID && info.metadata.candidateID !== candidateID)) {
        return Response.json({ error: 'This saved preview belongs to another workspace or account.' }, { status: 403 })
      }
      if (info.metadata.template && info.metadata.template !== sandboxTemplate) {
        return Response.json({ error: 'The saved preview template does not match this project.' }, { status: 409 })
      }
      const resumed = await WebSandbox.connect(cachedWeb.sbxId, { timeoutMs: sandboxTimeout, requestTimeoutMs: 10_000 })
      try { await injectInspectBridge(resumed) } catch { console.warn('[EvoStack][PREVIEW] Could not update the preview helper.') }
      const url = `https://${resumed.getHost(resolveSandboxPort(sandboxTemplate))}`
      const preview = await probePreview(url)
      if (!preview.ok) return Response.json({ error: 'The saved preview is temporarily unavailable. Please retry.' }, { status: 503 })
      const storedSource = fragmentSchema.safeParse(cachedWeb.fragment)
      let actualFragment = storedSource.success ? storedSource.data : fragment
      if (!storedSource.success) {
        const restoredFiles = await Promise.all(sourceFiles.map(async file => {
          try { return { ...file, file_content: await resumed.files.read(file.file_path) } } catch { return file }
        }))
        actualFragment = fragmentWithFiles(fragment, restoredFiles)
      }
      let manifest: unknown = []
      try { manifest = JSON.parse(await resumed.files.read(`${IMAGE_DIR}/manifest.json`)) } catch { /* Projects without photos have no manifest. */ }
      let imageQueries = validImageQueries(manifest)
      if (!imageQueries.length) imageQueries = validImageQueries(cachedWeb.imageQueries)
      const savedRecovery = fragmentSchema.safeParse(cachedWeb.recoveryFragment)
      const recoveryFragment = portableFragment(actualFragment, imageQueries, savedRecovery.success ? savedRecovery.data : undefined)
      if (!storedSource.success && !sameSource(fragment, actualFragment) && !sameSource(fragment, recoveryFragment)) {
        return Response.json({ error: 'The saved preview does not match this version. Generate a preview from its saved source.' }, { status: 409 })
      }
      const refreshed = await resumed.getInfo({ requestTimeoutMs: 10_000 })
      return Response.json({
        sbxId: resumed.sandboxId,
        template: sandboxTemplate,
        url,
        expiresAt: refreshed.endAt.getTime(),
        fragment: actualFragment,
        recoveryFragment,
        imageQueries,
        health: {
          ...cachedWeb.health,
          state: 'UNVERIFIED', verified: false, runtimeStatus: 'skipped',
          buildStatus: cachedWeb.health?.buildStatus || 'skipped',
          dependencyStatus: cachedWeb.health?.dependencyStatus || 'skipped',
          repairAttempts: cachedWeb.health?.repairAttempts || 0, repaired: Boolean(cachedWeb.health?.repaired),
          log: [...(Array.isArray(cachedWeb.health?.log) ? cachedWeb.health.log : []), '[EvoStack][PREVIEW] Saved sandbox reconnected; HTTP responded.'],
        },
      } satisfies ExecutionResultWeb)
    } catch (error) {
      if (!isMissingSandbox(error)) {
        console.warn('[EvoStack][RECONNECT] failed', error instanceof Error ? error.name : 'SandboxError')
        return Response.json({ error: 'Unable to reconnect the saved preview. Please retry.' }, { status: reconnectErrorStatus(error) })
      }
      // Only a genuinely missing sandbox can use the paid creation path.
      const savedRecovery = fragmentSchema.safeParse(cachedWeb.recoveryFragment)
      if (savedRecovery.success) {
        fragment = savedRecovery.data
        try { sourceFiles = fragmentFiles(fragment) } catch {
          return Response.json({ error: 'Invalid saved project source paths.' }, { status: 400 })
        }
      }
    }
  }

  // Auth/reconnect failures return above; only fresh web creation shares a paid job.
  if (sandboxTemplate === 'code-interpreter-v1') return createPreview(req.signal)
  prunePreviewCreations()
  const sourceHash = createHash('sha256').update(JSON.stringify({
    template: sandboxTemplate,
    files: [...sourceFiles].sort((a, b) => a.file_path.localeCompare(b.file_path)),
    dependencies: [...fragment.additional_dependencies].sort(),
    installRequested: fragment.has_additional_dependencies,
    install: fragment.install_dependencies_command,
    runtimeError: typeof runtimeError === 'string' ? runtimeError.trim().slice(0, 4000) : '',
  })).digest('hex')
  const key = JSON.stringify([ownerID, typeof projectID === 'string' ? projectID : '', typeof candidateID === 'string' ? candidateID : 'primary', typeof runID === 'string' ? runID : '', sourceHash])
  const existing = previewCreations.get(key)
  if (existing) return (await waitForJob(existing, req.signal)).clone()
  if ([...previewCreations.values()].filter((job) => !job.expiresAt).length >= 8) {
    return Response.json({ error: 'Preview creation is busy. Please retry shortly.' }, { status: 429 })
  }
  const cancel = new AbortController()
  const job: PreviewJob = { promise: Promise.resolve().then(() => createPreview(cancel.signal)), expiresAt: 0, waiters: 0, cancel }
  previewCreations.set(key, job)
  job.promise = job.promise.then(async (response) => {
    if (previewCreations.get(key) !== job) return response
    // A timed-out creation was killed. Briefly retain its terminal response,
    // release the active slot, and avoid an immediate overlapping refresh create.
    if (response.status === 504 && provisioningStarted) job.expiresAt = Date.now() + 30_000
    else if (await unusablePreview(response)) previewCreations.delete(key)
    else job.expiresAt = Date.now() + sandboxTimeout
    prunePreviewCreations()
    return response
  }).catch((error) => { if (previewCreations.get(key) === job) previewCreations.delete(key); throw error })
  return (await waitForJob(job, req.signal)).clone()

  /** Every failure, timeout or cancellation kills the sandbox it created; only a usable preview survives. */
  async function createPreview(cancelSignal: AbortSignal) {
    const controller = new AbortController()
    const deadline = Date.now() + maxDuration * 1000
    const timer = setTimeout(() => controller.abort(previewTimeout('Preview preparation timed out after five minutes. Wait 30 seconds, then retry.')), maxDuration * 1000)
    const onCancel = () => controller.abort(previewCanceled())
    if (cancelSignal.aborted) onCancel()
    else cancelSignal.addEventListener('abort', onCancel, { once: true })
    try {
      const response = await withSignal(preparePreview(controller.signal, deadline), controller.signal)
      if (await unusablePreview(response)) discardSandbox('preview failed its checks')
      return response
    } catch (error) {
      // Abort first so a sandbox whose creation lands later is killed as well.
      if (!controller.signal.aborted) controller.abort(error)
      discardSandbox(error instanceof Error ? error.name : 'error')
      if (error instanceof Error && error.name === 'PreviewTimeoutError') {
        return Response.json({ error: error.message, code: 'PREVIEW_TIMEOUT' }, { status: 504 })
      }
      if (error instanceof Error && error.name === 'PreviewCanceledError') {
        return Response.json({ error: error.message, code: 'PREVIEW_CANCELED' }, { status: 499 })
      }
      throw error
    } finally {
      clearTimeout(timer)
      cancelSignal.removeEventListener('abort', onCancel)
    }
  }

  function discardSandbox(reason: string) {
    if (!createdSandboxId || discarded) return
    discarded = true
    const id = createdSandboxId
    console.log(`[EvoStack][SANDBOX] killing ${id}: ${reason}`)
    void WebSandbox.kill(id, { requestTimeoutMs: 15_000 }).catch((error) =>
      console.warn('[EvoStack][SANDBOX] kill failed', id, error instanceof Error ? error.name : error))
  }

  async function preparePreview(signal: AbortSignal, deadline: number) {
  signal.throwIfAborted()
  // Create an interpreter or a sandbox
  const options = {
    metadata: {
      template: sandboxTemplate,
      userID: ownerID,
      teamID: typeof teamID === 'string' ? teamID.slice(0, 128) : '',
      ...(typeof projectID === 'string' ? { projectID: projectID.slice(0, 128) } : {}),
      ...(typeof candidateID === 'string' ? { candidateID: candidateID.slice(0, 128) } : {}),
      ...(typeof runID === 'string' ? { runID: runID.slice(0, 128) } : {}),
    },
    timeoutMs: sandboxTimeout,
    requestTimeoutMs: 60_000,
    // Secured envd needs a token only API-key holders get. vue/streamlit/gradio
    // hosted templates reject it ("not compatible with secured access").
    secure: SECURE_TEMPLATES.has(sandboxTemplate),
  }
  const createdAt = Date.now()
  provisioningStarted = true
  const creating: Promise<Sandbox> = sandboxTemplate === 'code-interpreter-v1'
    ? InterpreterSandbox.create(sandboxTemplate, options)
    : WebSandbox.create(sandboxTemplate, {
        ...options,
        lifecycle: { onTimeout: 'pause', autoResume: true },
      })
  void creating.then((sbx) => {
    createdSandboxId = sbx.sandboxId
    if (signal.aborted) discardSandbox('request ended before creation finished')
  }, () => {})
  const sandboxTask = withSignal<Sandbox>(creating, signal)
  // Photos resolve while the sandbox boots; the site's title/description steer AI photos,
  // and paid AI photos count against the verified owner's hourly quota.
  const imageTask = withSignal(resolveImages(sourceFiles, signal, {
    context: { title: fragment.title, description: fragment.description },
    userId: ownerID,
  }), signal)
  let created: Sandbox
  let imaged: Awaited<ReturnType<typeof resolveImages>>
  try {
    ;[created, imaged] = await Promise.all([sandboxTask, imageTask])
  } catch (error) {
    void sandboxTask.catch(() => {})
    void imageTask.catch(() => {})
    throw error
  }
  signal.throwIfAborted()
  const sbx = guardedSandbox(created, signal, deadline)

  const npmPkgs = extraNpmPackages(
    sourceFiles,
    fragment.additional_dependencies,
  )
  const npmTemplate =
    sandboxTemplate === 'nextjs-developer' || sandboxTemplate === 'vue-developer'
  const healNext =
    sandboxTemplate === 'nextjs-developer' && !isStaticHtml(fragment)

  // The image manifest belongs to preview infrastructure, never to editable source.
  const imageManifest = imaged.files.find(file => file.file_path === `${IMAGE_DIR}/manifest.json`)
  if (imageManifest) await sbx.files.write(imageManifest.file_path, imageManifest.file_content)
  const imageSourceFiles = imaged.files.filter(file => file.file_path !== `${IMAGE_DIR}/manifest.json`)
  const legacySingleFile = fragment.files === undefined
  let health: CandidateHealth | undefined
  let files = withMissingLocalModules(imageSourceFiles, legacySingleFile)
  let reportedRuntimeError = typeof runtimeError === 'string' ? runtimeError.trim().slice(0, 4000) : ''

  if (healNext) {
    let typecheckPassed = false
    let probedFiles: WrittenFile[] | null = null
    if (imaged.binaries.length) await sbx.files.write(imaged.binaries.map(bin => ({ path: bin.file_path, data: bin.data })))
    const present = await readInstalledPackages(sbx)
    const previewUrl = `https://${sbx.getHost(resolveSandboxPort(sandboxTemplate))}`
    const healed = await healCandidate({
      files: imageSourceFiles,
      present,
      declared: fragment.additional_dependencies,
      label: fragment.title || sbx.sandboxId,
      log: (line) => console.log(line),
      install: (pkgs) => installMissing(sbx, pkgs),
      probe: async (nextFiles) => {
        const written = withMissingLocalModules(nextFiles, legacySingleFile)
        await writeFiles(sbx, written)
        probedFiles = written
        typecheckPassed = false
        let types = await runCmd(sbx, './node_modules/.bin/tsc --project ./tsconfig.json --noEmit --incremental false --pretty false', 30_000)
        const staleUi = unusedTemplateUiErrors(types.output, nextFiles)
        if (!types.ok && staleUi.length) {
          await sbx.commands.run(`rm -f ${staleUi.join(' ')}`)
          console.log(`[EvoStack][TYPECHECK] skipped unused template files: ${staleUi.join(', ')}`)
          types = await runCmd(sbx, './node_modules/.bin/tsc --project ./tsconfig.json --noEmit --incremental false --pretty false', 30_000)
        }
        typecheckPassed = types.ok
        if (!types.ok) return { ok: false, output: types.output, phase: 'build' }
        if (reportedRuntimeError) {
          const output = reportedRuntimeError
          reportedRuntimeError = ''
          return { ok: false, output, phase: 'preview' }
        }
        return probePreview(previewUrl, signal)
      },
      llmRepair: (ctx) => repairWithModel(model, config, ctx, signal),
    })
    health = healed.health
    if (typecheckPassed) {
      health.buildStatus = 'passed'
      health.log.push('[EvoStack][TYPECHECK] PASS')
    }
    files = withMissingLocalModules(healed.files, legacySingleFile)
    // The probe already wrote these bytes. A repair can roll back after that
    // write, so a changed set or any repair still uploads.
    if (health.repaired || !sameWrittenFiles(probedFiles, files)) await writeFiles(sbx, files)
  } else {
    if (npmTemplate && npmPkgs.length) {
      const installed = await installMissing(sbx, npmPkgs)
      if (!installed.ok) {
        console.warn(
          `[deps] install failed (${npmPkgs.join(', ')})`,
          installed.output,
        )
      }
    } else if (!npmTemplate && fragment.has_additional_dependencies) {
      await sbx.commands.run(fragment.install_dependencies_command).then(() => {
        console.log(
          `Installed dependencies: ${fragment.additional_dependencies.join(', ')} in sandbox ${sbx.sandboxId}`,
        )
      })
    }
    await writeFiles(sbx, files)
    if (imaged.binaries.length) await sbx.files.write(imaged.binaries.map(bin => ({ path: bin.file_path, data: bin.data })))
  }

  // Static HTML has no Next/Vue server. Mount it inside the running template
  // so preview uses the template port instead of a closed port 80.
  if (sandboxTemplate !== 'code-interpreter-v1' && isStaticHtml(fragment)) {
    const html =
      files.find((f) => /\.html?$/i.test(f.file_path))?.file_content ||
      files[0]?.file_content ||
      ''
    await sbx.files.write('public/generated.html', html)
    await sbx.files.write(
      'pages/index.tsx',
      `export default function Page() {
  return (
    <iframe
      src="/generated.html"
      title="preview"
      style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', border: 'none' }}
    />
  )
}
`,
    )
    console.log(`Mounted static HTML in ${sbx.sandboxId}`)
  }

  if (sandboxTemplate !== 'code-interpreter-v1') {
    try {
      await injectInspectBridge(sbx)
    } catch (e) {
      console.warn('inspect bridge inject failed', e)
    }
  }

  // Execute code or return a URL to the running sandbox
  if (sandboxTemplate === 'code-interpreter-v1') {
    const { logs, error, results } = await withSignal((created as InterpreterSandbox).runCode(fragment.code || ''), signal)

    return new Response(
      JSON.stringify({
        sbxId: sbx?.sandboxId,
        template: sandboxTemplate,
        stdout: logs.stdout,
        stderr: logs.stderr,
        runtimeError: error,
        cellResults: results,
      } as ExecutionResultInterpreter),
    )
  }

  const actualFragment = fragmentWithFiles(fragment, files)
  return new Response(
    JSON.stringify({
      sbxId: sbx?.sandboxId,
      template: sandboxTemplate,
      url: `https://${sbx?.getHost(resolveSandboxPort(sandboxTemplate))}`,
      health,
      expiresAt: createdAt + sandboxTimeout,
      fragment: actualFragment,
      recoveryFragment: portableFragment(actualFragment, imaged.manifest),
      imageQueries: validImageQueries(imaged.manifest),
    } as ExecutionResultWeb),
  )
  }
}

function previewTimeout(message: string) {
  return Object.assign(new Error(message), { name: 'PreviewTimeoutError' })
}

// Verified with real sandboxes (create + connect + files.write); the other hosted templates return 400.
const SECURE_TEMPLATES = new Set(['nextjs-developer', 'code-interpreter-v1'])

function previewCanceled() {
  return Object.assign(new Error('Preview request was canceled.'), { name: 'PreviewCanceledError' })
}

/** Mirrors lib/sandbox-client.ts: the client discards these, so the sandbox would only leak. */
async function unusablePreview(response: Response) {
  if (!response.ok) return true
  try {
    const { health } = await response.clone().json() as ExecutionResultWeb
    return health?.state === 'FAILED' ||
      (health?.state === 'UNVERIFIED' && !health.log?.some((line) => line.includes('[EvoStack][HTTP] PASS')))
  } catch { return true }
}

/** A shared creation is canceled (and its sandbox killed) once every waiting request has disconnected. */
async function waitForJob(job: PreviewJob, signal: AbortSignal) {
  job.waiters++
  let left = false
  const leave = () => {
    if (left) return
    left = true
    if (--job.waiters <= 0 && !job.expiresAt) job.cancel.abort(previewCanceled())
  }
  if (signal.aborted) leave()
  else signal.addEventListener('abort', leave, { once: true })
  try {
    return await job.promise
  } finally {
    signal.removeEventListener('abort', leave)
    if (!left) { left = true; job.waiters-- }
  }
}

/** DELETE {sbxIds} kills only sandboxes whose metadata.userID is the caller. */
export async function DELETE(req: Request) {
  const userId = await getUserId()
  if (!userId) return Response.json({ error: 'Sign in to stop previews.' }, { status: 401 })
  let ids: unknown
  try { ids = (await req.json())?.sbxIds } catch { ids = undefined }
  if (!Array.isArray(ids) || !ids.length || ids.length > 32 ||
    !ids.every((id) => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(id))) {
    return Response.json({ error: 'sbxIds must be 1-32 preview ids.' }, { status: 400 })
  }
  const result = { killed: [] as string[], missing: [] as string[], forbidden: [] as string[], failed: [] as string[] }
  await Promise.all([...new Set(ids as string[])].map(async (id) => {
    try {
      const info = await WebSandbox.getInfo(id, { requestTimeoutMs: 10_000 })
      if (info.metadata?.userID !== userId) return void result.forbidden.push(id)
      if (await WebSandbox.kill(id, { requestTimeoutMs: 15_000 })) result.killed.push(id)
      else result.missing.push(id)
    } catch (error) {
      if (isMissingSandbox(error)) result.missing.push(id)
      else result.failed.push(id)
    }
  }))
  return Response.json(result)
}

/** Also bounds adapters that fail to honor cancellation; their late result is ignored. */
function withSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason)
    if (signal.aborted) { promise.catch(() => {}); reject(signal.reason); return }
    signal.addEventListener('abort', abort, { once: true })
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}

function guardedSandbox(sbx: Sandbox, signal: AbortSignal, deadline: number): Sandbox {
  const remaining = () => Math.max(1, deadline - Date.now())
  const requestTimeout = () => Math.min(60_000, remaining())
  async function step<T>(operation: () => Promise<T>): Promise<T> {
    signal.throwIfAborted()
    const value = await withSignal(operation(), signal)
    signal.throwIfAborted()
    return value
  }
  return {
    sandboxId: sbx.sandboxId,
    getHost: (port) => sbx.getHost(port),
    files: {
      write: ((pathOrFiles: string | { path: string; data: string | ArrayBuffer }[], dataOrOptions?: string | ArrayBuffer | { requestTimeoutMs?: number }) => step(() => typeof pathOrFiles === 'string'
        ? sbx.files.write(pathOrFiles, dataOrOptions as string | ArrayBuffer, { requestTimeoutMs: requestTimeout() })
        : sbx.files.write(pathOrFiles, { requestTimeoutMs: requestTimeout() }))) as Sandbox['files']['write'],
      read: (path) => step(() => sbx.files.read(path, { requestTimeoutMs: requestTimeout() })),
    },
    commands: {
      run: (command, opts) => step(() => sbx.commands.run(command, {
        ...opts,
        timeoutMs: Math.min(opts?.timeoutMs ?? 60_000, remaining()),
        requestTimeoutMs: Math.min(opts?.requestTimeoutMs ?? 60_000, remaining()),
      })),
    },
  }
}

function sameSource(first: FragmentSchema, second: FragmentSchema) {
  try {
    const source = (fragment: FragmentSchema) => fragmentFiles(fragment).map(file => [file.file_path, file.file_content.trim()]).sort((a, b) => a[0].localeCompare(b[0]))
    return JSON.stringify(source(first)) === JSON.stringify(source(second))
  } catch { return false }
}

function isMissingSandbox(error: unknown) {
  if (error instanceof NotFoundError) return true
  if (!error || typeof error !== 'object') return false
  const value = error as { status?: number; statusCode?: number; code?: number }
  return value.status === 404 || value.statusCode === 404 || value.code === 404
}

function reconnectErrorStatus(error: unknown) {
  if (!error || typeof error !== 'object') return 503
  const value = error as { status?: number; statusCode?: number; code?: number; name?: string }
  const status = value.status || value.statusCode || value.code
  if (status === 401 || status === 403 || value.name === 'AuthenticationError') return status === 401 ? 401 : 403
  if (status === 429 || value.name === 'RateLimitError') return 429
  return 503
}

function portableFragment(actual: FragmentSchema, manifest: unknown, saved?: FragmentSchema): FragmentSchema {
  let converted = false
  const files = fragmentFiles(actual).map(file => {
    let code = file.file_content
    for (const row of validImageQueries(manifest)) {
      const path = `${IMAGE_PUBLIC}/${row.file}`
      if (code.includes(path)) {
        code = code.split(path).join(`evo-image://${row.query}`)
        converted = true
      }
    }
    return { ...file, file_content: code }
  })
  return converted ? fragmentWithFiles(actual, files) : saved || actual
}

/** Rows that convert a photo file back into its evo-image:// query; `portable: false` files (runtime-built or unknown query) stay files. */
function validImageQueries(manifest: unknown): NonNullable<ExecutionResultWeb['imageQueries']> {
  return (Array.isArray(manifest) ? manifest.slice(0, 128) : []).filter((row) =>
    row && row.portable !== false && typeof row.file === 'string' && /^[\w-][\w.-]{0,200}$/.test(row.file) &&
    typeof row.query === 'string' && row.query.trim() && row.query.length <= 1000 && !/["'`\\\r\n)]/.test(row.query),
  ).map((row) => ({ file: row.file, query: row.query }))
}

function sameWrittenFiles(current: readonly WrittenFile[] | null, next: readonly WrittenFile[]) {
  if (!current || current.length !== next.length) return false
  return current.every((file, index) => file.file_path === next[index].file_path && file.file_content === next[index].file_content)
}

async function writeFiles(sbx: Sandbox, files: WrittenFile[]) {
  await sbx.files.write(files.map(file => ({ path: file.file_path, data: file.file_content })))
  for (const file of files) {
    console.log(`Copied file to ${file.file_path} in ${sbx.sandboxId}`)
  }
}

async function runCmd(sbx: Sandbox, cmd: string, timeoutMs: number) {
  let result
  try {
    result = await sbx.commands.run(cmd, {
      timeoutMs,
      requestTimeoutMs: timeoutMs,
    })
  } catch (error) {
    // E2B throws on a nonzero exit; keep compiler/install diagnostics for repair.
    if (!error || typeof error !== 'object' || !('exitCode' in error) || typeof error.exitCode !== 'number') throw error
    result = error
  }
  const rec = result as { stdout?: string; stderr?: string; exitCode?: number }
  return {
    ok: rec.exitCode === 0,
    stdout: rec.stdout || '',
    output: `${rec.stdout || ''}\n${rec.stderr || ''}`.replace(/^(.+?\.(?:tsx?|jsx?))\((\d+),(\d+)\):/gm, '$1:$2:$3:'),
  }
}

async function readInstalledPackages(sbx: Sandbox): Promise<string[]> {
  try {
    const listed = await runCmd(
      sbx,
      `node -e "const p=require('./package.json'); process.stdout.write(Object.keys({...p.dependencies,...p.devDependencies}).join(','))"`,
      20_000,
    )
    return listed.stdout.split(/[\n,]/).map((s) => s.trim()).filter(Boolean)
  } catch {
    return []
  }
}

async function readPackageManager(sbx: Sandbox): Promise<PackageManager | null> {
  try {
    const listed = await runCmd(
      sbx,
      `node -e "const fs=require('fs'); const locks=['pnpm-lock.yaml','yarn.lock','package-lock.json'].filter(f=>fs.existsSync(f)); let pm=''; try{pm=(require('./package.json').packageManager)||''}catch(e){} process.stdout.write(JSON.stringify({locks,pm}))"`,
      20_000,
    )
    const raw = listed.stdout || ''
    const start = raw.indexOf('{')
    const end = raw.lastIndexOf('}')
    if (start < 0 || end < start) return null
    const info = JSON.parse(raw.slice(start, end + 1)) as {
      locks?: string[]
      pm?: string
    }
    const manager = detectPackageManager({
      packageManager: info.pm,
      lockfiles: info.locks,
    })
    console.log(`[deps] package manager: ${manager || 'conflict'}`)
    return manager
  } catch (e) {
    console.warn(
      '[deps] could not read package manager; not installing',
      e instanceof Error ? e.message : e,
    )
    return null
  }
}

async function installMissing(sbx: Sandbox, packages: string[]) {
  const manager = await readPackageManager(sbx)
  if (!manager) {
    return {
      ok: false,
      output: 'refused to install: lockfiles conflict or package manager could not be read',
    }
  }
  const cmd = installCommand(manager, packages)
  if (!cmd) return { ok: true, output: '' }
  try {
    let result = await runCmd(sbx, cmd, 90_000)
    const peer =
      manager === 'npm'
        ? /ERESOLVE/i.test(result.output)
        : manager === 'pnpm'
          ? /ERR_PNPM_PEER_DEP/i.test(result.output)
          : false
    const retry = peer ? installCommand(manager, packages, true) : null
    if (!result.ok && retry) result = await runCmd(sbx, retry, 90_000)
    if (!result.ok) return result
    const check = packages.map((p) => `require.resolve(${JSON.stringify(p.startsWith('@types/') ? `${p}/package.json` : p)})`).join(';')
    const resolved = await runCmd(sbx, `node -e ${JSON.stringify(check)}`, 20_000)
    if (!resolved.ok) {
      return { ok: false, output: `${result.output}\n${resolved.output}` }
    }
    console.log(
      `Installed dependencies with ${manager}: ${packages.join(', ')} in sandbox ${sbx.sandboxId}`,
    )
    return { ok: true, output: result.output }
  } catch (e) {
    return { ok: false, output: e instanceof Error ? e.message : String(e) }
  }
}

async function probePreview(url: string, signal?: AbortSignal): Promise<ProbeResult> {
  let last = ''
  let status = 0
  if (signal) await withSignal(new Promise((r) => setTimeout(r, 1500)), signal)
  else await new Promise((r) => setTimeout(r, 1500))
  for (let i = 0; i < 4; i++) {
    signal?.throwIfAborted()
    try {
      const res = await fetch(url, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000) })
      status = res.status
      last = (await res.text()).slice(0, 8000)
      const runtime = /Application error|Unhandled Runtime/i.test(last)
      const compiling = /compiling/i.test(last) && last.length < 4000
      const starter = /Get started by editing|To get started, edit/i.test(last)
      if (res.ok && !isBuildFailure(last) && !runtime && !compiling && !starter && last.includes('<')) {
        return { ok: true, output: '', httpStatus: status, phase: 'preview' }
      }
      if ((isBuildFailure(last) || runtime) && i === 3) {
        return { ok: false, output: last, httpStatus: status, phase: 'preview' }
      }
    } catch (e) {
      last = e instanceof Error ? e.message : String(e)
    }
    if (signal) await withSignal(new Promise((r) => setTimeout(r, 2000)), signal)
    else await new Promise((r) => setTimeout(r, 2000))
  }
  return { ok: false, output: last || 'timeout', httpStatus: status, phase: 'preview' }
}

async function repairWithModel(
  model: LLMModel | undefined,
  config: LLMModelConfig | undefined,
  ctx: RepairContext,
  parentSignal: AbortSignal,
): Promise<WrittenFile[] | null> {
  parentSignal.throwIfAborted()
  if (!model || !config) return null
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(previewTimeout('Automatic preview repair timed out after 60 seconds. Wait 30 seconds, then retry.')), 60_000)
  const signal = AbortSignal.any([parentSignal, controller.signal])
  try {
    const { text } = await withSignal(generateText({
      model: getModelClient(model, config) as LanguageModel,
      prompt: repairPrompt(ctx),
      maxRetries: 0,
      temperature: 0,
      abortSignal: signal,
    }), signal)
    signal.throwIfAborted()
    return filesFromModel(ctx.files, ctx.error, text)
  } catch (e) {
    if (signal.aborted) throw signal.reason
    console.warn(
      '[EvoStack][REPAIR] model unavailable',
      e instanceof Error ? e.message : e,
    )
    return null
  } finally { clearTimeout(timer) }
}

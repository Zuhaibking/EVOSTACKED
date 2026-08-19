import {
  getFragmentFiles,
  getPrimaryFileContent,
} from '@/lib/fragment'
import { FragmentSchema } from '@/lib/schema'
import { getTemplateId } from '@/lib/templates'
import { ExecutionResult, ExecutionResultInterpreter, ExecutionResultWeb } from '@/lib/types'
import {
  VerificationResult,
  extractPreviewOverlayErrorFromHtml,
  extractUsefulError,
  isPreviewOverlayFailure,
  truncateDiagnostic,
} from '@/lib/verification'
import {
  createSandboxSerialized,
  formatSandboxCreateError,
  shouldRetrySandboxDeploy,
  withSandboxCreateLock,
} from '@/lib/sandbox-transport'
import {
  buildInspectInjectFiles,
  shouldInjectInspect,
} from '@/lib/design-mode/inject'
import { sanitizeInspectStamps, stampDataOids } from '@/lib/design-mode/rewrite-classes'
import {
  isForbiddenManifestPath,
  resolveInstallCommand,
} from '@/lib/dependency-closure'
import { Sandbox } from '@e2b/code-interpreter'

const SANDBOX_TIMEOUT_MS = 10 * 60 * 1000
const INSTALL_TIMEOUT_MS = 90_000
const READY_TIMEOUT_MS = 60_000
const READY_POLL_MS = 2_000
const HTTP_ATTEMPT_TIMEOUT_MS = 8_000

export type TemplateRuntimeKind = 'web' | 'interpreter'

export function getTemplateRuntime(templateId: string): {
  kind: TemplateRuntimeKind
  port: number | null
} {
  const id = getTemplateId(templateId)
  if (id === 'code-interpreter-v1') {
    return { kind: 'interpreter', port: null }
  }
  if (id === 'streamlit-developer') {
    return { kind: 'web', port: 8501 }
  }
  if (id === 'gradio-developer') {
    return { kind: 'web', port: 7860 }
  }
  // nextjs-developer, vue-developer, and unknown web templates
  return { kind: 'web', port: 3000 }
}

export type DeployAndVerifyOptions = {
  userID?: string
  teamID?: string
  accessToken?: string
  /** Skip HTTP/process checks and only write+return URL (not used by tournament). */
  skipChecks?: boolean
}

export type DeployAndVerifyResult = {
  verification: VerificationResult
  execution?: ExecutionResult
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fileExists(sbx: Sandbox, path: string): Promise<boolean> {
  try {
    await sbx.files.read(path)
    return true
  } catch {
    return false
  }
}

async function waitForHttp(
  url: string,
  timeoutMs: number,
): Promise<{
  ok: boolean
  status?: number
  error?: string
  partial?: boolean
  compileError?: string
}> {
  const deadline = Date.now() + timeoutMs
  let lastStatus: number | undefined
  let lastError: string | undefined
  let compileError: string | undefined

  while (Date.now() < deadline) {
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), HTTP_ATTEMPT_TIMEOUT_MS)
      const res = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
        headers: { Accept: 'text/html,application/json,*/*' },
      }).finally(() => clearTimeout(timer))

      lastStatus = res.status
      const body = (await res.text().catch(() => '')).slice(0, 20_000)
      const extracted = extractPreviewOverlayErrorFromHtml(body)
      if (extracted) compileError = extracted

      if (extracted && isPreviewOverlayFailure(extracted)) {
        return {
          ok: false,
          partial: true,
          status: res.status,
          error: extracted,
          compileError: extracted,
        }
      }

      if (res.ok && !extracted) {
        return { ok: true, status: res.status }
      }
      // App is up but returning an error page — keep the real compile message.
      if (res.status >= 400 && res.status < 600) {
        lastError =
          extracted || `Preview responded with HTTP ${res.status}`
        if (extracted && isPreviewOverlayFailure(extracted)) {
          return {
            ok: false,
            partial: true,
            status: res.status,
            error: extracted,
            compileError: extracted,
          }
        }
      }
    } catch (e: any) {
      lastError =
        e?.name === 'AbortError'
          ? 'Preview request timed out'
          : truncateDiagnostic(e?.message || 'Preview fetch failed', 200)
    }
    await sleep(READY_POLL_MS)
  }

  if (lastStatus && lastStatus >= 400) {
    return {
      ok: false,
      partial: true,
      status: lastStatus,
      error:
        compileError ||
        lastError ||
        `Application did not return a successful response within ${timeoutMs}ms (last HTTP ${lastStatus}).`,
      compileError,
    }
  }

  return {
    ok: false,
    status: lastStatus,
    error:
      lastError ||
      `Application did not become reachable within the startup timeout (${timeoutMs}ms).`,
    compileError,
  }
}

/**
 * Create an E2B sandbox, write candidate files, install deps if needed,
 * and collect deterministic runtime evidence. Keeps the sandbox alive on
 * success so the client can reuse it for preview.
 *
 * Full boot (create + install + Next start) is serialized so concurrent
 * tournament specimens cannot OOM each other. Infra deaths retry once.
 */
export async function deployAndVerify(
  fragment: FragmentSchema,
  opts: DeployAndVerifyOptions = {},
): Promise<DeployAndVerifyResult> {
  return withSandboxCreateLock(async () => {
    const first = await deployAndVerifyOnce(fragment, opts)
    if (
      opts.skipChecks ||
      !shouldRetrySandboxDeploy(
        first.verification.errors,
        first.verification.previewReachable,
      )
    ) {
      return first
    }
    return deployAndVerifyOnce(fragment, opts)
  })
}

async function deployAndVerifyOnce(
  fragment: FragmentSchema,
  opts: DeployAndVerifyOptions = {},
): Promise<DeployAndVerifyResult> {
  const started = Date.now()
  const errors: string[] = []
  const warnings: string[] = []
  const files = getFragmentFiles(fragment)
  const sandboxTemplate = getTemplateId(fragment.template)
  const runtime = getTemplateRuntime(sandboxTemplate)
  const port = fragment.port ?? runtime.port ?? 80

  let filesWritten = false
  let dependenciesInstalled: boolean | 'not_required' = 'not_required'
  let processStarted = false
  let previewReachable = false
  let httpStatus: number | undefined
  let sbx: Sandbox | undefined
  let sbxId: string | undefined
  let url: string | undefined
  let execution: ExecutionResult | undefined
  const checkedFiles: string[] = []
  const missingFiles: string[] = []

  if (files.length === 0) {
    return {
      verification: {
        status: 'failed',
        filesWritten: false,
        dependenciesInstalled: 'not_required',
        processStarted: false,
        previewReachable: false,
        errors: ['Fragment contains no files to write'],
        warnings: [],
        durationMs: Date.now() - started,
        template: sandboxTemplate,
      },
    }
  }

  if (!process.env.E2B_API_KEY?.trim()) {
    return {
      verification: {
        status: 'failed',
        filesWritten: false,
        dependenciesInstalled: 'not_required',
        processStarted: false,
        previewReachable: false,
        errors: [
          'E2B_API_KEY is missing from the API process. Sandbox create skipped.',
        ],
        warnings: [],
        durationMs: Date.now() - started,
        template: sandboxTemplate,
      },
    }
  }

  try {
    sbx = await createSandboxSerialized(
      () =>
        Sandbox.create(sandboxTemplate, {
          metadata: {
            template: sandboxTemplate,
            userID: opts.userID ?? '',
            teamID: opts.teamID ?? '',
          },
          timeoutMs: SANDBOX_TIMEOUT_MS,
          ...(opts.teamID && opts.accessToken
            ? {
                headers: {
                  'X-Supabase-Team': opts.teamID,
                  'X-Supabase-Token': opts.accessToken,
                },
              }
            : {}),
        }),
    )
    sbxId = sbx.sandboxId
    processStarted = true // template startCmd is running for web templates

    // Install extra packages declared on the fragment (or synthesized from
    // additional_dependencies). Do not require both flags — that skipped bcryptjs.
    const installCommand = resolveInstallCommand(fragment)
    if (installCommand) {
      try {
        const install = await sbx.commands.run(installCommand, {
          timeoutMs: INSTALL_TIMEOUT_MS,
        })
        if (install.exitCode === 0) {
          dependenciesInstalled = true
        } else {
          dependenciesInstalled = false
          errors.push(
            extractUsefulError(install.stdout || '', install.stderr || '') ||
              `Dependency install failed (exit ${install.exitCode})`,
          )
        }
      } catch (e: any) {
        dependenciesInstalled = false
        errors.push(
          truncateDiagnostic(
            e?.message || 'Dependency install timed out or crashed',
            400,
          ),
        )
      }
    }

    // Write generated source. Never overlay template package.json / lockfiles.
    const injectInspect = shouldInjectInspect(sandboxTemplate)
    for (const file of files) {
      if (isForbiddenManifestPath(file.file_path)) continue
      const content = injectInspect
        ? stampDataOids(file.file_path, file.file_content)
        : sanitizeInspectStamps(file.file_content)
      await sbx.files.write(file.file_path, content)
    }

    if (injectInspect) {
      try {
        const extras = buildInspectInjectFiles(files.map((file) => file.file_path))
        for (const extra of extras) {
          await sbx.files.write(extra.file_path, extra.file_content)
        }
      } catch {
        warnings.push('Inspect probe was not injected; preview still runs.')
      }
    }

    // Confirm expected files exist on disk.
    const toCheck = Array.from(
      new Set<string>([
        ...files
          .filter((f) => !isForbiddenManifestPath(f.file_path))
          .map((f) => f.file_path),
        ...(fragment.file_path && !isForbiddenManifestPath(fragment.file_path)
          ? [fragment.file_path]
          : []),
      ]),
    )
    for (const path of toCheck) {
      checkedFiles.push(path)
      const exists = await fileExists(sbx, path)
      if (!exists) missingFiles.push(path)
    }
    filesWritten = missingFiles.length === 0
    if (!filesWritten) {
      errors.push(`Missing files after write: ${missingFiles.join(', ')}`)
    }

    if (runtime.kind === 'interpreter') {
      const source = getPrimaryFileContent(fragment)
      const { logs, error, results } = await sbx.runCode(source || '')
      execution = {
        sbxId: sbx.sandboxId,
        template: sandboxTemplate,
        stdout: logs.stdout,
        stderr: logs.stderr,
        runtimeError: error,
        cellResults: results,
      } as ExecutionResultInterpreter

      if (error) {
        processStarted = false
        const errAny = error as any
        errors.push(
          truncateDiagnostic(
            `${errAny.name || 'RuntimeError'}: ${errAny.value || errAny.traceback || errAny.message || 'code execution failed'}`,
            500,
          ),
        )
      } else {
        processStarted = true
        previewReachable = true // interpreter "preview" is the cell result
      }
    } else {
      url = `https://${sbx.getHost(port)}`
      execution = {
        sbxId: sbx.sandboxId,
        template: sandboxTemplate,
        url,
      } as ExecutionResultWeb

      if (!opts.skipChecks && filesWritten && dependenciesInstalled !== false) {
        const ready = await waitForHttp(url, READY_TIMEOUT_MS)
        httpStatus = ready.status
        if (ready.ok) {
          previewReachable = true
          processStarted = true
        } else if (ready.compileError && isPreviewOverlayFailure(ready.compileError)) {
          previewReachable = false
          processStarted = true
          errors.push(ready.compileError)
        } else if (ready.partial) {
          previewReachable = false
          processStarted = true
          warnings.push(ready.error || `HTTP ${ready.status}`)
        } else {
          previewReachable = false
          errors.push(
            ready.error ||
              'Application did not become reachable within the startup timeout.',
          )
          // Try to scrape recent process noise via a harmless command if possible.
          try {
            const probe = await sbx.commands.run(
              'echo ready-check',
              { timeoutMs: 5_000 },
            )
            if (probe.exitCode !== 0) {
              warnings.push('Sandbox shell probe failed after preview miss')
            }
          } catch {
            /* ignore */
          }
        }
      } else if (dependenciesInstalled === false) {
        warnings.push('Skipped preview check because dependency install failed')
      } else if (!filesWritten) {
        warnings.push('Skipped preview check because files were missing')
      } else {
        // skipChecks — assume template process is up
        previewReachable = true
      }
    }
  } catch (e: any) {
    errors.push(truncateDiagnostic(formatSandboxCreateError(e), 500))
    processStarted = false
    // Best-effort cleanup when we never got a usable sandbox.
    if (sbx) {
      try {
        await sbx.kill()
      } catch {
        /* ignore */
      }
      sbx = undefined
      sbxId = undefined
      execution = undefined
      url = undefined
    }
  }

  const durationMs = Date.now() - started

  let status: VerificationResult['status'] = 'passed'
  if (
    !filesWritten ||
    dependenciesInstalled === false ||
    errors.length > 0 ||
    (runtime.kind === 'web' && !previewReachable && !opts.skipChecks) ||
    (runtime.kind === 'interpreter' && !previewReachable)
  ) {
    // Partial: process answered with HTTP error but sandbox is alive
    if (
      filesWritten &&
      dependenciesInstalled !== false &&
      processStarted &&
      warnings.length > 0 &&
      !previewReachable &&
      httpStatus &&
      httpStatus >= 400
    ) {
      status = 'partial'
    } else {
      status = 'failed'
    }
  }

  // Kill only hard failures with no reusable preview host.
  // If we already have a getHost URL but HTTP readiness timed out, keep the
  // sandbox + URL as `partial` so Preview can still load (Next may still be
  // compiling or showing an in-app error overlay). Never fabricate URLs.
  if (status === 'failed' && sbx) {
    const hasHostUrl =
      typeof url === 'string' &&
      url.length > 0 &&
      execution &&
      'url' in execution
    const softTimeoutPattern =
      /did not become reachable|startup timeout|timed out|Preview fetch failed|Preview request timed out|fetch failed|ECONNREFUSED|ENOTFOUND|network|socket/i
    const softTimeout =
      hasHostUrl &&
      filesWritten &&
      dependenciesInstalled !== false &&
      errors.some((e) => softTimeoutPattern.test(e))

    const overlayFailure = errors.some((e) => isPreviewOverlayFailure(e))

    if (softTimeout && !overlayFailure) {
      status = 'partial'
      processStarted = true
      warnings.push(
        'Preview host was provisioned but readiness checks timed out — URL kept for Preview.',
      )
      // Move timeout messages to warnings; keep real compile/runtime signals in errors if any.
      const keptErrors = errors.filter((e) => !softTimeoutPattern.test(e))
      errors.length = 0
      errors.push(...keptErrors)
    } else if (hasHostUrl && overlayFailure) {
      // Real build/compile failure — keep the host so Preview/Source stay inspectable.
      processStarted = true
    } else {
      try {
        await sbx.kill()
      } catch {
        /* ignore */
      }
      // Keep sbxId in the report for diagnostics, but drop reusable execution URL.
      execution = undefined
      url = undefined
    }
  }

  const verification: VerificationResult = {
    status,
    filesWritten,
    dependenciesInstalled,
    processStarted,
    previewReachable,
    errors:
      httpStatus &&
      errors.length > 0 &&
      !errors.some((e) => /HTTP\s+\d{3}/i.test(e))
        ? [`${errors[0]} — HTTP ${httpStatus}`, ...errors.slice(1)]
        : errors,
    warnings,
    durationMs,
    sbxId,
    url,
    template: sandboxTemplate,
    checkedFiles,
    missingFiles: missingFiles.length ? missingFiles : undefined,
    httpStatus,
  }

  return { verification, execution }
}

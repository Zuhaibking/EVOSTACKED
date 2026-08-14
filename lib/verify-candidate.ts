import {
  getFragmentFiles,
  getPrimaryFileContent,
} from '@/lib/fragment'
import { FragmentSchema } from '@/lib/schema'
import { getTemplateId } from '@/lib/templates'
import { ExecutionResult, ExecutionResultInterpreter, ExecutionResultWeb } from '@/lib/types'
import {
  VerificationResult,
  extractUsefulError,
  truncateDiagnostic,
} from '@/lib/verification'
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
): Promise<{ ok: boolean; status?: number; error?: string; partial?: boolean }> {
  const deadline = Date.now() + timeoutMs
  let lastStatus: number | undefined
  let lastError: string | undefined

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
      // Drain body so the connection can close cleanly.
      await res.arrayBuffer().catch(() => undefined)

      if (res.ok) {
        return { ok: true, status: res.status }
      }
      // App is up but returning an error page — partial evidence.
      if (res.status >= 400 && res.status < 600) {
        lastError = `Preview responded with HTTP ${res.status}`
        // Keep polling a bit — Next may still be compiling.
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
        lastError ||
        `Application did not return a successful response within ${timeoutMs}ms (last HTTP ${lastStatus}).`,
    }
  }

  return {
    ok: false,
    status: lastStatus,
    error:
      lastError ||
      `Application did not become reachable within the startup timeout (${timeoutMs}ms).`,
  }
}

/**
 * Create an E2B sandbox, write candidate files, install deps if needed,
 * and collect deterministic runtime evidence. Keeps the sandbox alive on
 * success so the client can reuse it for preview.
 */
export async function deployAndVerify(
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

  try {
    sbx = await Sandbox.create(sandboxTemplate, {
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
    })
    sbxId = sbx.sandboxId
    processStarted = true // template startCmd is running for web templates

    // Install additional packages before/after write — before write is fine.
    if (
      fragment.has_additional_dependencies &&
      fragment.install_dependencies_command?.trim()
    ) {
      try {
        const install = await sbx.commands.run(
          fragment.install_dependencies_command,
          { timeoutMs: INSTALL_TIMEOUT_MS },
        )
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

    // Write all project files.
    for (const file of files) {
      await sbx.files.write(file.file_path, file.file_content)
    }

    // Confirm expected files exist on disk.
    const toCheck = Array.from(
      new Set<string>([
        ...files.map((f) => f.file_path),
        ...(fragment.file_path ? [fragment.file_path] : []),
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
    errors.push(
      truncateDiagnostic(e?.message || 'Sandbox create/verify failed', 500),
    )
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

  // Kill failed sandboxes to avoid wasting quota; keep passed/partial for preview.
  if (status === 'failed' && sbx) {
    try {
      await sbx.kill()
    } catch {
      /* ignore */
    }
    // Keep sbxId in the report for diagnostics, but drop reusable execution URL.
    execution = undefined
    url = undefined
  }

  const verification: VerificationResult = {
    status,
    filesWritten,
    dependenciesInstalled,
    processStarted,
    previewReachable,
    errors,
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

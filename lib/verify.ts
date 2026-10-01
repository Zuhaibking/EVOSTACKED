/** A candidate is usable only after install, compile, and preview checks pass. */

import type { CandidateHealth, HealthState } from './candidate-health'
import type { WrittenFile } from './fragment-files'
import { packagesToInstall, npmPackageName } from './fragment-deps'
import { sanitizeHydrationFile } from './hydrate-safe'
import { repairSyntax } from './syntax-safe'
import { normalizeProjectPath, validateProjectFiles } from './project-paths'

export type { CandidateHealth, HealthState } from './candidate-health'
export { candidateHealthLabel } from './candidate-health'

export const MAX_REPAIR_ATTEMPTS = 3

export type ErrorCategory =
  | 'MODULE_NOT_FOUND'
  | 'DEPENDENCY_INSTALL_ERROR'
  | 'TYPESCRIPT_ERROR'
  | 'NEXT_BUILD_ERROR'
  | 'NEXT_SSR_ERROR'
  | 'NEXT_CLIENT_SERVER_ERROR'
  | 'HYDRATION_ERROR'
  | 'REACT_RUNTIME_ERROR'
  | 'SYNTAX_ERROR'
  | 'IMPORT_ERROR'
  | 'EXPORT_ERROR'
  | 'CSS_ERROR'
  | 'IMAGE_ERROR'
  | 'ROUTING_ERROR'
  | 'RUNTIME_ERROR'
  | 'HTTP_500'
  | 'HTTP_404'
  | 'ESLINT_ERROR'

export type VerifyPhase = 'install' | 'build' | 'preview' | 'runtime'

export type NormalizedError = {
  category: ErrorCategory
  package?: string
  file?: string
  line?: number
  column?: number
  message: string
  rawOutput: string
  phase: VerifyPhase
}

export type GateSnapshot = {
  install: boolean
  build: boolean
  preview: boolean
  http: boolean
  runtime: boolean
}

export type ProbeResult = {
  ok: boolean
  output: string
  httpStatus?: number
  phase: 'build' | 'preview'
}

export type RepairContext = {
  error: NormalizedError
  files: WrittenFile[]
  attempt: number
  history: string[]
}

type InstallResult = { ok: boolean; output: string }

const COMPILE_FAIL =
  /Module not found|Can't resolve '|Cannot find module|Failed to compile|Parsing ecmascript source code failed|Build Error|Unexpected token|Unexpected eof/i

export function isBuildFailure(body: string): boolean {
  return COMPILE_FAIL.test(body || '')
}

export function classifyOutput(
  raw: string,
  phase: VerifyPhase,
  httpStatus?: number,
): NormalizedError {
  const text = raw || ''
  const message = text.split('\n').map((l) => l.trim()).find(Boolean) || text.slice(0, 240)
  const loc = /(?:\.\/)?([A-Za-z0-9_./@()[\]-]+\.[A-Za-z]+)(?::(\d+):(\d+)|\((\d+),(\d+)\))/.exec(text)
  const base = {
    message,
    rawOutput: text.slice(0, 4000),
    phase,
    file: loc?.[1],
    line: loc ? Number(loc[2] || loc[4]) : undefined,
    column: loc ? Number(loc[3] || loc[5]) : undefined,
  }

  if (phase === 'install' || /npm ERR!/i.test(text)) {
    return { ...base, phase: 'install', category: 'DEPENDENCY_INSTALL_ERROR', message: installDetail(text) || message }
  }

  const missing = /(?:Can't resolve|Cannot find module)\s+['"]([^'"]+)['"]/i.exec(text)
  if (missing) {
    return { ...base, category: 'MODULE_NOT_FOUND', package: npmPackageName(missing[1]) || missing[1] }
  }
  if (/window is not defined|document is not defined|localStorage is not defined/i.test(text)) {
    return { ...base, category: 'NEXT_SSR_ERROR' }
  }
  if (/use client|Client Component/i.test(text)) {
    return { ...base, category: 'NEXT_CLIENT_SERVER_ERROR' }
  }
  if (/Hydration failed|did not match|Text content does not match/i.test(text)) {
    return { ...base, category: 'HYDRATION_ERROR' }
  }
  if (/Parsing ecmascript|Unexpected eof|Unexpected token/i.test(text)) {
    return { ...base, category: 'SYNTAX_ERROR' }
  }
  if (/is not exported|Attempted import error/i.test(text)) {
    return { ...base, category: 'IMPORT_ERROR' }
  }
  if (/default export/i.test(text)) {
    return { ...base, category: 'EXPORT_ERROR' }
  }
  if (/React Hook|Rendered more hooks|Invalid hook call/i.test(text)) {
    return { ...base, category: 'REACT_RUNTIME_ERROR' }
  }
  if (/next\/image|Invalid src prop/i.test(text)) {
    return { ...base, category: 'IMAGE_ERROR' }
  }
  if (/CssSyntaxError|Module parse failed.*\.css/i.test(text)) {
    return { ...base, category: 'CSS_ERROR' }
  }
  if (/eslint/i.test(text)) return { ...base, category: 'ESLINT_ERROR' }
  if (/This page could not be found/i.test(text) || httpStatus === 404) {
    return { ...base, category: 'HTTP_404' }
  }
  if (/error TS\d+/i.test(text)) return { ...base, category: 'TYPESCRIPT_ERROR' }
  if (/Failed to compile|Build Error/i.test(text)) return { ...base, category: 'NEXT_BUILD_ERROR' }
  if (httpStatus === 500) return { ...base, category: 'HTTP_500' }
  if (/Application error|Unhandled Runtime/i.test(text)) {
    return { ...base, category: 'RUNTIME_ERROR' }
  }
  return { ...base, category: phase === 'runtime' ? 'RUNTIME_ERROR' : 'NEXT_BUILD_ERROR' }
}

function installDetail(text: string): string {
  if (/ERESOLVE/i.test(text)) return 'peer dependency conflict'
  if (/404 Not Found|ETARGET/i.test(text)) return 'package unavailable'
  if (/ETIMEDOUT|ENOTFOUND|network/i.test(text)) return 'network failure'
  if (/Invalid package name/i.test(text)) return 'invalid package name'
  if (/package-lock|EBADLOCK/i.test(text)) return 'lockfile conflict'
  return ''
}

export function regressed(before: GateSnapshot, after: GateSnapshot): boolean {
  return (Object.keys(before) as (keyof GateSnapshot)[]).some((k) => before[k] && !after[k])
}

export function repairPrompt(ctx: RepairContext): string {
  const file = ctx.files[fileIndex(ctx.files, ctx.error)]
  return `Fix the root cause with the smallest possible change.

Do not redesign the application.
Do not modify unrelated files.
Do not remove requested functionality.
Do not replace dependencies unnecessarily.
Do not hide the error.
Do not weaken TypeScript.
Do not disable linting/build checks.
Do not suppress errors just to make the build pass.
Do not add @ts-ignore, @ts-nocheck, or eslint-disable.
Do not comment out broken code.
Do not replace the page with a fallback.
Keep server HTML and the first client render identical. Initialize state with deterministic values and restore browser preferences in useEffect. Gate useTheme/resolvedTheme-dependent output until mounted; do not suppress hydration warnings or disable SSR.

Error category: ${ctx.error.category}
Phase: ${ctx.error.phase}
File: ${ctx.error.file || file?.file_path || ''}
Message: ${ctx.error.message}
Previous attempts:
${ctx.history.join('\n') || '(none)'}

Return JSON only: {"files":[{"file_path":"project-relative path","file_content":"complete corrected source"}]}.
Include only changed files. Preserve all other files. Fix ${file?.file_path || ctx.error.file || 'the indicated source'} when it is responsible. Missing local imports need a real implemented module at the correct resolved path; do not install local paths as npm packages or fabricate empty stubs. You may add a real missing module. Do not replace template configuration. CSS and JSON fixes must keep their original language.

PROJECT SOURCE:
${ctx.files.map(source => `FILE: ${source.file_path}\n${source.file_content}`).join('\n\n')}`
}

export function acceptPatch(before: string, after: string): boolean {
  const next = after.trim()
  if (!next) return false
  if (before.length > 200 && next.length < before.length * 0.4) return false
  const bad = /@ts-ignore|@ts-nocheck|eslint-disable/g
  const added = (next.match(bad) || []).length - (before.match(bad) || []).length
  if (added > 0) return false
  if (/export\s+default\b/.test(before) && !/export\s+default\b/.test(next)) return false
  return true
}

export function filesFromModel(
  files: WrittenFile[],
  error: NormalizedError,
  text: string,
): WrittenFile[] | null {
  const json = /```json\s*([\s\S]*?)```/.exec(text)?.[1] || text.trim()
  if (json.startsWith('{')) {
    try {
      const value = JSON.parse(json)
      const patches = value.files
      if (!('files' in value)) {
        if (!text.includes('```')) return null
      } else {
      if (!Array.isArray(patches) || !patches.length) return null
      validateProjectFiles(patches)
      const copy = files.map(file => ({ ...file }))
      for (const patch of patches) {
        const path = normalizeProjectPath(patch.file_path)
        const i = copy.findIndex(file => file.file_path === path)
        if (!acceptPatch(i < 0 ? '' : copy[i].file_content, patch.file_content)) return null
        const updated = { file_path: path, file_content: patch.file_content }
        if (i < 0) copy.push(updated)
        else copy[i] = updated
      }
      validateProjectFiles(copy)
      return copy
      }
    } catch { return null }
  }
  const fence = /```(?:(?:tsx|ts|jsx|js|css|json|vue|html)\b)?\s*([\s\S]*?)```/.exec(text)
  const next = (fence?.[1] || '').trim()
  if (!next) return null
  const i = fileIndex(files, error)
  if (i < 0) return null
  if (!acceptPatch(files[i].file_content, next)) return null
  const copy = files.map((f) => ({ ...f }))
  copy[i] = { ...copy[i], file_content: next.endsWith('\n') ? next : `${next}\n` }
  return copy
}

/** Known mechanical fixes. Returns null when the evidence does not support one. */
export function deterministicRepair(
  files: WrittenFile[],
  error: NormalizedError,
): WrittenFile[] | null {
  const i = fileIndex(files, error)
  if (i < 0) return null
  const code = files[i].file_content
  let next: string | null = null

  if (error.category === 'SYNTAX_ERROR' || /Unexpected eof|Parsing ecmascript/i.test(error.message)) {
    const repaired = repairSyntax(code)
    if (repaired !== code) next = repaired
  } else if (error.category === 'NEXT_SSR_ERROR') {
    const repaired = sanitizeHydrationFile(files[i].file_path, code)
    if (repaired !== code) next = repaired
  } else if (error.category === 'NEXT_CLIENT_SERVER_ERROR' && !/^\s*['"]use client['"]/.test(code)) {
    next = `'use client'\n${code}`
  } else if (error.category === 'EXPORT_ERROR' && !/\bexport\s+default\b/.test(code)) {
    const name = /export\s+function\s+([A-Za-z0-9_]+)/.exec(code)?.[1] || /function\s+([A-Za-z0-9_]+)/.exec(code)?.[1]
    if (name) next = `${code.replace(/\s*$/, '')}\nexport default ${name}\n`
  } else if (error.category === 'HYDRATION_ERROR') {
    const repaired = sanitizeHydrationFile(files[i].file_path, code)
    if (repaired !== code) next = repaired
  }

  if (next == null || next === code) return null
  const copy = files.map((f) => ({ ...f }))
  copy[i] = { ...copy[i], file_content: next }
  return copy
}

export async function healCandidate(opts: {
  files: WrittenFile[]
  present: readonly string[]
  declared?: unknown
  label?: string
  probe: (files: WrittenFile[]) => Promise<ProbeResult>
  install: (packages: string[]) => Promise<InstallResult>
  llmRepair?: (ctx: RepairContext) => Promise<WrittenFile[] | null>
  log?: (line: string) => void
}): Promise<{ files: WrittenFile[]; health: CandidateHealth; probed: boolean }> {
  const logs: string[] = []
  const note = (line: string) => {
    logs.push(line)
    opts.log?.(line)
  }
  const label = opts.label || 'preview'
  let files = opts.files.map((f) => ({ ...f }))
  const present = new Set(opts.present)
  let repaired = false
  let probed = false
  let attempts = 0
  const history: string[] = []
  const reinstalled = new Set<string>()

  note(`[EvoStack][VERIFY] ${label}`)
  note('[EvoStack][STATE] VERIFYING')

  const missing = packagesToInstall(files, opts.declared, [...present])
  if (missing.length) {
    note(`[EvoStack][DEPENDENCY] Missing package: ${missing.join(', ')}`)
    note('[EvoStack][STATE] INSTALLING_DEPENDENCIES')
    note(`[EvoStack][REPAIR] Installing ${missing.join(' ')}`)
    const inst = await opts.install(missing)
    if (!inst.ok) {
      const err = classifyOutput(inst.output, 'install')
      note(`[EvoStack][ERROR] ${err.category} ${err.message}`)
      note('[EvoStack][RESULT] FAILED')
      return {
        files,
        probed,
        health: healthOf({
          state: 'FAILED',
          logs,
          attempts,
          repaired,
          verified: false,
          dependency: 'failed',
          build: 'skipped',
          runtime: 'skipped',
        }),
      }
    }
    missing.forEach((p) => present.add(p))
    repaired = true
  }

  let probe = await runProbe(opts.probe, files)
  probed = true
  if (!probe.ok && inconclusiveProbe(probe)) {
    note('[EvoStack][RESULT] UNVERIFIED')
    return {
      files,
      probed,
      health: healthOf({
        state: 'UNVERIFIED',
        logs,
        attempts,
        repaired,
        verified: false,
        dependency: 'passed',
        build: 'skipped',
        runtime: 'skipped',
      }),
    }
  }
  if (probe.ok) {
    note(`[EvoStack][${probe.phase === 'build' ? 'BUILD' : 'HTTP'}] PASS`)
    note('[EvoStack][RUNTIME] Browser hydration and interactions not checked')
    note('[EvoStack][RESULT] UNVERIFIED')
    return {
      files,
      probed,
      health: healthOf({
        state: 'UNVERIFIED',
        logs,
        attempts,
        repaired,
        verified: false,
        dependency: 'passed',
        build: probe.phase === 'build' ? 'passed' : 'skipped',
        runtime: 'skipped',
      }),
    }
  }

  let lastProbe = probe
  while (attempts < MAX_REPAIR_ATTEMPTS) {
    attempts++
    const checkpoint = files.map((f) => ({ ...f }))
    const before = gatesFrom(true, lastProbe)
    const err = classifyOutput(lastProbe.output, lastProbe.phase, lastProbe.httpStatus)
    note(`[EvoStack][REPAIR] Attempt ${attempts}/${MAX_REPAIR_ATTEMPTS}`)
    note(`[EvoStack][ERROR] ${err.category}`)
    if (err.file) note(`[EvoStack][FILE] ${err.file}`)
    note('[EvoStack][STATE] REPAIRING')
    history.push(`${err.category}: ${err.message}`)

    let nextFiles: WrittenFile[] | null = null
    if (err.category === 'MODULE_NOT_FOUND' && err.package && npmPackageName(err.package) && !reinstalled.has(err.package)) {
      reinstalled.add(err.package)
      note(`[EvoStack][DEPENDENCY] Missing package: ${err.package}`)
      note('[EvoStack][STATE] INSTALLING_DEPENDENCIES')
      const inst = await opts.install([err.package])
      if (inst.ok) {
        present.add(err.package)
        repaired = true
        nextFiles = files
      } else {
        note(`[EvoStack][ERROR] DEPENDENCY_INSTALL_ERROR ${classifyOutput(inst.output, 'install').message}`)
      }
    }

    if (!nextFiles) {
      const det = deterministicRepair(files, err)
      const sig = det ? det.map((f) => f.file_content).join('\0') : ''
      if (det && sig !== checkpoint.map((f) => f.file_content).join('\0')) {
        nextFiles = det
        repaired = true
        note('[EvoStack][REPAIR] deterministic')
      }
    }

    if (!nextFiles && opts.llmRepair) {
      const patched = await opts.llmRepair({ error: err, files, attempt: attempts, history })
      if (patched) {
        nextFiles = patched
        repaired = true
        note('[EvoStack][REPAIR] model patch')
      }
    }

    if (!nextFiles) break

    const more = packagesToInstall(nextFiles, [], [...present])
    if (more.length) {
      note(`[EvoStack][DEPENDENCY] Missing package: ${more.join(', ')}`)
      const inst = await opts.install(more)
      if (!inst.ok) {
        note('[EvoStack][ROLLBACK] dependency install failed')
        files = checkpoint
        continue
      }
      more.forEach((p) => present.add(p))
    }

    files = nextFiles.map((file) => ({
      ...file,
      file_content: sanitizeHydrationFile(file.file_path, file.file_content),
    }))
    note('[EvoStack][STATE] REBUILDING')
    const afterProbe = await runProbe(opts.probe, files)
    probed = true
    const after = gatesFrom(true, afterProbe)
    if (regressed(before, after)) {
      note('[EvoStack][ROLLBACK] repair regressed a passing gate')
      files = checkpoint
      continue
    }
    if (inconclusiveProbe(afterProbe)) {
      note('[EvoStack][RESULT] UNVERIFIED')
      return {
        files,
        probed,
        health: healthOf({
          state: 'UNVERIFIED',
          logs,
          attempts,
          repaired,
          verified: false,
          dependency: 'passed',
          build: 'skipped',
          runtime: 'skipped',
        }),
      }
    }
    if (afterProbe.ok) {
      note(`[EvoStack][${afterProbe.phase === 'build' ? 'BUILD' : 'HTTP'}] PASS`)
      note('[EvoStack][RUNTIME] Browser hydration and interactions not checked')
      note('[EvoStack][RESULT] UNVERIFIED')
      return {
        files,
        probed,
        health: healthOf({
          state: 'UNVERIFIED',
          logs,
          attempts,
          repaired,
          verified: false,
          dependency: 'passed',
          build: afterProbe.phase === 'build' ? 'passed' : 'skipped',
          runtime: 'skipped',
        }),
      }
    }
    lastProbe = afterProbe
  }

  const inconclusive = /timeout|aborted|ECONNREFUSED|fetch failed/i.test(lastProbe.output) && !isBuildFailure(lastProbe.output)
  note(`[EvoStack][RESULT] ${inconclusive ? 'UNVERIFIED' : 'FAILED'}`)
  return {
    files,
    probed,
    health: healthOf({
      state: inconclusive ? 'UNVERIFIED' : 'FAILED',
      logs,
      attempts,
      repaired,
      verified: false,
      dependency: 'passed',
      build: inconclusive ? 'skipped' : 'failed',
      runtime: 'skipped',
    }),
  }
}

async function runProbe(
  probe: (files: WrittenFile[]) => Promise<ProbeResult>,
  files: WrittenFile[],
): Promise<ProbeResult> {
  try {
    return await probe(files)
  } catch (e) {
    return {
      ok: false,
      output: e instanceof Error ? e.message : String(e),
      phase: 'preview',
    }
  }
}

function inconclusiveProbe(probe: ProbeResult): boolean {
  return !isBuildFailure(probe.output) && /timeout|aborted|ECONNREFUSED|fetch failed|AbortError/i.test(probe.output || '')
}

function gatesFrom(installOk: boolean, probe: ProbeResult): GateSnapshot {
  const compileFail = isBuildFailure(probe.output)
  const http = (probe.httpStatus ?? 0) >= 200 && (probe.httpStatus ?? 0) < 500
  return {
    install: installOk,
    build: probe.ok || !compileFail,
    preview: probe.ok,
    http: probe.ok || http,
    runtime: false,
  }
}

function fileIndex(files: WrittenFile[], error: NormalizedError): number {
  if (error.file) {
    const path = error.file.trim().replace(/\\/g, '/').replace(/^\.\//, '')
    const i = files.findIndex((f) => f.file_path === path || path.endsWith(`/${f.file_path}`))
    if (i >= 0) return i
    if (files.length > 1) return -1
  }
  return files.findIndex((f) => /\.(tsx|jsx|ts|js|vue)$/i.test(f.file_path))
}

function healthOf(p: {
  state: HealthState
  logs: string[]
  attempts: number
  repaired: boolean
  verified: boolean
  dependency: CandidateHealth['dependencyStatus']
  build: CandidateHealth['buildStatus']
  runtime: CandidateHealth['runtimeStatus']
}): CandidateHealth {
  return {
    state: p.state,
    buildStatus: p.build,
    runtimeStatus: p.runtime,
    dependencyStatus: p.dependency,
    repairAttempts: p.attempts,
    repaired: p.repaired,
    verified: p.verified,
    log: p.logs,
  }
}

import type { ExecutionResult } from './types'
import { sameFragmentSource } from './schema'

/** Shared by tournament previews, chat regeneration, and inspector edits. */
export async function createSandbox(
  payload: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<ExecutionResult> {
  const cached = payload.cachedResult as Extract<ExecutionResult, { url: string }> | undefined
  const source = payload.fragment as { code?: unknown; file_path?: string; template?: string; files?: { file_path?: string; file_content?: string }[] } | undefined
  if (cached && source) {
    const changed = cached.fragment && !sameFragmentSource(source, cached.fragment)
    let portable = source
    if (!changed && cached.recoveryFragment) portable = cached.recoveryFragment
    else if (Array.isArray(cached.imageQueries)) {
      const images = cached.imageQueries.slice(0, 128).filter((row) => row && typeof row.file === 'string' && /^[\w.-]+$/.test(row.file) && typeof row.query === 'string' && row.query.trim() && row.query.length <= 1000 && !/["'`\\\r\n)]/.test(row.query))
      function portableText(content: string): string {
        for (const row of images) content = content.split(`/evo-images/${row.file}`).join(`evo-image://${row.query}`)
        return content
      }
      const code = typeof source.code === 'string' ? portableText(source.code) : Array.isArray(source.code)
        ? source.code.map((file) => typeof file?.file_content === 'string' ? { ...file, file_content: portableText(file.file_content) } : file)
        : source.code
      portable = { ...source, code, ...(source.files ? { files: source.files.map((file) => ({ ...file, file_content: typeof file.file_content === 'string' ? portableText(file.file_content) : file.file_content })) } : {}) }
    }
    // Preserve saved edits and portable assets while replacing an older preview.
    payload = { ...payload, fragment: portable, cachedResult: changed || payload.runtimeError ? undefined : cached }
  }
  const deadline = AbortSignal.timeout(330_000)
  let response: Response
  let text: string
  try {
    response = await fetch('/api/sandbox', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
    })
    text = await response.text()
  } catch (error) {
    if (deadline.aborted && !signal?.aborted) throw new Error('Preview preparation timed out. Your source is saved; retry the preview.')
    throw error
  }
  let result: ExecutionResult
  try {
    result = JSON.parse(text)
  } catch {
    throw new Error(response.ok ? 'The preview returned an invalid response.' : text.slice(0, 300) || `Preview failed (${response.status}).`)
  }
  if (!response.ok) {
    const error = result as unknown as { error?: string; message?: string }
    throw new Error(error.error || error.message || `Preview failed (${response.status}).`)
  }
  if (!result || typeof result.sbxId !== 'string' || typeof result.template !== 'string') {
    throw new Error('The preview could not be created. Please retry.')
  }
  if ('health' in result && result.health?.state === 'FAILED') {
    throw new Error(result.health.log.slice(-3).join('\n') || 'The generated app failed its checks.')
  }
  if ('url' in result && result.health?.state === 'UNVERIFIED' && !result.health.log.some((line) =>
    line.includes('[EvoStack][HTTP] PASS') || line.includes('[EvoStack][PREVIEW] Saved sandbox reconnected; HTTP responded.'),
  )) {
    throw new Error('The preview server did not respond to its checks. Your source is saved; retry the preview.')
  }
  if ('runtimeError' in result && result.runtimeError) {
    throw new Error(result.runtimeError.value || 'The generated program failed to run.')
  }
  if (!('url' in result && typeof result.url === 'string') && !('stdout' in result && Array.isArray(result.stdout))) {
    throw new Error('The preview response has no running app or program output.')
  }
  return result
}

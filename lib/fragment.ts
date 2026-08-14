import { FragmentSchema } from '@/lib/schema'
import { DeepPartial } from 'ai'

export type FragmentFile = {
  file_path: string
  file_content: string
}

/** Runtime code shape: new multi-file arrays, or legacy single-string snapshots. */
export type FragmentCode =
  | string
  | Array<DeepPartial<FragmentFile> | FragmentFile>
  | undefined

/**
 * Normalize fragment.code (string | file[]) into a stable file list.
 * Keeps preview, sandbox, morph, and localStorage snapshots working across formats.
 */
export function getFragmentFiles(
  fragment:
    | DeepPartial<FragmentSchema>
    | FragmentSchema
    | { file_path?: string; code?: FragmentCode }
    | undefined
    | null,
): FragmentFile[] {
  if (!fragment) return []

  const code = fragment.code as FragmentCode
  const primaryPath =
    typeof fragment.file_path === 'string' ? fragment.file_path : 'untitled'

  if (typeof code === 'string') {
    if (!code) return []
    return [{ file_path: primaryPath, file_content: code }]
  }

  if (Array.isArray(code)) {
    return code
      .filter(
        (f): f is FragmentFile =>
          !!f &&
          typeof f.file_path === 'string' &&
          f.file_path.length > 0 &&
          typeof f.file_content === 'string',
      )
      .map((f) => ({
        file_path: f.file_path,
        file_content: f.file_content,
      }))
  }

  return []
}

export function getPrimaryFile(
  fragment:
    | DeepPartial<FragmentSchema>
    | FragmentSchema
    | { file_path?: string; code?: FragmentCode }
    | undefined
    | null,
): FragmentFile | undefined {
  const files = getFragmentFiles(fragment)
  if (files.length === 0) return undefined

  const primaryPath =
    typeof fragment?.file_path === 'string' ? fragment.file_path : undefined
  if (primaryPath) {
    const match = files.find((f) => f.file_path === primaryPath)
    if (match) return match
  }
  return files[0]
}

export function getPrimaryFileContent(
  fragment:
    | DeepPartial<FragmentSchema>
    | FragmentSchema
    | { file_path?: string; code?: FragmentCode }
    | undefined
    | null,
): string {
  return getPrimaryFile(fragment)?.file_content ?? ''
}

export function hasFragmentCode(
  fragment:
    | DeepPartial<FragmentSchema>
    | FragmentSchema
    | { file_path?: string; code?: FragmentCode }
    | undefined
    | null,
): boolean {
  return getFragmentFiles(fragment).length > 0
}

/** Stable equality for deciding whether to skip re-sandboxing. */
export function fragmentCodeEqual(
  a:
    | DeepPartial<FragmentSchema>
    | FragmentSchema
    | { file_path?: string; code?: FragmentCode }
    | undefined
    | null,
  b:
    | DeepPartial<FragmentSchema>
    | FragmentSchema
    | { file_path?: string; code?: FragmentCode }
    | undefined
    | null,
): boolean {
  const fa = getFragmentFiles(a)
  const fb = getFragmentFiles(b)
  if (fa.length !== fb.length) return false
  const sortKey = (f: FragmentFile) => f.file_path
  const sa = [...fa].sort((x, y) => sortKey(x).localeCompare(sortKey(y)))
  const sb = [...fb].sort((x, y) => sortKey(x).localeCompare(sortKey(y)))
  return sa.every(
    (f, i) =>
      f.file_path === sb[i].file_path && f.file_content === sb[i].file_content,
  )
}

/** Compact text for LLM judge prompts (file tree + truncated contents). */
export function summarizeFragmentForJudge(
  fragment: any,
  maxChars = 2200,
): string {
  const files = getFragmentFiles(fragment)
  if (files.length === 0) {
    return typeof fragment?.code === 'string'
      ? fragment.code.slice(0, maxChars)
      : ''
  }

  const header = files.map((f) => `- ${f.file_path}`).join('\n')
  let body = ''
  let remaining = maxChars - header.length - 32
  for (const f of files) {
    if (remaining <= 0) break
    const slice = f.file_content.slice(0, Math.max(200, Math.floor(remaining / files.length)))
    const chunk = `\n\n// ${f.file_path}\n${slice}`
    body += chunk
    remaining -= chunk.length
  }
  return `files:\n${header}${body}`
}

export function totalCodeLength(fragment: any): number {
  return getFragmentFiles(fragment).reduce(
    (n, f) => n + f.file_content.length,
    0,
  )
}

/**
 * Apply a single-file edit into a multi-file (or legacy string) fragment,
 * always returning the new array `code` shape.
 */
export function applyFileUpdate(
  fragment: FragmentSchema,
  filePath: string,
  nextContent: string,
): FragmentSchema['code'] {
  const files = getFragmentFiles(fragment)
  if (files.length === 0) {
    return [{ file_path: filePath, file_content: nextContent }]
  }

  const idx = files.findIndex((f) => f.file_path === filePath)
  if (idx === -1) {
    return [...files, { file_path: filePath, file_content: nextContent }]
  }

  return files.map((f, i) =>
    i === idx ? { file_path: filePath, file_content: nextContent } : f,
  )
}

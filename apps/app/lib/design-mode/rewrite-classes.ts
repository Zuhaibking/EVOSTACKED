import { applyFileUpdate, getFragmentFiles } from '@/lib/fragment'
import type { FragmentSchema } from '@/lib/schema'
import type { DeepPartial } from '@evostack/shared'
import type { InspectedNode, StylePatch } from './protocol'
import { JSX_OPEN, isJsxTagOpen } from './stamp-oids'
import { mergeClasses } from './tailwind-map'

export {
  sanitizeInspectStamps,
  stampDataOids,
} from './stamp-oids'

export type RewriteResult =
  | {
      ok: true
      filePath: string
      nextContent: string
      className: string
      content?: string
    }
  | { ok: false; reason: 'ambiguous' | 'not_found' | 'no_files' }

export function parseOid(
  oid: string | undefined,
): { filePath: string; index: number } | null {
  if (!oid) return null
  const match = oid.match(/^(.*):(\d+)$/)
  if (!match) return null
  const index = Number(match[2])
  if (!Number.isFinite(index) || index < 1) return null
  return { filePath: match[1], index }
}

function count(haystack: string, needle: string): number {
  if (!needle) return 0
  return haystack.split(needle).length - 1
}

function eachJsxOpen(
  source: string,
  visit: (tag: string, attrs: string, index: number, start: number) => boolean | void,
) {
  const re = new RegExp(JSX_OPEN.source, 'g')
  let n = 0
  let match: RegExpExecArray | null
  while ((match = re.exec(source))) {
    const tag = match[1]
    if (!isJsxTagOpen(source, match.index, tag)) continue
    n += 1
    if (visit(tag, match[2] || '', n, match.index) === false) return
  }
}

function tagStartForOid(source: string, oid: string): number {
  let index = source.indexOf(`data-oid="${oid}"`)
  if (index < 0) index = source.indexOf(`data-oid='${oid}'`)
  if (index >= 0) return source.lastIndexOf('<', index)
  const parsed = parseOid(oid)
  if (!parsed) return -1
  let found = -1
  eachJsxOpen(source, (_tag, _attrs, n, start) => {
    if (n === parsed.index) {
      found = start
      return false
    }
  })
  return found
}

function replaceClassOnTag(
  source: string,
  tagStart: number,
  nextClass: string,
): string | null {
  const slice = source.slice(tagStart, tagStart + 800)
  const close = slice.search(/\/?>/)
  if (close < 0) return null
  const tag = slice.slice(0, close)
  if (/class(?:Name)?\s*=\s*\{/.test(tag)) return null
  const classMatch = tag.match(/class(?:Name)?=(["'`])([\s\S]*?)\1/)
  if (classMatch && classMatch.index != null) {
    const quote = classMatch[1]
    const abs = tagStart + classMatch.index
    return (
      source.slice(0, abs) +
      `className=${quote}${nextClass}${quote}` +
      source.slice(abs + classMatch[0].length)
    )
  }
  const insertAt = tagStart + (tag.match(/^<\w+/)?.[0].length || 1)
  return (
    source.slice(0, insertAt) +
    ` className="${nextClass}"` +
    source.slice(insertAt)
  )
}

function replaceTextOnTag(
  source: string,
  tagStart: number,
  nextText: string,
): string {
  const gt = source.indexOf('>', tagStart)
  if (gt < 0) return source
  const close = source.indexOf('<', gt + 1)
  if (close < 0) return source
  const inner = source.slice(gt + 1, close)
  if (inner.includes('{')) return source
  return source.slice(0, gt + 1) + nextText + source.slice(close)
}

export function rewriteNodeInSource(
  source: string,
  node: InspectedNode,
  patches: StylePatch[],
): RewriteResult {
  const merged = mergeClasses(node.className, patches)
  if (node.oid) {
    const tagStart = tagStartForOid(source, node.oid)
    if (tagStart < 0) return { ok: false, reason: 'not_found' }
    const next = replaceClassOnTag(source, tagStart, merged.className)
    if (!next) return { ok: false, reason: 'ambiguous' }
    const withText =
      merged.content != null ? replaceTextOnTag(next, tagStart, merged.content) : next
    return {
      ok: true,
      filePath: node.sourceFile || parseOid(node.oid)?.filePath || '',
      nextContent: withText,
      className: merged.className,
      content: merged.content,
    }
  }

  const className = node.className.trim()
  if (!className) return { ok: false, reason: 'not_found' }
  const hits = count(source, className)
  if (hits === 0) return { ok: false, reason: 'not_found' }
  if (hits > 1) return { ok: false, reason: 'ambiguous' }
  const classIndex = source.indexOf(className)
  const tagStart = source.lastIndexOf('<', classIndex)
  const next = replaceClassOnTag(source, tagStart, merged.className)
  if (!next) return { ok: false, reason: 'not_found' }
  const withText =
    merged.content != null ? replaceTextOnTag(next, tagStart, merged.content) : next
  return {
    ok: true,
    filePath: node.sourceFile || '',
    nextContent: withText,
    className: merged.className,
    content: merged.content,
  }
}

export function applyPatchesToFragment(
  fragment: DeepPartial<FragmentSchema> | FragmentSchema | undefined,
  node: InspectedNode,
  patches: StylePatch[],
): RewriteResult & { code?: FragmentSchema['code'] } {
  const files = getFragmentFiles(fragment)
  if (!files.length) return { ok: false, reason: 'no_files' }

  const oidFile = parseOid(node.oid)?.filePath
  const preferredPath = node.sourceFile || oidFile
  const preferred = preferredPath
    ? files.filter((f) => f.file_path === preferredPath)
    : files
  const search = preferred.length ? preferred : files

  for (const file of search) {
    const result = rewriteNodeInSource(file.file_content, node, patches)
    if (result.ok) {
      const code = applyFileUpdate(
        {
          ...(fragment as FragmentSchema),
          file_path: String(fragment?.file_path || file.file_path),
          code: files,
        },
        file.file_path,
        result.nextContent,
      )
      return { ...result, filePath: file.file_path, code }
    }
    if (result.reason === 'ambiguous') return result
  }
  return { ok: false, reason: 'not_found' }
}

export function serializePatchesForPrompt(
  node: InspectedNode,
  patches: StylePatch[],
): string {
  const lines = patches.map((p) => `${p.prop}: ${p.value}`).join('; ')
  return `Apply these visual edits to <${node.tag}> class="${node.className}"${
    node.oid ? ` oid=${node.oid}` : ''
  }: ${lines}`
}


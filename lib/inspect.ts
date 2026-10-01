import { FragmentSchema, fragmentSchema, fragmentSourceFiles } from './schema'
import { sanitizeHydrationFile } from './hydrate-safe'
import { sanitizeMotionFile } from './motion-safe'
import { normalizeProjectPath, validateProjectFiles } from './project-paths'
import { DeepPartial } from 'ai'

export const INSPECT_SOURCE = 'evostack-inspect'

export const INSPECT_PILLS = [
  '/modern',
  '/contrast',
  '/spacious',
  '/simplify',
  '/readable',
  '/shadows',
  '/pop',
  '/hierarchy',
] as const

export type InspectRect = {
  top: number
  left: number
  width: number
  height: number
}

export type InspectStyles = {
  fontFamily: string
  fontSize: string
  fontWeight: string
  fontStyle: string
  lineHeight: string
  letterSpacing: string
  textAlign: string
  textTransform: string
  textDecoration: string
  color: string
  backgroundColor: string
  display: string
  width: string
  height: string
  padding: string
  margin: string
  borderRadius: string
  opacity: string
  boxShadow: string
  borderWidth: string
  borderStyle: string
  borderColor: string
}

export type InspectSelection = {
  tag: string
  id: string
  className: string
  selector: string
  text: string
  html: string
  rect: InspectRect
  styles: InspectStyles
}

export type InspectDraft = {
  text: string
  fontFamily: string
  fontSize: string
  fontWeight: string
  fontStyle: string
  lineHeight: string
  letterSpacing: string
  textAlign: string
  textTransform: string
  textDecoration: string
  color: string
  backgroundColor: string
  padding: string
  margin: string
  borderRadius: string
  opacity: string
  boxShadow: string
  borderWidth: string
  borderStyle: string
  borderColor: string
  hidden: boolean
}

export type InspectMessage =
  | { source: typeof INSPECT_SOURCE; type: 'ready' }
  | { source: typeof INSPECT_SOURCE; type: 'select'; payload: InspectSelection | null }
  | { source: typeof INSPECT_SOURCE; type: 'rect'; payload: InspectRect }
  | { source: typeof INSPECT_SOURCE; type: 'text'; payload: string }

export function isInspectMessage(data: unknown): data is InspectMessage {
  if (!data || typeof data !== 'object') return false
  const d = data as { source?: unknown; type?: unknown }
  return d.source === INSPECT_SOURCE && typeof d.type === 'string'
}

export function toCompleteFragment(
  fragment: DeepPartial<FragmentSchema> | undefined,
): FragmentSchema | null {
  if (!fragment?.file_path || !fragment.template) return null
  try {
    // A streamed incomplete file must not be silently discarded before an edit.
    if (fragment.files !== undefined && (!Array.isArray(fragment.files) || fragment.files.some(file => !file || typeof file.file_path !== 'string' || typeof file.file_content !== 'string'))) return null
    const files = fragmentSourceFiles(fragment).map(file => ({
      file_path: normalizeProjectPath(file.file_path),
      file_content: sanitizeHydrationFile(file.file_path, sanitizeMotionFile(file.file_path, file.file_content)),
    }))
    validateProjectFiles(files)
    const entryPath = normalizeProjectPath(fragment.file_path)
    const entry = files.find(file => file.file_path === entryPath)
    if (!entry) return null
    const supporting = files.filter(file => file.file_path !== entryPath)
    return {
      commentary: fragment.commentary || '',
      template: fragment.template,
      title: fragment.title || 'App',
      description: fragment.description || '',
      additional_dependencies: (fragment.additional_dependencies ?? []).filter((d): d is string => typeof d === 'string'),
      has_additional_dependencies: Boolean(fragment.has_additional_dependencies),
      install_dependencies_command: fragment.install_dependencies_command || '',
      port: typeof fragment.port === 'number' || fragment.port === null ? fragment.port : 3000,
      file_path: entryPath,
      code: entry.file_content,
      ...(fragment.files !== undefined || supporting.length ? { files: supporting } : {}),
    }
  } catch { return null }
}

export function isValidPatchedFragment(
  prev: FragmentSchema,
  next: unknown,
): next is FragmentSchema {
  const parsed = fragmentSchema.safeParse(next)
  if (!parsed.success || parsed.data.file_path !== prev.file_path || parsed.data.template !== prev.template) return false
  try {
    const before = fragmentSourceFiles(prev)
    const after = fragmentSourceFiles(parsed.data)
    validateProjectFiles(before)
    validateProjectFiles(after)
    const paths = new Set(after.map(file => normalizeProjectPath(file.file_path)))
    return before.every(file => paths.has(normalizeProjectPath(file.file_path)))
  } catch { return false }
}

/** A unique element/source match is a hint; ambiguous matches are left to full-context editing. */
export function locateProjectSourceSnippet(
  fragment: DeepPartial<FragmentSchema> | undefined,
  selection: InspectSelection | null,
  targetFile?: string,
): { filePath?: string; line: number; snippet: string } {
  const files = fragmentSourceFiles(fragment)
  if (targetFile) {
    const file = files.find(file => file.file_path === targetFile)
    return file ? { filePath: file.file_path, ...locateSourceSnippet(file.file_content, selection) } : { line: 0, snippet: '' }
  }
  if (!selection) return { line: 0, snippet: '' }
  const matches = files.flatMap(file => {
    const match = locateSourceSnippet(file.file_content, selection)
    return match.line ? [{ filePath: file.file_path, ...match }] : []
  })
  return matches.length === 1 ? matches[0] : { line: 0, snippet: '' }
}

export function locateSourceSnippet(
  code: string,
  selection: InspectSelection | null,
): { line: number; snippet: string } {
  if (!selection) return { line: 0, snippet: '' }
  const needles = [
    selection.text.trim().slice(0, 80),
    selection.id ? `id="${selection.id}"` : '',
    selection.id ? `id='${selection.id}'` : '',
    selection.className.split(/\s+/).find((c) => c.length > 3) || '',
  ].filter(Boolean)
  const lines = code.split('\n')
  for (const needle of needles) {
    const hit = lines.findIndex((l) => l.includes(needle))
    if (hit >= 0) {
      const from = Math.max(0, hit - 1)
      const to = Math.min(lines.length, hit + 2)
      return { line: hit + 1, snippet: lines.slice(from, to).join('\n') }
    }
  }
  return { line: 0, snippet: '' }
}

export function draftFromSelection(selection: InspectSelection): InspectDraft {
  const s = selection.styles
  return {
    text: selection.text,
    fontFamily: (s.fontFamily.split(',')[0] || '').replace(/['"]/g, '').trim(),
    fontSize: s.fontSize,
    fontWeight:
      s.fontWeight === 'bold' ? '700' : s.fontWeight === 'normal' ? '400' : s.fontWeight,
    fontStyle: s.fontStyle,
    lineHeight: s.lineHeight,
    letterSpacing: s.letterSpacing,
    textAlign: s.textAlign,
    textTransform: s.textTransform,
    textDecoration: s.textDecoration,
    color: s.color,
    backgroundColor: s.backgroundColor,
    padding: s.padding,
    margin: s.margin,
    borderRadius: s.borderRadius,
    opacity: s.opacity || '1',
    boxShadow: s.boxShadow || 'none',
    borderWidth: s.borderWidth || '0px',
    borderStyle: s.borderStyle || 'none',
    borderColor: s.borderColor || 'transparent',
    hidden: false,
  }
}

export function draftDirty(base: InspectDraft | null, draft: InspectDraft | null) {
  if (!base || !draft) return false
  return JSON.stringify(base) !== JSON.stringify(draft)
}

export function serializeInspectApply(
  selection: InspectSelection,
  base: InspectDraft,
  draft: InspectDraft,
  instruction: string,
): string {
  const lines: string[] = [
    `Edit only this element (${selection.tag} ${selection.selector}).`,
    'Keep sibling candidates and unrelated UI unchanged.',
  ]
  if (draft.text !== base.text) {
    lines.push(
      `Replace the visible text with exactly this (do not add quotes in the UI):`,
      draft.text,
    )
  }
  const styleKeys: (keyof InspectDraft)[] = [
    'fontFamily',
    'fontSize',
    'fontWeight',
    'fontStyle',
    'lineHeight',
    'letterSpacing',
    'textAlign',
    'textTransform',
    'textDecoration',
    'color',
    'backgroundColor',
    'padding',
    'margin',
    'borderRadius',
    'opacity',
    'boxShadow',
    'borderWidth',
    'borderStyle',
    'borderColor',
  ]
  const styleLines = styleKeys
    .filter((k) => draft[k] !== base[k])
    .map((k) => `- ${k}: ${String(base[k])} → ${String(draft[k])}`)
  if (styleLines.length) {
    lines.push('Update styles (prefer Tailwind classes if the file already uses them):')
    lines.push(...styleLines)
  }
  if (draft.hidden && !base.hidden) {
    lines.push('Hide this element (do not delete the source unless asked).')
  }
  const extra = instruction.trim()
  if (extra) {
    lines.push('Additional instructions:')
    lines.push(extra)
  }
  return lines.join('\n')
}

export function toColorInput(value: string): string {
  if (!value || value === 'transparent') return '#000000'
  const hex = value.match(/#([0-9a-f]{3,8})/i)
  if (hex) {
    let h = hex[1]
    if (h.length === 3) h = h.split('').map((c) => c + c).join('')
    return `#${h.slice(0, 6)}`
  }
  const m = value.match(/rgba?\(\s*([\d.]+)[,\s/]+([\d.]+)[,\s/]+([\d.]+)/i)
  if (!m) return '#000000'
  return `#${[m[1], m[2], m[3]]
    .map((n) => Math.max(0, Math.min(255, Math.round(Number(n)))).toString(16).padStart(2, '0'))
    .join('')}`
}

/** While Inspect is open the iframe keeps its current URL. A new sandbox must not remount it. */
export function stableInspectSrc(locked: string, next: string, inspectOn: boolean) {
  return inspectOn ? locked || next : next
}

export function livePayload(draft: InspectDraft | null, previewOriginal: boolean) {
  if (!draft) return { type: 'live' as const, reset: true }
  if (previewOriginal) return { type: 'live' as const, reset: true }
  return {
    type: 'live' as const,
    text: draft.text,
    hidden: draft.hidden,
    styles: {
      fontFamily: draft.fontFamily,
      fontSize: draft.fontSize,
      fontWeight: draft.fontWeight,
      fontStyle: draft.fontStyle,
      lineHeight: draft.lineHeight,
      letterSpacing: draft.letterSpacing,
      textAlign: draft.textAlign,
      textTransform: draft.textTransform,
      textDecoration: draft.textDecoration,
      color: draft.color,
      backgroundColor: draft.backgroundColor,
      padding: draft.padding,
      margin: draft.margin,
      borderRadius: draft.borderRadius,
      opacity: draft.opacity,
      boxShadow: draft.boxShadow,
      borderWidth: draft.borderWidth,
      borderStyle: draft.borderStyle,
      borderColor: draft.borderColor,
    },
  }
}

export function pillInstruction(pill: string): string {
  switch (pill) {
    case '/modern':
      return 'Restyle this element to feel more modern: tighter type, current spacing, fewer ornaments.'
    case '/contrast':
      return 'Increase contrast on this element so text and background read clearly.'
    case '/spacious':
      return 'Give this element more breathing room: increase padding and surrounding space.'
    case '/simplify':
      return 'Simplify this element: remove extra chrome, keep the essential content.'
    case '/readable':
      return 'Improve readability of this element: type size, line-height, and contrast.'
    case '/shadows':
      return 'Add a subtle, realistic shadow to this element. Do not overdo it.'
    case '/pop':
      return 'Make this element more visually prominent without breaking the page layout.'
    case '/hierarchy':
      return 'Adjust type weight/size on this element so hierarchy is clearer.'
    default:
      return pill
  }
}

import { FragmentSchema, fragmentCodeText } from './schema'
import { sanitizeStyleHydration } from './hydrate-safe'
import { sanitizeMotionKeyframes } from './motion-safe'
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
  if (!fragment) return null
  const code = sanitizeStyleHydration(
    sanitizeMotionKeyframes(fragmentCodeText(fragment.code)),
  )
  if (!code.trim() || !fragment.file_path || !fragment.template) return null
  return {
    commentary: fragment.commentary || '',
    template: fragment.template,
    title: fragment.title || 'App',
    description: fragment.description || '',
    additional_dependencies: (fragment.additional_dependencies ?? []).filter(
      (d): d is string => typeof d === 'string',
    ),
    has_additional_dependencies: Boolean(fragment.has_additional_dependencies),
    install_dependencies_command: fragment.install_dependencies_command || '',
    port: typeof fragment.port === 'number' ? fragment.port : 3000,
    file_path: fragment.file_path,
    code,
  }
}

export function isValidPatchedFragment(
  prev: FragmentSchema,
  next: unknown,
): next is FragmentSchema {
  if (!next || typeof next !== 'object') return false
  const n = next as Partial<FragmentSchema>
  const code = fragmentCodeText(n.code)
  if (!code.trim()) return false
  if (typeof n.file_path !== 'string' || !n.file_path) return false
  if (n.file_path !== prev.file_path) return false
  if (typeof n.template !== 'string' || n.template !== prev.template) return false
  return true
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

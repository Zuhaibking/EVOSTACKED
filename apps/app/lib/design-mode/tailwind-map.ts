import { STYLE_PROPS, type StylePatch, type StyleProp } from './protocol'

const WEIGHT: Record<string, string> = {
  '100': 'font-thin',
  '200': 'font-extralight',
  '300': 'font-light',
  '400': 'font-normal',
  '500': 'font-medium',
  '600': 'font-semibold',
  '700': 'font-bold',
  '800': 'font-extrabold',
  '900': 'font-black',
}

const ALIGN: Record<string, string> = {
  left: 'text-left',
  center: 'text-center',
  right: 'text-right',
  justify: 'text-justify',
}

const DISPLAY: Record<string, string> = {
  block: 'block',
  flex: 'flex',
  grid: 'grid',
  none: 'hidden',
  'inline-flex': 'inline-flex',
  'inline-block': 'inline-block',
  inline: 'inline',
}

const FLEX_DIR: Record<string, string> = {
  row: 'flex-row',
  column: 'flex-col',
  'row-reverse': 'flex-row-reverse',
  'column-reverse': 'flex-col-reverse',
}

const JUSTIFY: Record<string, string> = {
  'flex-start': 'justify-start',
  start: 'justify-start',
  'flex-end': 'justify-end',
  end: 'justify-end',
  center: 'justify-center',
  'space-between': 'justify-between',
  'space-around': 'justify-around',
  'space-evenly': 'justify-evenly',
}

const ITEMS: Record<string, string> = {
  'flex-start': 'items-start',
  start: 'items-start',
  'flex-end': 'items-end',
  end: 'items-end',
  center: 'items-center',
  stretch: 'items-stretch',
  baseline: 'items-baseline',
}

const PREFIX: Record<StyleProp, string[]> = {
  color: ['text-'],
  background: ['bg-'],
  fontSize: ['text-'],
  fontWeight: ['font-'],
  fontFamily: ['font-'],
  lineHeight: ['leading-'],
  letterSpacing: ['tracking-'],
  textAlign: ['text-left', 'text-center', 'text-right', 'text-justify'],
  textDecoration: ['underline', 'line-through', 'no-underline', 'overline'],
  padding: ['p-', 'px-', 'py-', 'pt-', 'pr-', 'pb-', 'pl-'],
  margin: ['m-', 'mx-', 'my-', 'mt-', 'mr-', 'mb-', 'ml-'],
  width: ['w-'],
  height: ['h-'],
  display: [
    'block',
    'flex',
    'grid',
    'hidden',
    'inline',
    'inline-flex',
    'inline-block',
  ],
  flexDirection: ['flex-row', 'flex-col', 'flex-row-reverse', 'flex-col-reverse'],
  gap: ['gap-'],
  justifyContent: ['justify-'],
  alignItems: ['items-'],
  border: ['border', 'border-'],
  borderRadius: ['rounded'],
  opacity: ['opacity-'],
  boxShadow: ['shadow'],
  content: [],
}

function arb(prefix: string, value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  const inner = trimmed.replace(/\s+/g, '_')
  return `${prefix}-[${inner}]`
}

function hexish(value: string): string {
  const v = value.trim()
  if (/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v)) return v.toLowerCase()
  const rgb = v.match(
    /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i,
  )
  if (rgb) {
    const to = (n: string) => Number(n).toString(16).padStart(2, '0')
    return `#${to(rgb[1])}${to(rgb[2])}${to(rgb[3])}`
  }
  return v
}

export function patchToClass(patch: StylePatch): string | null {
  const value = patch.value.trim()
  if (!value && patch.prop !== 'content') return null
  switch (patch.prop) {
    case 'content':
      return null
    case 'color':
      return arb('text', hexish(value))
    case 'background':
      return arb('bg', hexish(value))
    case 'fontSize':
      return arb('text', value)
    case 'fontWeight':
      return WEIGHT[value] || arb('font', value)
    case 'fontFamily':
      if (/mono/i.test(value)) return 'font-mono'
      if (/serif/i.test(value) && !/sans/i.test(value)) return 'font-serif'
      if (/sans/i.test(value)) return 'font-sans'
      return arb('font', value)
    case 'lineHeight':
      return arb('leading', value)
    case 'letterSpacing':
      return arb('tracking', value)
    case 'textAlign':
      return ALIGN[value] || null
    case 'textDecoration':
      if (value === 'underline') return 'underline'
      if (value === 'line-through') return 'line-through'
      if (value === 'none') return 'no-underline'
      return null
    case 'padding':
      return arb('p', value)
    case 'margin':
      return arb('m', value)
    case 'width':
      if (value === '100%') return 'w-full'
      if (value === 'auto') return 'w-auto'
      return arb('w', value)
    case 'height':
      if (value === '100%') return 'h-full'
      if (value === 'auto') return 'h-auto'
      return arb('h', value)
    case 'display':
      return DISPLAY[value] || null
    case 'flexDirection':
      return FLEX_DIR[value] || null
    case 'gap':
      return arb('gap', value)
    case 'justifyContent':
      return JUSTIFY[value] || null
    case 'alignItems':
      return ITEMS[value] || null
    case 'border':
      if (value === 'none' || value === '0') return 'border-0'
      return arb('border', value)
    case 'borderRadius':
      if (value === '0' || value === '0px') return 'rounded-none'
      if (value === '9999px' || value === '9999') return 'rounded-full'
      return arb('rounded', value)
    case 'opacity':
      return arb('opacity', value)
    case 'boxShadow':
      if (value === 'none') return 'shadow-none'
      return arb('shadow', value)
    default:
      return null
  }
}

function classConflicts(cls: string, prop: StyleProp): boolean {
  const prefixes = PREFIX[prop] || []
  return prefixes.some((prefix) => {
    if (prefix.endsWith('-')) return cls === prefix.slice(0, -1) || cls.startsWith(prefix)
    return cls === prefix || cls.startsWith(`${prefix}-`) || cls.startsWith(`${prefix}[`)
  })
}

export function mergeClasses(
  current: string,
  patches: StylePatch[],
): { className: string; content?: string } {
  const tokens = current.split(/\s+/).filter(Boolean)
  let content: string | undefined
  for (const patch of patches) {
    if (patch.prop === 'content') {
      content = patch.value
      continue
    }
    const next = patchToClass(patch)
    const kept = tokens.filter((cls) => !classConflicts(cls, patch.prop))
    tokens.length = 0
    tokens.push(...kept)
    if (next) tokens.push(next)
  }
  return { className: tokens.join(' '), content }
}

export function coveredStyleProps(): StyleProp[] {
  return [...STYLE_PROPS]
}

/**
 * Inspect `data-oid` stamps. Leaf module — do not import fragment/source-syntax
 * (those import this file).
 */
import ts from 'typescript'

export const JSX_OPEN = /<([A-Za-z][\w.]*)(\s[^>]*?)?(\/)?>/g

export const SKIP_TAGS = new Set([
  'Fragment',
  'script',
  'style',
  'link',
  'meta',
  'html',
  'head',
  'body',
  'noscript',
  'template',
  'Main',
  'NextScript',
  'Head',
  'Html',
])

const TS_TYPE_TAG =
  /^(?:HTML\w+|SVG\w+|React(?:\.\w+)?|Promise|Partial|Required|Readonly|Record|Pick|Omit|Exclude|Extract|NonNullable|ReturnType|Parameters|InstanceType|ConstructorParameters|Awaited|Array|ReadonlyArray|Map|Set|WeakMap|WeakSet|Iterable|AsyncIterable|Generator|AsyncGenerator|MouseEvent|ChangeEvent|FormEvent|KeyboardEvent|FocusEvent|PointerEvent|TouchEvent|DragEvent|WheelEvent|ClipboardEvent|CSSProperties|RefObject|MutableRefObject|Dispatch|SetStateAction|FC|FunctionComponent|ComponentType|PropsWithChildren|ComponentProps|ComponentPropsWithoutRef|ComponentPropsWithRef)$/

const OID_ATTR = /\s+data-oid=(["'])[^"']*\1/g

export function isTsGenericOpen(source: string, index: number): boolean {
  if (index <= 0) return false
  return /[A-Za-z0-9._]/.test(source.charAt(index - 1))
}

export function isTsTypeTagName(tag: string): boolean {
  return TS_TYPE_TAG.test(tag)
}

/** True when this `<` is a TypeScript generic, not a JSX tag. */
export function isJsxTagOpen(source: string, index: number, tag: string): boolean {
  if (isTsGenericOpen(source, index)) return false
  if (isTsTypeTagName(tag)) return false
  if (SKIP_TAGS.has(tag)) return false
  return true
}

/**
 * Strip inspect stamps that landed inside TypeScript generics
 * (`RefObject<HTMLDivElement data-oid="pages/index.tsx:4">`).
 * Leaves real JSX `data-oid` attributes alone.
 */
export function sanitizeInspectStamps(source: string): string {
  if (!source.includes('data-oid=')) return source
  return source.replace(OID_ATTR, (full, _quote: string, offset: number) => {
    const tagStart = source.lastIndexOf('<', offset)
    if (tagStart < 0) return ''
    if (isTsGenericOpen(source, tagStart)) return ''
    const name = source.slice(tagStart + 1).match(/^([A-Za-z][\w.]*)/)
    if (name && isTsTypeTagName(name[1])) return ''
    return full
  })
}

function parseErrorCount(filePath: string, content: string): number {
  if (!/\.(tsx|ts|jsx|js)$/i.test(filePath)) return 0
  const result = ts.transpileModule(content, {
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      isolatedModules: true,
      skipLibCheck: true,
    },
    reportDiagnostics: true,
    fileName: filePath,
  })
  return (result.diagnostics || []).filter(
    (diag) => diag.category === ts.DiagnosticCategory.Error,
  ).length
}

/**
 * Stamp JSX tags with `data-oid`. Never writes into TypeScript generics.
 * If a stamp would make the file unparseable, returns the sanitized original.
 */
export function stampDataOids(filePath: string, source: string): string {
  const cleaned = sanitizeInspectStamps(source)
  if (!/\.(tsx|jsx|vue)$/.test(filePath)) return cleaned

  let n = 0
  const stamped = cleaned.replace(
    JSX_OPEN,
    (full, tag: string, attrs = '', self: string | undefined, offset: number) => {
      if (!isJsxTagOpen(cleaned, offset, tag)) return full
      if (/\bdata-oid=/.test(attrs)) return full
      n += 1
      return `<${tag}${attrs} data-oid="${filePath}:${n}"${self || ''}>`
    },
  )
  const healed = sanitizeInspectStamps(stamped)
  if (parseErrorCount(filePath, healed) > parseErrorCount(filePath, cleaned)) {
    return cleaned
  }
  return healed
}

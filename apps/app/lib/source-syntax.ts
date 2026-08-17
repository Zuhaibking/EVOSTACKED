/**
 * Deterministic TS/TSX syntax checks for generated fragments.
 * ZERO OpenAI / E2B / network. Parse-only (no typecheck).
 */
import { getFragmentFiles, type FragmentFile } from '@/lib/fragment'
import type { FragmentSchema } from '@/lib/schema'
import type { DeepPartial } from '@evostack/shared'
import ts from 'typescript'

export type SourceIssueCode = 'invalid_source' | 'truncated_source' | 'jsx_in_ts'

export type SourceIntegrityIssue = {
  code: SourceIssueCode
  severity: 'error'
  message: string
  file?: string
}

export type SourceIntegrityResult = {
  ok: boolean
  issues: SourceIntegrityIssue[]
}

const CODE_FILE = /\.(tsx|ts|jsx|js|mjs|cjs)$/i
const TS_ONLY = /\.ts$/i
const API_ROUTE = /(^|\/)pages\/api\//i
const DECLARATION = /\.d\.ts$/i

const JSX_HINT =
  /<(?:div|span|section|main|header|footer|nav|aside|article|button|form|input|img|ul|ol|li|p|a|h[1-6]|label|select|option|textarea|table|thead|tbody|tr|td|th|fragment|[A-Z][\w.]*)\b|<>/

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+/g, '/')
}

export function stripBomAndZeroWidth(content: string): string {
  return content
    .replace(/^\uFEFF/, '')
    .replace(/[\u200B-\u200D\u2060]/g, '')
}

/** Unwrap a whole-file markdown fence the model sometimes leaves in file_content. */
export function stripWrappingMarkdownFence(content: string): string {
  const trimmed = content.trim()
  const closed = trimmed.match(
    /^```(?:tsx|ts|jsx|js|javascript|typescript)?\s*\r?\n([\s\S]*?)\r?\n```$/i,
  )
  if (closed) return closed[1]
  const open = trimmed.match(
    /^```(?:tsx|ts|jsx|js|javascript|typescript)?\s*\r?\n([\s\S]*)$/i,
  )
  if (open && !open[1].includes('```')) return open[1]
  return content
}

export function sourceLooksLikeJsx(content: string): boolean {
  return JSX_HINT.test(content)
}

function scriptKindForPath(path: string): ts.ScriptKind {
  if (/\.tsx$/i.test(path)) return ts.ScriptKind.TSX
  if (/\.jsx$/i.test(path)) return ts.ScriptKind.JSX
  if (/\.ts$/i.test(path)) return ts.ScriptKind.TS
  return ts.ScriptKind.JS
}

function isTruncationDiagnostic(message: string): boolean {
  return /expected|unterminated|no corresponding closing tag|unexpected eof/i.test(
    message,
  )
}

export function parseGeneratedSource(
  filePath: string,
  content: string,
): SourceIntegrityIssue[] {
  const path = normalizePath(filePath)
  const result = ts.transpileModule(content, {
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      isolatedModules: true,
      skipLibCheck: true,
    },
    reportDiagnostics: true,
    fileName: path,
  })
  const issues: SourceIntegrityIssue[] = []
  for (const diag of result.diagnostics || []) {
    if (diag.category !== ts.DiagnosticCategory.Error) continue
    const message = ts.flattenDiagnosticMessageText(diag.messageText, '\n')
    if (/jsx cannot be used|cannot use jsx/i.test(message)) {
      issues.push({
        code: 'jsx_in_ts',
        severity: 'error',
        message: `${path}: JSX in a .ts file — rename to .tsx`,
        file: path,
      })
      continue
    }
    const code = isTruncationDiagnostic(message)
      ? 'truncated_source'
      : 'invalid_source'
    const loc =
      diag.start != null
        ? ts.getLineAndCharacterOfPosition(
            ts.createSourceFile(
              path,
              content,
              ts.ScriptTarget.Latest,
              true,
              scriptKindForPath(path),
            ),
            diag.start,
          )
        : null
    const where = loc ? `${path}:${loc.line + 1}:${loc.character + 1}` : path
    issues.push({
      code,
      severity: 'error',
      message: `${where} ${message}`,
      file: path,
    })
  }
  return issues
}

export function validateFragmentSourceSyntax(
  files: Array<{ file_path: string; file_content: string }>,
): SourceIntegrityResult {
  const issues: SourceIntegrityIssue[] = []
  for (const f of files) {
    const path = normalizePath(f.file_path)
    if (!CODE_FILE.test(path)) continue
    const content = f.file_content || ''
    if (!content.trim()) continue
    if (TS_ONLY.test(path) && !DECLARATION.test(path) && sourceLooksLikeJsx(content)) {
      issues.push({
        code: 'jsx_in_ts',
        severity: 'error',
        message: `${path}: contains JSX but uses a .ts extension (Next/Turbopack parses it as script, not TSX)`,
        file: path,
      })
    }
    issues.push(...parseGeneratedSource(path, content))
  }
  const unique = new Map<string, SourceIntegrityIssue>()
  for (const issue of issues) {
    const key = `${issue.code}:${issue.file}:${issue.message}`
    if (!unique.has(key)) unique.set(key, issue)
  }
  const list = Array.from(unique.values())
  return { ok: list.length === 0, issues: list }
}

function rewriteTsSpecifier(content: string, fromBase: string, toBase: string): string {
  if (fromBase === toBase) return content
  const escaped = fromBase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return content.replace(
    new RegExp(`(['"])([^'"]*${escaped})\\.ts\\1`, 'g'),
    `$1$2$1`,
  )
}

/**
 * Strip fences/BOM and rename .ts files that contain JSX to .tsx.
 * Does not invent source — only mechanical fixes.
 */
export function normalizeFragmentSourceFiles<
  T extends {
    code?: FragmentSchema['code'] | DeepPartial<FragmentSchema>['code']
    file_path?: string
  },
>(fragment: T): { fragment: T; changed: boolean } {
  const files = getFragmentFiles(fragment)
  if (!files.length) return { fragment, changed: false }

  let changed = false
  const used = new Set(files.map((f) => normalizePath(f.file_path).toLowerCase()))
  const renamed = new Map<string, string>()

  const next: FragmentFile[] = files.map((f) => {
    const originalPath = normalizePath(f.file_path)
    let content = stripBomAndZeroWidth(f.file_content || '')
    const unfenced = stripWrappingMarkdownFence(content)
    if (unfenced !== content) {
      content = unfenced
      changed = true
    }
    let path = originalPath
    if (
      TS_ONLY.test(path) &&
      !DECLARATION.test(path) &&
      !API_ROUTE.test(path) &&
      sourceLooksLikeJsx(content)
    ) {
      const candidate = path.replace(/\.ts$/i, '.tsx')
      if (!used.has(candidate.toLowerCase())) {
        used.delete(path.toLowerCase())
        used.add(candidate.toLowerCase())
        renamed.set(path, candidate)
        path = candidate
        changed = true
      }
    }
    if (path !== originalPath || content !== f.file_content) {
      return { file_path: path, file_content: content }
    }
    return f
  })

  if (renamed.size) {
    const fromBases = Array.from(renamed.keys()).map((p) =>
      p.replace(/\.ts$/i, ''),
    )
    for (let i = 0; i < next.length; i++) {
      let body = next[i].file_content
      for (const base of fromBases) {
        const fileBase = base.split('/').pop() || base
        body = rewriteTsSpecifier(body, fileBase, fileBase)
      }
      if (body !== next[i].file_content) {
        next[i] = { ...next[i], file_content: body }
        changed = true
      }
    }
  }

  if (!changed) return { fragment, changed: false }

  const primary =
    typeof fragment.file_path === 'string'
      ? renamed.get(normalizePath(fragment.file_path)) || fragment.file_path
      : fragment.file_path

  return {
    fragment: { ...fragment, code: next, file_path: primary },
    changed: true,
  }
}

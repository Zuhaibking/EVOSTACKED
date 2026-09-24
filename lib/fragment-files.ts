/** Files the sandbox should write for a generated fragment. */

import { sanitizeHydrationFile } from './hydrate-safe'
import { sanitizeMotionFile } from './motion-safe'

export type WrittenFile = { file_path: string; file_content: string }

export type LocalImport = {
  spec: string
  resolved: string
  defaultName?: string
  names: string[]
}

const TEMPLATE_KEEP = /^(components\/ui(?:\/|$)|lib\/utils(?:\.|$)|hooks\/)/

export function fragmentFiles(fragment: {
  file_path?: string
  code?: unknown
}): WrittenFile[] {
  const mainPath = fragment.file_path || 'pages/index.tsx'
  const code = fragment.code
  if (Array.isArray(code)) {
    const files: WrittenFile[] = []
    for (const f of code) {
      if (!f || typeof f !== 'object') continue
      const rec = f as Record<string, unknown>
      const path =
        (typeof rec.file_path === 'string' && rec.file_path) ||
        (typeof rec.file_name === 'string' && rec.file_name) ||
        ''
      const content =
        (typeof rec.file_content === 'string' && rec.file_content) ||
        (typeof rec.content === 'string' && rec.content) ||
        ''
      if (path) files.push({ file_path: posix(path), file_content: content })
    }
    if (files.length) return files.map(safeFile)
  }
  return [
    {
      file_path: posix(mainPath),
      file_content: typeof code === 'string' ? code : '',
    },
  ].map(safeFile)
}

function safeFile(file: WrittenFile): WrittenFile {
  return {
    ...file,
    file_content: sanitizeHydrationFile(
      file.file_path,
      sanitizeMotionFile(file.file_path, file.file_content),
    ),
  }
}

export function localImports(code: string, fromFile: string): LocalImport[] {
  if (!code) return []
  const out: LocalImport[] = []

  for (const m of code.matchAll(
    /import\s+(type\s+)?([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g,
  )) {
    if (m[1]) continue
    const spec = m[3]
    const resolved = resolveLocal(fromFile, spec)
    if (!resolved) continue
    out.push({ spec, resolved, ...parseClause(m[2]) })
  }

  for (const m of code.matchAll(
    /export\s+(?:type\s+)?\{([^}]*)\}\s+from\s+['"]([^'"]+)['"]/g,
  )) {
    const spec = m[2]
    const resolved = resolveLocal(fromFile, spec)
    if (!resolved) continue
    const names = m[1]
      .split(',')
      .map((s) => s.replace(/^type\s+/, '').trim().split(/\s+as\s+/)[0].trim())
      .filter((n) => n && n !== 'type')
    out.push({ spec, resolved, names })
  }

  for (const m of code.matchAll(/require\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    const spec = m[1]
    const resolved = resolveLocal(fromFile, spec)
    if (!resolved) continue
    out.push({ spec, resolved, names: [], defaultName: 'mod' })
  }

  return out
}

export function withMissingLocalModules(files: WrittenFile[]): WrittenFile[] {
  const have = files.map((f) => posix(f.file_path))
  const extras: WrittenFile[] = []
  for (const file of files) {
    for (const imp of localImports(file.file_content, file.file_path)) {
      if (alreadyHave(have, extras, imp.resolved)) continue
      const path = stubPath(imp)
      extras.push({ file_path: path, file_content: stubModule(imp) })
      have.push(path)
    }
  }
  // ponytail: stubs only make missing local imports compile (empty lists / null components).
  // Upgrade: persist a files[] array from the model so real mock data is written instead.
  return extras.length ? [...files, ...extras] : files
}

function parseClause(clause: string): { defaultName?: string; names: string[] } {
  const names: string[] = []
  const named = clause.match(/\{([^}]*)\}/)
  if (named) {
    for (const part of named[1].split(',')) {
      const orig = part
        .replace(/^type\s+/, '')
        .trim()
        .split(/\s+as\s+/)[0]
        .trim()
      if (orig) names.push(orig)
    }
  }
  const star = clause.match(/\*\s+as\s+(\w+)/)
  const def = clause
    .replace(/\{[^}]*\}/, '')
    .replace(/\*\s+as\s+\w+/, '')
    .replace(/,/g, '')
    .trim()
  const defaultName = star?.[1] || (def && def !== 'type' ? def : undefined)
  return { defaultName, names }
}

function resolveLocal(fromFile: string, spec: string): string | null {
  const alias = spec.startsWith('@/') || spec.startsWith('~/')
  const rel = spec.startsWith('.')
  if (!alias && !rel) return null
  const raw = alias
    ? spec.replace(/^@\//, '').replace(/^\~\//, '')
    : joinPath(dirOf(fromFile), spec)
  const n = posix(raw)
  if (!n || TEMPLATE_KEEP.test(n)) return null
  return n
}

function alreadyHave(
  have: string[],
  extras: WrittenFile[],
  resolved: string,
): boolean {
  const want = stripExt(posix(resolved))
  return [...have, ...extras.map((e) => e.file_path)].some((p) => {
    const got = stripExt(posix(p))
    return got === want || got === `${want}/index`
  })
}

function stubPath(imp: LocalImport): string {
  if (/\.(tsx|ts|jsx|js|css|json)$/.test(imp.resolved)) return imp.resolved
  if (imp.resolved.endsWith('.css') || imp.spec.endsWith('.css')) {
    return imp.resolved.endsWith('.css') ? imp.resolved : `${imp.resolved}.css`
  }
  return `${imp.resolved}.ts`
}

function stubModule(imp: LocalImport): string {
  if (imp.resolved.endsWith('.css') || imp.spec.endsWith('.css')) {
    return '/* sandbox: local stylesheet was not generated */\n'
  }
  if (imp.resolved.endsWith('.json') || imp.spec.endsWith('.json')) {
    return '{}\n'
  }
  const names = [...new Set(imp.names)]
  const lines = [
    '// sandbox: local module was imported but never generated',
  ]
  for (const n of names) {
    lines.push(
      /^[A-Z]/.test(n)
        ? `export function ${n}() { return null }`
        : `export const ${n}: any = []`,
    )
  }
  if (imp.defaultName && /^[A-Z]/.test(imp.defaultName)) {
    lines.push(`export default function ${imp.defaultName}() { return null }`)
  } else {
    const keys = names.filter((n) => !/^[A-Z]/.test(n))
    const keyReturns = keys.map((k) => `    if (p === '${k}') return ${k}`).join('\n')
    lines.push(
      'const __default: any = new Proxy([] as any[], {',
      '  get(t, p) {',
      "    if (p === 'then' || p === '__esModule') return undefined",
      '    if (typeof p === "string" && p in t) return (t as any)[p]',
      ...(keyReturns ? [keyReturns] : []),
      '    return []',
      '  },',
      '})',
      'export default __default',
    )
  }
  return `${lines.join('\n')}\n`
}

function posix(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/{2,}/g, '/')
}

function dirOf(filePath: string): string {
  const n = posix(filePath)
  const i = n.lastIndexOf('/')
  return i === -1 ? '' : n.slice(0, i)
}

function joinPath(dir: string, spec: string): string {
  const parts = `${dir ? `${dir}/` : ''}${spec}`.split('/')
  const out: string[] = []
  for (const part of parts) {
    if (!part || part === '.') continue
    if (part === '..') out.pop()
    else out.push(part)
  }
  return out.join('/')
}

function stripExt(p: string): string {
  return p.replace(/\.(tsx|ts|jsx|js|mjs|cjs|css|json)$/, '')
}

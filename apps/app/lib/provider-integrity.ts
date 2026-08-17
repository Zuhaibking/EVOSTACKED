/**
 * Deterministic React provider / context integrity for generated apps.
 * ZERO provider / E2B / network.
 *
 * Catches useSession() / useContext(null) hooks used without a mounted
 * Provider. Repairs by wrapping pages/_app.tsx or app/layout.tsx when safe.
 */
import { getFragmentFiles, type FragmentFile } from '@/lib/fragment'
import type { FragmentSchema } from '@/lib/schema'
import { getTemplateId } from '@/lib/templates'

export type ProviderIntegrityIssue = {
  code: 'missing_provider'
  file: string
  line?: number
  hookName: string
  message: string
  specifier?: string
}

export type ProviderRepairResult = {
  fragment: FragmentSchema
  repaired: boolean
  issues: ProviderIntegrityIssue[]
  changedFiles: string[]
}

type ContextHook = {
  hookName: string
  contextName: string
  file: string
  providerExport?: string
  packageSpecifier?: string
  destructuredKeys: string[]
}

const REACT_HOOKS = new Set([
  'useState',
  'useEffect',
  'useLayoutEffect',
  'useMemo',
  'useCallback',
  'useRef',
  'useReducer',
  'useId',
  'useTransition',
  'useDeferredValue',
  'useSyncExternalStore',
  'useInsertionEffect',
  'useImperativeHandle',
  'useDebugValue',
  'useContext',
])

const PACKAGE_HOOK_PROVIDERS: Array<{
  module: string
  hooks: string[]
  provider: string
}> = [
  {
    module: 'next-auth/react',
    hooks: ['useSession'],
    provider: 'SessionProvider',
  },
  {
    module: '@clerk/nextjs',
    hooks: ['useUser', 'useAuth', 'useSession', 'useClerk'],
    provider: 'ClerkProvider',
  },
]

function normalizePath(p: string): string {
  return (p || '').replace(/\\/g, '/').replace(/^\.\//, '')
}

function lineAt(source: string, index: number): number {
  let line = 1
  for (let i = 0; i < index && i < source.length; i++) {
    if (source[i] === '\n') line++
  }
  return line
}

function isCodeFile(path: string): boolean {
  return /\.(tsx|ts|jsx|js|mjs|cjs)$/i.test(path)
}

function relativeImport(fromFile: string, toFile: string): string {
  const from = normalizePath(fromFile).split('/')
  from.pop()
  const to = normalizePath(toFile).replace(/\.(tsx|ts|jsx|js)$/i, '')
  const toParts = to.split('/')
  let i = 0
  while (i < from.length && i < toParts.length && from[i] === toParts[i]) i++
  const up = from.length - i
  const down = toParts.slice(i)
  const rel = [...Array(up).fill('..'), ...down].join('/')
  return rel.startsWith('.') ? rel : `./${rel}`
}

function providerJsxRe(name: string): RegExp {
  return new RegExp(`<${name}(?:\\s|>|/)`)
}

function findCallSites(
  files: FragmentFile[],
  hookName: string,
): Array<{ file: string; index: number; line: number; snippet: string }> {
  const re = new RegExp(`\\b${hookName}\\s*\\(`, 'g')
  const sites: Array<{
    file: string
    index: number
    line: number
    snippet: string
  }> = []
  for (const f of files) {
    const path = normalizePath(f.file_path)
    if (!isCodeFile(path)) continue
    const src = f.file_content || ''
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(src))) {
      // Skip the hook's own declaration: export function useX(
      const before = src.slice(Math.max(0, m.index - 40), m.index)
      if (/\b(?:export\s+)?(?:async\s+)?function\s+$/.test(before)) continue
      if (/\b(?:export\s+)?(?:const|let|var)\s+$/.test(before)) continue
      const lineStart = src.lastIndexOf('\n', m.index - 1) + 1
      const lineEnd = src.indexOf('\n', m.index)
      const snippet = src.slice(lineStart, lineEnd < 0 ? src.length : lineEnd).trim()
      sites.push({
        file: path,
        index: m.index,
        line: lineAt(src, m.index),
        snippet,
      })
    }
  }
  return sites
}

function destructuredKeysFromCalls(
  files: FragmentFile[],
  hookName: string,
): string[] {
  const keys = new Set<string>()
  const re = new RegExp(
    `const\\s*\\{([^}]+)\\}\\s*=\\s*${hookName}\\s*\\(`,
    'g',
  )
  for (const f of files) {
    const src = f.file_content || ''
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(src))) {
      for (const part of m[1].split(',')) {
        const name = part
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .split(':')[0]
          .replace(/\s+/g, '')
          .replace(/\?.*$/, '')
        if (name && /^[A-Za-z_$][\w$]*$/.test(name)) keys.add(name)
      }
    }
  }
  return Array.from(keys)
}

function detectPackageHooks(files: FragmentFile[]): ContextHook[] {
  const hooks: ContextHook[] = []
  for (const f of files) {
    const path = normalizePath(f.file_path)
    if (!isCodeFile(path)) continue
    const src = f.file_content || ''
    for (const spec of PACKAGE_HOOK_PROVIDERS) {
      const importRe = new RegExp(
        `from\\s+['"]${spec.module.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`,
      )
      if (!importRe.test(src)) continue
      for (const hookName of spec.hooks) {
        if (!new RegExp(`\\b${hookName}\\b`).test(src)) continue
        hooks.push({
          hookName,
          contextName: spec.provider,
          file: path,
          providerExport: spec.provider,
          packageSpecifier: spec.module,
          destructuredKeys: destructuredKeysFromCalls(files, hookName),
        })
      }
    }
  }
  return hooks
}

function detectLocalContextHooks(files: FragmentFile[]): ContextHook[] {
  const hooks: ContextHook[] = []
  for (const f of files) {
    const path = normalizePath(f.file_path)
    if (!isCodeFile(path)) continue
    const src = f.file_content || ''
    const ctxRe =
      /(?:const|let|var)\s+([A-Z][A-Za-z0-9_]*)\s*=\s*(?:React\.)?createContext\s*\(\s*(null|undefined)?\s*\)/g
    let cm: RegExpExecArray | null
    ctxRe.lastIndex = 0
    while ((cm = ctxRe.exec(src))) {
      const contextName = cm[1]
      const hookRe = new RegExp(
        `(?:export\\s+)?(?:function\\s+(use[A-Z][A-Za-z0-9_]*)\\s*\\(|(?:const|let|var)\\s+(use[A-Z][A-Za-z0-9_]*)\\s*=)([\\s\\S]{0,400}?useContext\\s*\\(\\s*${contextName}\\s*\\))`,
        'g',
      )
      let hm: RegExpExecArray | null
      while ((hm = hookRe.exec(src))) {
        const hookName = hm[1] || hm[2]
        if (!hookName || REACT_HOOKS.has(hookName)) continue
        const providerFn = new RegExp(
          `export\\s+(?:default\\s+)?(?:function\\s+|const\\s+)(${contextName.replace(/Context$/, '')}Provider|${contextName}Provider)\\b`,
        ).exec(src)
        const namedProvider = src.match(
          new RegExp(
            `export\\s+(?:function\\s+|const\\s+)([A-Z][A-Za-z0-9_]*Provider)\\b`,
          ),
        )
        hooks.push({
          hookName,
          contextName,
          file: path,
          providerExport:
            providerFn?.[1] ||
            namedProvider?.[1] ||
            undefined,
          destructuredKeys: destructuredKeysFromCalls(files, hookName),
        })
      }
    }
  }
  return hooks
}

function providerMounted(
  files: FragmentFile[],
  hook: ContextHook,
): boolean {
  const names = new Set<string>()
  if (hook.providerExport) names.add(hook.providerExport)
  names.add(`${hook.contextName}.Provider`)
  if (hook.contextName.endsWith('Context')) {
    names.add(`${hook.contextName.slice(0, -7)}Provider`)
  }
  names.add(`${hook.hookName.replace(/^use/, '')}Provider`)

  for (const f of files) {
    const src = f.file_content || ''
    for (const name of names) {
      if (name.includes('.')) {
        if (src.includes(`<${name}`)) return true
      } else if (providerJsxRe(name).test(src)) {
        return true
      }
    }
  }
  return false
}

function pagesAppPath(files: FragmentFile[]): string | null {
  const hit = files.find((f) =>
    /(^|\/)pages\/_app\.(tsx|ts|jsx|js)$/i.test(normalizePath(f.file_path)),
  )
  return hit ? normalizePath(hit.file_path) : null
}

function appLayoutPath(files: FragmentFile[]): string | null {
  const hit = files.find((f) =>
    /(^|\/)app\/layout\.(tsx|ts|jsx|js)$/i.test(normalizePath(f.file_path)),
  )
  return hit ? normalizePath(hit.file_path) : null
}

function prefersPagesRouter(
  fragment: FragmentSchema,
  files: FragmentFile[],
): boolean {
  const id = getTemplateId(fragment.template || '')
  if (id === 'nextjs-developer') return true
  if (files.some((f) => /(^|\/)pages\//.test(normalizePath(f.file_path)))) {
    return true
  }
  return false
}

function ensureLocalProviderSource(
  source: string,
  hook: ContextHook,
): string {
  if (hook.packageSpecifier) return source
  if (hook.providerExport && new RegExp(`\\b${hook.providerExport}\\b`).test(source)) {
    return source
  }
  const providerName =
    hook.providerExport ||
    (hook.contextName.endsWith('Context')
      ? `${hook.contextName.slice(0, -7)}Provider`
      : `${hook.contextName}Provider`)
  const keys = hook.destructuredKeys.length ? hook.destructuredKeys : []
  const valueExpr = keys.length
    ? `{ ${keys.map((k) => `${k}: null`).join(', ')} }`
    : '{}'
  const block = `
export function ${providerName}({ children }: { children?: any }) {
  const value = ${valueExpr} as any
  return (
    <${hook.contextName}.Provider value={value}>
      {children}
    </${hook.contextName}.Provider>
  )
}
`
  if (!/\bReact\b/.test(source) && !/from ['"]react['"]/.test(source)) {
    return `import React from 'react'\n${source.trimEnd()}\n${block}`
  }
  return `${source.trimEnd()}\n${block}`
}

function wrapPagesApp(
  source: string,
  wraps: Array<{ name: string; from: string }>,
): string {
  let next = source
  for (const w of wraps) {
    const importLine = `import { ${w.name} } from '${w.from}'`
    if (!next.includes(importLine) && !new RegExp(`\\b${w.name}\\b`).test(
      next.split('\n').filter((l) => l.includes('from ')).join('\n'),
    )) {
      next = `${importLine}\n${next}`
    }
    if (providerJsxRe(w.name).test(next)) continue
    if (/<Component\s+\{\.\.\.pageProps\}\s*\/>/.test(next)) {
      next = next.replace(
        /<Component\s+\{\.\.\.pageProps\}\s*\/>/,
        `<${w.name}${w.name === 'SessionProvider' && w.from.includes('next-auth') ? ' session={pageProps.session}' : ''}>\n        <Component {...pageProps} />\n      </${w.name}>`,
      )
    } else if (/\{children\}/.test(next)) {
      next = next.replace(
        /\{children\}/,
        `<${w.name}>{children}</${w.name}>`,
      )
    }
  }
  return next
}

function defaultPagesApp(
  wraps: Array<{ name: string; from: string }>,
): string {
  const imports = wraps
    .map((w) => `import { ${w.name} } from '${w.from}'`)
    .join('\n')
  let inner = '<Component {...pageProps} />'
  for (const w of [...wraps].reverse()) {
    const extra =
      w.name === 'SessionProvider' && w.from.includes('next-auth')
        ? ' session={pageProps.session}'
        : ''
    inner = `<${w.name}${extra}>\n        ${inner}\n      </${w.name}>`
  }
  return `import type { AppProps } from 'next/app'
${imports}

export default function App({ Component, pageProps }: AppProps) {
  return (
    ${inner}
  )
}
`
}

function wrapAppLayout(
  source: string,
  wraps: Array<{ name: string; from: string }>,
): string {
  let next = source
  for (const w of wraps) {
    const importLine = `import { ${w.name} } from '${w.from}'`
    if (!next.includes(`{ ${w.name} }`)) {
      next = `${importLine}\n${next}`
    }
    if (providerJsxRe(w.name).test(next)) continue
    if (/\{children\}/.test(next)) {
      next = next.replace(
        /\{children\}/,
        `<${w.name}>{children}</${w.name}>`,
      )
    }
  }
  return next
}

function defaultAppLayout(
  wraps: Array<{ name: string; from: string }>,
): string {
  const imports = wraps
    .map((w) => `import { ${w.name} } from '${w.from}'`)
    .join('\n')
  let inner = '{children}'
  for (const w of [...wraps].reverse()) {
    inner = `<${w.name}>${inner}</${w.name}>`
  }
  return `import React from 'react'
${imports}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>${inner}</body>
    </html>
  )
}
`
}

function upsertFile(
  files: FragmentFile[],
  filePath: string,
  content: string,
): FragmentFile[] {
  const n = normalizePath(filePath)
  const idx = files.findIndex((f) => normalizePath(f.file_path) === n)
  if (idx >= 0) {
    const next = files.slice()
    next[idx] = { file_path: files[idx].file_path, file_content: content }
    return next
  }
  return [...files, { file_path: n, file_content: content }]
}

function collectUnmountedHooks(files: FragmentFile[]): ContextHook[] {
  const hooks = [
    ...detectPackageHooks(files),
    ...detectLocalContextHooks(files),
  ]
  const unique = new Map<string, ContextHook>()
  for (const h of hooks) {
    unique.set(`${h.hookName}:${h.file}:${h.packageSpecifier || 'local'}`, h)
  }
  return Array.from(unique.values()).filter((h) => {
    const sites = findCallSites(files, h.hookName)
    return sites.length > 0 && !providerMounted(files, h)
  })
}

function issuesForHooks(
  files: FragmentFile[],
  hooks: ContextHook[],
): ProviderIntegrityIssue[] {
  return hooks.map((hook) => {
    const site = findCallSites(files, hook.hookName)[0]
    return {
      code: 'missing_provider' as const,
      file: site?.file || hook.file,
      line: site?.line,
      hookName: hook.hookName,
      specifier: hook.packageSpecifier,
      message: `${site?.file || hook.file}:${site?.line || '?'}: ${hook.hookName}() is used without its required provider mounted at the application root.`,
    }
  })
}

/** Detect-only — does not mutate the fragment. */
export function detectProviderIssues(
  fragment: FragmentSchema,
): ProviderIntegrityIssue[] {
  const files = getFragmentFiles(fragment)
  return issuesForHooks(files, collectUnmountedHooks(files))
}

/**
 * Detect unmounted context/session hooks and wrap the app root when safe.
 */
export function repairFragmentProviders(
  fragment: FragmentSchema,
): ProviderRepairResult {
  const files = getFragmentFiles(fragment)
  const needed = collectUnmountedHooks(files)

  if (!needed.length) {
    return {
      fragment,
      repaired: false,
      issues: [],
      changedFiles: [],
    }
  }

  let nextFiles = files.map((f) => ({ ...f }))
  const changed = new Set<string>()
  const wraps: Array<{ name: string; from: string }> = []
  const wrapKeys = new Set<string>()
  const leftover: ProviderIntegrityIssue[] = []

  const addWrap = (name: string, from: string) => {
    const key = `${name}::${from}`
    if (wrapKeys.has(key)) return
    wrapKeys.add(key)
    wraps.push({ name, from })
  }

  for (const hook of needed) {
    const sites = findCallSites(nextFiles, hook.hookName)
    if (!sites.length) continue

    if (hook.packageSpecifier && hook.providerExport) {
      addWrap(hook.providerExport, hook.packageSpecifier)
      continue
    }

    const def = nextFiles.find(
      (f) => normalizePath(f.file_path) === normalizePath(hook.file),
    )
    if (!def) {
      leftover.push({
        code: 'missing_provider',
        file: sites[0].file,
        line: sites[0].line,
        hookName: hook.hookName,
        message: `${sites[0].file}:${sites[0].line}: ${hook.hookName}() requires a provider, but its module was not found.`,
      })
      continue
    }

    const providerName =
      hook.providerExport ||
      (hook.contextName.endsWith('Context')
        ? `${hook.contextName.slice(0, -7)}Provider`
        : `${hook.contextName}Provider`)
    const updated = ensureLocalProviderSource(def.file_content, {
      ...hook,
      providerExport: providerName,
    })
    if (updated !== def.file_content) {
      nextFiles = upsertFile(nextFiles, def.file_path, updated)
      changed.add(normalizePath(def.file_path))
    }
    addWrap(providerName, relativeImport('pages/_app.tsx', hook.file))
  }

  if (wraps.length) {
    const usePages = prefersPagesRouter(fragment, nextFiles)
    if (usePages) {
      const existing = pagesAppPath(nextFiles)
      const path = existing || 'pages/_app.tsx'
      const current =
        nextFiles.find((f) => normalizePath(f.file_path) === path)
          ?.file_content || ''
      const next = current.trim()
        ? wrapPagesApp(current, wraps)
        : defaultPagesApp(wraps)
      nextFiles = upsertFile(nextFiles, path, next)
      changed.add(path)
    } else {
      const existing = appLayoutPath(nextFiles)
      const path = existing || 'app/layout.tsx'
      const current =
        nextFiles.find((f) => normalizePath(f.file_path) === path)
          ?.file_content || ''
      const layoutWraps = wraps.map((w) => ({
        ...w,
        from: w.from.startsWith('.')
          ? relativeImport(path, needed[0]?.file || w.from)
          : w.from,
      }))
      const next = current.trim()
        ? wrapAppLayout(current, layoutWraps)
        : defaultAppLayout(layoutWraps)
      nextFiles = upsertFile(nextFiles, path, next)
      changed.add(path)
    }
  }

  const repairedFragment: FragmentSchema = {
    ...fragment,
    code: nextFiles,
  }
  leftover.push(
    ...issuesForHooks(
      getFragmentFiles(repairedFragment),
      collectUnmountedHooks(getFragmentFiles(repairedFragment)),
    ),
  )

  return {
    fragment: repairedFragment,
    repaired: changed.size > 0,
    issues: leftover,
    changedFiles: Array.from(changed),
  }
}

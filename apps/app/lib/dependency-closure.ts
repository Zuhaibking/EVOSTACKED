/**
 * Deterministic npm dependency closure for generated fragments.
 * ZERO provider / E2B / network.
 *
 * Extra packages live on fragment.additional_dependencies — never write
 * package.json. Template-provided packages are a conservative runtime
 * baseline, not the integrity "known packages" allowlist.
 */
import { getFragmentFiles } from '@/lib/fragment'
import type { FragmentSchema } from '@/lib/schema'
import { getTemplateId } from '@/lib/templates'

export const FORBIDDEN_MANIFEST_BASENAMES = new Set([
  'package.json',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lock',
  'bun.lockb',
])

/** Node builtins (with and without node:). */
export const NODE_BUILTINS = new Set([
  'assert',
  'async_hooks',
  'buffer',
  'child_process',
  'cluster',
  'console',
  'constants',
  'crypto',
  'dgram',
  'diagnostics_channel',
  'dns',
  'domain',
  'events',
  'fs',
  'http',
  'http2',
  'https',
  'inspector',
  'module',
  'net',
  'os',
  'path',
  'perf_hooks',
  'process',
  'punycode',
  'querystring',
  'readline',
  'repl',
  'stream',
  'string_decoder',
  'timers',
  'tls',
  'tty',
  'url',
  'util',
  'v8',
  'vm',
  'wasi',
  'worker_threads',
  'zlib',
])

/** Conservative Next.js + shadcn packages already in the E2B template image. */
export const NEXTJS_TEMPLATE_PACKAGES = new Set([
  'react',
  'react-dom',
  'next',
  'lucide-react',
  'clsx',
  'class-variance-authority',
  'tailwind-merge',
  'tailwindcss',
  'postcss',
  'autoprefixer',
  'typescript',
  '@types/node',
  '@types/react',
  '@types/react-dom',
  'eslint',
  'eslint-config-next',
])

export const VUE_TEMPLATE_PACKAGES = new Set([
  'vue',
  'nuxt',
  'tailwindcss',
  'postcss',
  'autoprefixer',
])

const PACKAGE_FROM_RE =
  /(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g
const PACKAGE_REQUIRE_RE = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g
const DYNAMIC_IMPORT_RE = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g

const SAFE_PKG =
  /^(?:@[a-zA-Z0-9._-]+\/)?[a-zA-Z0-9._-]+$/

export function normalizeRelPath(p: string): string {
  return (p || '').replace(/\\/g, '/').replace(/^\.\//, '')
}

export function isForbiddenManifestPath(filePath: string): boolean {
  const n = normalizeRelPath(filePath)
  const base = (n.split('/').pop() || n).toLowerCase()
  return FORBIDDEN_MANIFEST_BASENAMES.has(base)
}

export function stripForbiddenManifests(
  fragment: FragmentSchema,
): FragmentSchema {
  const code = (fragment.code || []).filter(
    (f) => !isForbiddenManifestPath(f.file_path),
  )
  if (code.length === fragment.code.length) return fragment
  return { ...fragment, code }
}

export function isLocalOrRelativeSpecifier(spec: string): boolean {
  const s = (spec || '').trim()
  return (
    s.startsWith('./') ||
    s.startsWith('../') ||
    s.startsWith('@/') ||
    s.startsWith('/') ||
    s.startsWith('http://') ||
    s.startsWith('https://')
  )
}

export function packageRoot(spec: string): string {
  const s = (spec || '').trim()
  if (!s) return ''
  if (s.startsWith('node:')) return s.slice(5).split('/')[0]
  if (s.startsWith('@')) {
    return s.split('/').slice(0, 2).join('/')
  }
  return s.split('/')[0]
}

export function packageNameFromDepString(dep: string): string {
  const t = (dep || '').trim()
  if (!t) return ''
  if (t.startsWith('@')) {
    const parts = t.split('/')
    if (parts.length < 2) return t
    const name = parts[1].split('@')[0]
    return `${parts[0]}/${name}`
  }
  return t.split('@')[0]
}

export function isNodeBuiltin(spec: string): boolean {
  const s = (spec || '').trim()
  if (s.startsWith('node:')) return true
  const root = packageRoot(s)
  return NODE_BUILTINS.has(root)
}

export function isJsDependencyTemplate(templateId?: string): boolean {
  const id = getTemplateId(templateId || '')
  return id === 'nextjs-developer' || id === 'vue-developer'
}

export function isTemplateProvidedPackage(
  spec: string,
  templateId?: string,
): boolean {
  if (isLocalOrRelativeSpecifier(spec) || isNodeBuiltin(spec)) return true
  const root = packageRoot(spec)
  if (!root) return true
  const id = getTemplateId(templateId || '')
  if (id === 'vue-developer') {
    return VUE_TEMPLATE_PACKAGES.has(root)
  }
  if (root.startsWith('@radix-ui/')) return true
  return NEXTJS_TEMPLATE_PACKAGES.has(root)
}

export function isSafePackageName(name: string): boolean {
  if (!name || name.length > 128) return false
  if (/[;&|`$<>()\\]/.test(name)) return false
  return SAFE_PKG.test(name)
}

export function listedDepsCover(
  listed: string[] | undefined,
  spec: string,
): boolean {
  const root = packageRoot(spec)
  if (!root) return false
  return (listed || []).some((d) => {
    const name = packageNameFromDepString(d)
    return name === root || d === spec || d.startsWith(`${root}@`)
  })
}

export type PackageImportHit = {
  file: string
  specifier: string
  root: string
}

/** All non-local package specifiers in generated JS/TS. */
export function extractPackageImportsFromSource(source: string): string[] {
  if (!source) return []
  const found = new Set<string>()
  const collect = (re: RegExp) => {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(source))) {
      if (m[1]) found.add(m[1])
    }
  }
  collect(PACKAGE_FROM_RE)
  collect(PACKAGE_REQUIRE_RE)
  collect(DYNAMIC_IMPORT_RE)
  return Array.from(found)
}

export function collectPackageImports(
  fragment: FragmentSchema,
): PackageImportHit[] {
  const hits: PackageImportHit[] = []
  for (const f of getFragmentFiles(fragment)) {
    const path = normalizeRelPath(f.file_path)
    if (!/\.(tsx|ts|jsx|js|mjs|cjs)$/i.test(path)) continue
    for (const spec of extractPackageImportsFromSource(f.file_content || '')) {
      if (!spec || isLocalOrRelativeSpecifier(spec) || isNodeBuiltin(spec)) {
        continue
      }
      const root = packageRoot(spec)
      if (!root || !isSafePackageName(root)) continue
      hits.push({ file: path, specifier: spec, root })
    }
  }
  return hits
}

export function extraPackagesRequired(fragment: FragmentSchema): string[] {
  if (!isJsDependencyTemplate(fragment.template)) return []
  const needed = new Set<string>()
  for (const hit of collectPackageImports(fragment)) {
    if (isTemplateProvidedPackage(hit.specifier, fragment.template)) continue
    needed.add(hit.root)
  }
  return Array.from(needed).sort()
}

export function buildNpmInstallCommand(packages: string[]): string {
  const unique = Array.from(
    new Set(packages.map((p) => p.trim()).filter((p) => isSafePackageName(p))),
  ).sort()
  if (!unique.length) return ''
  return `npm install ${unique.join(' ')}`
}

export function isSafeInstallCommand(cmd: string): boolean {
  const t = cmd.trim()
  if (!t) return true
  return /^(npm install|pip install|pnpm add|yarn add)\s+[\w@/.\-\s]+$/.test(t)
}

export type DependencyClosureResult = {
  fragment: FragmentSchema
  added: string[]
  changed: boolean
}

/**
 * Merge imported extra packages into additional_dependencies and the
 * install command. Does not write package.json.
 */
export function closeFragmentDependencies(
  fragment: FragmentSchema,
): DependencyClosureResult {
  const stripped = stripForbiddenManifests(fragment)
  if (!isJsDependencyTemplate(stripped.template)) {
    return { fragment: stripped, added: [], changed: stripped !== fragment }
  }

  const extra = extraPackagesRequired(stripped)
  const existing = [...(stripped.additional_dependencies || [])]
  const added: string[] = []
  for (const pkg of extra) {
    if (!listedDepsCover(existing, pkg)) {
      existing.push(pkg)
      added.push(pkg)
    }
  }

  if (!added.length) {
    const hasExtras = existing.length > 0
    const cmd =
      stripped.install_dependencies_command?.trim() ||
      (hasExtras ? buildNpmInstallCommand(existing.map(packageNameFromDepString)) : '')
    if (
      hasExtras &&
      (!stripped.has_additional_dependencies ||
        !stripped.install_dependencies_command?.trim())
    ) {
      const nextCmd = isSafeInstallCommand(cmd) ? cmd : buildNpmInstallCommand(
        existing.map(packageNameFromDepString).filter(isSafePackageName),
      )
      return {
        fragment: {
          ...stripped,
          additional_dependencies: existing,
          has_additional_dependencies: true,
          install_dependencies_command: nextCmd,
        },
        added: [],
        changed: true,
      }
    }
    return {
      fragment: stripped,
      added: [],
      changed: stripped !== fragment,
    }
  }

  const names = existing.map(packageNameFromDepString).filter(isSafePackageName)
  const cmd = buildNpmInstallCommand(names)
  return {
    fragment: {
      ...stripped,
      additional_dependencies: existing,
      has_additional_dependencies: existing.length > 0,
      install_dependencies_command: cmd,
    },
    added,
    changed: true,
  }
}

/** Install command to run in E2B — synthesize from the dep list when omitted. */
export function resolveInstallCommand(fragment: FragmentSchema): string {
  const listed = (fragment.additional_dependencies || [])
    .map((d) => d.trim())
    .filter(Boolean)
  const existing = fragment.install_dependencies_command?.trim() || ''
  if (existing && isSafeInstallCommand(existing)) return existing
  if (listed.length) {
    const names = listed.map(packageNameFromDepString).filter(isSafePackageName)
    return buildNpmInstallCommand(names)
  }
  return ''
}

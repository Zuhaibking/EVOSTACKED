import type { WrittenFile } from './fragment-files'

const SCRIPT = /\.(tsx|ts|jsx|js|mjs|cjs|vue)$/i
const FROM_RES = [
  /\bfrom\s+['"]([^'"]+)['"]/g,
  /\bimport\s+['"]([^'"]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
]

const SKIP = new Set([
  'react',
  'react-dom',
  'next',
  'typescript',
  'tailwindcss',
  'postcss',
  'autoprefixer',
  'clsx',
  'tailwind-merge',
  'class-variance-authority',
  'lucide-react',
  'vue',
  'nuxt',
  'fs',
  'path',
  'url',
  'crypto',
  'stream',
  'http',
  'https',
  'util',
  'os',
  'zlib',
  'buffer',
  'events',
  'assert',
])

const SAFE = /^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i

export function extraNpmPackages(
  files: WrittenFile[],
  declared: unknown = [],
): string[] {
  const names = new Set<string>()
  for (const file of files) {
    if (!SCRIPT.test(file.file_path)) continue
    for (const spec of importSpecs(file.file_content)) {
      const pkg = packageName(spec)
      if (pkg) names.add(pkg)
    }
  }
  if (Array.isArray(declared)) {
    for (const raw of declared) {
      if (typeof raw !== 'string') continue
      const pkg = declaredName(raw)
      if (pkg) names.add(pkg)
    }
  }
  return Array.from(names)
    .filter((n) => SAFE.test(n) && !SKIP.has(n))
    .sort()
}

/** Packages still missing after `present` (package.json / node_modules names). */
export function packagesToInstall(
  files: WrittenFile[],
  declared: unknown = [],
  present: readonly string[] = [],
): string[] {
  const have = new Set(present)
  return extraNpmPackages(files, declared).filter((n) => !have.has(n))
}

export function npmPackageName(spec: string): string | null {
  return packageName(spec)
}

/** Only compiler TS7016 evidence justifies trying a separate declaration package. */
export function typePackagesForDiagnostics(output: string): string[] {
  const names = new Set<string>()
  for (const match of output.matchAll(/\bTS7016\s*:\s*Could not find a declaration file for module\s+['"]([^'"\r\n]+)['"]/gi)) {
    const pkg = npmPackageName(match[1])
    if (!pkg || !SAFE.test(pkg) || pkg.startsWith('@types/')) continue
    // Match TypeScript's getTypesPackageName / scoped-package mangling.
    const name = `@types/${pkg.startsWith('@') ? pkg.slice(1).replace('/', '__') : pkg}`
    if (SAFE.test(name)) names.add(name)
  }
  return [...names].sort()
}

export type PackageManager = 'npm' | 'pnpm' | 'yarn'

/**
 * Lockfile wins over package.json "packageManager", so an install cannot
 * switch managers and write a second lockfile. No lockfile and no field
 * means npm, which is how the Next and Vue templates are created.
 * Two lockfiles returns null: refuse rather than pick one.
 */
export function detectPackageManager(signals: {
  packageManager?: string
  lockfiles?: readonly string[]
}): PackageManager | null {
  const locks = new Set(signals.lockfiles || [])
  const hasPnpm = locks.has('pnpm-lock.yaml')
  const hasYarn = locks.has('yarn.lock')
  const hasNpm = locks.has('package-lock.json')
  const count = Number(hasPnpm) + Number(hasYarn) + Number(hasNpm)
  if (count > 1) return null
  if (hasPnpm) return 'pnpm'
  if (hasYarn) return 'yarn'
  if (hasNpm) return 'npm'
  const field = (signals.packageManager || '').trim().toLowerCase()
  if (field.startsWith('pnpm@') || field === 'pnpm') return 'pnpm'
  if (field.startsWith('yarn@') || field === 'yarn') return 'yarn'
  if (field.startsWith('npm@') || field === 'npm') return 'npm'
  return 'npm'
}

export function installCommand(
  manager: PackageManager,
  packages: string[],
  peerFallback = false,
): string | null {
  const pkgs = packages.filter((n) => SAFE.test(n))
  if (!pkgs.length) return null
  const list = pkgs.join(' ')
  if (manager === 'pnpm') {
    return peerFallback
      ? `pnpm add --no-strict-peer-dependencies ${list}`
      : `pnpm add ${list}`
  }
  if (manager === 'yarn') {
    return peerFallback ? null : `yarn add ${list}`
  }
  return peerFallback
    ? `npm install --no-fund --no-audit --legacy-peer-deps ${list}`
    : `npm install --no-fund --no-audit ${list}`
}

export function npmInstallCommand(packages: string[]): string | null {
  return installCommand('npm', packages)
}

function importSpecs(code: string): string[] {
  if (!code) return []
  const out: string[] = []
  for (const re of FROM_RES) {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(code))) out.push(m[1])
  }
  return out
}

function packageName(spec: string): string | null {
  if (!spec || spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('node:')) {
    return null
  }
  if (spec.startsWith('@/') || spec.startsWith('~/')) return null
  if (spec.startsWith('@')) {
    const parts = spec.split('/')
    if (parts.length < 2) return null
    return `${parts[0]}/${parts[1]}`
  }
  return spec.split('/')[0] || null
}

function declaredName(raw: string): string | null {
  const t = raw.trim()
  if (!t || /[;|&$`\\]/.test(t)) return null
  if (t.startsWith('git+') || t.startsWith('http:') || t.startsWith('https:')) {
    return null
  }
  if (t.startsWith('@')) {
    const m = t.match(/^(@[^/]+\/[^@/]+)/)
    return m ? m[1] : null
  }
  const m = t.match(/^([^@/]+)/)
  return m ? m[1] : null
}

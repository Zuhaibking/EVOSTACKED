import type { WrittenFile } from './fragment-files'

const SCRIPT = /\.(tsx|ts|jsx|js|mjs|cjs|vue)$/i
const FROM_RES = [
  /\bfrom\s+['"]([^'"]+)['"]/g,
  /\bimport\s+['"]([^'"]+)['"]/g,
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
    .filter((n) => SAFE.test(n) && !SKIP.has(n) && !n.startsWith('@types/'))
    .sort()
}

export function npmInstallCommand(packages: string[]): string | null {
  const pkgs = packages.filter((n) => SAFE.test(n))
  if (!pkgs.length) return null
  return `npm install --no-fund --no-audit ${pkgs.join(' ')}`
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

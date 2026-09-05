import { coerceDeps } from './salvage-fragment'

const PKG =
  /^(@[a-z0-9-~._]+\/)?[a-z0-9-~._]+(@[a-z0-9-~._+]+)?$/i

/** Already in the nextjs-developer / shadcn template — installing again is wasted time. */
const TEMPLATE_PACKAGES = new Set([
  'react',
  'react-dom',
  'next',
  'typescript',
  'tailwindcss',
  'postcss',
  'autoprefixer',
  'lucide-react',
  'class-variance-authority',
  'clsx',
  'tailwind-merge',
  'tailwindcss-animate',
])

export function npmPackageName(spec: string): string | null {
  const raw = spec.trim()
  if (!raw || raw.startsWith('.') || raw.startsWith('/') || raw.startsWith('@/') || raw.startsWith('~/')) {
    return null
  }
  if (raw.startsWith('next/') || raw === 'react' || raw.startsWith('react/') || raw.startsWith('react-dom')) {
    return null
  }
  const name = raw.startsWith('@')
    ? raw.split('/').slice(0, 2).join('/')
    : raw.split('/')[0]
  if (!name || !PKG.test(name) || /[;&|`$<>()\\]/.test(name)) return null
  const bare = name.startsWith('@') ? name : name.replace(/@[^/]+$/, '')
  if (TEMPLATE_PACKAGES.has(bare) || bare.startsWith('@radix-ui/')) return null
  return name
}

export function npmPackagesFromCode(code: string): string[] {
  const found = new Set<string>()
  const re = /(?:from|import|require\s*\()\s*['"]([^'"]+)['"]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(code))) {
    const name = npmPackageName(m[1])
    if (name) found.add(name)
  }
  return [...found]
}

function packagesFromCommand(command: string): string[] {
  const cmd = command.trim()
  if (!/^(npm|pnpm|yarn|npx)\s+(install|add|i)\b/.test(cmd)) return []
  if (/[;&|`$<>]/.test(cmd)) return []
  const parts = cmd.split(/\s+/).slice(2)
  const out: string[] = []
  for (const part of parts) {
    if (part.startsWith('-')) continue
    const name = npmPackageName(part)
    if (name) out.push(name)
  }
  return out
}

export function collectInstallPackages(args: {
  code?: unknown
  files?: { file_content: string }[]
  additional_dependencies?: unknown
  install_dependencies_command?: unknown
}): string[] {
  const found = new Set<string>()
  for (const d of coerceDeps(args.additional_dependencies)) {
    const name = npmPackageName(d)
    if (name) found.add(name)
  }
  if (typeof args.install_dependencies_command === 'string') {
    for (const name of packagesFromCommand(args.install_dependencies_command)) found.add(name)
  }
  const sources = [
    ...(typeof args.code === 'string' ? [args.code] : []),
    ...(args.files ?? []).map((f) => f.file_content),
  ]
  for (const src of sources) {
    for (const name of npmPackagesFromCode(src)) found.add(name)
  }
  return [...found]
}

/** Safe `npm install` only. Null when the template already covers the imports. */
export function safeInstallCommand(args: {
  code?: unknown
  files?: { file_content: string }[]
  additional_dependencies?: unknown
  install_dependencies_command?: unknown
  has_additional_dependencies?: unknown
}): string | null {
  const pkgs = collectInstallPackages(args)
  if (!pkgs.length) return null
  return `npm install ${pkgs.join(' ')}`
}

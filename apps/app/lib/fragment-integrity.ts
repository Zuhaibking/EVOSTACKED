/**
 * Deterministic fragment integrity — local import graph / file manifest checks.
 * ZERO OpenAI / E2B / network calls.
 */
import {
  validateFragmentStylesheets,
  type CssIssueCode,
} from '@/lib/css-integrity'
import {
  validateFragmentSourceSyntax,
  type SourceIssueCode,
} from '@/lib/source-syntax'
import { getFragmentFiles, type FragmentCode } from '@/lib/fragment'
import {
  detectHydrationRisksInSource,
  formatHydrationRepairHints,
  inferHydrationRiskCode,
  shouldScanFileForHydration,
} from '@/lib/hydration-safety'
import {
  isJsDependencyTemplate,
  isLocalOrRelativeSpecifier,
  isNodeBuiltin,
  isTemplateProvidedPackage,
  listedDepsCover,
} from '@/lib/dependency-closure'
import { detectProviderIssues } from '@/lib/provider-integrity'
import type { FragmentSchema } from '@/lib/schema'
import type { VerificationResult } from '@/lib/verification'
import type { DeepPartial } from '@evostack/shared'

export const CODE_EXTENSIONS = [
  '.tsx',
  '.ts',
  '.jsx',
  '.js',
  '.mjs',
  '.cjs',
] as const

/** Packages commonly available in EvoStack Next.js / Node templates. */
export const KNOWN_PACKAGE_PREFIXES = [
  'react',
  'react-dom',
  'next',
  'clsx',
  'class-variance-authority',
  'tailwind-merge',
  'lucide-react',
  'framer-motion',
  'zod',
  'date-fns',
  'recharts',
  '@radix-ui/',
  'classnames',
  'uuid',
  'nanoid',
  'swr',
  'ai',
] as const

export type IntegrityIssueCode =
  | 'missing_entrypoint'
  | 'empty_critical_file'
  | 'duplicate_path'
  | 'unresolved_local_import'
  | 'broken_relative_path'
  | 'unknown_package'
  | 'missing_export_hint'
  | 'hydration_risk'
  | 'missing_npm_dependency'
  | 'missing_provider'
  | CssIssueCode
  | SourceIssueCode

export type IntegrityIssue = {
  code: IntegrityIssueCode
  severity: 'error' | 'warning'
  message: string
  /** File that contains the problem (importer or empty file). */
  file?: string
  /** Import specifier when relevant. */
  specifier?: string
  /** Human-readable basename for UX (derived from the import path). */
  missingName?: string
  /** Approximate 1-based line when available. */
  line?: number
}

export type FragmentManifest = {
  /** Normalized forward-slash paths, unique. */
  files: string[]
  /** Lowercase path → actual path (for case-insensitive lookup). */
  byLower: Map<string, string>
}

export type FragmentIntegrityResult = {
  ok: boolean
  manifest: FragmentManifest
  issues: IntegrityIssue[]
  unresolvedImports: Array<{
    from: string
    specifier: string
    missingName?: string
  }>
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+/g, '/')
}

function dirname(p: string): string {
  const n = normalizePath(p)
  const i = n.lastIndexOf('/')
  return i < 0 ? '' : n.slice(0, i)
}

function joinPath(baseDir: string, rel: string): string {
  const parts = [
    ...(baseDir ? baseDir.split('/') : []),
    ...normalizePath(rel).split('/'),
  ]
  const out: string[] = []
  for (const part of parts) {
    if (!part || part === '.') continue
    if (part === '..') {
      out.pop()
      continue
    }
    out.push(part)
  }
  return out.join('/')
}

function basenameNoExt(path: string): string {
  const base = normalizePath(path).split('/').pop() || path
  return base.replace(/\.(tsx|ts|jsx|js|mjs|cjs)$/i, '')
}

/** Build deterministic file manifest from a fragment. */
export function buildFragmentManifest(
  fragment:
    | DeepPartial<FragmentSchema>
    | FragmentSchema
    | { file_path?: string; code?: FragmentCode }
    | null
    | undefined,
): FragmentManifest {
  const files = getFragmentFiles(fragment)
  const paths: string[] = []
  const byLower = new Map<string, string>()
  for (const f of files) {
    const p = normalizePath(f.file_path)
    if (!p) continue
    paths.push(p)
    const lower = p.toLowerCase()
    if (!byLower.has(lower)) byLower.set(lower, p)
  }
  return { files: paths, byLower }
}

/**
 * Resolve a local relative/aliased import against the generated manifest.
 * Tries exact path + common extensions + index files.
 * Case-insensitive match only when a real generated file exists.
 */
export function resolveLocalImport(
  fromFile: string,
  specifier: string,
  manifest: FragmentManifest,
): { resolved: string | null; tried: string[] } {
  const tried: string[] = []
  const raw = specifier.trim()
  if (!raw) return { resolved: null, tried }

  let target: string
  if (raw.startsWith('@/')) {
    target = normalizePath(raw.slice(2))
  } else if (raw.startsWith('./') || raw.startsWith('../')) {
    target = joinPath(dirname(fromFile), raw)
  } else {
    return { resolved: null, tried }
  }

  const candidates: string[] = []
  const push = (p: string) => {
    const n = normalizePath(p)
    if (n && !candidates.includes(n)) candidates.push(n)
  }

  push(target)
  const hasExt = /\.(tsx|ts|jsx|js|mjs|cjs|css|json|svg|png|jpg|jpeg|gif|webp)$/i.test(
    target,
  )
  if (!hasExt) {
    for (const ext of CODE_EXTENSIONS) {
      push(target + ext)
    }
    for (const ext of CODE_EXTENSIONS) {
      push(`${target}/index${ext}`)
    }
  }

  for (const c of candidates) {
    tried.push(c)
    if (manifest.files.includes(c)) return { resolved: c, tried }
    const ci = manifest.byLower.get(c.toLowerCase())
    if (ci) return { resolved: ci, tried }
  }

  return { resolved: null, tried }
}

const LOCAL_FROM_RE =
  /(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?['"]((?:\.\.?\/|@\/)[^'"]+)['"]/g
const REQUIRE_RE =
  /require\s*\(\s*['"]((?:\.\.?\/|@\/)[^'"]+)['"]\s*\)/g
const DYNAMIC_IMPORT_RE =
  /import\s*\(\s*['"]((?:\.\.?\/|@\/)[^'"]+)['"]\s*\)/g

/** Extract local import/require/dynamic-import specifiers from source. */
export function extractLocalImports(source: string): string[] {
  if (!source) return []
  const found = new Set<string>()
  const collect = (re: RegExp) => {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(source))) {
      if (m[1]) found.add(m[1])
    }
  }
  collect(LOCAL_FROM_RE)
  collect(REQUIRE_RE)
  collect(DYNAMIC_IMPORT_RE)
  return Array.from(found)
}

const PACKAGE_FROM_RE =
  /(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g
const PACKAGE_REQUIRE_RE = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g

function looksLikeExport(name: string, content: string): boolean {
  if (!name || !content) return false
  const re = new RegExp(
    `export\\s+(?:default\\s+)?(?:async\\s+)?(?:function|const|class|let|var)\\s+${name}\\b|export\\s*\\{[^}]*\\b${name}\\b`,
  )
  return re.test(content)
}

/**
 * Paths provided by the E2B sandbox template (e.g. nextjs-developer runs
 * `shadcn add --all`) — NOT required in fragment.code[].
 * App-specific components under components/ (outside ui/) must still resolve.
 */
export function isTemplateProvidedImport(
  specifier: string,
  resolvedTarget?: string | null,
): boolean {
  const fromSpec = specifier.trim()
  let pathPart = ''
  if (fromSpec.startsWith('@/')) {
    pathPart = normalizePath(fromSpec.slice(2))
  } else if (resolvedTarget) {
    pathPart = normalizePath(resolvedTarget)
  } else if (fromSpec.startsWith('./') || fromSpec.startsWith('../')) {
    // Relative imports are app-local unless they clearly target ui/utils.
    pathPart = normalizePath(fromSpec.replace(/^\.\.?\//, ''))
  } else {
    return false
  }

  // shadcn/ui kit + utils shipped with nextjs-developer template
  if (/^components\/ui(\/|$)/i.test(pathPart)) return true
  if (/^lib\/utils(\.|$)/i.test(pathPart)) return true
  // Occasional shadcn hook path
  if (/^hooks\/use-toast(\.|$)/i.test(pathPart)) return true
  if (/^components\/ui\/use-toast(\.|$)/i.test(pathPart)) return true

  return false
}

/**
 * Validate generated fragment integrity (manifest + local import graph).
 * Pure / deterministic — no providers.
 */
export function validateFragmentIntegrity(
  fragment:
    | DeepPartial<FragmentSchema>
    | FragmentSchema
    | null
    | undefined,
  opts?: { extraDependencies?: string[] },
): FragmentIntegrityResult {
  const files = getFragmentFiles(fragment)
  const manifest = buildFragmentManifest(fragment)
  const issues: IntegrityIssue[] = []
  const unresolvedImports: FragmentIntegrityResult['unresolvedImports'] = []

  const primary =
    typeof fragment?.file_path === 'string' ? normalizePath(fragment.file_path) : ''

  if (!files.length) {
    issues.push({
      code: 'missing_entrypoint',
      severity: 'error',
      message: 'Generated fragment has no source files',
    })
    return { ok: false, manifest, issues, unresolvedImports }
  }

  if (primary && !manifest.byLower.has(primary.toLowerCase())) {
    issues.push({
      code: 'missing_entrypoint',
      severity: 'error',
      message: `Primary entry "${primary}" is not present in the generated file set`,
      file: primary,
      missingName: basenameNoExt(primary),
    })
  }

  // Duplicate paths (exact)
  const seen = new Map<string, number>()
  for (const p of manifest.files) {
    seen.set(p, (seen.get(p) || 0) + 1)
  }
  for (const [p, n] of Array.from(seen.entries())) {
    if (n > 1) {
      issues.push({
        code: 'duplicate_path',
        severity: 'error',
        message: `Duplicate generated file path: ${p}`,
        file: p,
      })
    }
  }

  const extraDeps = [
    ...(opts?.extraDependencies || []),
    ...((fragment as FragmentSchema)?.additional_dependencies || []),
  ]

  for (const f of files) {
    const path = normalizePath(f.file_path)
    const content = f.file_content || ''
    const isCode = /\.(tsx|ts|jsx|js|mjs|cjs)$/i.test(path)
    if (isCode && !content.trim()) {
      issues.push({
        code: 'empty_critical_file',
        severity: 'error',
        message: `Critical file is empty: ${path}`,
        file: path,
      })
      continue
    }
    if (!isCode) continue

    for (const spec of extractLocalImports(content)) {
      // Asset-like extensions that may not be in code[] — warn lightly
      if (/\.(css|scss|sass|json|svg|png|jpg|jpeg|gif|webp|ico)$/i.test(spec)) {
        const { resolved } = resolveLocalImport(path, spec, manifest)
        if (!resolved && !/\.(css|scss|sass)$/i.test(spec)) {
          issues.push({
            code: 'unresolved_local_import',
            severity: 'warning',
            message: `Referenced asset may be missing: ${spec} (from ${path})`,
            file: path,
            specifier: spec,
            missingName: basenameNoExt(spec),
          })
        }
        continue
      }

      if (spec.includes('\\') || spec.includes('\0')) {
        issues.push({
          code: 'broken_relative_path',
          severity: 'error',
          message: `Broken import path in ${path}: ${spec}`,
          file: path,
          specifier: spec,
        })
        continue
      }

      const { resolved, tried } = resolveLocalImport(path, spec, manifest)
      if (!resolved) {
        const missingName = basenameNoExt(spec)
        // Template scaffolding (shadcn ui, lib/utils) exists on the sandbox —
        // do not block deploy or burn the one-shot repair budget on these.
        if (
          isTemplateProvidedImport(spec, tried[0] || null) ||
          isTemplateProvidedImport(spec)
        ) {
          issues.push({
            code: 'unresolved_local_import',
            severity: 'warning',
            message: `Template-provided import "${spec}" in ${path} (not required in generated files)`,
            file: path,
            specifier: spec,
            missingName,
          })
          continue
        }
        unresolvedImports.push({ from: path, specifier: spec, missingName })
        issues.push({
          code: 'unresolved_local_import',
          severity: 'error',
          message: `Unresolved local import "${spec}" in ${path} (missing ${missingName})`,
          file: path,
          specifier: spec,
          missingName,
        })
      } else {
        // Soft export name check for default-ish component imports
        const defaultImport = content.match(
          new RegExp(
            `import\\s+([A-Z][A-Za-z0-9_]*)\\s+from\\s+['"]${spec.replace(
              /[.*+?^${}()|[\]\\]/g,
              '\\$&',
            )}['"]`,
          ),
        )
        if (defaultImport?.[1]) {
          const targetFile = files.find(
            (x) => normalizePath(x.file_path) === resolved,
          )
          if (
            targetFile &&
            !looksLikeExport(defaultImport[1], targetFile.file_content) &&
            !/export\s+default\b/.test(targetFile.file_content)
          ) {
            issues.push({
              code: 'missing_export_hint',
              severity: 'warning',
              message: `Import "${defaultImport[1]}" from ${spec} may not match exports in ${resolved}`,
              file: path,
              specifier: spec,
              missingName: defaultImport[1],
            })
          }
        }
      }
    }

    // Missing extra npm packages (not template-provided, not listed)
    PACKAGE_FROM_RE.lastIndex = 0
    let pm: RegExpExecArray | null
    while ((pm = PACKAGE_FROM_RE.exec(content))) {
      const spec = pm[1]
      if (!spec || isLocalOrRelativeSpecifier(spec) || isNodeBuiltin(spec)) {
        continue
      }
      if (!isJsDependencyTemplate((fragment as FragmentSchema)?.template)) {
        continue
      }
      if (isTemplateProvidedPackage(spec, (fragment as FragmentSchema)?.template)) {
        continue
      }
      if (listedDepsCover(extraDeps, spec)) continue
      issues.push({
        code: 'missing_npm_dependency',
        severity: 'error',
        message: `${path}: Package import "${spec}" is not in the template or additional_dependencies`,
        file: path,
        specifier: spec,
        missingName: spec,
      })
    }
    PACKAGE_REQUIRE_RE.lastIndex = 0
    while ((pm = PACKAGE_REQUIRE_RE.exec(content))) {
      const spec = pm[1]
      if (!spec || isLocalOrRelativeSpecifier(spec) || isNodeBuiltin(spec)) {
        continue
      }
      if (!isJsDependencyTemplate((fragment as FragmentSchema)?.template)) {
        continue
      }
      if (isTemplateProvidedPackage(spec, (fragment as FragmentSchema)?.template)) {
        continue
      }
      if (listedDepsCover(extraDeps, spec)) continue
      issues.push({
        code: 'missing_npm_dependency',
        severity: 'error',
        message: `${path}: Package require "${spec}" is not in the template or additional_dependencies`,
        file: path,
        specifier: spec,
        missingName: spec,
      })
    }

    // SSR / hydration hazards (generic — countdowns, clocks, random IDs, browser APIs)
    if (shouldScanFileForHydration(path) && isCode) {
      for (const risk of detectHydrationRisksInSource(content, {
        filePath: path,
      })) {
        issues.push({
          code: 'hydration_risk',
          severity: risk.severity,
          message: risk.message,
          file: path,
        })
      }
    }
  }

  if (isJsDependencyTemplate((fragment as FragmentSchema)?.template)) {
    for (const issue of detectProviderIssues(fragment as FragmentSchema)) {
      issues.push({
        code: 'missing_provider',
        severity: 'error',
        message: issue.message,
        file: issue.file,
        specifier: issue.specifier,
        missingName: issue.hookName,
        line: issue.line,
      })
    }
  }

  const css = validateFragmentStylesheets(files)
  for (const issue of css.issues) {
    issues.push({
      code: issue.code,
      severity: issue.severity,
      message: issue.message,
      file: issue.file,
    })
  }

  const syntax = validateFragmentSourceSyntax(files)
  for (const issue of syntax.issues) {
    issues.push({
      code: issue.code,
      severity: issue.severity,
      message: issue.message,
      file: issue.file,
    })
  }

  const errors = issues.filter((i) => i.severity === 'error')
  return {
    ok: errors.length === 0,
    manifest,
    issues,
    unresolvedImports,
  }
}

/**
 * Issues that prevent Next/E2B from compiling or starting.
 * Hydration mismatches and unused extra stylesheets are not compile failures —
 * they must not skip sandbox deploy.
 */
export const COMPILE_BLOCKING_INTEGRITY_CODES: ReadonlySet<IntegrityIssueCode> =
  new Set([
    'missing_entrypoint',
    'empty_critical_file',
    'duplicate_path',
    'unresolved_local_import',
    'broken_relative_path',
    'invalid_css_import_order',
    'malformed_css',
    'truncated_css',
    'invalid_source',
    'truncated_source',
    'jsx_in_ts',
    'missing_npm_dependency',
    'missing_provider',
  ])

export function isCompileBlockingIntegrityIssue(
  issue: IntegrityIssue,
): boolean {
  return (
    issue.severity === 'error' &&
    COMPILE_BLOCKING_INTEGRITY_CODES.has(issue.code)
  )
}

/** True when E2B/sandbox may proceed. Quality-only errors do not block. */
export function canDeployIntegrity(result: FragmentIntegrityResult): boolean {
  return !result.issues.some(isCompileBlockingIntegrityIssue)
}

export function formatNonBlockingIntegrityWarnings(
  result: FragmentIntegrityResult,
): string[] {
  return result.issues
    .filter((i) => i.severity === 'error' && !isCompileBlockingIntegrityIssue(i))
    .map((i) => i.message)
}

export function formatIntegrityDiagnostics(
  result: FragmentIntegrityResult,
): string[] {
  return result.issues
    .filter((i) => i.severity === 'error')
    .map((i) => i.message)
}

/** Concise UX-facing summary (not a raw stack trace). */
export function formatIntegrityUserSummary(
  result: FragmentIntegrityResult,
  opts?: { candidateLabel?: string; repaired?: boolean; recovered?: boolean },
): string {
  const label = opts?.candidateLabel || 'Candidate'
  const missing = result.unresolvedImports
    .map((u) => u.missingName)
    .filter(Boolean)
  const unique = Array.from(new Set(missing))

  if (opts?.recovered) {
    return `${label} recovered successfully.`
  }
  if (opts?.repaired && !result.ok) {
    const first =
      formatIntegrityDiagnostics(result)[0] || 'Structural validation failed.'
    const miss =
      unique.length > 0
        ? ` Missing component: ${unique.slice(0, 3).join(', ')}.`
        : ''
    return `${label} encountered a build issue.${miss} ${first}`
  }
  if (!result.ok) {
    const miss =
      unique.length > 0
        ? ` Missing component: ${unique.slice(0, 3).join(', ')}.`
        : ` ${formatIntegrityDiagnostics(result)[0] || 'Structural validation failed.'}`
    return `${label} encountered a build issue.${miss}`
  }
  return `${label} passed local validation.`
}

/** Convert integrity failure into a VerificationResult (skip/fake-success guard). */
export function integrityToFailedVerification(
  result: FragmentIntegrityResult,
  opts?: { candidateLabel?: string; durationMs?: number },
): VerificationResult {
  const summary = formatIntegrityUserSummary(result, {
    candidateLabel: opts?.candidateLabel,
  })
  const details = formatIntegrityDiagnostics(result)
  return {
    status: 'failed',
    filesWritten: false,
    dependenciesInstalled: 'not_required',
    processStarted: false,
    previewReachable: false,
    errors: [summary, ...details].filter(Boolean).slice(0, 8),
    warnings: result.issues
      .filter((i) => i.severity === 'warning')
      .map((i) => i.message)
      .slice(0, 6),
    durationMs: opts?.durationMs ?? 0,
  }
}

export function formatIntegrityForRepair(
  result: FragmentIntegrityResult,
): string {
  const tree = result.manifest.files.map((f) => `- ${f}`).join('\n') || '- (none)'
  const unresolved =
    result.unresolvedImports.length > 0
      ? result.unresolvedImports
          .map(
            (u) =>
              `- ${u.from} imports "${u.specifier}" → missing ${u.missingName || u.specifier}`,
          )
          .join('\n')
      : '- (none)'
  const issues = result.issues
    .map((i) => `- [${i.severity}] ${i.code}: ${i.message}`)
    .join('\n')
  const hydration = formatHydrationRepairHints(
    result.issues
      .filter((i) => i.code === 'hydration_risk')
      .map((i) => ({
        code: inferHydrationRiskCode(i.message),
        severity: i.severity,
        message: i.message,
      })),
  )
  const hasImportIssues = result.unresolvedImports.length > 0
  const hasHydration = result.issues.some((i) => i.code === 'hydration_risk')
  const hasCss = result.issues.some(
    (i) =>
      i.code === 'invalid_css_import_order' ||
      i.code === 'malformed_css' ||
      i.code === 'truncated_css' ||
      i.code === 'duplicate_stylesheet',
  )
  const hasSyntax = result.issues.some(
    (i) =>
      i.code === 'invalid_source' ||
      i.code === 'truncated_source' ||
      i.code === 'jsx_in_ts',
  )
  const hasMissingDep = result.issues.some((i) => i.code === 'missing_npm_dependency')
  const hasMissingProvider = result.issues.some((i) => i.code === 'missing_provider')
  return `## File integrity failure (local validation)
Generated file manifest:
${tree}

Unresolved local imports:
${unresolved}

Issues:
${issues}

${hydration}

Fix instructions:
${hasImportIssues ? '- Ensure every local import resolves to an existing generated file (add missing modules OR fix paths).\n' : ''}${hasMissingDep ? '- Add every imported extra npm package to additional_dependencies and install_dependencies_command. Do not overwrite package.json.\n' : ''}${hasMissingProvider ? '- Mount the required React provider (e.g. SessionProvider) at pages/_app.tsx or app/layout.tsx. Do not delete authentication or session code.\n' : ''}${hasHydration ? '- Fix SSR/hydration hazards: useEffect + stable placeholders for time/random/browser APIs; never nest <a> or <motion.a> inside Next.js <Link> (Link already renders <a>). Keep countdowns/clocks/animations/links functional.\n' : ''}${hasCss ? '- Stylesheet structure is invalid. Move every external @import to a valid location at the beginning of the stylesheet (only @charset and @layer statements may appear first). Preserve every existing CSS rule, Tailwind directive, animation, variable, component style, font configuration, and visual feature. Do not delete functionality.\n- Do not "fix" CSS by removing fonts, animations, sections, or visual effects.\n' : ''}${hasSyntax ? '- TypeScript/JSX does not parse. Complete truncated files, close every JSX tag, and put JSX only in .tsx/.jsx files (never .ts). Do not wrap file contents in markdown fences.\n' : ''}- Do not remove required features.
- Do not simplify the application unnecessarily.
Return the corrected complete file set for changed/added files only.`
}

/** Detect generic Module-not-found / resolve failures in build logs. */
export function isImportGraphBuildError(message: string): boolean {
  return /Module not found|Cannot find module|Unable to resolve|Can't resolve/i.test(
    message || '',
  )
}

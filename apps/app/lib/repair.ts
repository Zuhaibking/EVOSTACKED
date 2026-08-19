import type { ArchitectureComplianceResult } from '@/lib/architecture-compliance'
import {
  formatArchitectureComplianceForJudge,
  hasCriticalArchitectureFailure,
} from '@/lib/architecture-compliance'
import {
  formatIntegrityForRepair,
  type FragmentIntegrityResult,
} from '@/lib/fragment-integrity'
import { getFragmentFiles, FragmentFile } from '@/lib/fragment'
import type { ApplicationPlan } from '@/lib/plan'
import { formatArchitectureForGeneration, formatPlanForJudge } from '@/lib/plan'
import { FragmentSchema, fragmentFileSchema } from '@/lib/schema'
import {
  VerificationResult,
  formatVerificationForJudge,
  truncateDiagnostic,
  verificationHasPreviewOverlayFailure,
} from '@/lib/verification'
import { isInfrastructureRuntimeFailure } from '@/lib/sandbox-transport'
import { z } from 'zod'

/** Hard structural limit — never more than one repair per candidate. */
export const MAX_REPAIR_ATTEMPTS_PER_CANDIDATE = 1

export const repairReasonSchema = z.enum([
  'architecture',
  'runtime',
  'combined',
  'integrity',
])

export type RepairReason = z.infer<typeof repairReasonSchema>

export const repairFileActionSchema = z.enum(['modify', 'add', 'remove'])

export const repairFileChangeSchema = z.object({
  file_path: z
    .string()
    .describe('Relative project path of the file to change.'),
  action: repairFileActionSchema.describe(
    'modify = replace contents; add = new file; remove = delete file.',
  ),
  file_content: z
    .string()
    .describe(
      'Full file contents for modify/add. Empty string for remove.',
    ),
})

/**
 * Structured repair output from the model.
 * Only changed files are returned — unrelated files stay as-is.
 */
export const repairResultSchema = z.object({
  explanation: z
    .string()
    .describe(
      'Short diagnosis of the failure and the minimal fix applied.',
    ),
  changedFiles: z
    .array(z.string())
    .describe('List of file paths touched by this repair.'),
  files: z
    .array(repairFileChangeSchema)
    .describe(
      'Only the files that must change. Prefer 1–5 files. Do not regenerate the whole project.',
    ),
  additional_dependencies: z
    .array(z.string())
    .optional()
    .describe(
      'If the failure is a missing package, list packages to add. Otherwise omit or [].',
    ),
  install_dependencies_command: z
    .string()
    .optional()
    .describe(
      'Install command for additional_dependencies, e.g. "npm install recharts". Empty if none.',
    ),
})

export type RepairResult = z.infer<typeof repairResultSchema>
export type RepairFileChange = z.infer<typeof repairFileChangeSchema>

export type RepairAttemptRecord = {
  attempted: true
  /** Why this single repair was triggered. */
  reason: RepairReason
  /** Always 1 after an attempt is recorded (budget consumed). */
  repairAttempts: number
  explanation?: string
  changedFiles?: string[]
  success: boolean
  error?: string
}

export type RepairEligibilityInput = {
  /** Must be 0 to be eligible. */
  repairAttempts: number
  architectureCompliance?: ArchitectureComplianceResult | null
  verification?: VerificationResult | null
  /** Local static integrity (import graph / manifest). */
  integrity?: FragmentIntegrityResult | null
}

/**
 * True only for a real compile/runtime failure that E2B already observed.
 * Architecture gaps, hydration heuristics, and integrity warnings are not enough.
 * Infrastructure (missing E2B key, DNS, transport) must never consume repair budget.
 */
export function hasGenuineRuntimeFailure(
  verification?: VerificationResult | null,
): boolean {
  if (!verification) return false
  if (isInfrastructureRuntimeFailure(verification.errors)) return false
  return (
    verification.status === 'failed' ||
    verificationHasPreviewOverlayFailure(verification)
  )
}

/**
 * Choose primary repair reason.
 * Repair is fallback-only: a genuine non-infrastructure compile/runtime failure
 * must exist. Architecture/integrity evidence may annotate that repair, but
 * cannot trigger an LLM call on their own.
 */
export function selectRepairReason(
  input: Omit<RepairEligibilityInput, 'repairAttempts'>,
): RepairReason | null {
  const runtimeFail = hasGenuineRuntimeFailure(input.verification)
  if (!runtimeFail) return null

  const integrityFail = Boolean(input.integrity && !input.integrity.ok)
  const archFail = hasCriticalArchitectureFailure(
    input.architectureCompliance ?? null,
  )
  if (integrityFail && !archFail) return 'integrity'
  if (integrityFail && archFail) return 'combined'
  if (archFail) return 'combined'
  return 'runtime'
}

/**
 * Unified eligibility: unused repair budget AND a genuine compile/runtime
 * failure. Architecture-only, integrity-only, hydration heuristics, and
 * infrastructure failures do not qualify.
 */
export function shouldAttemptRepair(input: RepairEligibilityInput): boolean {
  if (
    !Number.isFinite(input.repairAttempts) ||
    input.repairAttempts < 0 ||
    input.repairAttempts >= MAX_REPAIR_ATTEMPTS_PER_CANDIDATE
  ) {
    return false
  }
  return selectRepairReason(input) != null
}

/** Consume the one-shot budget — always returns 1. */
export function consumeRepairAttempt(current: number): number {
  if (current >= MAX_REPAIR_ATTEMPTS_PER_CANDIDATE) {
    return MAX_REPAIR_ATTEMPTS_PER_CANDIDATE
  }
  return MAX_REPAIR_ATTEMPTS_PER_CANDIDATE
}

export const REPAIR_SYSTEM_PROMPT = `You are repairing an EXISTING generated application.

You are NOT generating a new application.

Rules:
- Do NOT redesign the product, UI theme, or requirements.
- Do NOT regenerate the entire project.
- Make the smallest safe changes to fix the stated deterministic failure(s).
- Preserve design direction, working functionality, interaction contracts, and unrelated files.
- Only modify files relevant to the failure.
- You may add a missing file or dependency when evidence proves it is needed.
- You may remove a file only when it is clearly broken and unused.
- Never invent secrets or real API keys.
- Do not touch package.json / lockfiles; use additional_dependencies + install_dependencies_command instead.
- If fixing architecture: implement the REQUIRED layers from ArchitectureRequirements (backend/API, database layer, auth) without adding unnecessary infrastructure.
- If fixing runtime: address the factual diagnostics (missing modules, imports, compile/startup errors, truncated TSX, unclosed JSX).
- If fixing file integrity: every local import must resolve to an existing generated file. Add the missing module OR fix the import path — keep required features.
- If the file does not parse: finish truncated source, close every JSX tag, and keep JSX only in .tsx/.jsx files.
- If fixing CSS: move @import statements to a valid location at the beginning of the stylesheet. Preserve every existing CSS rule, Tailwind directive, animation, variable, component style, font configuration, and visual feature. Do not delete fonts, animations, sections, or effects.
- If fixing hydration/SSR hazards: move Date.now()/new Date()/Math.random()/browser APIs into useEffect with a stable first-paint placeholder. Keep countdowns/clocks/animations — do not delete them. Never nest <a> or <motion.a> inside Next.js <Link> (Link already renders <a>); use className on Link, motion(Link), or legacyBehavior. Do not delete navigation.
- Connect existing UI to the required architecture when possible; do not replace a working UI.
- Return ONLY the schema fields. Put full file contents for each modify/add.`

export function buildUnifiedRepairPrompt(opts: {
  reason: RepairReason
  fragment: FragmentSchema
  plan?: ApplicationPlan | null
  architectureCompliance?: ArchitectureComplianceResult | null
  verification?: VerificationResult | null
  integrity?: FragmentIntegrityResult | null
  productContext?: string
}): string {
  const {
    reason,
    fragment,
    plan,
    architectureCompliance,
    verification,
    integrity,
  } = opts
  const product = opts.productContext
    ? `\nProduct context:\n${opts.productContext}\n`
    : ''

  const planBlock = plan
    ? `## Shared product plan
${formatPlanForJudge(plan)}
${
  plan.architectureRequirements
    ? `\n## Architecture requirements (must satisfy)\n${formatArchitectureForGeneration(plan.architectureRequirements)}`
    : ''
}
`
    : ''

  const integrityBlock =
    reason === 'integrity' ||
    (reason === 'combined' && integrity && !integrity.ok)
      ? `${formatIntegrityForRepair(
          integrity || {
            ok: false,
            manifest: { files: [], byLower: new Map() },
            issues: [],
            unresolvedImports: [],
          },
        )}
`
      : ''

  const archBlock =
    reason === 'architecture' || reason === 'combined'
      ? `## Architecture compliance failure (PRIMARY)
${formatArchitectureComplianceForJudge(architectureCompliance)}
`
      : architectureCompliance
        ? `## Architecture compliance (context)
${formatArchitectureComplianceForJudge(architectureCompliance)}
`
        : ''

  const runtimeBlock =
    reason === 'runtime' || reason === 'combined'
      ? `## Runtime verification failure${reason === 'combined' ? ' (also failed)' : ' (PRIMARY)'}
${verification ? formatDiagnosticsForRepair(verification) : '(none)'}
`
      : verification
        ? `## Runtime verification (context)
${formatDiagnosticsForRepair(verification)}
`
        : ''

  const focus =
    reason === 'integrity'
      ? 'Focus ONLY on unresolved local imports / missing generated files. Do not remove required features. Ensure every local import resolves.'
      : reason === 'architecture'
        ? 'Focus on implementing the missing REQUIRED architecture layers with minimal changes. Preserve UI and contracts.'
        : reason === 'runtime'
          ? 'Focus on making the app runnable using the runtime diagnostics. Do not redesign architecture unnecessarily.'
          : 'Fix structural integrity, critical architecture gaps, and/or runtime failures in one minimal pass.'

  return `Repair reason: ${reason.toUpperCase()}
${focus}
${product}
${planBlock}
${integrityBlock}
${archBlock}
${runtimeBlock}
## Current project
Template: ${fragment.template}
Primary entry: ${fragment.file_path}
Title: ${fragment.title}
Architecture note: ${fragment.architecture}

${buildRepairFileContext(fragment)}

Return only the files that must change.`
}

/** Reject path traversal and absolute / sensitive paths. */
export function isSafeRepairPath(path: string): boolean {
  if (!path || typeof path !== 'string') return false
  const trimmed = path.trim()
  if (!trimmed || trimmed.length > 260) return false
  if (trimmed.startsWith('/') || trimmed.startsWith('\\')) return false
  if (/^[a-zA-Z]:[\\/]/.test(trimmed)) return false
  if (trimmed.includes('\0')) return false
  const normalized = trimmed.replace(/\\/g, '/')
  const parts = normalized.split('/')
  if (parts.some((p) => p === '..' || p === '')) return false
  if (/(^|\/)\.git(\/|$)/.test(normalized)) return false
  const base = parts[parts.length - 1] || ''
  // Allow .env.example; block other env/secret files
  if (base === '.env' || (base.startsWith('.env.') && base !== '.env.example')) {
    return false
  }
  if (!/^[a-zA-Z0-9._\-/@]+$/.test(normalized)) return false
  return true
}

export type ApplyRepairOutcome =
  | {
      ok: true
      fragment: FragmentSchema
      changedFiles: string[]
      explanation: string
    }
  | { ok: false; error: string }

/**
 * Validate model repair output and merge into a copy of the original fragment.
 * Original fragment is never mutated.
 */
export function applyRepairToFragment(
  original: FragmentSchema,
  repair: unknown,
): ApplyRepairOutcome {
  const parsed = repairResultSchema.safeParse(repair)
  if (!parsed.success) {
    return {
      ok: false,
      error: `Invalid repair output: ${parsed.error.issues
        .slice(0, 3)
        .map((i) => i.message)
        .join('; ')}`,
    }
  }

  const result = parsed.data
  if (!result.files.length) {
    return { ok: false, error: 'Repair contained no file changes' }
  }
  if (result.files.length > 12) {
    return { ok: false, error: 'Repair touches too many files (max 12)' }
  }

  const originalFiles = getFragmentFiles(original)
  const map = new Map<string, FragmentFile>(
    originalFiles.map((f) => [f.file_path, { ...f }]),
  )
  const touched: string[] = []

  for (const change of result.files) {
    if (!isSafeRepairPath(change.file_path)) {
      return {
        ok: false,
        error: `Rejected unsafe file path: ${change.file_path}`,
      }
    }

    // Validate content shape
    if (change.action !== 'remove') {
      const contentCheck = fragmentFileSchema.safeParse({
        file_path: change.file_path,
        file_content: change.file_content,
      })
      if (!contentCheck.success || !change.file_content.trim()) {
        return {
          ok: false,
          error: `Invalid or empty content for ${change.file_path}`,
        }
      }
      // Block obvious secret dumps
      if (
        /(?:OPENAI_API_KEY|CLERK_SECRET|E2B_API_KEY|sk-[a-zA-Z0-9]{10,})/.test(
          change.file_content,
        )
      ) {
        return {
          ok: false,
          error: `Repair content appears to contain secrets in ${change.file_path}`,
        }
      }
    }

    if (change.action === 'remove') {
      if (!map.has(change.file_path)) {
        return {
          ok: false,
          error: `Cannot remove missing file: ${change.file_path}`,
        }
      }
      map.delete(change.file_path)
      touched.push(change.file_path)
      continue
    }

    if (change.action === 'add' && map.has(change.file_path)) {
      // Treat as modify if already exists
    }
    if (change.action === 'modify' && !map.has(change.file_path)) {
      // Allow modify→add if file missing (common for "create missing module")
    }

    map.set(change.file_path, {
      file_path: change.file_path,
      file_content: change.file_content,
    })
    touched.push(change.file_path)
  }

  if (map.size === 0) {
    return { ok: false, error: 'Repair would leave the project with zero files' }
  }

  const nextFiles = Array.from(map.values())
  const primaryStillExists = nextFiles.some(
    (f) => f.file_path === original.file_path,
  )
  const nextPrimary = primaryStillExists
    ? original.file_path
    : nextFiles[0].file_path

  // Merge dependency hints
  let additional_dependencies = [...(original.additional_dependencies || [])]
  let has_additional_dependencies = original.has_additional_dependencies
  let install_dependencies_command = original.install_dependencies_command || ''

  if (result.additional_dependencies?.length) {
    const incoming = result.additional_dependencies
      .map((d) => d.trim())
      .filter(Boolean)
    // Reject shell metacharacters in package names
    if (incoming.some((d) => /[;&|`$<>]/.test(d))) {
      return { ok: false, error: 'Rejected unsafe dependency names' }
    }
    additional_dependencies = Array.from(
      new Set([...additional_dependencies, ...incoming]),
    )
    has_additional_dependencies = additional_dependencies.length > 0
    const cmd =
      result.install_dependencies_command?.trim() ||
      (incoming.length ? `npm install ${incoming.join(' ')}` : '')
    if (
      cmd &&
      !/^(npm install|pip install|pnpm add|yarn add)\s+[\w@/.\-\s]+$/.test(cmd)
    ) {
      return { ok: false, error: 'Rejected unsafe install command' }
    }
    if (cmd) install_dependencies_command = cmd
  }

  const fragment: FragmentSchema = {
    ...original,
    file_path: nextPrimary,
    code: nextFiles,
    additional_dependencies,
    has_additional_dependencies,
    install_dependencies_command,
    commentary: truncateDiagnostic(
      `Repair: ${result.explanation}`,
      500,
    ),
  }

  const changedFiles = Array.from(
    new Set([...(result.changedFiles || []), ...touched]),
  )

  return {
    ok: true,
    fragment,
    changedFiles,
    explanation: result.explanation,
  }
}

/** Compact diagnostics block for the repair model. */
export function formatDiagnosticsForRepair(
  verification: VerificationResult,
): string {
  return formatVerificationForJudge(verification)
}

export function formatRepairHistoryForJudge(opts: {
  initial: VerificationResult
  final: VerificationResult
  repair: RepairAttemptRecord | null
  initialArchitecture?: ArchitectureComplianceResult | null
  finalArchitecture?: ArchitectureComplianceResult | null
}): string {
  const repairLine = !opts.repair
    ? 'Repair: none (attempts=0)'
    : opts.repair.success
      ? `Repair: attempted once (success) reason=${opts.repair.reason} attempts=${opts.repair.repairAttempts}
changed: ${(opts.repair.changedFiles || []).join(', ') || 'n/a'}
note: ${opts.repair.explanation || ''}`
      : `Repair: attempted once (failed) reason=${opts.repair.reason || 'n/a'} attempts=${opts.repair.repairAttempts ?? 1} — kept prior fragment
error: ${opts.repair.error || 'unknown'}`

  const archInitial = opts.initialArchitecture
    ? `Initial architecture:\n${formatArchitectureComplianceForJudge(opts.initialArchitecture)}\n\n`
    : ''
  const archFinal = opts.finalArchitecture
    ? `Final architecture:\n${formatArchitectureComplianceForJudge(opts.finalArchitecture)}\n\n`
    : ''

  return `${archInitial}Initial runtime:
${formatVerificationForJudge(opts.initial)}

${repairLine}

${archFinal}Final runtime:
${formatVerificationForJudge(opts.final)}`
}

/** Build truncated project context for the repair LLM. */
export function buildRepairFileContext(
  fragment: FragmentSchema,
  maxPerFile = 4500,
): string {
  const files = getFragmentFiles(fragment)
  const tree = files.map((f) => `- ${f.file_path}`).join('\n')
  const bodies = files
    .map((f) => {
      const body =
        f.file_content.length > maxPerFile
          ? `${f.file_content.slice(0, maxPerFile)}\n/* … truncated … */`
          : f.file_content
      return `### ${f.file_path}\n\`\`\`\n${body}\n\`\`\``
    })
    .join('\n\n')
  return `Project files:\n${tree}\n\n${bodies}`
}

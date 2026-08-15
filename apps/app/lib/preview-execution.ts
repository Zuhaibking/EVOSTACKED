import { ExecutionResult, ExecutionResultWeb } from '@/lib/types'
import { VerificationResult } from '@/lib/verification'

/**
 * True when an ExecutionResult has the fields FragmentPreview needs.
 * Web previews require url; interpreter results require stdout arrays.
 */
export function isReusableExecutionResult(
  execution: ExecutionResult | undefined | null,
): execution is ExecutionResult {
  if (!execution?.sbxId || typeof execution.template !== 'string') {
    return false
  }
  if ('url' in execution) {
    return typeof execution.url === 'string' && execution.url.length > 0
  }
  const interp = execution as {
    stdout?: unknown
    stderr?: unknown
    cellResults?: unknown
  }
  return Array.isArray(interp.stdout) && Array.isArray(interp.stderr)
}

/**
 * Build a web ExecutionResult from verification fields when the tournament
 * client retained url/sbxId/template but not a separate execution object.
 */
export function executionFromVerification(
  verification: VerificationResult | undefined | null,
): ExecutionResultWeb | undefined {
  if (!verification || verification.status === 'failed') return undefined
  const { sbxId, url, template } = verification
  if (
    typeof sbxId !== 'string' ||
    !sbxId ||
    typeof url !== 'string' ||
    !url ||
    typeof template !== 'string' ||
    !template
  ) {
    return undefined
  }
  return { sbxId, url, template }
}

/**
 * Prefer candidate.execution; else synthesize from verification/finalVerification.
 * Returns undefined when Preview must fall back to POST /v1/sandbox.
 */
export function resolveReusablePreviewExecution(opts: {
  execution?: ExecutionResult | null
  verification?: VerificationResult | null
  finalVerification?: VerificationResult | null
}): ExecutionResult | undefined {
  const runtime = opts.finalVerification || opts.verification
  if (runtime?.status === 'failed') return undefined

  if (isReusableExecutionResult(opts.execution ?? undefined)) {
    return opts.execution!
  }

  return executionFromVerification(runtime)
}

/**
 * Structured runtime/preview diagnostics — no secrets, no source bodies.
 * ZERO provider / LLM calls.
 */
export type RuntimePreviewDiagnostic = {
  candidateId?: string
  candidateLabel?: string
  deploymentStatus?: string
  runtimeStatus?: string
  hasExecution: boolean
  hasExecutionUrl: boolean
  executionUrlHost?: string
  previewReachable?: boolean
  processStarted?: boolean
  port?: number | null
  httpStatus?: number
  deploymentError?: string
  runtimeError?: string
  integrityIssueCodes?: string[]
}

function hostOnly(url?: string | null): string | undefined {
  if (!url || typeof url !== 'string') return undefined
  try {
    return new URL(url).host
  } catch {
    return 'invalid-url'
  }
}

export function buildRuntimePreviewDiagnostic(input: {
  candidateId?: string
  candidateLabel?: string
  verification?: {
    status?: string
    previewReachable?: boolean
    processStarted?: boolean
    httpStatus?: number
    errors?: string[]
    url?: string
  } | null
  execution?: {
    url?: string
    sbxId?: string
    template?: string
  } | null
  port?: number | null
  deployError?: string
  integrityIssueCodes?: string[]
}): RuntimePreviewDiagnostic {
  const url =
    (input.execution && 'url' in input.execution
      ? input.execution.url
      : undefined) || input.verification?.url
  const err =
    input.deployError ||
    input.verification?.errors?.[0] ||
    undefined
  return {
    candidateId: input.candidateId,
    candidateLabel: input.candidateLabel,
    deploymentStatus: input.execution?.sbxId
      ? url
        ? 'deployed'
        : 'sandbox_without_url'
      : input.verification?.status === 'failed'
        ? 'failed'
        : 'unknown',
    runtimeStatus: input.verification?.status,
    hasExecution: Boolean(input.execution?.sbxId),
    hasExecutionUrl: Boolean(url),
    executionUrlHost: hostOnly(url),
    previewReachable: input.verification?.previewReachable,
    processStarted: input.verification?.processStarted,
    port: input.port,
    httpStatus: input.verification?.httpStatus,
    deploymentError: err ? String(err).slice(0, 240) : undefined,
    runtimeError: input.verification?.errors?.[0]
      ? String(input.verification.errors[0]).slice(0, 240)
      : undefined,
    integrityIssueCodes: input.integrityIssueCodes?.slice(0, 12),
  }
}

/** Safe console diagnostic for tournament/runtime — never logs secrets/source. */
export function logRuntimePreviewDiagnostic(
  label: string,
  diagnostic: RuntimePreviewDiagnostic,
): void {
  try {
    console.info(`[evostack:runtime-preview] ${label}`, diagnostic)
  } catch {
    /* ignore */
  }
}

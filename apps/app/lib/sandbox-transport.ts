/**
 * E2B sandbox create transport helpers — no network until callers invoke create.
 * ZERO LLM calls.
 */
import dns from 'node:dns'
import { Agent, setGlobalDispatcher } from 'undici'

const TRANSPORT_MESSAGE =
  /fetch failed|Failed to fetch|network|socket|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ECONNRESET|ETIMEDOUT|UND_ERR|Connect Timeout|other side closed|getaddrinfo/i

/** Sandbox process was killed/OOM'd — not a compile error the LLM should rewrite. */
const SANDBOX_PROCESS_DEATH =
  /signal:\s*(?:killed|SIGKILL|SIGTERM)|exit status 137|exit code 137/i
const BARE_SANDBOX_EXIT =
  /^(?:runtimeError:\s*)?(?:deploymentError:\s*)?(?:exit status 1|exit code 1)$/i

const DNS_MESSAGE = /ENOTFOUND|EAI_AGAIN|getaddrinfo|ERR_NAME_NOT_RESOLVED/i

/** Documented E2B control plane. Preview hosts stay on e2b.app unless the SDK says otherwise. */
export const DEFAULT_E2B_API_URL = 'https://api.e2b.dev'

let sandboxConnectTimeoutApplied = false
let sandboxCreateTail: Promise<unknown> = Promise.resolve()

/** Undici's default ~10s connect timeout caused UND_ERR_CONNECT_TIMEOUT to E2B. */
export function ensureSandboxConnectTimeout(ms = 30_000): void {
  if (sandboxConnectTimeoutApplied) return
  sandboxConnectTimeoutApplied = true
  setGlobalDispatcher(
    new Agent({
      connectTimeout: ms,
      connect: { family: 4 },
    }),
  )
}

/**
 * Prefer IPv4 (avoids NAT64 IPv6 ENOTFOUND) and the documented control API host.
 * Preview sandbox hostnames are unchanged (still derived from e2b.app unless E2B_DOMAIN is set).
 */
export function prepareSandboxNetwork(): void {
  try {
    dns.setDefaultResultOrder('ipv4first')
  } catch {
    /* Node without setDefaultResultOrder */
  }
  if (!process.env.E2B_API_URL?.trim()) {
    process.env.E2B_API_URL = DEFAULT_E2B_API_URL
  }
  ensureSandboxConnectTimeout()
}

export function resolveE2bControlApiUrl(): string {
  const fromEnv = process.env.E2B_API_URL?.trim()
  if (fromEnv) return fromEnv.replace(/\/$/, '')
  return DEFAULT_E2B_API_URL
}

export function isSandboxTransportError(error: unknown): boolean {
  let current: unknown = error
  for (let depth = 0; depth < 5 && current; depth++) {
    if (typeof current === 'string') return TRANSPORT_MESSAGE.test(current)
    if (typeof current !== 'object') return false
    const rec = current as Record<string, unknown>
    const code = String(rec.code || rec.errno || '')
    const message = String(rec.message || '')
    if (TRANSPORT_MESSAGE.test(code) || TRANSPORT_MESSAGE.test(message)) {
      return true
    }
    current = rec.cause
  }
  return false
}

export function isDnsLookupError(error: unknown): boolean {
  let current: unknown = error
  for (let depth = 0; depth < 5 && current; depth++) {
    if (typeof current === 'string') return DNS_MESSAGE.test(current)
    if (typeof current !== 'object') return false
    const rec = current as Record<string, unknown>
    const code = String(rec.code || rec.errno || rec.syscall || '')
    const message = String(rec.message || '')
    if (DNS_MESSAGE.test(code) || DNS_MESSAGE.test(message)) return true
    current = rec.cause
  }
  return false
}

/** True when runtime failed due to sandbox/API transport, not missing source. */
export function isInfrastructureRuntimeFailure(errors: string[] | undefined): boolean {
  const list = (errors || []).filter(Boolean)
  if (list.length === 0) return false
  const transport = list.some((e) => isSandboxTransportError(e))
  const missingKey = list.some((e) => /E2B_API_KEY/i.test(e))
  const processDeath = list.some(
    (e) => SANDBOX_PROCESS_DEATH.test(e) || BARE_SANDBOX_EXIT.test(e.trim()),
  )
  return transport || missingKey || processDeath
}

export function formatSandboxCreateError(error: unknown): string {
  const parts: string[] = []
  let current: unknown = error
  for (let depth = 0; depth < 4 && current; depth++) {
    if (typeof current === 'string') {
      parts.push(current)
      break
    }
    if (typeof current !== 'object') break
    const rec = current as Record<string, unknown>
    if (rec.message) parts.push(String(rec.message))
    if (rec.code) parts.push(`code=${String(rec.code)}`)
    if (rec.syscall) parts.push(`syscall=${String(rec.syscall)}`)
    current = rec.cause
  }
  const joined = parts.filter(Boolean).join(' · ').slice(0, 400)
  return joined || 'Sandbox create/verify failed'
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * One sandbox boot at a time. Generation stays parallel; create + install +
 * Next start are serialized so three apps cannot OOM the same E2B host.
 */
export function withSandboxCreateLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = sandboxCreateTail.then(fn, fn)
  sandboxCreateTail = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

export async function withSandboxCreateTransportRetry<T>(
  create: () => Promise<T>,
  opts?: { delayMs?: number; attempts?: number },
): Promise<T> {
  prepareSandboxNetwork()
  const maxAttempts = Math.max(1, opts?.attempts ?? 4)
  let lastError: unknown
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await create()
    } catch (error) {
      lastError = error
      if (!isSandboxTransportError(error) || attempt === maxAttempts) {
        throw error
      }
      const skipWait = opts?.delayMs === 0
      const delay = skipWait
        ? 0
        : isDnsLookupError(error)
          ? Math.min(4_000, 1_000 * 2 ** (attempt - 1))
          : (opts?.delayMs ?? 750)
      if (delay > 0) await sleep(delay)
    }
  }
  throw lastError
}

/** True when a failed boot should be retried on a fresh sandbox (not LLM-repaired). */
export function shouldRetrySandboxDeploy(
  errors: string[] | undefined,
  previewReachable?: boolean,
): boolean {
  if (previewReachable) return false
  const list = (errors || []).filter(Boolean)
  if (list.some((e) => /E2B_API_KEY/i.test(e))) return false
  return isInfrastructureRuntimeFailure(list)
}

/** Retry Sandbox.create transport; full boot is serialized by deployAndVerify. */
export function createSandboxSerialized<T>(
  create: () => Promise<T>,
  opts?: { delayMs?: number; attempts?: number },
): Promise<T> {
  return withSandboxCreateTransportRetry(create, opts)
}

/**
 * Database workspace helpers for real EvoStack platform data.
 * Read-only. Does not invent records, endpoints, or metrics.
 */
import type { ExecutionResult, ExecutionResultWeb } from '@/lib/types'
import { getFragmentFiles, hasFragmentCode } from '@/lib/fragment'

type WorkspaceFragment = Parameters<typeof getFragmentFiles>[0] & {
  architecture?: string
  title?: string
}
import { isSecretEnvName } from '@/lib/generated-project-database'

export const DATABASE_SECTIONS = [
  'overview',
  'tables',
  'data',
  'users',
  'analytics',
  'api',
  'integrations',
  'environment',
  'logs',
  'workflows',
  'security',
  'settings',
] as const

export type DatabaseSection = (typeof DATABASE_SECTIONS)[number]

export const DATABASE_SECTION_META: {
  id: DatabaseSection
  label: string
  group: 'database' | 'project' | 'platform' | 'system'
}[] = [
  { id: 'overview', label: 'Overview', group: 'database' },
  { id: 'tables', label: 'Tables', group: 'database' },
  { id: 'data', label: 'Data', group: 'database' },
  { id: 'users', label: 'Users', group: 'project' },
  { id: 'analytics', label: 'Analytics', group: 'project' },
  { id: 'api', label: 'API', group: 'platform' },
  { id: 'integrations', label: 'Integrations', group: 'platform' },
  { id: 'environment', label: 'Environment', group: 'platform' },
  { id: 'logs', label: 'Logs', group: 'platform' },
  { id: 'workflows', label: 'Workflows', group: 'project' },
  { id: 'security', label: 'Security', group: 'platform' },
  { id: 'settings', label: 'Settings', group: 'system' },
]

export type PlatformTableId =
  | 'users'
  | 'runs'
  | 'messages'
  | 'fragments'
  | 'candidates'
  | 'project_brains'
  | 'version_snapshots'
  | 'memory_items'
  | 'memory_cache'
  | 'llm_response_cache'
  | 'request_logs'

export type PlatformColumn = {
  name: string
  type: string
  pk?: boolean
  relation?: string
}

export type PlatformTable = {
  id: PlatformTableId
  model: string
  columns: PlatformColumn[]
  readable: boolean
  emptyReason?: string
}

/** Mirrors apps/api/prisma/schema.prisma — metadata only, no live connection. */
export const EVOSTACK_PLATFORM_TABLES: PlatformTable[] = [
  {
    id: 'users',
    model: 'User',
    readable: true,
    columns: [
      { name: 'id', type: 'String', pk: true },
      { name: 'email', type: 'String?' },
      { name: 'createdAt', type: 'DateTime' },
      { name: 'updatedAt', type: 'DateTime' },
      { name: 'runs', type: 'Run[]', relation: 'Run' },
    ],
  },
  {
    id: 'runs',
    model: 'Run',
    readable: true,
    columns: [
      { name: 'id', type: 'String', pk: true },
      { name: 'userId', type: 'String', relation: 'User' },
      { name: 'status', type: 'String' },
      { name: 'memoryVersion', type: 'Int' },
      { name: 'selectedCandidate', type: 'String?' },
      { name: 'hasTournament', type: 'Boolean' },
      { name: 'activeVersion', type: 'Int?' },
      { name: 'updatedAt', type: 'DateTime' },
    ],
  },
  {
    id: 'messages',
    model: 'Message',
    readable: true,
    columns: [
      { name: 'role', type: 'String' },
      { name: 'preview', type: 'String' },
    ],
  },
  {
    id: 'fragments',
    model: 'Fragment',
    readable: true,
    columns: [
      { name: 'title', type: 'String' },
      { name: 'template', type: 'String' },
      { name: 'files', type: 'Int' },
    ],
  },
  {
    id: 'candidates',
    model: 'Candidate',
    readable: false,
    emptyReason: 'Candidate rows are not exposed by a list endpoint.',
    columns: [
      { name: 'id', type: 'String', pk: true },
      { name: 'variantId', type: 'String' },
      { name: 'status', type: 'String' },
    ],
  },
  {
    id: 'project_brains',
    model: 'ProjectBrain',
    readable: true,
    columns: [
      { name: 'updatedAt', type: 'String' },
      { name: 'currentVersion', type: 'Int' },
      { name: 'template', type: 'String' },
    ],
  },
  {
    id: 'version_snapshots',
    model: 'VersionSnapshot',
    readable: true,
    columns: [
      { name: 'version', type: 'Int', pk: true },
      { name: 'createdAt', type: 'DateTime' },
      { name: 'label', type: 'String' },
    ],
  },
  {
    id: 'memory_items',
    model: 'MemoryItem',
    readable: true,
    columns: [
      { name: 'memoryVersion', type: 'Int' },
      { name: 'itemCount', type: 'Int' },
      { name: 'recentMessageCount', type: 'Int' },
    ],
  },
  {
    id: 'memory_cache',
    model: 'MemoryCache',
    readable: false,
    emptyReason: 'Cache rows are not exposed by a list endpoint.',
    columns: [
      { name: 'id', type: 'String', pk: true },
      { name: 'cacheKey', type: 'String' },
    ],
  },
  {
    id: 'llm_response_cache',
    model: 'LlmResponseCache',
    readable: false,
    emptyReason: 'LLM cache rows are not exposed by a list endpoint.',
    columns: [
      { name: 'id', type: 'String', pk: true },
      { name: 'model', type: 'String' },
    ],
  },
  {
    id: 'request_logs',
    model: 'RequestLog',
    readable: true,
    columns: [
      { name: 'createdAt', type: 'DateTime' },
      { name: 'method', type: 'String' },
      { name: 'path', type: 'String' },
      { name: 'status', type: 'Int' },
      { name: 'durationMs', type: 'Int' },
    ],
  },
]

export type PlatformEndpoint = {
  method: string
  route: string
  description: string
}

/** Actual Nest controllers — not generated, not invented. */
export const EVOSTACK_PLATFORM_ENDPOINTS: PlatformEndpoint[] = [
  { method: 'GET', route: '/health', description: 'API process health' },
  { method: 'GET', route: '/v1/runs', description: 'List current-user runs' },
  { method: 'POST', route: '/v1/runs', description: 'Ensure or create a run' },
  { method: 'GET', route: '/v1/runs/:id', description: 'Run metadata' },
  { method: 'PATCH', route: '/v1/runs/:id', description: 'Update run metadata' },
  { method: 'GET', route: '/v1/runs/:id/messages', description: 'Run messages' },
  { method: 'POST', route: '/v1/runs/:id/messages', description: 'Append a message' },
  { method: 'GET', route: '/v1/runs/:id/brain', description: 'Project brain' },
  { method: 'POST', route: '/v1/runs/:id/brain', description: 'Save project brain' },
  { method: 'GET', route: '/v1/runs/:id/versions', description: 'Version snapshots' },
  { method: 'POST', route: '/v1/runs/:id/versions', description: 'Save a version' },
  { method: 'GET', route: '/v1/runs/:id/versions/:version', description: 'One version' },
  { method: 'GET', route: '/v1/runs/:id/memory', description: 'Memory pack summary' },
  { method: 'GET', route: '/v1/logs', description: 'Request logs for the current user' },
  { method: 'POST', route: '/v1/chat', description: 'Generate a project' },
  { method: 'POST', route: '/v1/sandbox', description: 'Sandbox / preview' },
  { method: 'POST', route: '/v1/tournament', description: 'Product / Premium / Innovate' },
  { method: 'POST', route: '/v1/morph', description: 'Morph edit' },
]

export type SafeClientEnv = {
  name: string
  configured: boolean
  secret: boolean
}

const CLIENT_ENV_NAMES = [
  'NEXT_PUBLIC_API_URL',
  'NEXT_PUBLIC_ENABLE_POSTHOG',
  'NEXT_PUBLIC_POSTHOG_HOST',
  'NEXT_PUBLIC_HIDE_LOCAL_MODELS',
  'NEXT_PUBLIC_VERCEL_ENV',
  'NEXT_PUBLIC_USE_MORPH_APPLY',
  'NEXT_PUBLIC_NO_API_KEY_INPUT',
  'NEXT_PUBLIC_NO_BASE_URL_INPUT',
  'NEXT_PUBLIC_SITE_URL',
] as const

export function inspectSafeClientEnv(
  env: Record<string, string | undefined> = {},
): SafeClientEnv[] {
  return CLIENT_ENV_NAMES.map((name) => ({
    name,
    configured: Boolean(env[name]?.trim()),
    secret: isSecretEnvName(name),
  }))
}

export function apiHostFromUrl(url?: string | null): string | undefined {
  if (!url) return undefined
  try {
    return new URL(url).host
  } catch {
    return undefined
  }
}

export type RequestLogRow = {
  id?: string
  method?: string
  path?: string
  status?: number
  durationMs?: number
  runId?: string | null
  createdAt?: string
  meta?: unknown
}

export type WorkspaceLog = {
  id: string
  timestamp: string
  level: 'error' | 'warn' | 'info'
  source: string
  message: string
}

function sourceFromPath(path: string): string {
  if (path.includes('/v1/chat')) return 'chat'
  if (path.includes('/v1/tournament')) return 'tournament'
  if (path.includes('/v1/sandbox')) return 'sandbox'
  if (path.includes('/v1/morph')) return 'morph'
  if (path.includes('/v1/logs')) return 'logs'
  if (path.includes('/v1/runs')) return 'runs'
  if (path.includes('/health')) return 'health'
  return 'api'
}

export function humanizeRequestLog(log: RequestLogRow, index = 0): WorkspaceLog {
  const path = String(log.path || '/').split('?')[0]
  const status = Number(log.status || 0)
  const method = String(log.method || 'GET').toUpperCase()
  const ms = Number(log.durationMs || 0)
  const level: WorkspaceLog['level'] =
    status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info'
  const outcome =
    status >= 500
      ? 'failed on the server'
      : status >= 400
        ? 'was rejected'
        : 'completed'
  return {
    id: log.id || `log-${index}`,
    timestamp: log.createdAt || '',
    level,
    source: sourceFromPath(path),
    message: `${method} ${path} ${outcome} (${status || 'unknown'}) in ${ms}ms`,
  }
}

export function logsFromDiagnostics(diagnostics?: string[] | null): WorkspaceLog[] {
  if (!diagnostics?.length) return []
  return diagnostics
    .map((line, index) => line.trim())
    .filter(Boolean)
    .map((line, index) => ({
      id: `diag-${index}`,
      timestamp: '',
      level: /error|fail/i.test(line) ? 'error' : /warn/i.test(line) ? 'warn' : 'info',
      source: 'preview',
      message: line.slice(0, 400),
    }))
}

export type WorkflowStepId =
  | 'prompt'
  | 'plan'
  | 'generate'
  | 'build'
  | 'verify'
  | 'preview'
  | 'publish'

export type WorkflowStep = {
  id: WorkflowStepId
  label: string
  status: 'done' | 'active' | 'pending' | 'unavailable'
  detail: string
}

export function deriveWorkflowSteps(input: {
  hasUserPrompt?: boolean
  hasPlan?: boolean
  hasGeneratedFiles?: boolean
  hasSandbox?: boolean
  hasVerification?: boolean
  hasPreview?: boolean
  hasPublish?: boolean
}): WorkflowStep[] {
  const defs: { id: WorkflowStepId; label: string; done?: boolean; note: string; empty: string }[] =
    [
      {
        id: 'prompt',
        label: 'Prompt',
        done: input.hasUserPrompt,
        note: 'A user prompt is stored on this run',
        empty: 'No prompt has been recorded for this run yet',
      },
      {
        id: 'plan',
        label: 'Plan',
        done: input.hasPlan,
        note: 'A project plan exists',
        empty: 'No plan is stored for this run',
      },
      {
        id: 'generate',
        label: 'Generate',
        done: input.hasGeneratedFiles,
        note: 'Generated source files are present',
        empty: 'No generated project files yet',
      },
      {
        id: 'build',
        label: 'Build',
        done: input.hasSandbox,
        note: 'A sandbox build was created',
        empty: 'No sandbox build is available',
      },
      {
        id: 'verify',
        label: 'Verify',
        done: input.hasVerification,
        note: 'Verification or diagnostics were recorded',
        empty: 'No verification result is stored',
      },
      {
        id: 'preview',
        label: 'Preview',
        done: input.hasPreview,
        note: 'A live preview URL exists',
        empty: 'Preview is not available yet',
      },
      {
        id: 'publish',
        label: 'Publish',
        done: input.hasPublish,
        note: 'A published deployment was recorded',
        empty: 'Publish state is not available from current APIs',
      },
    ]

  let sawPending = false
  return defs.map((step) => {
    if (step.done) {
      return { id: step.id, label: step.label, status: 'done', detail: step.note }
    }
    if (step.id === 'publish' && !step.done) {
      return {
        id: step.id,
        label: step.label,
        status: 'unavailable',
        detail: step.empty,
      }
    }
    if (!sawPending) {
      sawPending = true
      return { id: step.id, label: step.label, status: 'pending', detail: step.empty }
    }
    return { id: step.id, label: step.label, status: 'pending', detail: step.empty }
  })
}

export function workflowInputFromWorkspace(input: {
  fragment?: WorkspaceFragment
  result?: ExecutionResult
  diagnostics?: string[]
  messages?: unknown[]
  brain?: Record<string, unknown> | null
  run?: { hasTournament?: boolean } | null
}): ReturnType<typeof deriveWorkflowSteps> {
  const files = getFragmentFiles(input.fragment)
  const brain = input.brain || {}
  const previewUrl =
    input.result && 'url' in input.result
      ? (input.result as ExecutionResultWeb).url
      : undefined
  const hasUserPrompt =
    (Array.isArray(input.messages) && input.messages.length > 0) ||
    (Array.isArray(brain.userRequests) && brain.userRequests.length > 0)
  const hasPlan = Boolean(brain.plan) || Boolean(input.fragment?.architecture)
  const hasVerification =
    Boolean(brain.verification) ||
    Boolean(brain.architectureCompliance) ||
    Boolean(input.diagnostics?.length)

  return deriveWorkflowSteps({
    hasUserPrompt,
    hasPlan,
    hasGeneratedFiles: hasFragmentCode(input.fragment) || files.length > 0,
    hasSandbox: Boolean(input.result?.sbxId),
    hasVerification,
    hasPreview: Boolean(previewUrl),
    hasPublish: false,
  })
}

export function sortRecords(
  rows: Record<string, unknown>[],
  key: string | null,
  direction: 'asc' | 'desc',
): Record<string, unknown>[] {
  if (!key) return rows
  const copy = [...rows]
  copy.sort((a, b) => {
    const av = a[key]
    const bv = b[key]
    const as = av == null ? '' : String(av)
    const bs = bv == null ? '' : String(bv)
    const cmp = as.localeCompare(bs, undefined, { numeric: true, sensitivity: 'base' })
    return direction === 'asc' ? cmp : -cmp
  })
  return copy
}

export function filterRecords(
  rows: Record<string, unknown>[],
  query: string,
): Record<string, unknown>[] {
  const q = query.trim().toLowerCase()
  if (!q) return rows
  return rows.filter((row) =>
    Object.entries(row).some(([key, value]) => {
      if (isSecretEnvName(key)) return false
      return String(value ?? '').toLowerCase().includes(q)
    }),
  )
}

export function previewUnknown(value: unknown, max = 140): string {
  if (value == null) return ''
  if (typeof value === 'string') return value.slice(0, max)
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try {
    return JSON.stringify(value).slice(0, max)
  } catch {
    return ''
  }
}

export function messageToRecord(value: unknown, index: number): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const row = value as Record<string, unknown>
    const content = row.content
    let preview = ''
    if (typeof content === 'string') preview = content
    else if (Array.isArray(content)) {
      preview = content
        .map((part) => {
          if (typeof part === 'string') return part
          if (part && typeof part === 'object' && 'text' in part) {
            return String((part as { text?: unknown }).text || '')
          }
          return ''
        })
        .filter(Boolean)
        .join(' ')
    }
    return {
      index,
      role: typeof row.role === 'string' ? row.role : 'unknown',
      preview: preview.slice(0, 220),
    }
  }
  return { index, role: 'unknown', preview: previewUnknown(value) }
}

export function brainToRecord(brain: Record<string, unknown> | null): Record<string, unknown>[] {
  if (!brain) return []
  return [
    {
      updatedAt: typeof brain.updatedAt === 'string' ? brain.updatedAt : '',
      currentVersion:
        typeof brain.currentVersion === 'number' ? brain.currentVersion : null,
      template: typeof brain.template === 'string' ? brain.template : '',
      winner: typeof brain.currentWinnerLabel === 'string' ? brain.currentWinnerLabel : '',
      issues: Array.isArray(brain.issues) ? brain.issues.length : 0,
    },
  ]
}

/**
 * EvoStack Platform — shared contracts (Phase 2).
 *
 * Flow: idea → discovery (ProjectSpec) → 3-candidate tournament → user picks one →
 * provision an isolated backend (own SQLite DB per project) from a generated Blueprint →
 * generated Control Center (admin dashboard) → website submissions stream into it live.
 *
 * LLM-facing schemas avoid optional()/length limits (OpenAI structured outputs);
 * sanitize + clamp AFTER generation with the helpers in the owning modules.
 */
import { z } from 'zod'

// ───────────────────────── Project specification (discovery output) ─────────────────────────
export const PROJECT_TYPES = [
  'ecommerce', 'saas', 'restaurant', 'agency', 'booking', 'portfolio', 'events',
  'education', 'nonprofit', 'marketplace', 'community', 'custom',
] as const
export const projectTypeSchema = z.enum(PROJECT_TYPES)
export type ProjectType = z.infer<typeof projectTypeSchema>

export const projectSpecSchema = z.object({
  name: z.string(),
  tagline: z.string(),
  summary: z.string(),
  projectType: projectTypeSchema,
  industry: z.string(),
  audience: z.object({
    customers: z.array(z.string()), // who uses the public website
    operators: z.array(z.string()), // who runs the business in the dashboard (roles)
  }),
  features: z.array(z.object({
    name: z.string(),
    description: z.string(),
    priority: z.enum(['must', 'should', 'could']),
  })),
  entities: z.array(z.object({ name: z.string(), description: z.string() })), // Product, Order, Reservation…
  workflows: z.array(z.object({ name: z.string(), trigger: z.string(), outcome: z.string() })),
  integrations: z.array(z.string()), // stripe, email, calendar, sms…
  pages: z.array(z.string()),
  brand: z.object({ tone: z.string(), style: z.string(), colors: z.array(z.string()) }),
  constraints: z.array(z.string()),
})
export type ProjectSpec = z.infer<typeof projectSpecSchema>

// Discovery protocol (POST /api/discovery)
export const discoveryQuestionSchema = z.object({
  id: z.string(),
  question: z.string(),
  why: z.string(), // one line: why this matters for the build
  kind: z.enum(['single', 'multi', 'text']),
  options: z.array(z.string()), // suggested answers ([] for text)
  placeholder: z.string(),
  field: z.string(), // spec area it fills: name | audience | features | workflows | integrations | brand | …
})
export type DiscoveryQuestion = z.infer<typeof discoveryQuestionSchema>
export type DiscoveryAnswer = { questionId: string; question: string; answer: string }
export type DiscoveryRequest = {
  idea: string
  spec: ProjectSpec | null
  answers: DiscoveryAnswer[]
  model?: unknown
  config?: unknown
}
export type DiscoveryResponse = {
  spec: ProjectSpec
  questions: DiscoveryQuestion[] // 0–4 adaptive questions; [] when done
  completeness: number // 0–100
  known: string[] // facts already established (never re-asked)
  missing: string[] // gaps still worth asking about
  done: boolean
  brief: string // generation-ready brief derived from the spec
}

// ───────────────────────── Backend blueprint (drives DB + API + dashboard) ─────────────────────────
export const FIELD_TYPES = [
  'text', 'longtext', 'number', 'money', 'boolean', 'date', 'datetime', 'email', 'phone',
  'url', 'image', 'enum', 'relation', 'tags',
] as const
export const fieldTypeSchema = z.enum(FIELD_TYPES)
export type FieldType = z.infer<typeof fieldTypeSchema>

export const fieldSchema = z.object({
  key: z.string(), // ^[a-z][a-z0-9_]{0,39}$ (sanitized)
  label: z.string(),
  type: fieldTypeSchema,
  required: z.boolean(),
  options: z.array(z.string()), // enum options, [] otherwise
  relation: z.string().nullable(), // target collection key when type === 'relation'
  showInTable: z.boolean(),
  publicWritable: z.boolean(), // website may set it on public create
})
export type Field = z.infer<typeof fieldSchema>

export const collectionSchema = z.object({
  key: z.string(), // snake_case plural: "orders"
  label: z.string(), // "Orders"
  singular: z.string(), // "Order"
  icon: z.string(), // lucide-react icon name: "ShoppingCart"
  description: z.string(),
  titleField: z.string(),
  statusField: z.string().nullable(), // enum field → kanban / pipeline
  dateField: z.string().nullable(), // date/datetime field → calendar
  publicCreate: z.boolean(), // website submissions allowed (orders, reservations, leads)
  publicRead: z.boolean(), // website may read (products, menu, services)
  fields: z.array(fieldSchema),
})
export type Collection = z.infer<typeof collectionSchema>

export const MODULE_KINDS = ['overview', 'table', 'kanban', 'calendar', 'analytics', 'activity', 'workflows', 'settings'] as const
export const moduleSchema = z.object({
  key: z.string(),
  label: z.string(),
  icon: z.string(),
  kind: z.enum(MODULE_KINDS),
  collection: z.string().nullable(),
  group: z.string(), // sidebar group: "Overview" | "Sales" | "Catalog" | "Operations" | "Insights" | "System"
  description: z.string(),
})
export type Module = z.infer<typeof moduleSchema>

export const metricSchema = z.object({
  key: z.string(),
  label: z.string(),
  collection: z.string(),
  op: z.enum(['count', 'sum', 'avg']),
  field: z.string().nullable(),
  filter: z.object({ field: z.string(), equals: z.string() }).nullable(),
  format: z.enum(['number', 'money', 'percent']),
  icon: z.string(),
})
export type Metric = z.infer<typeof metricSchema>

export const chartSchema = z.object({
  key: z.string(),
  label: z.string(),
  kind: z.enum(['timeseries', 'breakdown']),
  collection: z.string(),
  op: z.enum(['count', 'sum']),
  field: z.string().nullable(), // summed field (op === 'sum')
  groupBy: z.string().nullable(), // enum field for breakdown
})
export type Chart = z.infer<typeof chartSchema>

export const workflowSchema = z.object({
  key: z.string(),
  name: z.string(),
  description: z.string(),
  trigger: z.object({
    collection: z.string(),
    event: z.enum(['created', 'updated', 'status_changed']),
    toStatus: z.string().nullable(),
  }),
  actions: z.array(z.object({
    type: z.enum(['set_field', 'create_record', 'notify', 'adjust_number']),
    collection: z.string().nullable(),
    field: z.string().nullable(),
    value: z.string().nullable(),
    message: z.string().nullable(),
  })),
  enabled: z.boolean(),
})
export type Workflow = z.infer<typeof workflowSchema>

export const settingSchema = z.object({
  key: z.string(),
  label: z.string(),
  type: z.enum(['text', 'number', 'boolean', 'select', 'money']),
  value: z.string(),
  options: z.array(z.string()),
  group: z.string(),
  description: z.string(),
})
export type Setting = z.infer<typeof settingSchema>

export const blueprintSchema = z.object({
  projectType: projectTypeSchema,
  appName: z.string(),
  collections: z.array(collectionSchema),
  modules: z.array(moduleSchema),
  metrics: z.array(metricSchema),
  charts: z.array(chartSchema),
  workflows: z.array(workflowSchema),
  settings: z.array(settingSchema),
})
export type Blueprint = z.infer<typeof blueprintSchema>

export type SeedData = Record<string, Record<string, unknown>[]> // collection key → rows

// ───────────────────────── Runtime records / events ─────────────────────────
export type RecordRow = { id: string; created_at: string; updated_at: string; [field: string]: unknown }
export type EventSource = 'dashboard' | 'website' | 'workflow' | 'system'
export type PlatformEvent = {
  id: number
  ts: string
  type: 'record.created' | 'record.updated' | 'record.deleted' | 'workflow.ran' | 'notify' | 'provisioned' | 'settings.updated'
  collection: string | null
  recordId: string | null
  source: EventSource
  summary: string // human sentence: "New order #A12 · $84.00 from website"
  payload: unknown
}
export type PlatformMeta = {
  projectId: string
  ownerId: string
  appName: string
  projectType: ProjectType
  spec: ProjectSpec | null
  blueprint: Blueprint
  createdAt: string
}
export type MetricValue = { key: string; label: string; value: number; format: Metric['format']; icon: string }
export type ChartSeries = { key: string; label: string; kind: Chart['kind']; points: { x: string; y: number }[] }
export type MetricsResponse = { metrics: MetricValue[]; charts: ChartSeries[] }

/** Identifier guard shared by DB + blueprint sanitizer. */
export const IDENT = /^[a-z][a-z0-9_]{0,39}$/
export function toIdent(raw: string, fallback = 'field'): string {
  const s = String(raw || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 'f_$1').slice(0, 40)
  return IDENT.test(s) ? s : fallback
}

import { z } from 'zod'

/**
 * Compact architecture decision layer (Part 7).
 * Produced in the SAME ApplicationPlan planning call — no extra LLM round-trip.
 * Principle: simplest architecture that fully satisfies the product requirements.
 */

export const persistenceStrategySchema = z.enum(['none', 'local', 'server'])
export type PersistenceStrategy = z.infer<typeof persistenceStrategySchema>

export const stateStrategySchema = z.enum(['none', 'component', 'shared_store'])
export type StateStrategy = z.infer<typeof stateStrategySchema>

export const databaseTypeSchema = z.enum(['none', 'relational', 'document'])
export type DatabaseType = z.infer<typeof databaseTypeSchema>

export const relationshipTypeSchema = z.enum([
  'has_one',
  'has_many',
  'belongs_to',
  'many_to_many',
])

export const architectureRequirementsSchema = z.object({
  frontend: z
    .object({
      required: z
        .boolean()
        .default(true)
        .describe('Almost always true for sandbox apps.'),
      reason: z
        .string()
        .describe('Why a UI is needed (usually obvious).'),
    })
    .describe('User-facing UI layer.'),
  state: z
    .object({
      required: z.boolean().describe('Whether the UI needs client state.'),
      strategy: stateStrategySchema.describe(
        'none | component (local React/Vue state) | shared_store (context/store module)',
      ),
      reason: z.string(),
    })
    .describe('In-memory client state needs.'),
  persistence: z
    .object({
      required: z
        .boolean()
        .describe('Must data survive refresh/session/device?'),
      strategy: persistenceStrategySchema.describe(
        'none = ephemeral; local = localStorage/IndexedDB; server = backend/DB',
      ),
      reason: z.string(),
    })
    .describe('Where durable data lives, if anywhere.'),
  backend: z
    .object({
      required: z
        .boolean()
        .describe(
          'True only for shared multi-user data, protected ops, secrets, payments, DB access, webhooks, etc.',
        ),
      reason: z.string(),
    })
    .describe('Server/API layer.'),
  database: z
    .object({
      required: z
        .boolean()
        .describe('True only when structured/shared durable data needs a DB.'),
      type: databaseTypeSchema.describe(
        'none when not required; relational for related business records; document when that fits better',
      ),
      reason: z.string(),
    })
    .describe('Database requirement + category — not a full schema.'),
  authentication: z
    .object({
      required: z
        .boolean()
        .describe(
          'True for accounts, private data, staff/admin access, protected resources.',
        ),
      reason: z.string(),
    })
    .describe('Identity / login.'),
  authorization: z
    .object({
      required: z
        .boolean()
        .describe('True only when different roles need different capabilities.'),
      roles: z
        .array(z.string())
        .max(8)
        .default([])
        .describe('Role names, e.g. admin, staff, trainer. Empty if not required.'),
      reason: z.string(),
    })
    .describe('Roles / permissions.'),
  fileStorage: z
    .object({
      required: z
        .boolean()
        .describe('True only for persistent uploads/media/documents.'),
      reason: z.string(),
    })
    .describe('Object/file storage.'),
  externalServices: z
    .object({
      required: z.boolean(),
      services: z
        .array(z.string())
        .max(8)
        .default([])
        .describe('Only genuine integrations, e.g. Stripe. Never invent.'),
      reason: z.string(),
    })
    .describe('Third-party services.'),
  entities: z
    .array(z.string())
    .max(12)
    .default([])
    .describe(
      'Core business entities when persistence matters (Member, Order, Task). Keep short — not a full schema.',
    ),
  relationships: z
    .array(
      z.object({
        from: z.string(),
        type: relationshipTypeSchema,
        to: z.string(),
      }),
    )
    .max(16)
    .default([])
    .describe('Important relationships only, when persistence/backend is required.'),
  summary: z
    .string()
    .describe(
      '1–2 sentences: the chosen architecture and why it is the minimum that satisfies the product.',
    ),
})

export type ArchitectureRequirements = z.infer<
  typeof architectureRequirementsSchema
>

export type ArchitectureConsistencyIssue = {
  code: string
  message: string
}

/** Detect inconsistent architecture combinations (before/after normalize). */
export function validateArchitectureConsistency(
  arch: ArchitectureRequirements,
): { ok: boolean; issues: ArchitectureConsistencyIssue[] } {
  const issues: ArchitectureConsistencyIssue[] = []

  if (arch.database.required && !arch.persistence.required) {
    issues.push({
      code: 'db_without_persistence',
      message: 'database.required=true but persistence.required=false',
    })
  }
  if (arch.database.required && arch.persistence.strategy === 'none') {
    issues.push({
      code: 'db_with_none_persistence',
      message: 'database.required=true but persistence.strategy=none',
    })
  }
  if (arch.database.required && arch.persistence.strategy === 'local') {
    issues.push({
      code: 'db_with_local_persistence',
      message:
        'database.required=true with local-only persistence is inconsistent (use server persistence)',
    })
  }
  if (arch.database.required && !arch.backend.required) {
    issues.push({
      code: 'db_without_backend',
      message: 'database.required=true but backend.required=false',
    })
  }
  if (arch.database.required && arch.database.type === 'none') {
    issues.push({
      code: 'db_type_none',
      message: 'database.required=true but database.type=none',
    })
  }
  if (!arch.database.required && arch.database.type !== 'none') {
    issues.push({
      code: 'db_type_without_requirement',
      message: 'database.required=false but database.type is not none',
    })
  }
  if (arch.authorization.required && !arch.authentication.required) {
    issues.push({
      code: 'authz_without_authn',
      message: 'authorization.required=true but authentication.required=false',
    })
  }
  if (arch.authorization.required && arch.authorization.roles.length === 0) {
    issues.push({
      code: 'authz_without_roles',
      message: 'authorization.required=true but roles[] is empty',
    })
  }
  if (
    !arch.persistence.required &&
    arch.persistence.strategy !== 'none'
  ) {
    issues.push({
      code: 'persistence_strategy_mismatch',
      message:
        'persistence.required=false but strategy is not none',
    })
  }
  if (
    arch.persistence.required &&
    arch.persistence.strategy === 'none'
  ) {
    issues.push({
      code: 'persistence_required_none',
      message: 'persistence.required=true but strategy=none',
    })
  }
  if (
    arch.persistence.strategy === 'server' &&
    !arch.backend.required
  ) {
    issues.push({
      code: 'server_persistence_without_backend',
      message: 'persistence.strategy=server but backend.required=false',
    })
  }

  return { ok: issues.length === 0, issues }
}

/**
 * Repair inconsistent architecture decisions into a coherent minimum set.
 * Prefer enabling required layers over inventing unused infrastructure.
 */
export function normalizeArchitectureRequirements(
  input: ArchitectureRequirements,
): ArchitectureRequirements {
  const arch: ArchitectureRequirements = {
    ...input,
    frontend: {
      required: input.frontend?.required !== false,
      reason: input.frontend?.reason || 'User-facing interface is required.',
    },
    state: {
      required: input.state?.required ?? true,
      strategy: input.state?.strategy ?? 'component',
      reason: input.state?.reason || 'UI interactions need client state.',
    },
    persistence: {
      required: !!input.persistence?.required,
      strategy: input.persistence?.strategy ?? 'none',
      reason: input.persistence?.reason || '',
    },
    backend: {
      required: !!input.backend?.required,
      reason: input.backend?.reason || '',
    },
    database: {
      required: !!input.database?.required,
      type: input.database?.type ?? 'none',
      reason: input.database?.reason || '',
    },
    authentication: {
      required: !!input.authentication?.required,
      reason: input.authentication?.reason || '',
    },
    authorization: {
      required: !!input.authorization?.required,
      roles: Array.isArray(input.authorization?.roles)
        ? input.authorization.roles
        : [],
      reason: input.authorization?.reason || '',
    },
    fileStorage: {
      required: !!input.fileStorage?.required,
      reason: input.fileStorage?.reason || '',
    },
    externalServices: {
      required: !!input.externalServices?.required,
      services: Array.isArray(input.externalServices?.services)
        ? input.externalServices.services
        : [],
      reason: input.externalServices?.reason || '',
    },
    entities: Array.isArray(input.entities) ? input.entities.slice(0, 12) : [],
    relationships: Array.isArray(input.relationships)
      ? input.relationships.slice(0, 16)
      : [],
    summary: input.summary || 'Minimum architecture for the product.',
  }

  // Database implies server persistence + backend
  if (arch.database.required) {
    arch.persistence.required = true
    arch.persistence.strategy = 'server'
    arch.backend.required = true
    if (!arch.backend.reason) {
      arch.backend.reason =
        'Database-backed shared data requires a server/API layer.'
    }
    if (!arch.persistence.reason) {
      arch.persistence.reason =
        'Structured records must persist beyond a single browser session.'
    }
    if (arch.database.type === 'none') {
      arch.database.type = 'relational'
    }
    if (!arch.database.reason) {
      arch.database.reason =
        'Product needs durable structured/shared business data.'
    }
  } else {
    arch.database.type = 'none'
  }

  // Server persistence implies backend
  if (arch.persistence.strategy === 'server') {
    arch.persistence.required = true
    arch.backend.required = true
    if (!arch.backend.reason) {
      arch.backend.reason =
        'Server persistence requires a backend that owns the data store.'
    }
  }

  // Local persistence: no DB by default
  if (arch.persistence.strategy === 'local') {
    arch.persistence.required = true
    arch.database.required = false
    arch.database.type = 'none'
  }

  // None persistence
  if (!arch.persistence.required || arch.persistence.strategy === 'none') {
    arch.persistence.required = false
    arch.persistence.strategy = 'none'
    // Do not force-clear backend — backend can exist without persistence (rare),
    // but clear DB.
    if (!arch.database.required) {
      arch.database.type = 'none'
    }
  }

  // AuthZ requires AuthN + roles
  if (arch.authorization.required) {
    arch.authentication.required = true
    if (!arch.authentication.reason) {
      arch.authentication.reason =
        'Role-based access requires authenticated identity.'
    }
    if (arch.authorization.roles.length === 0) {
      arch.authorization.roles = ['admin', 'user']
    }
  }

  if (!arch.authentication.required) {
    arch.authorization.required = false
    arch.authorization.roles = []
  }

  if (!arch.externalServices.required) {
    arch.externalServices.services = []
  }

  if (!arch.fileStorage.required && !arch.fileStorage.reason) {
    arch.fileStorage.reason = 'No persistent file/media uploads required.'
  }
  if (!arch.persistence.reason) {
    arch.persistence.reason = arch.persistence.required
      ? 'Product data must survive sessions.'
      : 'No durable storage required.'
  }
  if (!arch.backend.reason) {
    arch.backend.reason = arch.backend.required
      ? 'Server-side logic or shared data is required.'
      : 'Client-only architecture is sufficient.'
  }
  if (!arch.authentication.reason) {
    arch.authentication.reason = arch.authentication.required
      ? 'Users need authenticated access.'
      : 'No user accounts or private data.'
  }
  if (!arch.authorization.reason) {
    arch.authorization.reason = arch.authorization.required
      ? 'Different roles need different capabilities.'
      : 'No role differentiation required.'
  }
  if (!arch.externalServices.reason) {
    arch.externalServices.reason = arch.externalServices.required
      ? 'Product depends on listed third-party services.'
      : 'No external integrations required.'
  }

  // Clear entities/relationships when no durable shared model
  if (
    !arch.persistence.required ||
    arch.persistence.strategy === 'none'
  ) {
    // Keep entities only if local persistence listed them; relationships need server/db
    if (!arch.database.required) {
      arch.relationships = []
    }
  }

  return arch
}

export type ArchitectureInferHints = {
  needsAuth?: boolean
  needsBackend?: boolean
  dataApproach?: string
  complexity?: 'simple' | 'medium' | 'complex'
  applicationType?: string
  productGoal?: string
}

/**
 * Infer safe architecture for legacy plans missing architectureRequirements.
 * Biased toward the simplest architecture that matches old flags.
 */
export function inferArchitectureRequirements(
  hints: ArchitectureInferHints = {},
): ArchitectureRequirements {
  const type = (hints.applicationType || '').toLowerCase()
  const goal = (hints.productGoal || '').toLowerCase()
  const data = (hints.dataApproach || '').toLowerCase()
  const blob = `${type} ${goal} ${data}`

  const looksLocal =
    /localstorage|indexeddb|local persistence|local-only|browser storage/.test(
      blob,
    ) ||
    (/todo|note|habit|bookmark/.test(blob) &&
      !/saas|multi-user|team|staff|admin/.test(blob))

  const looksServer =
    !!hints.needsBackend ||
    /postgres|database|prisma|supabase|shared|multi-user|saas|crm|ecommerce|e-commerce|gym|hospital|inventory/.test(
      blob,
    )

  const looksAuth =
    !!hints.needsAuth ||
    /auth|login|account|staff|admin|role/.test(blob)

  let base: ArchitectureRequirements

  if (looksServer) {
    base = {
      frontend: {
        required: true,
        reason: 'Users interact through a web UI.',
      },
      state: {
        required: true,
        strategy: 'shared_store',
        reason: 'Multi-screen app needs coordinated client state.',
      },
      persistence: {
        required: true,
        strategy: 'server',
        reason:
          'Shared business data must persist and be available to multiple users.',
      },
      backend: {
        required: true,
        reason:
          hints.needsBackend
            ? 'Legacy plan marked needsBackend.'
            : 'Shared/protected server operations are required.',
      },
      database: {
        required: true,
        type: 'relational',
        reason: 'Structured related business records need a database.',
      },
      authentication: {
        required: looksAuth,
        reason: looksAuth
          ? 'Authenticated access is required for private/staff data.'
          : 'No authentication required by legacy signals.',
      },
      authorization: {
        required: /role|admin|staff|trainer|receptionist/.test(blob),
        roles: /gym/.test(blob)
          ? ['admin', 'receptionist', 'trainer']
          : /ecommerce|e-commerce/.test(blob)
            ? ['admin', 'customer']
            : looksAuth
              ? ['admin', 'user']
              : [],
        reason: /role|admin|staff/.test(blob)
          ? 'Different user roles need different capabilities.'
          : 'No role model required.',
      },
      fileStorage: {
        required: /upload|image|media|document|file storage/.test(blob),
        reason: /upload|image|media|document/.test(blob)
          ? 'Product needs persistent uploaded files.'
          : 'No file storage required.',
      },
      externalServices: {
        required: /payment|stripe|email|sms/.test(blob),
        services: /payment|stripe|order/.test(blob) ? ['payments'] : [],
        reason: /payment|stripe/.test(blob)
          ? 'Orders/payments need an external payment provider (placeholders only).'
          : 'No external services required.',
      },
      entities: [],
      relationships: [],
      summary:
        'Server-backed architecture inferred from legacy plan flags/domain.',
    }
  } else if (looksLocal) {
    base = {
      frontend: {
        required: true,
        reason: 'Users interact through a web UI.',
      },
      state: {
        required: true,
        strategy: 'shared_store',
        reason: 'Client state for list/form interactions.',
      },
      persistence: {
        required: true,
        strategy: 'local',
        reason:
          'Personal data should survive refresh via localStorage/IndexedDB.',
      },
      backend: {
        required: false,
        reason: 'Single-user local data does not need a backend.',
      },
      database: {
        required: false,
        type: 'none',
        reason: 'Local browser storage is sufficient.',
      },
      authentication: {
        required: false,
        reason: 'No accounts or private multi-user data.',
      },
      authorization: {
        required: false,
        roles: [],
        reason: 'No roles required.',
      },
      fileStorage: {
        required: false,
        reason: 'No persistent uploads.',
      },
      externalServices: {
        required: false,
        services: [],
        reason: 'No external integrations.',
      },
      entities: ['Item'],
      relationships: [],
      summary: 'Frontend + local persistence — no backend/database.',
    }
  } else {
    // Frontend + ephemeral state (calculator, portfolio, landing)
    base = {
      frontend: {
        required: true,
        reason: 'Users interact through a web UI.',
      },
      state: {
        required: !/landing|portfolio|marketing/.test(blob),
        strategy: /landing|portfolio|marketing/.test(blob)
          ? 'none'
          : 'component',
        reason: /landing|portfolio|marketing/.test(blob)
          ? 'Mostly static content; minimal client state.'
          : 'UI interactions need component state.',
      },
      persistence: {
        required: false,
        strategy: 'none',
        reason: 'No data needs to survive sessions.',
      },
      backend: {
        required: false,
        reason: 'Client-only product is sufficient.',
      },
      database: {
        required: false,
        type: 'none',
        reason: 'No database required.',
      },
      authentication: {
        required: false,
        reason: 'Public or single-session experience; no accounts.',
      },
      authorization: {
        required: false,
        roles: [],
        reason: 'No roles required.',
      },
      fileStorage: {
        required: false,
        reason: 'No persistent uploads.',
      },
      externalServices: {
        required: false,
        services: [],
        reason: 'No external integrations.',
      },
      entities: [],
      relationships: [],
      summary: 'Frontend-only (or frontend + local state) — minimum architecture.',
    }
  }

  // Apply explicit legacy flags as overrides
  if (hints.needsBackend) {
    base.backend.required = true
    base.persistence.required = true
    base.persistence.strategy = 'server'
    base.database.required = true
    if (base.database.type === 'none') base.database.type = 'relational'
  }
  if (hints.needsAuth) {
    base.authentication.required = true
  }

  return normalizeArchitectureRequirements(base)
}

/** Preset fixtures for deterministic tests / examples. */
export function architecturePreset(
  kind:
    | 'calculator'
    | 'portfolio'
    | 'personal_todo'
    | 'gym'
    | 'ecommerce'
    | 'landing',
): ArchitectureRequirements {
  switch (kind) {
    case 'calculator':
      return normalizeArchitectureRequirements({
        frontend: { required: true, reason: 'Interactive calculator UI.' },
        state: {
          required: true,
          strategy: 'component',
          reason: 'Expression/result state only.',
        },
        persistence: {
          required: false,
          strategy: 'none',
          reason: 'Calculations are ephemeral.',
        },
        backend: { required: false, reason: 'No shared or protected logic.' },
        database: {
          required: false,
          type: 'none',
          reason: 'No durable data.',
        },
        authentication: {
          required: false,
          reason: 'Public utility; no accounts.',
        },
        authorization: {
          required: false,
          roles: [],
          reason: 'No roles.',
        },
        fileStorage: { required: false, reason: 'No uploads.' },
        externalServices: {
          required: false,
          services: [],
          reason: 'No integrations.',
        },
        entities: [],
        relationships: [],
        summary: 'Frontend + local state only.',
      })
    case 'portfolio':
      return normalizeArchitectureRequirements({
        frontend: { required: true, reason: 'Showcase site.' },
        state: {
          required: false,
          strategy: 'none',
          reason: 'Mostly static content.',
        },
        persistence: {
          required: false,
          strategy: 'none',
          reason: 'Content is static in the app.',
        },
        backend: { required: false, reason: 'No server needed.' },
        database: {
          required: false,
          type: 'none',
          reason: 'No database.',
        },
        authentication: {
          required: false,
          reason: 'Public portfolio.',
        },
        authorization: {
          required: false,
          roles: [],
          reason: 'No roles.',
        },
        fileStorage: { required: false, reason: 'No uploads.' },
        externalServices: {
          required: false,
          services: [],
          reason: 'No integrations.',
        },
        entities: [],
        relationships: [],
        summary: 'Frontend-only portfolio.',
      })
    case 'personal_todo':
      return normalizeArchitectureRequirements({
        frontend: { required: true, reason: 'Todo UI.' },
        state: {
          required: true,
          strategy: 'shared_store',
          reason: 'List/filter state across components.',
        },
        persistence: {
          required: true,
          strategy: 'local',
          reason: 'Personal todos should survive refresh.',
        },
        backend: {
          required: false,
          reason: 'Single-user local data.',
        },
        database: {
          required: false,
          type: 'none',
          reason: 'localStorage is enough.',
        },
        authentication: {
          required: false,
          reason: 'No accounts.',
        },
        authorization: {
          required: false,
          roles: [],
          reason: 'No roles.',
        },
        fileStorage: { required: false, reason: 'No uploads.' },
        externalServices: {
          required: false,
          services: [],
          reason: 'No integrations.',
        },
        entities: ['TodoItem'],
        relationships: [],
        summary: 'Frontend + local persistence; no backend/database.',
      })
    case 'gym':
      return normalizeArchitectureRequirements({
        frontend: {
          required: true,
          reason: 'Staff/admin operate the gym system via UI.',
        },
        state: {
          required: true,
          strategy: 'shared_store',
          reason: 'Multi-page operational UI.',
        },
        persistence: {
          required: true,
          strategy: 'server',
          reason:
            'Member, payment, attendance, and membership records must survive sessions and be shared by staff.',
        },
        backend: {
          required: true,
          reason:
            'Multiple authenticated users need shared persistent business data with protected operations.',
        },
        database: {
          required: true,
          type: 'relational',
          reason:
            'Members, payments, attendance, and memberships have related structured records.',
        },
        authentication: {
          required: true,
          reason: 'Staff and administrators require authenticated access.',
        },
        authorization: {
          required: true,
          roles: ['admin', 'receptionist', 'trainer'],
          reason:
            'Admin, receptionist, and trainer have different capabilities.',
        },
        fileStorage: {
          required: false,
          reason: 'No mandatory media uploads for MVP.',
        },
        externalServices: {
          required: false,
          services: [],
          reason: 'No required third-party integrations for MVP.',
        },
        entities: [
          'Member',
          'Membership',
          'Payment',
          'Attendance',
          'Trainer',
        ],
        relationships: [
          { from: 'Member', type: 'has_many', to: 'Payment' },
          { from: 'Member', type: 'has_many', to: 'Attendance' },
          { from: 'Member', type: 'has_one', to: 'Membership' },
          { from: 'Trainer', type: 'has_many', to: 'Member' },
        ],
        summary:
          'Full-stack gym system: frontend + backend + relational DB + auth + roles.',
      })
    case 'ecommerce':
      return normalizeArchitectureRequirements({
        frontend: {
          required: true,
          reason: 'Shoppers and admins need a web storefront/admin UI.',
        },
        state: {
          required: true,
          strategy: 'shared_store',
          reason: 'Cart and catalog UI state.',
        },
        persistence: {
          required: true,
          strategy: 'server',
          reason: 'Products, carts, and orders must persist and be shared.',
        },
        backend: {
          required: true,
          reason:
            'Orders, inventory, and protected checkout operations need a server.',
        },
        database: {
          required: true,
          type: 'relational',
          reason:
            'Users, products, carts, orders, and payments are related structured records.',
        },
        authentication: {
          required: true,
          reason: 'Accounts for customers and admin access.',
        },
        authorization: {
          required: true,
          roles: ['admin', 'customer'],
          reason: 'Admins manage catalog/orders; customers shop.',
        },
        fileStorage: {
          required: false,
          reason: 'Product images can be URLs/placeholders for MVP.',
        },
        externalServices: {
          required: true,
          services: ['payments'],
          reason: 'Checkout needs a payment provider (use placeholders/mocks if unpaid).',
        },
        entities: [
          'User',
          'Product',
          'Cart',
          'Order',
          'OrderItem',
          'Payment',
        ],
        relationships: [
          { from: 'User', type: 'has_many', to: 'Order' },
          { from: 'User', type: 'has_one', to: 'Cart' },
          { from: 'Order', type: 'has_many', to: 'OrderItem' },
          { from: 'Order', type: 'has_one', to: 'Payment' },
          { from: 'Product', type: 'has_many', to: 'OrderItem' },
        ],
        summary:
          'E-commerce: frontend + backend + DB + auth + orders/payments integrations.',
      })
    case 'landing':
      return normalizeArchitectureRequirements({
        frontend: { required: true, reason: 'Marketing page.' },
        state: {
          required: false,
          strategy: 'none',
          reason: 'Static marketing content.',
        },
        persistence: {
          required: false,
          strategy: 'none',
          reason: 'No durable app data.',
        },
        backend: { required: false, reason: 'No server required.' },
        database: {
          required: false,
          type: 'none',
          reason: 'No database.',
        },
        authentication: {
          required: false,
          reason: 'Public landing page.',
        },
        authorization: {
          required: false,
          roles: [],
          reason: 'No roles.',
        },
        fileStorage: { required: false, reason: 'No uploads.' },
        externalServices: {
          required: false,
          services: [],
          reason: 'No integrations.',
        },
        entities: [],
        relationships: [],
        summary: 'Public frontend-only landing page.',
      })
    default: {
      const _exhaustive: never = kind
      throw new Error(`Unknown preset ${_exhaustive}`)
    }
  }
}

export function formatArchitectureForGeneration(
  arch: ArchitectureRequirements,
): string {
  const yn = (v: boolean) => (v ? 'REQUIRED' : 'NOT required')
  const entities =
    arch.entities.length > 0
      ? arch.entities.map((e) => `- ${e}`).join('\n')
      : '- (none)'
  const rels =
    arch.relationships.length > 0
      ? arch.relationships
          .map((r) => `- ${r.from} ${r.type} ${r.to}`)
          .join('\n')
      : '- (none)'
  const roles =
    arch.authorization.roles.length > 0
      ? arch.authorization.roles.join(', ')
      : '(none)'
  const services =
    arch.externalServices.services.length > 0
      ? arch.externalServices.services.join(', ')
      : '(none)'

  return `### Architecture requirements (SHARED — implement exactly; do not overengineer)
Summary: ${arch.summary}

- Frontend: ${yn(arch.frontend.required)} — ${arch.frontend.reason}
- Client state: ${yn(arch.state.required)} (strategy=${arch.state.strategy}) — ${arch.state.reason}
- Persistence: ${yn(arch.persistence.required)} (strategy=${arch.persistence.strategy}) — ${arch.persistence.reason}
- Backend/API: ${yn(arch.backend.required)} — ${arch.backend.reason}
- Database: ${yn(arch.database.required)} (type=${arch.database.type}) — ${arch.database.reason}
- Authentication: ${yn(arch.authentication.required)} — ${arch.authentication.reason}
- Authorization: ${yn(arch.authorization.required)} roles=[${roles}] — ${arch.authorization.reason}
- File storage: ${yn(arch.fileStorage.required)} — ${arch.fileStorage.reason}
- External services: ${yn(arch.externalServices.required)} services=[${services}] — ${arch.externalServices.reason}

#### Core entities
${entities}

#### Important relationships
${rels}

#### Architecture implementation rules
- Use THE SIMPLEST architecture that satisfies these requirements. More infrastructure ≠ better.
- If database is NOT required: do NOT add Prisma/PostgreSQL/ORM/migrations/DB config.
- If backend is NOT required: do NOT invent API routes/servers for façade complexity.
- If authentication is NOT required: do NOT add login/signup screens.
- If persistence.strategy=local: use localStorage/IndexedDB (or equivalent); no server DB.
- If database IS required: implement real persistence architecture appropriate to the template (API routes + data layer). Do NOT ship mock-data.ts alone and claim completeness. If the sandbox cannot provision a real cloud DB, use the simplest durable approach the template supports and document the limitation — still separate server/data layers from UI.
- If authentication/authorization ARE required: enforce permissions on the server/API for protected operations; frontend checks alone are insufficient for sensitive actions.
- If external services are listed: add .env.example with PLACEHOLDER values only (never real secrets). Document setup in README.
- Align folder structure with complexity (simple → few files; full-stack → clear server/db/auth separation).`
}

export function formatArchitectureForJudge(
  arch?: ArchitectureRequirements | null,
): string {
  if (!arch) return 'Architecture requirements: (none / legacy defaults)'
  const roles = arch.authorization.roles.join(',') || 'none'
  const services = arch.externalServices.services.join(',') || 'none'
  return `Architecture requirements (simplest that satisfies product — NOT "more infra = better"):
summary: ${arch.summary}
persistence: ${arch.persistence.required ? arch.persistence.strategy : 'none'} — ${arch.persistence.reason}
backend: ${arch.backend.required} — ${arch.backend.reason}
database: ${arch.database.required ? arch.database.type : 'none'} — ${arch.database.reason}
authn: ${arch.authentication.required} — ${arch.authentication.reason}
authz: ${arch.authorization.required} roles=[${roles}] — ${arch.authorization.reason}
files: ${arch.fileStorage.required}; external: ${arch.externalServices.required} [${services}]
entities: ${arch.entities.join(', ') || 'n/a'}
Score architecture FIT: satisfying required layers WITHOUT unnecessary DB/auth/backend on simple apps.
Penalize mock-only implementations when database/backend are required.
Penalize unnecessary PostgreSQL/Prisma/auth when they are NOT required.`
}

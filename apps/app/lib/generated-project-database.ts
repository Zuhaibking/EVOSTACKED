/**
 * Inspect generated project files for database and data-platform artifacts.
 * Never reads or mutates EvoStack's own Prisma/Postgres.
 */
import {
  getFragmentFiles,
  hasFragmentCode,
  type FragmentFile,
} from '@/lib/fragment'

const DB_PATH =
  /(?:^|\/)(prisma\/schema\.prisma|drizzle(\.|\/)|migrations?\/|schema\.sql)$/i

const DB_CONTENT =
  /\b(DATABASE_URL|PrismaClient|prisma\.\w+\.|drizzle(-orm)?|mongoose|TypeORM|DataSource|sequelize|sqlalchemy|createClient\s*\([^)]*supabase|new\s+Pool\s*\(|pg\.Pool|from\s+['"]pg['"]|mongodb(\+srv)?:\/\/)\b/i

const SECRET_ENV_NAME =
  /(secret|password|passwd|token|jwt|credential|private|auth_key|api_key|apikey|access_key|database_url|connection_string|dsn)/i

const INTEGRATION_PACKAGES: { name: string; kind: string; pattern: RegExp }[] = [
  { name: 'Prisma', kind: 'database', pattern: /\bprisma\b/i },
  { name: 'Drizzle', kind: 'database', pattern: /\bdrizzle-orm\b/i },
  { name: 'Supabase', kind: 'backend', pattern: /@supabase\/|supabase-js\b/i },
  { name: 'Clerk', kind: 'auth', pattern: /@clerk\/|clerkClient\b/i },
  { name: 'NextAuth', kind: 'auth', pattern: /\bnext-auth\b/i },
  { name: 'Stripe', kind: 'payments', pattern: /\bstripe\b/i },
  { name: 'Resend', kind: 'email', pattern: /\bresend\b/i },
  { name: 'Twilio', kind: 'messaging', pattern: /\btwilio\b/i },
  { name: 'PostHog', kind: 'analytics', pattern: /\bposthog\b/i },
  { name: 'Sentry', kind: 'observability', pattern: /@sentry\/|\bsentry\b/i },
  { name: 'OpenAI', kind: 'ai', pattern: /\bopenai\b/i },
  { name: 'Anthropic', kind: 'ai', pattern: /@anthropic|\banthropic\b/i },
  { name: 'Upstash', kind: 'data', pattern: /@upstash\/|\bupstash\b/i },
  { name: 'Neon', kind: 'database', pattern: /@neondatabase|\bneon\b/i },
  { name: 'PlanetScale', kind: 'database', pattern: /\bplanetscale\b/i },
  { name: 'MongoDB', kind: 'database', pattern: /\bmongoose|mongodb\b/i },
  { name: 'Firebase', kind: 'backend', pattern: /\bfirebase\b/i },
  { name: 'Cloudinary', kind: 'storage', pattern: /\bcloudinary\b/i },
  { name: 'Auth0', kind: 'auth', pattern: /\bauth0\b/i },
]

export type GeneratedDbColumn = {
  name: string
  type: string
  optional: boolean
  isArray: boolean
  isPrimaryKey: boolean
  isUnique: boolean
  isRelation: boolean
  relationTo?: string
  attributes: string[]
}

export type GeneratedDbRelation = {
  field: string
  to: string
  kind: 'one' | 'many'
}

export type GeneratedDbTable = {
  name: string
  source: 'prisma' | 'drizzle' | 'sql' | 'mongoose'
  filePath: string
  mappedName?: string
  columns: GeneratedDbColumn[]
  primaryKeys: string[]
  indexes: string[]
  relations: GeneratedDbRelation[]
}

export type GeneratedEndpoint = {
  method: string
  route: string
  filePath: string
  description?: string
}

export type GeneratedIntegration = {
  name: string
  kind: string
  evidence: string
}

export type GeneratedEnvVar = {
  name: string
  configured: boolean
  secret: boolean
  filePath: string
}

export type GeneratedFileRecords = {
  tableHint: string
  filePath: string
  records: Record<string, unknown>[]
}

export type GeneratedSecuritySignal = {
  id: string
  label: string
  status: 'pass' | 'warn' | 'missing'
  detail: string
}

export type GeneratedProjectDatabase = {
  configured: boolean
  files: FragmentFile[]
  models: string[]
  provider?: string
  tables: GeneratedDbTable[]
  endpoints: GeneratedEndpoint[]
  integrations: GeneratedIntegration[]
  envVars: GeneratedEnvVar[]
  fileRecords: GeneratedFileRecords[]
  security: GeneratedSecuritySignal[]
}

export function isSecretEnvName(name: string): boolean {
  return SECRET_ENV_NAME.test(name)
}

function prismaModels(content: string): string[] {
  const names: string[] = []
  const re = /^\s*model\s+([A-Za-z_][A-Za-z0-9_]*)/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(content))) {
    names.push(m[1])
  }
  return names
}

function datasourceProvider(content: string): string | undefined {
  const block = content.match(/datasource\s+\w+\s*\{([\s\S]*?)\}/)
  if (!block) return undefined
  const provider = block[1].match(/provider\s*=\s*"([^"]+)"/)
  return provider?.[1]
}

function splitAttrs(raw: string): string[] {
  const attrs: string[] = []
  const re = /@[\w.]+(?:\([^)]*\))?/g
  let m: RegExpExecArray | null
  while ((m = re.exec(raw))) attrs.push(m[0])
  return attrs
}

function parsePrismaTables(filePath: string, content: string): GeneratedDbTable[] {
  const modelNames = prismaModels(content)
  const tables: GeneratedDbTable[] = []
  const modelRe = /model\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{([\s\S]*?)\n\}/g
  let match: RegExpExecArray | null

  while ((match = modelRe.exec(content))) {
    const name = match[1]
    const body = match[2]
    const columns: GeneratedDbColumn[] = []
    const indexes: string[] = []
    const relations: GeneratedDbRelation[] = []
    let mappedName: string | undefined
    const compositeId: string[] = []

    for (const rawLine of body.split('\n')) {
      const line = rawLine.trim()
      if (!line || line.startsWith('//')) continue
      if (line.startsWith('@@')) {
        const map = line.match(/@@map\(\s*"([^"]+)"\s*\)/)
        if (map) mappedName = map[1]
        const id = line.match(/@@id\(\s*\[([^\]]+)\]\s*\)/)
        if (id) {
          compositeId.push(
            ...id[1].split(',').map((s) => s.trim()).filter(Boolean),
          )
        }
        const index = line.match(/@@index\(\s*\[([^\]]+)\]/)
        if (index) indexes.push(index[1].replace(/\s+/g, ''))
        const unique = line.match(/@@unique\(\s*\[([^\]]+)\]/)
        if (unique) indexes.push(`unique:${unique[1].replace(/\s+/g, '')}`)
        continue
      }

      const field = line.match(
        /^([A-Za-z_][A-Za-z0-9_]*)\s+([A-Za-z_][A-Za-z0-9_]*)(\[\])?(\?)?(.*)$/,
      )
      if (!field) continue
      const fieldName = field[1]
      const type = field[2]
      const isArray = Boolean(field[3])
      const optional = Boolean(field[4])
      const attrs = splitAttrs(field[5] || '')
      const isPrimaryKey = attrs.some((a) => a === '@id')
      const isUnique = attrs.some((a) => a.startsWith('@unique'))
      const relationAttr = attrs.find((a) => a.startsWith('@relation'))
      const related = modelNames.includes(type)
      const isRelation = Boolean(relationAttr) || related
      if (isRelation) {
        relations.push({
          field: fieldName,
          to: type,
          kind: isArray ? 'many' : 'one',
        })
      }
      columns.push({
        name: fieldName,
        type,
        optional,
        isArray,
        isPrimaryKey,
        isUnique,
        isRelation,
        relationTo: isRelation ? type : undefined,
        attributes: attrs,
      })
    }

    if (compositeId.length > 0) {
      for (const col of columns) {
        if (compositeId.includes(col.name)) col.isPrimaryKey = true
      }
    }

    tables.push({
      name,
      source: 'prisma',
      filePath,
      mappedName,
      columns,
      primaryKeys: columns.filter((c) => c.isPrimaryKey).map((c) => c.name),
      indexes,
      relations,
    })
  }

  return tables
}

function parseDrizzleTables(filePath: string, content: string): GeneratedDbTable[] {
  const tables: GeneratedDbTable[] = []
  const re =
    /(?:export\s+)?const\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:pgTable|mysqlTable|sqliteTable)\(\s*['"]([^'"]+)['"]\s*,\s*\{([\s\S]*?)\}\s*\)/g
  let match: RegExpExecArray | null
  while ((match = re.exec(content))) {
    const name = match[1]
    const mappedName = match[2]
    const body = match[3]
    const columns: GeneratedDbColumn[] = []
    for (const rawLine of body.split('\n')) {
      const line = rawLine.trim().replace(/,$/, '')
      const field = line.match(
        /^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([A-Za-z_][A-Za-z0-9_]*)\(/,
      )
      if (!field) continue
      const rest = line.slice(field[0].length)
      columns.push({
        name: field[1],
        type: field[2],
        optional: !/\.notNull\(/.test(rest),
        isArray: false,
        isPrimaryKey: /\.primaryKey\(/.test(rest),
        isUnique: /\.unique\(/.test(rest),
        isRelation: false,
        attributes: [],
      })
    }
    tables.push({
      name,
      source: 'drizzle',
      filePath,
      mappedName,
      columns,
      primaryKeys: columns.filter((c) => c.isPrimaryKey).map((c) => c.name),
      indexes: [],
      relations: [],
    })
  }
  return tables
}

function parseSqlTables(filePath: string, content: string): GeneratedDbTable[] {
  const tables: GeneratedDbTable[] = []
  const re = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["`]?([A-Za-z_][A-Za-z0-9_]*)["`]?\s*\(([\s\S]*?)\);/gi
  let match: RegExpExecArray | null
  while ((match = re.exec(content))) {
    const name = match[1]
    const columns: GeneratedDbColumn[] = []
    for (const raw of match[2].split(',')) {
      const line = raw.trim()
      if (!line || /^(PRIMARY|FOREIGN|UNIQUE|CHECK|CONSTRAINT)\b/i.test(line)) {
        continue
      }
      const field = line.match(/^["`]?([A-Za-z_][A-Za-z0-9_]*)["`]?\s+([A-Za-z][A-Za-z0-9_()]*)/i)
      if (!field) continue
      columns.push({
        name: field[1],
        type: field[2],
        optional: !/\bNOT\s+NULL\b/i.test(line),
        isArray: false,
        isPrimaryKey: /\bPRIMARY\s+KEY\b/i.test(line),
        isUnique: /\bUNIQUE\b/i.test(line),
        isRelation: /\bREFERENCES\b/i.test(line),
        attributes: [],
      })
    }
    tables.push({
      name,
      source: 'sql',
      filePath,
      columns,
      primaryKeys: columns.filter((c) => c.isPrimaryKey).map((c) => c.name),
      indexes: [],
      relations: [],
    })
  }
  return tables
}

function parseMongooseTables(filePath: string, content: string): GeneratedDbTable[] {
  const tables: GeneratedDbTable[] = []
  const re = /(?:mongoose\.)?model\(\s*['"]([^'"]+)['"]/g
  let match: RegExpExecArray | null
  while ((match = re.exec(content))) {
    tables.push({
      name: match[1],
      source: 'mongoose',
      filePath,
      columns: [],
      primaryKeys: ['_id'],
      indexes: [],
      relations: [],
    })
  }
  return tables
}

function nextRouteFromPath(filePath: string): string | undefined {
  const app = filePath.match(/(?:^|\/)app(\/api\/.+)\/route\.(ts|js|tsx|jsx)$/i)
  if (app) {
    return app[1].replace(/\/\([^/]+\)/g, '').replace(/\[([^\]]+)\]/g, ':$1')
  }
  const pages = filePath.match(/(?:^|\/)pages(\/api\/.+)\.(ts|js)$/i)
  if (pages) {
    return pages[1].replace(/\[([^\]]+)\]/g, ':$1')
  }
  return undefined
}

function parseEndpoints(file: FragmentFile): GeneratedEndpoint[] {
  const path = file.file_path.replace(/\\/g, '/')
  const content = file.file_content
  const found: GeneratedEndpoint[] = []
  const nextRoute = nextRouteFromPath(path)

  if (nextRoute) {
    const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']
    let any = false
    for (const method of methods) {
      const re = new RegExp(
        `export\\s+(async\\s+)?function\\s+${method}\\b|export\\s+const\\s+${method}\\s*=`,
      )
      if (re.test(content)) {
        any = true
        found.push({
          method,
          route: nextRoute,
          filePath: path,
          description: `App Router handler in ${path}`,
        })
      }
    }
    if (!any && /export\s+default\s+function|export\s+async\s+function/i.test(content)) {
      found.push({
        method: 'ANY',
        route: nextRoute,
        filePath: path,
        description: `API route in ${path}`,
      })
    }
  }

  const decorator =
    /@(?:app|router)\.(get|post|put|patch|delete)\(\s*['"]([^'"]+)['"]/gi
  let m: RegExpExecArray | null
  while ((m = decorator.exec(content))) {
    found.push({
      method: m[1].toUpperCase(),
      route: m[2],
      filePath: path,
      description: `Detected ${m[1].toLowerCase()} handler in ${path}`,
    })
  }

  return found
}

function parseEnvVars(file: FragmentFile): GeneratedEnvVar[] {
  const path = file.file_path.replace(/\\/g, '/')
  if (!/(^|\/)\.env/i.test(path) && !/\.env\./i.test(path)) return []
  const vars: GeneratedEnvVar[] = []
  for (const raw of file.file_content.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const kv = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (!kv) continue
    const name = kv[1]
    const rawValue = kv[2].replace(/^['"]|['"]$/g, '').trim()
    vars.push({
      name,
      configured: rawValue.length > 0 && rawValue !== 'changeme' && rawValue !== 'TODO',
      secret: isSecretEnvName(name),
      filePath: path,
    })
  }
  return vars
}

function parsePackageDeps(content: string): string {
  try {
    const parsed = JSON.parse(content) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    return [
      ...Object.keys(parsed.dependencies || {}),
      ...Object.keys(parsed.devDependencies || {}),
    ].join('\n')
  } catch {
    return ''
  }
}

function detectIntegrations(files: FragmentFile[]): GeneratedIntegration[] {
  const blob = files
    .map((f) => {
      const path = f.file_path.replace(/\\/g, '/')
      if (/(^|\/)package\.json$/i.test(path)) return parsePackageDeps(f.file_content)
      return f.file_content
    })
    .join('\n')

  const found: GeneratedIntegration[] = []
  for (const item of INTEGRATION_PACKAGES) {
    if (item.pattern.test(blob)) {
      found.push({
        name: item.name,
        kind: item.kind,
        evidence: `Detected ${item.name} usage in generated project files`,
      })
    }
  }
  return found
}

function safeRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const out: Record<string, unknown> = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (isSecretEnvName(key)) {
      out[key] = raw == null || raw === '' ? 'empty' : 'configured'
      continue
    }
    if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean' || raw == null) {
      out[key] = raw
      continue
    }
    if (Array.isArray(raw)) {
      out[key] = `[${raw.length}]`
      continue
    }
    out[key] = '{…}'
  }
  return out
}

function parseJsonRecords(file: FragmentFile): GeneratedFileRecords[] {
  const path = file.file_path.replace(/\\/g, '/')
  if (!/\.json$/i.test(path)) return []
  if (/(^|\/)package\.json$/i.test(path) || /(^|\/)tsconfig/i.test(path)) return []
  try {
    const parsed = JSON.parse(file.file_content)
    if (Array.isArray(parsed)) {
      const records = parsed
        .map(safeRecord)
        .filter((row): row is Record<string, unknown> => !!row)
      if (records.length === 0) return []
      const hint = path.split('/').pop()?.replace(/\.json$/i, '') || 'records'
      return [{ tableHint: hint, filePath: path, records }]
    }
    if (parsed && typeof parsed === 'object') {
      const sets: GeneratedFileRecords[] = []
      for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (!Array.isArray(value)) continue
        const records = value
          .map(safeRecord)
          .filter((row): row is Record<string, unknown> => !!row)
        if (records.length > 0) {
          sets.push({ tableHint: key, filePath: path, records })
        }
      }
      return sets
    }
  } catch {
    return []
  }
  return []
}

function buildSecurity(
  tables: GeneratedDbTable[],
  envVars: GeneratedEnvVar[],
  files: FragmentFile[],
): GeneratedSecuritySignal[] {
  const blob = files.map((f) => f.file_content).join('\n')
  const auth =
    /\b(NextAuth|next-auth|@clerk\/|clerkClient|lucia|better-auth|supabase\.auth)\b/i.test(
      blob,
    )
  const fakeAuth =
    !auth &&
    (/\bisLoggedIn\s*=\s*true\b/.test(blob) || /\bfake(Login|Auth|User)\b/i.test(blob))
  const secretsInSource = envVars.filter((v) => v.secret && v.configured).length
  const hasUserTable = tables.some((t) => /user|account|member|profile/i.test(t.name))

  return [
    {
      id: 'auth',
      label: 'Authentication',
      status: auth ? 'pass' : fakeAuth ? 'warn' : 'missing',
      detail: auth
        ? 'Auth provider primitives detected in generated source'
        : fakeAuth
          ? 'Only client-side login flags were found'
          : 'No authentication infrastructure detected in this project',
    },
    {
      id: 'secrets',
      label: 'Secret configuration',
      status: secretsInSource > 0 ? 'pass' : 'missing',
      detail:
        secretsInSource > 0
          ? `${secretsInSource} secret-named variable(s) are present in env examples. Values are never shown.`
          : 'No secret-named environment variables were found in project env files',
    },
    {
      id: 'identity-table',
      label: 'Identity tables',
      status: hasUserTable ? 'pass' : 'missing',
      detail: hasUserTable
        ? 'A user/account model exists in the generated schema'
        : 'No user or account model was found in the generated schema',
    },
  ]
}

export function inspectGeneratedProjectDatabase(
  fragment: Parameters<typeof getFragmentFiles>[0],
): GeneratedProjectDatabase {
  const files = getFragmentFiles(fragment)
  const matched: FragmentFile[] = []
  const models: string[] = []
  const tables: GeneratedDbTable[] = []
  const endpoints: GeneratedEndpoint[] = []
  const envVars: GeneratedEnvVar[] = []
  const fileRecords: GeneratedFileRecords[] = []
  let provider: string | undefined

  for (const file of files) {
    const path = file.file_path.replace(/\\/g, '/')
    const byPath = DB_PATH.test(path)
    const byContent = DB_CONTENT.test(file.file_content)
    if (byPath || byContent) {
      matched.push(file)
      if (/prisma\/schema\.prisma$/i.test(path) || /\.prisma$/i.test(path)) {
        models.push(...prismaModels(file.file_content))
        tables.push(...parsePrismaTables(path, file.file_content))
        provider = provider || datasourceProvider(file.file_content)
      }
      if (/drizzle/i.test(path) || /\bpgTable\s*\(/.test(file.file_content)) {
        tables.push(...parseDrizzleTables(path, file.file_content))
      }
      if (/\.sql$/i.test(path)) {
        tables.push(...parseSqlTables(path, file.file_content))
      }
      if (/\bmongoose\.model\b|\.model\(\s*['"]/.test(file.file_content)) {
        tables.push(...parseMongooseTables(path, file.file_content))
      }
    }

    endpoints.push(...parseEndpoints(file))
    envVars.push(...parseEnvVars(file))
    fileRecords.push(...parseJsonRecords(file))
  }

  const uniqueTables = new Map<string, GeneratedDbTable>()
  for (const table of tables) {
    uniqueTables.set(`${table.source}:${table.name}:${table.filePath}`, table)
  }

  const uniqueEndpoints = new Map<string, GeneratedEndpoint>()
  for (const endpoint of endpoints) {
    uniqueEndpoints.set(`${endpoint.method}:${endpoint.route}:${endpoint.filePath}`, endpoint)
  }

  const resolvedTables = [...uniqueTables.values()]

  return {
    configured: matched.length > 0,
    files: matched,
    models: [...new Set(models)],
    provider,
    tables: resolvedTables,
    endpoints: [...uniqueEndpoints.values()],
    integrations: detectIntegrations(files),
    envVars,
    fileRecords,
    security: buildSecurity(resolvedTables, envVars, files),
  }
}

export type GeneratedDatabaseView =
  | { status: 'no-project' }
  | { status: 'no-database' }
  | { status: 'ready'; inspection: GeneratedProjectDatabase }

/** Generated-project Database context only — never EvoStack platform data. */
export function resolveGeneratedDatabaseView(
  fragment: Parameters<typeof getFragmentFiles>[0],
): GeneratedDatabaseView {
  if (!hasFragmentCode(fragment)) return { status: 'no-project' }
  const inspection = inspectGeneratedProjectDatabase(fragment)
  if (!inspection.configured) return { status: 'no-database' }
  return { status: 'ready', inspection }
}

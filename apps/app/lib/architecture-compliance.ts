import {
  ArchitectureRequirements,
  inferArchitectureRequirements,
  normalizeArchitectureRequirements,
} from '@/lib/architecture'
import { getFragmentFiles, type FragmentFile } from '@/lib/fragment'
import type { ApplicationPlan } from '@/lib/plan'
import type { FragmentSchema } from '@/lib/schema'
import { getTemplateId } from '@/lib/templates'
import { z } from 'zod'

export const complianceCheckStatusSchema = z.enum([
  'pass',
  'fail',
  'warning',
  'not_applicable',
])

export type ComplianceCheckStatus = z.infer<typeof complianceCheckStatusSchema>

export const complianceSeveritySchema = z.enum([
  'critical',
  'high',
  'medium',
  'low',
])

export type ComplianceSeverity = z.infer<typeof complianceSeveritySchema>

export const complianceOverallStatusSchema = z.enum([
  'passed',
  'partial',
  'failed',
])

export type ComplianceOverallStatus = z.infer<
  typeof complianceOverallStatusSchema
>

export const architectureComplianceCheckSchema = z.object({
  id: z.string(),
  requirement: z.string(),
  status: complianceCheckStatusSchema,
  severity: complianceSeveritySchema,
  evidence: z.string(),
})

export type ArchitectureComplianceCheck = z.infer<
  typeof architectureComplianceCheckSchema
>

export const architectureComplianceResultSchema = z.object({
  status: complianceOverallStatusSchema,
  checks: z.array(architectureComplianceCheckSchema),
  missingRequirements: z.array(z.string()),
  suspiciousPatterns: z.array(z.string()),
  evidence: z.array(z.string()),
  summary: z.string(),
})

export type ArchitectureComplianceResult = z.infer<
  typeof architectureComplianceResultSchema
>

const SECRET_PATTERNS =
  /(OPENAI_API_KEY|CLERK_SECRET_KEY|E2B_API_KEY|sk-[a-zA-Z0-9]{10,}|Bearer\s+[A-Za-z0-9._-]{20,})/gi

function sanitize(text: string, max = 220): string {
  return text
    .replace(SECRET_PATTERNS, '[REDACTED]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

type ProjectIndex = {
  files: FragmentFile[]
  paths: string[]
  blob: string
  pathBlob: string
  deps: string
  templateId: string
}

function buildIndex(
  fragment: FragmentSchema | { template?: string; code?: any; additional_dependencies?: string[] },
): ProjectIndex {
  const files = getFragmentFiles(fragment)
  const paths = files.map((f) => f.file_path.replace(/\\/g, '/'))
  const blob = files.map((f) => f.file_content).join('\n')
  const pathBlob = paths.join('\n').toLowerCase()
  const deps = (fragment.additional_dependencies || []).join(' ').toLowerCase()
  const templateId = getTemplateId(
    typeof fragment.template === 'string' ? fragment.template : '',
  )
  return { files, paths, blob, pathBlob, deps, templateId }
}

function hasPath(idx: ProjectIndex, re: RegExp): boolean {
  return idx.paths.some((p) => re.test(p))
}

function contentMatches(idx: ProjectIndex, re: RegExp): boolean {
  return re.test(idx.blob)
}

function findPathEvidence(idx: ProjectIndex, re: RegExp): string | undefined {
  const hit = idx.paths.find((p) => re.test(p))
  return hit ? `file:${hit}` : undefined
}

function check(
  id: string,
  requirement: string,
  status: ComplianceCheckStatus,
  severity: ComplianceSeverity,
  evidence: string,
): ArchitectureComplianceCheck {
  return {
    id,
    requirement,
    status,
    severity,
    evidence: sanitize(evidence),
  }
}

function na(
  id: string,
  requirement: string,
  why: string,
): ArchitectureComplianceCheck {
  return check(id, requirement, 'not_applicable', 'low', why)
}

/** Frontend entry appropriate to template. */
export function detectFrontend(idx: ProjectIndex): {
  ok: boolean
  evidence: string
} {
  const t = idx.templateId
  if (t === 'code-interpreter-v1') {
    const ok =
      hasPath(idx, /\.py$/i) || contentMatches(idx, /\b(def|import)\b/)
    return {
      ok,
      evidence: ok
        ? findPathEvidence(idx, /\.py$/i) || 'python source present'
        : 'No Python entry found',
    }
  }
  if (t.includes('vue')) {
    const ok =
      hasPath(idx, /(^|\/)(app\.vue|pages\/|components\/)/i) ||
      contentMatches(idx, /<template[\s>]/)
    return {
      ok,
      evidence: ok
        ? findPathEvidence(idx, /(app\.vue|pages\/)/i) || 'Vue SFC present'
        : 'No Vue app entry found',
    }
  }
  if (t.includes('streamlit')) {
    const ok =
      hasPath(idx, /app\.py$/i) || contentMatches(idx, /\bst\./)
    return {
      ok,
      evidence: ok
        ? findPathEvidence(idx, /\.py$/i) || 'streamlit usage'
        : 'No Streamlit entry found',
    }
  }
  if (t.includes('gradio')) {
    const ok =
      contentMatches(idx, /\bdemo\s*=/) || contentMatches(idx, /gradio/i)
    return {
      ok,
      evidence: ok
        ? findPathEvidence(idx, /\.py$/i) || 'gradio demo present'
        : 'No Gradio demo found',
    }
  }
  // Next.js / default web
  const ok =
    hasPath(idx, /(^|\/)pages\/.+\.(tsx|jsx|ts|js)$/i) ||
    hasPath(idx, /(^|\/)app\/.+page\.(tsx|jsx|ts|js)$/i) ||
    hasPath(idx, /(^|\/)(index|page)\.(tsx|jsx)$/i) ||
    contentMatches(idx, /export\s+default\s+function/)
  return {
    ok,
    evidence: ok
      ? findPathEvidence(
          idx,
          /(pages\/|app\/.*page\.|index\.(tsx|jsx))/i,
        ) || 'React/Next entry present'
      : 'No frontend entry (pages/ or app/) found',
  }
}

export function detectState(idx: ProjectIndex): {
  ok: boolean
  evidence: string
} {
  const patterns = [
    /\buseState\s*\(/,
    /\buseReducer\s*\(/,
    /\bcreateContext\s*\(/,
    /\buseContext\s*\(/,
    /\bcreateStore\b/,
    /\bzustand\b/i,
    /\bpinia\b/i,
    /\bvuex\b/i,
    /\bref\s*\(/,
    /\breactive\s*\(/,
    /\bst\.session_state\b/,
    /\bsignal\s*\(/,
  ]
  for (const re of patterns) {
    if (re.test(idx.blob)) {
      return { ok: true, evidence: `matched ${re.source}` }
    }
  }
  return { ok: false, evidence: 'No client state primitives detected' }
}

export function detectLocalPersistence(idx: ProjectIndex): {
  ok: boolean
  evidence: string
} {
  const patterns = [
    /\blocalStorage\b/,
    /\bsessionStorage\b/,
    /\bindexedDB\b/i,
    /\bopenDB\s*\(/,
    /\bidb\b/i,
    /\bDexie\b/,
  ]
  for (const re of patterns) {
    if (re.test(idx.blob)) {
      return { ok: true, evidence: `matched ${re.source}` }
    }
  }
  return { ok: false, evidence: 'No local persistence API detected' }
}

/** Real server/API surface — not a client setState helper. */
export function detectBackend(idx: ProjectIndex): {
  ok: boolean
  evidence: string
} {
  const pathHit =
    hasPath(idx, /(^|\/)pages\/api\//i) ||
    hasPath(idx, /(^|\/)app\/api\//i) ||
    hasPath(idx, /(^|\/)api\/.+\.(ts|js|py)$/i) ||
    hasPath(idx, /(^|\/)(server|backend)\//i) ||
    hasPath(idx, /route\.(ts|js)$/i)

  const contentHit =
    contentMatches(idx, /['"]use server['"]/) ||
    contentMatches(idx, /\bexport\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE)\b/) ||
    contentMatches(idx, /\b(FastAPI|APIRouter|flask|@app\.(route|get|post))\b/i) ||
    contentMatches(idx, /\bNextApiRequest\b/) ||
    contentMatches(idx, /\bcreateServerClient\b/)

  if (pathHit || contentHit) {
    return {
      ok: true,
      evidence:
        findPathEvidence(
          idx,
          /(pages\/api\/|app\/api\/|server\/|route\.(ts|js)$)/i,
        ) || 'server/API handlers present',
    }
  }
  return { ok: false, evidence: 'No API routes / server modules detected' }
}

export function detectDatabase(idx: ProjectIndex): {
  ok: boolean
  evidence: string
  dependencyOnly: boolean
} {
  const configPath =
    hasPath(idx, /prisma\/schema\.prisma$/i) ||
    hasPath(idx, /drizzle(\.|\/)/i) ||
    hasPath(idx, /(schema|models)\/.+\.(ts|js|py)$/i) ||
    hasPath(idx, /migrations?\//i)

  const usage =
    contentMatches(idx, /\bPrismaClient\b/) ||
    contentMatches(idx, /\bprisma\.\w+\./) ||
    contentMatches(idx, /\bdrizzle(-orm)?\b/i) ||
    contentMatches(idx, /\bmongoose\b/) ||
    contentMatches(idx, /\bTypeORM\b|\bDataSource\b/) ||
    contentMatches(idx, /\bsequelize\b/i) ||
    contentMatches(idx, /\bsqlalchemy\b/i) ||
    contentMatches(idx, /\bcreateClient\s*\([^)]*supabase/i) ||
    contentMatches(idx, /\bDATABASE_URL\b/) ||
    contentMatches(idx, /\bnew\s+Pool\s*\(/) ||
    contentMatches(idx, /\bpg\.Pool\b|\bfrom\s+['"]pg['"]/) ||
    contentMatches(idx, /\bmongodb(\+srv)?:\/\//i) ||
    contentMatches(idx, /\bdb\.(query|insert|select|execute)\b/i)

  const depOnly =
    !configPath &&
    !usage &&
    /\b(prisma|drizzle-orm|mongoose|typeorm|sequelize|pg|mysql2|supabase)\b/.test(
      idx.deps,
    )

  if (configPath || usage) {
    return {
      ok: true,
      dependencyOnly: false,
      evidence:
        findPathEvidence(
          idx,
          /(prisma\/schema|drizzle|migrations?\/|models\/)/i,
        ) || 'database client/schema usage detected',
    }
  }
  if (depOnly) {
    return {
      ok: false,
      dependencyOnly: true,
      evidence:
        'DB-related dependency listed but no schema/client usage found',
    }
  }
  return {
    ok: false,
    dependencyOnly: false,
    evidence: 'No database schema/client/repository evidence',
  }
}

export function detectMockOnlyBusinessData(idx: ProjectIndex): {
  suspicious: boolean
  patterns: string[]
  evidence: string
} {
  const patterns: string[] = []
  if (hasPath(idx, /mock[-_]?data\.(ts|js|tsx|jsx|json)$/i)) {
    patterns.push('mock-data file')
  }
  if (contentMatches(idx, /\b(MOCK_|FAKE_|dummy)(DATA|DB|USERS|MEMBERS|PRODUCTS)\b/i)) {
    patterns.push('MOCK_/FAKE_ data constants')
  }
  if (
    contentMatches(
      idx,
      /\b(const|let|var)\s+\w*(members|products|orders|users|tasks|contacts)\w*\s*=\s*\[\s*\{/i,
    )
  ) {
    patterns.push('hardcoded business array literal')
  }
  if (
    contentMatches(idx, /\bexport\s+const\s+\w+\s*=\s*\[[\s\S]{0,200}\{\s*id:/) &&
    !detectDatabase(idx).ok
  ) {
    patterns.push('exported seed-like arrays without DB layer')
  }

  // localStorage as sole "DB" while scanning for mock patterns
  const localOnlyPrimary =
    detectLocalPersistence(idx).ok &&
    !detectBackend(idx).ok &&
    !detectDatabase(idx).ok

  if (localOnlyPrimary && patterns.length > 0) {
    patterns.push('localStorage/mock without server persistence')
  }

  return {
    suspicious: patterns.length > 0,
    patterns,
    evidence: patterns.join('; ') || 'none',
  }
}

export function detectAuthentication(idx: ProjectIndex): {
  ok: boolean
  evidence: string
  fakeOnly: boolean
} {
  const real =
    contentMatches(idx, /\b(NextAuth|next-auth|getServerSession|auth\()\b/) ||
    contentMatches(idx, /\b(@clerk\/|clerkClient|currentUser|auth\(\))\b/) ||
    contentMatches(idx, /\b(lucia|better-auth|supabase\.auth)\b/i) ||
    contentMatches(idx, /\b(signIn|signOut|getSession)\s*\(/) ||
    contentMatches(idx, /\bjwt\.(sign|verify)\b/i) ||
    contentMatches(idx, /\bbcrypt\b/) ||
    hasPath(idx, /(^|\/)(auth|lib\/auth)/i) ||
    hasPath(idx, /middleware\.(ts|js)$/i)

  const fakeOnly =
    !real &&
    (contentMatches(idx, /\bisLoggedIn\s*=\s*true\b/) ||
      contentMatches(idx, /\bfake(Login|Auth|User)\b/i) ||
      contentMatches(idx, /\bsetUser\(\s*\{\s*name:/))

  if (real) {
    return {
      ok: true,
      fakeOnly: false,
      evidence:
        findPathEvidence(idx, /(auth|middleware)/i) ||
        'auth provider/session primitives present',
    }
  }
  return {
    ok: false,
    fakeOnly,
    evidence: fakeOnly
      ? 'Only fake login flags detected (e.g. isLoggedIn=true)'
      : 'No authentication infrastructure detected',
  }
}

export function detectAuthorization(
  idx: ProjectIndex,
  roles: string[],
): { ok: boolean; evidence: string; clientOnly: boolean } {
  const roleHits = roles.filter((r) =>
    new RegExp(
      `\\b${r.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`,
      'i',
    ).test(idx.blob),
  )

  const serverAuthz =
    contentMatches(
      idx,
      /\b(requireRole|hasRole|hasPermission|checkPermission|authorize)\s*\(/i,
    ) ||
    contentMatches(
      idx,
      /\b(role|roles)\s*(===|!==|includes|in)\b/,
    ) ||
    (hasPath(idx, /(pages\/api\/|app\/api\/|server\/)/i) &&
      roleHits.length > 0 &&
      contentMatches(idx, /\b(role|roles|permission)/i))

  const clientRoleUi =
    contentMatches(idx, /<select[^>]*>[\s\S]*role/i) ||
    contentMatches(idx, /\brole\s*===\s*['"]admin['"]/) ||
    roleHits.length > 0

  if (serverAuthz && roleHits.length > 0) {
    return {
      ok: true,
      clientOnly: false,
      evidence: `roles referenced (${roleHits.join(', ')}) with server-side checks`,
    }
  }
  if (serverAuthz) {
    return {
      ok: true,
      clientOnly: false,
      evidence: 'permission/role helpers on server surface',
    }
  }
  if (clientRoleUi) {
    return {
      ok: false,
      clientOnly: true,
      evidence: 'Role UI/client checks only — no server authorization evidence',
    }
  }
  return {
    ok: false,
    clientOnly: false,
    evidence: 'No role/permission enforcement detected',
  }
}

export function detectFileStorage(idx: ProjectIndex): {
  ok: boolean
  evidence: string
} {
  const ok =
    contentMatches(idx, /\b(multer|formidable|uploadthing|@aws-sdk\/client-s3|S3Client|putObject)\b/i) ||
    contentMatches(idx, /\b(FormData|file\.arrayBuffer|createWriteStream)\b/) ||
    hasPath(idx, /upload/i)
  return {
    ok,
    evidence: ok
      ? findPathEvidence(idx, /upload/i) || 'upload/storage primitives present'
      : 'No file storage/upload architecture detected',
  }
}

export function detectExternalServices(
  idx: ProjectIndex,
  services: string[],
): { ok: boolean; evidence: string } {
  if (!services.length) {
    return { ok: false, evidence: 'No services listed' }
  }
  const hits: string[] = []
  for (const s of services) {
    const key = s.toLowerCase()
    const re =
      key.includes('payment') || key.includes('stripe')
        ? /\b(stripe|Stripe|payments?)\b/
        : new RegExp(
            `\\b${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`,
            'i',
          )
    if (re.test(idx.blob) || re.test(idx.deps) || re.test(idx.pathBlob)) {
      hits.push(s)
    }
  }
  // Env scaffolding for listed services
  const envHit =
    hasPath(idx, /\.env\.example$/i) &&
    contentMatches(idx, /(STRIPE_|PAYMENT_|RESEND_|TWILIO_|API_KEY=)/i)

  if (hits.length > 0 || envHit) {
    return {
      ok: true,
      evidence: hits.length
        ? `integration scaffolding for: ${hits.join(', ')}`
        : '.env.example references external service placeholders',
    }
  }
  return {
    ok: false,
    evidence: `No scaffolding for required services: ${services.join(', ')}`,
  }
}

export function detectEntities(
  idx: ProjectIndex,
  entities: string[],
): { found: string[]; missing: string[] } {
  const found: string[] = []
  const missing: string[] = []
  for (const e of entities) {
    const re = new RegExp(
      `\\b${e.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`,
      'i',
    )
    if (re.test(idx.blob) || re.test(idx.pathBlob)) found.push(e)
    else missing.push(e)
  }
  return { found, missing }
}

export function detectRelationships(
  idx: ProjectIndex,
  relationships: ArchitectureRequirements['relationships'],
): { ok: boolean; evidence: string } {
  if (!relationships.length) {
    return { ok: true, evidence: 'No relationships specified' }
  }
  let hits = 0
  for (const r of relationships) {
    const from = r.from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const to = r.to.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const pair = new RegExp(`${from}[\\s\\S]{0,80}${to}|${to}[\\s\\S]{0,80}${from}`, 'i')
    const relApi =
      /\b(hasMany|hasOne|belongsTo|manyToMany|@relation|ForeignKey|references\s*\()/i
    if (pair.test(idx.blob) || (relApi.test(idx.blob) && new RegExp(from, 'i').test(idx.blob))) {
      hits++
    }
  }
  const ok = hits >= Math.ceil(relationships.length / 2)
  return {
    ok,
    evidence: ok
      ? `${hits}/${relationships.length} relationships evidenced`
      : `Only ${hits}/${relationships.length} relationships evidenced`,
  }
}

function hasEnvExample(idx: ProjectIndex): boolean {
  return hasPath(idx, /\.env\.example$/i) || hasPath(idx, /env\.example$/i)
}

function hasReadme(idx: ProjectIndex): boolean {
  return hasPath(idx, /(^|\/)README(\.md)?$/i)
}

function overallStatus(
  checks: ArchitectureComplianceCheck[],
): ComplianceOverallStatus {
  const relevant = checks.filter((c) => c.status !== 'not_applicable')
  const criticalFail = relevant.some(
    (c) => c.status === 'fail' && c.severity === 'critical',
  )
  if (criticalFail) return 'failed'
  const anyFail = relevant.some((c) => c.status === 'fail')
  const warnings = relevant.some((c) => c.status === 'warning')
  if (anyFail) return 'partial'
  if (warnings) return 'partial'
  return 'passed'
}

/**
 * Deterministic architecture compliance against generated files.
 * No LLM. No E2B. Requirement-driven.
 */
export function checkArchitectureCompliance(input: {
  fragment: FragmentSchema | any
  plan?: ApplicationPlan | null
  architecture?: ArchitectureRequirements | null
}): ArchitectureComplianceResult {
  const idx = buildIndex(input.fragment || {})
  const arch = normalizeArchitectureRequirements(
    input.architecture ||
      input.plan?.architectureRequirements ||
      inferArchitectureRequirements({
        needsAuth: input.plan?.needsAuth,
        needsBackend: input.plan?.needsBackend,
        dataApproach: input.plan?.dataApproach,
        complexity: input.plan?.complexity,
        applicationType: input.plan?.applicationType,
        productGoal: input.plan?.productGoal,
      }),
  )

  const checks: ArchitectureComplianceCheck[] = []
  const missingRequirements: string[] = []
  const suspiciousPatterns: string[] = []
  const evidence: string[] = []

  // Frontend
  if (arch.frontend.required !== false) {
    const fe = detectFrontend(idx)
    checks.push(
      check(
        'frontend',
        'Frontend entrypoint',
        fe.ok ? 'pass' : 'fail',
        'critical',
        fe.evidence,
      ),
    )
    if (!fe.ok) missingRequirements.push('frontend')
    else evidence.push(fe.evidence)
  } else {
    checks.push(na('frontend', 'Frontend entrypoint', 'Not required'))
  }

  // State
  if (arch.state.required) {
    const st = detectState(idx)
    checks.push(
      check(
        'state',
        'Client state',
        st.ok ? 'pass' : 'fail',
        'medium',
        st.evidence,
      ),
    )
    if (!st.ok) missingRequirements.push('state')
  } else {
    checks.push(na('state', 'Client state', 'Not required by plan'))
  }

  // Local persistence
  if (arch.persistence.required && arch.persistence.strategy === 'local') {
    const lp = detectLocalPersistence(idx)
    checks.push(
      check(
        'persistence_local',
        'Local persistence',
        lp.ok ? 'pass' : 'fail',
        'high',
        lp.evidence,
      ),
    )
    if (!lp.ok) missingRequirements.push('local persistence')
  } else if (arch.persistence.strategy === 'none' || !arch.persistence.required) {
    checks.push(
      na(
        'persistence_local',
        'Local persistence',
        'Plan does not require local persistence',
      ),
    )
  }

  // Backend
  if (arch.backend.required) {
    const be = detectBackend(idx)
    checks.push(
      check(
        'backend',
        'Backend / API',
        be.ok ? 'pass' : 'fail',
        'critical',
        be.evidence,
      ),
    )
    if (!be.ok) missingRequirements.push('backend')
  } else {
    const be = detectBackend(idx)
    if (be.ok) {
      checks.push(
        check(
          'backend',
          'Backend / API',
          'warning',
          'low',
          `Backend present but not required — ${be.evidence}`,
        ),
      )
    } else {
      checks.push(na('backend', 'Backend / API', 'Not required by plan'))
    }
  }

  // Database
  if (arch.database.required) {
    const db = detectDatabase(idx)
    const mock = detectMockOnlyBusinessData(idx)
    if (db.ok) {
      checks.push(
        check(
          'database',
          `Database (${arch.database.type})`,
          'pass',
          'critical',
          db.evidence,
        ),
      )
      evidence.push(db.evidence)
      // Seed/mock fixtures alongside a real DB layer are legitimate.
      checks.push(
        check(
          'database_mock',
          'Mock data vs real DB',
          'pass',
          'low',
          mock.suspicious
            ? `Seed/mock fixtures present with real DB (OK): ${mock.evidence}`
            : 'No mock-only replacement detected',
        ),
      )
    } else {
      checks.push(
        check(
          'database',
          `Database (${arch.database.type})`,
          'fail',
          'critical',
          db.dependencyOnly
            ? db.evidence
            : db.evidence,
        ),
      )
      missingRequirements.push('database')
      if (db.dependencyOnly) {
        suspiciousPatterns.push('dependency-without-usage')
      }
      if (mock.suspicious) {
        checks.push(
          check(
            'database_mock',
            'Mock data vs real DB',
            'fail',
            'critical',
            `Database required but mock-only patterns found: ${mock.evidence}`,
          ),
        )
        suspiciousPatterns.push(...mock.patterns)
        missingRequirements.push('real persistence (mock-only)')
      } else {
        checks.push(
          check(
            'database_mock',
            'Mock data vs real DB',
            'fail',
            'high',
            'No DB layer and no clear seed-vs-mock distinction',
          ),
        )
      }
    }
  } else {
    const db = detectDatabase(idx)
    if (db.ok) {
      checks.push(
        check(
          'database',
          'Database',
          'warning',
          'medium',
          `Unnecessary database infrastructure for this plan — ${db.evidence}`,
        ),
      )
      suspiciousPatterns.push('unnecessary-database')
    } else {
      checks.push(na('database', 'Database', 'Not required by plan'))
    }
    checks.push(
      na('database_mock', 'Mock data vs real DB', 'Database not required'),
    )
  }

  // Server persistence without calling it database — still need backend when strategy=server
  if (arch.persistence.strategy === 'server' && arch.backend.required) {
    const be = detectBackend(idx)
    if (!be.ok) {
      // already failed backend check; add persistence note
      checks.push(
        check(
          'persistence_server',
          'Server persistence',
          'fail',
          'critical',
          'Server persistence required but no backend surface found',
        ),
      )
      missingRequirements.push('server persistence')
    } else if (!arch.database.required) {
      checks.push(
        check(
          'persistence_server',
          'Server persistence',
          'pass',
          'high',
          be.evidence,
        ),
      )
    } else {
      const db = detectDatabase(idx)
      checks.push(
        check(
          'persistence_server',
          'Server persistence',
          db.ok ? 'pass' : 'fail',
          'critical',
          db.ok ? db.evidence : 'Server persistence needs a data layer',
        ),
      )
    }
  } else {
    checks.push(
      na(
        'persistence_server',
        'Server persistence',
        'Not required by plan',
      ),
    )
  }

  // Authentication
  if (arch.authentication.required) {
    const auth = detectAuthentication(idx)
    checks.push(
      check(
        'authentication',
        'Authentication',
        auth.ok ? 'pass' : 'fail',
        'critical',
        auth.evidence,
      ),
    )
    if (!auth.ok) {
      missingRequirements.push('authentication')
      if (auth.fakeOnly) suspiciousPatterns.push('fake-login')
    }
  } else {
    checks.push(na('authentication', 'Authentication', 'Not required by plan'))
  }

  // Authorization
  if (arch.authorization.required) {
    const az = detectAuthorization(idx, arch.authorization.roles || [])
    if (az.ok) {
      checks.push(
        check(
          'authorization',
          'Authorization / roles',
          'pass',
          'high',
          az.evidence,
        ),
      )
    } else if (az.clientOnly) {
      checks.push(
        check(
          'authorization',
          'Authorization / roles',
          'fail',
          'high',
          az.evidence,
        ),
      )
      missingRequirements.push('server-side authorization')
      suspiciousPatterns.push('client-only-roles')
    } else {
      checks.push(
        check(
          'authorization',
          'Authorization / roles',
          'fail',
          'high',
          az.evidence,
        ),
      )
      missingRequirements.push('authorization')
    }
  } else {
    checks.push(na('authorization', 'Authorization / roles', 'Not required'))
  }

  // File storage
  if (arch.fileStorage.required) {
    const fs = detectFileStorage(idx)
    checks.push(
      check(
        'file_storage',
        'File storage',
        fs.ok ? 'pass' : 'fail',
        'high',
        fs.evidence,
      ),
    )
    if (!fs.ok) missingRequirements.push('file storage')
  } else {
    checks.push(na('file_storage', 'File storage', 'Not required'))
  }

  // External services
  if (arch.externalServices.required) {
    const ex = detectExternalServices(idx, arch.externalServices.services || [])
    checks.push(
      check(
        'external_services',
        'External services',
        ex.ok ? 'pass' : 'fail',
        'high',
        ex.evidence,
      ),
    )
    if (!ex.ok) missingRequirements.push('external services')
  } else {
    checks.push(na('external_services', 'External services', 'Not required'))
  }

  // Entities
  if (arch.entities.length > 0 && (arch.database.required || arch.backend.required)) {
    const ent = detectEntities(idx, arch.entities)
    const ratio = ent.found.length / arch.entities.length
    if (ratio >= 0.6) {
      checks.push(
        check(
          'entities',
          'Core entities',
          'pass',
          'medium',
          `Found ${ent.found.join(', ') || 'none'}${ent.missing.length ? `; missing ${ent.missing.join(', ')}` : ''}`,
        ),
      )
    } else if (ent.found.length > 0) {
      checks.push(
        check(
          'entities',
          'Core entities',
          'fail',
          'high',
          `Missing many entities: ${ent.missing.join(', ')}`,
        ),
      )
      missingRequirements.push(...ent.missing.map((m) => `entity:${m}`))
    } else {
      checks.push(
        check(
          'entities',
          'Core entities',
          'fail',
          'high',
          `None of [${arch.entities.join(', ')}] found`,
        ),
      )
      missingRequirements.push('core entities')
    }
  } else {
    checks.push(na('entities', 'Core entities', 'Not required / none listed'))
  }

  // Relationships
  if (arch.relationships.length > 0 && arch.database.required) {
    const rel = detectRelationships(idx, arch.relationships)
    checks.push(
      check(
        'relationships',
        'Entity relationships',
        rel.ok ? 'pass' : 'fail',
        'medium',
        rel.evidence,
      ),
    )
    if (!rel.ok) missingRequirements.push('relationships')
  } else {
    checks.push(na('relationships', 'Entity relationships', 'Not required'))
  }

  // Env / README for infrastructure
  const needsInfra =
    arch.backend.required ||
    arch.database.required ||
    arch.authentication.required ||
    arch.externalServices.required ||
    arch.fileStorage.required

  if (needsInfra) {
    if (hasEnvExample(idx)) {
      checks.push(
        check(
          'env_example',
          '.env.example',
          'pass',
          'medium',
          findPathEvidence(idx, /\.env\.example$/i) || '.env.example present',
        ),
      )
    } else {
      checks.push(
        check(
          'env_example',
          '.env.example',
          'warning',
          'medium',
          'Infrastructure required but .env.example missing',
        ),
      )
    }
    if (hasReadme(idx)) {
      checks.push(
        check(
          'readme',
          'Setup documentation',
          'pass',
          'low',
          findPathEvidence(idx, /README/i) || 'README present',
        ),
      )
    } else {
      checks.push(
        check(
          'readme',
          'Setup documentation',
          'warning',
          'medium',
          'Infrastructure required but README missing',
        ),
      )
    }
  } else {
    checks.push(na('env_example', '.env.example', 'No infra config required'))
    checks.push(na('readme', 'Setup documentation', 'Optional for simple apps'))
  }

  const status = overallStatus(checks)
  const failedCritical = checks.filter(
    (c) => c.status === 'fail' && c.severity === 'critical',
  )
  const summary =
    status === 'passed'
      ? 'Architecture matches planned requirements'
      : status === 'partial'
        ? `Architecture partially matches (${checks.filter((c) => c.status === 'warning' || c.status === 'fail').length} issues)`
        : `Architecture compliance failed: ${failedCritical.map((c) => c.requirement).join(', ') || missingRequirements.join(', ')}`

  const result: ArchitectureComplianceResult = {
    status,
    checks,
    missingRequirements: Array.from(new Set(missingRequirements)),
    suspiciousPatterns: Array.from(new Set(suspiciousPatterns)),
    evidence: evidence.slice(0, 12).map((e) => sanitize(e)),
    summary: sanitize(summary, 400),
  }

  const parsed = architectureComplianceResultSchema.safeParse(result)
  if (!parsed.success) {
    return {
      status: 'failed',
      checks: [
        check(
          'internal',
          'Compliance result',
          'fail',
          'critical',
          'Malformed compliance result',
        ),
      ],
      missingRequirements: ['internal'],
      suspiciousPatterns: [],
      evidence: [],
      summary: 'Malformed compliance result',
    }
  }
  return parsed.data
}

export function formatArchitectureComplianceForJudge(
  result?: ArchitectureComplianceResult | null,
): string {
  if (!result) return 'Architecture compliance: (not run)'
  const fails = result.checks.filter((c) => c.status === 'fail')
  const warns = result.checks.filter((c) => c.status === 'warning')
  const lines = result.checks
    .filter((c) => c.status !== 'not_applicable')
    .map(
      (c) =>
        `- ${c.requirement} [${c.severity}]: ${c.status.toUpperCase()} — ${c.evidence}`,
    )
  return `Architecture compliance: ${result.status.toUpperCase()}
${result.summary}
Missing: ${result.missingRequirements.join('; ') || 'none'}
Suspicious: ${result.suspiciousPatterns.join('; ') || 'none'}
Fails: ${fails.length}; Warnings: ${warns.length}
${lines.join('\n')}`
}

/** Rank delta for winner guard: critical architecture fail is heavily penalized. */
export function architectureComplianceRankDelta(
  result?: ArchitectureComplianceResult | null,
): number {
  if (!result) return 0
  if (result.status === 'passed') return 3
  if (result.status === 'partial') {
    const critical = result.checks.some(
      (c) => c.status === 'fail' && c.severity === 'critical',
    )
    return critical ? -4 : 0
  }
  return -5
}

export function hasCriticalArchitectureFailure(
  result?: ArchitectureComplianceResult | null,
): boolean {
  if (!result) return false
  if (result.status === 'failed') return true
  return result.checks.some(
    (c) => c.status === 'fail' && c.severity === 'critical',
  )
}

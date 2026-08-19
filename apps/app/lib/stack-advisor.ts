/**
 * Deterministic stack advisor — no LLM.
 * Classifies the prompt + ApplicationPlan, then picks 3 catalog templates.
 */
import type { ApplicationPlan } from '@/lib/plan'
import {
  getTemplateId,
  stackLabelForTemplate,
  type Templates,
} from '@/lib/templates'

export type AppStackKind =
  | 'data-dashboard'
  | 'machine-learning'
  | 'python-script'
  | 'fullstack-webapp'
  | 'landing-page'
  | 'unknown'

export type StackPick = {
  templateId: string
  baseId: string
  stackLabel: string
  repeated: boolean
}

export type StackAdvice = {
  kind: AppStackKind
  picks: StackPick[]
}

const PREFERRED_BY_KIND: Record<AppStackKind, readonly string[]> = {
  'data-dashboard': [
    'streamlit-developer',
    'gradio-developer',
    'nextjs-developer',
  ],
  'machine-learning': [
    'streamlit-developer',
    'gradio-developer',
    'code-interpreter-v1',
  ],
  'python-script': [
    'streamlit-developer',
    'gradio-developer',
    'code-interpreter-v1',
  ],
  'fullstack-webapp': ['nextjs-developer', 'vue-developer'],
  'landing-page': ['nextjs-developer', 'vue-developer'],
  unknown: ['nextjs-developer', 'vue-developer', 'streamlit-developer'],
}

const FILL_ORDER = [
  'nextjs-developer',
  'vue-developer',
  'streamlit-developer',
  'gradio-developer',
  'code-interpreter-v1',
] as const

const WEB_BASES = ['nextjs-developer', 'vue-developer'] as const

const ADVICE_CACHE = new Map<string, StackAdvice>()
const ADVICE_CACHE_MAX = 80

export function clearStackAdvisorCache(): void {
  ADVICE_CACHE.clear()
}

function corpus(prompt?: string | null, plan?: ApplicationPlan | null): string {
  return [
    prompt || '',
    plan?.applicationType || '',
    plan?.productName || '',
    plan?.productGoal || '',
    plan?.problemStatement || '',
    ...(plan?.coreFeatures || []),
  ]
    .join('\n')
    .toLowerCase()
}

function planNeedsWebStack(plan?: ApplicationPlan | null): boolean {
  const arch = plan?.architectureRequirements
  return !!(
    arch?.backend?.required ||
    arch?.database?.required ||
    arch?.authentication?.required
  )
}

export function classifyAppStack(opts: {
  prompt?: string | null
  plan?: ApplicationPlan | null
}): AppStackKind {
  const text = corpus(opts.prompt, opts.plan)
  const type = (opts.plan?.applicationType || '').toLowerCase()

  if (
    planNeedsWebStack(opts.plan) ||
    /\b(saas|crm|e-?commerce|admin panel|multi-user|full-?stack)\b/.test(text) ||
    /saas|crm|e-?commerce|admin panel/.test(type)
  ) {
    return 'fullstack-webapp'
  }
  if (
    /\b(machine[- ]learning|neural net|pytorch|tensorflow|scikit|sklearn|train a model|classifier|fine-?tun(?:e|ing))\b/.test(
      text,
    )
  ) {
    return 'machine-learning'
  }
  if (
    /\b(python script|jupyter|notebook|pandas|data analysis)\b/.test(text) &&
    !/\b(dashboard|web app|website)\b/.test(text)
  ) {
    return 'python-script'
  }
  if (
    /\b(dashboard|csv|analytics|visuali[sz]e|chart|plotly|spreadsheet|metrics board)\b/.test(
      text,
    )
  ) {
    return 'data-dashboard'
  }
  if (
    /\b(landing page|marketing site|portfolio site|waitlist|coming soon|brochure)\b/.test(
      text,
    )
  ) {
    return 'landing-page'
  }
  return 'unknown'
}

function catalogKeyForBase(catalog: Templates, base: string): string | undefined {
  const want = getTemplateId(base)
  return Object.keys(catalog).find((key) => getTemplateId(key) === want)
}

function cacheKey(
  prompt: string | null | undefined,
  plan: ApplicationPlan | null | undefined,
  catalogKeys: string[],
): string {
  const arch = plan?.architectureRequirements
  const raw = JSON.stringify({
    p: (prompt || '').trim().slice(0, 2000),
    t: plan?.applicationType || '',
    g: plan?.productGoal || '',
    f: (plan?.coreFeatures || []).slice(0, 8),
    b: !!arch?.backend?.required,
    d: !!arch?.database?.required,
    a: !!arch?.authentication?.required,
    c: catalogKeys.slice().sort(),
  })
  let h = 0
  for (let i = 0; i < raw.length; i++) {
    h = (Math.imul(31, h) + raw.charCodeAt(i)) | 0
  }
  return `${h.toString(16)}:${raw.length}`
}

function remember(key: string, advice: StackAdvice): StackAdvice {
  if (ADVICE_CACHE.size >= ADVICE_CACHE_MAX) {
    const oldest = ADVICE_CACHE.keys().next().value
    if (oldest) ADVICE_CACHE.delete(oldest)
  }
  ADVICE_CACHE.set(key, advice)
  return advice
}

/**
 * Ranked 3-template assignment from the live E2B catalog.
 * Repeats only when fewer than 3 suitable templates exist.
 */
export function adviseStacks(opts: {
  prompt?: string | null
  plan?: ApplicationPlan | null
  catalog: Templates
  count?: number
}): StackAdvice {
  const catalog = opts.catalog
  const keys = Object.keys(catalog)
  const count = Math.max(1, opts.count ?? 3)
  const key = cacheKey(opts.prompt, opts.plan, keys)
  const hit = ADVICE_CACHE.get(key)
  if (hit && hit.picks.length === count) return hit

  const kind = classifyAppStack({ prompt: opts.prompt, plan: opts.plan })
  const preferred = PREFERRED_BY_KIND[kind]
  const fill =
    kind === 'fullstack-webapp' || kind === 'landing-page'
      ? [...WEB_BASES]
      : [...FILL_ORDER]

  const resolved: string[] = []
  const seen = new Set<string>()
  const pushBase = (base: string) => {
    const catalogKey = catalogKeyForBase(catalog, base)
    if (!catalogKey || seen.has(catalogKey)) return
    seen.add(catalogKey)
    resolved.push(catalogKey)
  }
  for (const base of preferred) pushBase(base)
  for (const base of fill) {
    if (resolved.length >= count) break
    pushBase(base)
  }
  if (!resolved.length && keys[0]) resolved.push(keys[0])

  const picks: StackPick[] = []
  for (let i = 0; i < count; i++) {
    const templateId = resolved[i] || resolved[i % resolved.length] || keys[0] || ''
    const repeated = i >= resolved.length || picks.some((p) => p.templateId === templateId)
    const baseId = getTemplateId(templateId)
    const label = stackLabelForTemplate(templateId)
    picks.push({
      templateId,
      baseId,
      stackLabel: repeated ? `${label} (repeat)` : label,
      repeated,
    })
  }

  return remember(key, { kind, picks })
}

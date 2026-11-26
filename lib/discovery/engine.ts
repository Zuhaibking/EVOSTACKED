/**
 * Adaptive project discovery: raw idea (+ prior answers + current spec) → updated ProjectSpec,
 * what is known/missing, completeness and the next 2–4 highest-value questions.
 * One structured LLM call per round (gpt-4.1 via the server key); heuristic fallback on failure.
 */
import { getModelClient, type LLMModel } from '@/lib/models'
import {
  discoveryQuestionSchema,
  projectSpecSchema,
  type DiscoveryAnswer,
  type DiscoveryQuestion,
  type DiscoveryRequest,
  type DiscoveryResponse,
  type ProjectSpec,
} from '@/lib/platform/types'
import { generateObject, type LanguageModel } from 'ai'
import { z } from 'zod'
import {
  MAX_ROUNDS,
  SKIPPED_ANSWER,
  answeredKeys,
  countAnsweredRounds,
  fallbackQuestions,
  heuristicSpec,
  namingQuestion,
  saysJustBuild,
  specToBrief,
} from './heuristics'

export { SKIPPED_ANSWER, MAX_ROUNDS } from './heuristics'

const DISCOVERY_MODEL: LLMModel = { id: 'gpt-4.1', provider: 'EvoStack', providerId: 'openai', name: 'Asta' }
const LLM_TIMEOUT_MS = 48_000

/** Mirrors DiscoveryResponse (no optional fields — OpenAI strict structured outputs). */
const discoveryLLMSchema = z.object({
  spec: projectSpecSchema,
  known: z.array(z.string()),
  missing: z.array(z.string()),
  completeness: z.number(),
  done: z.boolean(),
  questions: z.array(discoveryQuestionSchema),
  brief: z.string(),
})
type DiscoveryLLMOutput = z.infer<typeof discoveryLLMSchema>

const FIELDS = new Set(['name', 'audience', 'features', 'entities', 'workflows', 'integrations', 'pages', 'brand', 'constraints', 'summary'])

const SYSTEM = `You are EvoStack's principal product strategist. You run ADAPTIVE discovery: in a few short rounds you turn a raw idea into a precise, build-ready ProjectSpec. The spec drives (1) three competing website designs, (2) an isolated backend database + REST API, and (3) an admin Control Center dashboard tailored to the project type. It is not a fixed questionnaire — every question must be earned by THIS idea.

Each round you get the idea, the current spec (or none), every answer so far and the round number. Return the full updated spec, known, missing, completeness, done, the next questions and the brief.

1. projectType — the closest of: ecommerce | saas | restaurant | agency | booking | portfolio | events | education | nonprofit | marketplace | community | custom. (Resale/merch store → ecommerce; clinic/salon appointments → booking; café/restaurant → restaurant.)
2. EXTRACT EVERYTHING already stated or clearly implied by the idea, the answers and the current spec: location, city, currency, audience, offerings, mechanics (drops, raffles, memberships…), named features, brand words. Put it in the spec and list each established fact in "known" (short and concrete, ≤ 12 words, e.g. "Based in Bangalore — prices in INR", "Limited sneaker drops with raffle entries"). "known" holds ONLY what the user actually said (idea or answers) or what follows unambiguously from it — never your own defaults (e.g. a payment provider, operator roles or language the user never mentioned are NOT known). Every answered question yields at least one known fact. Example — idea "a sneaker resale store for Bangalore with drops and raffles": known = ["Sneaker resale store", "Based in Bangalore — prices in INR", "Limited drops", "Raffles for releases"]; NOT "Operators: Owner", "Targets ages 18–35" or "Payments via Razorpay" (those are your assumptions). Carry forward everything in the current spec unless an answer changes it. Apply every answer to the spec field it targets, REPLACING the default (an operator-roles answer replaces audience.operators; a payments answer sets integrations; a name answer sets name).
3. Fill every remaining spec field with smart, specific, industry-standard defaults so the spec is always build-ready. Defaults are assumptions: they are NOT "known"; the most consequential unconfirmed ones go in "missing" (short gap labels, max 8).
4. NEVER ask about anything in "known", anything already answered, or anything skipped. An answer of "${SKIPPED_ANSWER}" means "decide for me": pick a sensible default and never ask it again.
5. Ask the 2–4 highest-value questions — the ones that most change the build (data model, dashboard modules, key website forms, page structure, brand). Each question is ONE concrete decision, grounded in the user's own words (e.g. "For your drops, how should raffle winners be picked?"). Unless the user already gave a name, ask for it by round 2 at the latest: kind "single", field "name", with 3–4 strong, on-brand name ideas as options.
   - kind: "single" (one choice), "multi" (several apply) or "text" (names / free-form specifics only).
   - options: 3–6 short, concrete, mutually distinct answers tailored to the idea, its region and its industry (≤ 7 words each). Never include "Other" — the UI adds it. Use [] for text.
   - why: one line on what the answer changes in the build. placeholder: an example answer for free text.
   - field: the spec area it fills: name | audience | features | entities | workflows | integrations | pages | brand | constraints.
6. Progression — each round must be MORE SPECIFIC than the last and build on previous answers:
   - Round 1: foundations — the core offering and must-have features, target customers, the name (only if not given).
   - Round 2: operations — who runs it (operator roles), key workflows, payments/integrations, policies.
   - Round 3+: specifics & polish — edge cases, content, brand look & feel, constraints.
   Across rounds cover: naming, core features, target users AND operators, integrations, workflows, brand.
7. Type playbooks (adapt to the idea; skip what is known):
   - ecommerce: catalog size & type (variants/sizes, limited drops), fulfilment (shipping / pickup / local delivery), payments (e.g. Razorpay/UPI/COD in India, Stripe elsewhere), discounts & promo codes, returns/exchanges/authenticity.
   - saas: pricing tiers & trial, user roles & teams, the key usage metric, onboarding flow.
   - restaurant: reservations vs online ordering (or both), menu categories & dietary tags, opening hours, delivery/pickup partners.
   - booking: services with durations & prices, staff/practitioners & schedules, deposits & cancellation policy, reminders (SMS/email/WhatsApp).
   - agency: services offered, lead sources, pipeline stages, retainers vs one-off projects.
   - anything else: find the 3–5 decisions that shape the data model and key forms, and ask those.
8. completeness (0–100) = how much of what matters for the build is CONFIRMED by the user (idea + answers), not guessed. A one-line idea is usually 20–40; each answered round adds meaningfully; ≥ 80 means ready to build.
9. done = true when completeness ≥ 80, OR 3+ rounds have been answered, OR the user says to skip / just build. When done, questions = [].
10. Spec quality: features 6–10 with honest priority (must = launch-critical); entities 3–8 singular nouns = database tables (Product, Order, Raffle Entry…); workflows 2–6 (trigger = event, outcome = automated result); integrations = lowercase provider/service slugs, never payment methods (UPI + cards in India → razorpay; card payments elsewhere → stripe; plus email, sms, whatsapp, google-calendar, shiprocket…); pages 4–8 = PUBLIC website pages only (the admin dashboard / Control Center is generated separately — never list it as a page, feature or form); brand.colors = 2–4 hex colors that fit the brand; audience.operators = dashboard roles (Owner, Store manager…); constraints = hard requirements (region, currency, language, legal).
11. brief: a rich, generation-ready brief for the website generator (plain text with short headings, ≤ 450 words): what it is and for whom; a page-by-page plan with the key sections of each page; the forms for key actions with their fields (they submit to the backend and appear in the dashboard — e.g. checkout/order, raffle entry, reservation, appointment, lead); core features; brand tone, style and colors; concrete content (real-sounding product/service names, prices in the right currency, locations). No lorem ipsum, no placeholders.`

function buildPrompt(req: DiscoveryRequest, round: number, answeredRounds: number, forceDone: boolean, justBuild: boolean): string {
  const answers = req.answers.length
    ? req.answers.map((a, i) => `${i + 1}. [${a.questionId}] Q: ${a.question}\n   A: ${a.answer}`).join('\n')
    : '(none yet)'
  const instruction = justBuild
    ? 'The user asked to skip further questions / just build: set done = true and questions = []. Make the spec and brief as complete as possible from what you have; report completeness honestly (it may stay low).'
    : forceDone
      ? `${answeredRounds} rounds have been answered: set done = true and questions = []. Finalize the spec and brief.`
      : `Ask the round ${round} questions (2–4), more specific than any earlier round, never repeating answered or known topics.`
  return `ROUND ${round} · answered rounds so far: ${answeredRounds}

IDEA:
"""${req.idea}"""

CURRENT SPEC:
${req.spec ? JSON.stringify(req.spec) : '(none yet — infer it from the idea)'}

ANSWERS SO FAR:
${answers}

${instruction}`
}

// ───────────────────────── sanitizers ─────────────────────────
const txt = (v: unknown, max: number, fallback = ''): string => {
  const s = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : ''
  return (s || fallback).slice(0, max).trim()
}
function uniqueBy<T>(items: T[], key: (t: T) => string): T[] {
  const seen = new Set<string>()
  return items.filter((item) => {
    const k = key(item).toLowerCase()
    if (!k || seen.has(k)) return false
    seen.add(k)
    return true
  })
}
const list = (v: unknown, maxItems: number, maxLen: number): string[] =>
  Array.isArray(v) ? uniqueBy(v.map((x) => txt(x, maxLen)).filter(Boolean), (s) => s).slice(0, maxItems) : []
const orFallback = <T>(items: T[], fallback: T[]): T[] => (items.length ? items : fallback)
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))
/** The Control Center is generated separately — never a website page or feature. */
const ADMIN_SURFACE = /^(?:(?:admin|owner|staff|store|management)\s+dashboard|admin(?:\s+(?:panel|area|portal))?|control\s+center|back[\s-]?office|cms)$/i

function sanitizeSpec(spec: ProjectSpec, fb: ProjectSpec): ProjectSpec {
  return {
    name: txt(spec.name, 60, fb.name),
    tagline: txt(spec.tagline, 160, fb.tagline),
    summary: txt(spec.summary, 800, fb.summary),
    projectType: spec.projectType,
    industry: txt(spec.industry, 80, fb.industry),
    audience: {
      customers: orFallback(list(spec.audience.customers, 6, 80), fb.audience.customers),
      operators: orFallback(list(spec.audience.operators, 6, 60), fb.audience.operators),
    },
    features: orFallback(
      uniqueBy(
        spec.features.map((f) => ({ name: txt(f.name, 60), description: txt(f.description, 200), priority: f.priority })).filter((f) => f.name && !ADMIN_SURFACE.test(f.name)),
        (f) => f.name,
      ).slice(0, 12),
      fb.features,
    ),
    entities: orFallback(
      uniqueBy(spec.entities.map((e) => ({ name: txt(e.name, 40), description: txt(e.description, 160) })).filter((e) => e.name), (e) => e.name).slice(0, 10),
      fb.entities,
    ),
    workflows: uniqueBy(
      spec.workflows.map((w) => ({ name: txt(w.name, 60), trigger: txt(w.trigger, 140), outcome: txt(w.outcome, 180) })).filter((w) => w.name && w.trigger),
      (w) => w.name,
    ).slice(0, 8),
    integrations: list(spec.integrations.map((i) => i.toLowerCase()), 10, 40),
    pages: orFallback(list(spec.pages, 12, 40).filter((p) => !ADMIN_SURFACE.test(p)), fb.pages),
    brand: {
      tone: txt(spec.brand.tone, 120, fb.brand.tone),
      style: txt(spec.brand.style, 160, fb.brand.style),
      colors: orFallback(list(spec.brand.colors, 5, 32).filter((c) => /^#[0-9a-f]{3,8}$/i.test(c) || /^[a-z ]{3,24}$/i.test(c)), fb.brand.colors),
    },
    constraints: list(spec.constraints, 8, 200),
  }
}

/** Validate with projectSpecSchema; salvage valid fields/items and fill the rest from defaults. */
export function repairSpec(raw: unknown, fallback: ProjectSpec): ProjectSpec {
  const parsed = projectSpecSchema.safeParse(raw)
  if (parsed.success) return sanitizeSpec(parsed.data, fallback)
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const shape = projectSpecSchema.shape
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(shape) as (keyof ProjectSpec)[]) {
    const fieldSchema = shape[key]
    const ok = fieldSchema.safeParse(r[key])
    if (ok.success) out[key] = ok.data
    else if (fieldSchema instanceof z.ZodArray && Array.isArray(r[key])) {
      const element = fieldSchema.element as z.ZodType
      out[key] = (r[key] as unknown[]).filter((item) => element.safeParse(item).success)
    } else out[key] = fallback[key]
  }
  const salvaged = projectSpecSchema.safeParse(out)
  return sanitizeSpec(salvaged.success ? salvaged.data : fallback, fallback)
}

const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'to', 'for', 'your', 'you', 'do', 'does', 'what', 'which', 'how', 'is', 'are', 'will', 'would', 'should', 'be', 'in', 'on', 'with', 'want', 'need', 'it', 'we', 'i'])
const tokens = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)))
function similarity(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0
  let inter = 0
  for (const w of a) if (b.has(w)) inter++
  return inter / (a.size + b.size - inter)
}

function sanitizeQuestions(raw: DiscoveryQuestion[], answers: DiscoveryAnswer[], round: number): DiscoveryQuestion[] {
  const seen = answers.map((a) => tokens(a.question))
  const out: DiscoveryQuestion[] = []
  for (const q of raw) {
    const question = txt(q.question, 220)
    if (!question) continue
    const tk = tokens(question)
    if (seen.some((s) => similarity(s, tk) >= 0.6)) continue // never re-ask
    seen.push(tk)
    let kind = q.kind
    let options = list(q.options, 6, 60).filter((o) => !/^(other|none of (the|these)|n\/a)\b|^\[.*\]$|\b(enter|type|write) your own\b/i.test(o))
    if (kind !== 'text' && options.length < 2) kind = 'text'
    if (kind === 'text') options = []
    const field = FIELDS.has(q.field) ? q.field : 'features'
    out.push({
      id: `r${round}-${field}-${out.length + 1}`,
      question,
      why: txt(q.why, 160, 'Shapes what we generate for you.'),
      kind,
      options,
      placeholder: txt(q.placeholder, 90, kind === 'text' ? 'Type your answer…' : ''),
      field,
    })
    if (out.length === 4) break
  }
  return out
}

/** The user named it (answer, idea text or an explicit known fact) — don't push a naming question. */
function nameEstablished(spec: ProjectSpec, req: DiscoveryRequest, known: string[]): boolean {
  if (answeredKeys(req.answers).has('name')) return true
  // A proper noun the user typed ("Kickz Bangalore"), not a lowercase descriptor ("sneaker resale store").
  if (spec.name && /[A-Z0-9]/.test(spec.name) && req.idea.includes(spec.name)) return true
  return known.some((k) => /\b(named|called|name is|brand name)\b/i.test(k))
}

const cleanBrief = (s: string) => s.replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, 6000)

type Ctx = { round: number; answeredRounds: number; forceDone: boolean; justBuild: boolean; answeredCount: number }

/** Completeness never drops below what the answered rounds already established. */
const completenessFloor = (ctx: Ctx) => (ctx.answeredRounds === 0 ? 0 : Math.min(85, 30 + ctx.answeredRounds * 15 + ctx.answeredCount * 3))

const ROLE_QUESTION = /\b(manage|run|operat\w*|staff|roles?|dashboard|admin)\b/i

/** Operator-role answers must replace the default roles (the model tends to copy the old spec). */
function applyRoleAnswers(spec: ProjectSpec, answers: DiscoveryAnswer[]): ProjectSpec {
  for (const a of answers) {
    const key = /^r\d+-([a-z]+)/.exec(a.questionId)?.[1]
    if (a.answer === SKIPPED_ANSWER || !(key === 'operators' || (key === 'audience' && ROLE_QUESTION.test(a.question)))) continue
    const roles = a.answer.split(/,|;|\n|\s+and\s+/).map((r) => txt(r, 60)).filter(Boolean)
    if (roles.length) spec.audience.operators = uniqueBy(roles.map((r) => (/^just me$/i.test(r) ? 'Owner' : r)), (r) => r).slice(0, 6)
  }
  return spec
}

function finalize(raw: DiscoveryLLMOutput, req: DiscoveryRequest, ctx: Ctx): DiscoveryResponse {
  const fallback = req.spec ?? heuristicSpec(req.idea, req.answers, null)
  const spec = applyRoleAnswers(repairSpec(raw.spec, fallback), req.answers)
  const rawScore = Number.isFinite(raw.completeness) ? (raw.completeness > 0 && raw.completeness <= 1 ? raw.completeness * 100 : raw.completeness) : 0
  const completeness = clamp(Math.round(Math.max(rawScore, completenessFloor(ctx))), 0, 100)
  const done = completeness >= 80 || ctx.forceDone || ctx.justBuild
  let questions = done ? [] : sanitizeQuestions(raw.questions, req.answers, ctx.round)
  if (!done && questions.length < 2) {
    const have = new Set(questions.map((q) => q.field))
    questions = [...questions, ...fallbackQuestions(spec, req.answers, ctx.round, have)].slice(0, Math.max(2, questions.length))
  }
  if (!done && ctx.round >= 2 && !questions.some((q) => q.field === 'name') && !nameEstablished(spec, req, raw.known)) {
    questions = [...questions.slice(0, 3), namingQuestion(spec, ctx.round)]
  }
  const known = list(raw.known, 16, 140)
  const brief = cleanBrief(raw.brief)
  return {
    spec,
    questions,
    completeness,
    known: known.length ? known : req.answers.filter((a) => a.answer !== SKIPPED_ANSWER).map((a) => txt(`${a.question} → ${a.answer}`, 140)).slice(0, 16),
    missing: list(raw.missing, 8, 120),
    done,
    brief: brief.length >= 300 ? brief : specToBrief(spec),
  }
}

function heuristicResponse(req: DiscoveryRequest, ctx: Ctx): DiscoveryResponse {
  const spec = heuristicSpec(req.idea, req.answers, req.spec)
  const questions = ctx.forceDone || ctx.justBuild ? [] : fallbackQuestions(spec, req.answers, ctx.round)
  const completeness = clamp(Math.max(25 + ctx.answeredCount * 10, completenessFloor(ctx)), 0, questions.length ? 79 : 100)
  const done = !questions.length || completeness >= 80
  const answered = req.answers.filter((a) => a.answer !== SKIPPED_ANSWER)
  const keys = answeredKeys(req.answers)
  return {
    spec,
    questions: done ? [] : questions,
    completeness,
    known: [`Project type: ${spec.projectType}`, ...answered.map((a) => txt(`${a.question} → ${a.answer}`, 140))].slice(0, 16),
    missing: ['name', 'features', 'customers', 'brand', 'operators', 'integrations'].filter((k) => !keys.has(k)).map((k) => `Confirm ${k}`).slice(0, 8),
    done,
    brief: specToBrief(spec),
  }
}

export async function runDiscovery(req: DiscoveryRequest): Promise<DiscoveryResponse> {
  const answers = req.answers.slice(-30)
  const request: DiscoveryRequest = { ...req, answers, spec: req.spec ? repairSpec(req.spec, heuristicSpec(req.idea, [], null)) : null }
  const answeredRounds = countAnsweredRounds(answers)
  const ctx: Ctx = {
    round: answeredRounds + 1,
    answeredRounds,
    forceDone: answeredRounds >= MAX_ROUNDS,
    justBuild: saysJustBuild(req.idea, answers),
    answeredCount: answers.filter((a) => a.answer.trim() && a.answer !== SKIPPED_ANSWER).length,
  }
  try {
    const { object } = await generateObject({
      model: getModelClient(DISCOVERY_MODEL, {}) as LanguageModel,
      schema: discoveryLLMSchema,
      schemaName: 'discovery_round',
      system: SYSTEM,
      prompt: buildPrompt(request, ctx.round, answeredRounds, ctx.forceDone, ctx.justBuild),
      temperature: 0.3,
      maxOutputTokens: 4000,
      maxRetries: 1,
      abortSignal: AbortSignal.timeout(LLM_TIMEOUT_MS),
    })
    return finalize(object, request, ctx)
  } catch (error) {
    console.warn('[discovery] LLM round failed, using heuristic fallback:', error instanceof Error ? error.message : error)
    return heuristicResponse(request, ctx)
  }
}

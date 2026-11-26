/**
 * Deterministic discovery helpers: project-type inference, a heuristic spec used when the LLM
 * is unavailable, generic fallback questions and a spec → brief renderer.
 * Pure module (no server-only deps) so it can run under `npx tsx` and on the client.
 */
import type { DiscoveryAnswer, DiscoveryQuestion, ProjectSpec, ProjectType } from '@/lib/platform/types'

/** Sentinel answer the panel sends for a per-question "Skip" (= "decide for me"). */
export const SKIPPED_ANSWER = '[skipped]'
export const MAX_ROUNDS = 3

type Priority = ProjectSpec['features'][number]['priority']
type Preset = {
  industry: string
  customers: string[]
  operators: string[]
  features: [string, string, Priority][]
  entities: [string, string][]
  workflows: [string, string, string][]
  integrations: string[]
  pages: string[]
  tone: string
  style: string
  colors: string[]
}

// Scored keyword rules; ties resolve in list order (restaurant before booking, marketplace before ecommerce…).
const TYPE_RULES: [ProjectType, RegExp][] = [
  ['restaurant', /\b(restaurants?|caf[eé]s?|bistro|bakery|diner|pizzeria|food truck|eatery|menus?|brunch|takeaway|cloud kitchen|coffee shop|bar and grill)\b/gi],
  ['booking', /\b(bookings?|appointments?|clinics?|dental|dentists?|salons?|spa|barbers?|physio\w*|therap\w*|consultations?|schedul\w*|reservations?|grooming)\b/gi],
  ['marketplace', /\b(marketplace|vendors?|two-sided|listings?|peer-to-peer|buyers and sellers|sellers and buyers)\b/gi],
  ['ecommerce', /\b(e-?commerce|online store|stores?|shops?|boutique|merch|retail|resale|sell(ing)?|products?|catalog(ue)?|sneakers?|apparel|clothing|jewel(le)?ry|cosmetics|d2c|dtc|drops?)\b/gi],
  ['saas', /\b(saas|software|platform|subscriptions?|b2b|crm|analytics|workspace|automation|api)\b/gi],
  ['agency', /\b(agency|studio|consultancy|consulting|freelanc\w*|marketing firm|design firm|creative services)\b/gi],
  ['events', /\b(events?|conferences?|festivals?|meetups?|concerts?|weddings?|tickets?|summit)\b/gi],
  ['education', /\b(courses?|school|academy|tutors?|tutoring|learning|bootcamp|classes|curriculum|students?|lessons?)\b/gi],
  ['nonprofit', /\b(non-?profit|charity|ngo|donat\w*|foundation|volunteers?|fundrais\w*)\b/gi],
  ['community', /\b(community|forum|club|members(hip)?|network)\b/gi],
  ['portfolio', /\b(portfolio|personal (site|website)|resume|photographer|showcase)\b/gi],
]

export function inferProjectType(text: string): ProjectType {
  let best: ProjectType = 'custom'
  let bestScore = 0
  for (const [type, re] of TYPE_RULES) {
    const score = (text.match(re) || []).length
    if (score > bestScore) { best = type; bestScore = score }
  }
  return best
}

const CUSTOM: Preset = {
  industry: 'General business',
  customers: ['Website visitors', 'Prospective customers'],
  operators: ['Owner', 'Team member'],
  features: [
    ['Clear value proposition', 'Hero, benefits and social proof that explain the offer', 'must'],
    ['Lead capture', 'Inquiry form that lands in the dashboard', 'must'],
    ['Content pages', 'About, services/offer and FAQ pages', 'should'],
    ['Newsletter signup', 'Collect emails for updates', 'could'],
  ],
  entities: [['Lead', 'Inbound inquiry with contact details and message'], ['Contact', 'Person or company the business talks to']],
  workflows: [['New inquiry alert', 'Website inquiry submitted', 'Owner is notified and the lead is marked New']],
  integrations: ['email'],
  pages: ['Home', 'About', 'Services', 'FAQ', 'Contact'],
  tone: 'Clear and trustworthy',
  style: 'Modern, spacious layout with strong typography',
  colors: ['#111827', '#F9FAFB', '#4F46E5'],
}

const PRESETS: Partial<Record<ProjectType, Preset>> = {
  ecommerce: {
    industry: 'Retail & e-commerce',
    customers: ['Online shoppers'],
    operators: ['Store owner', 'Store manager', 'Fulfilment staff'],
    features: [
      ['Product catalog', 'Browsable products with photos, variants and stock badges', 'must'],
      ['Cart & checkout', 'Cart, address capture and order placement', 'must'],
      ['Order tracking', 'Order status from placed to delivered', 'must'],
      ['Inventory management', 'Stock levels per product and size/variant', 'must'],
      ['Discount codes', 'Promo codes and sale pricing', 'should'],
      ['Newsletter signup', 'Collect emails for launches and offers', 'should'],
      ['Product reviews', 'Ratings and reviews on product pages', 'could'],
    ],
    entities: [['Product', 'Item for sale with price, stock and variants'], ['Order', 'Purchase with line items, totals and status'], ['Customer', 'Buyer profile with contact and address'], ['Discount', 'Promo code with value and validity']],
    workflows: [['Order confirmation', 'New order placed', 'Customer gets a confirmation and stock is decremented'], ['Low stock alert', 'Stock falls below threshold', 'Store manager is notified']],
    integrations: ['stripe', 'email', 'shipping'],
    pages: ['Home', 'Shop', 'Product', 'Cart & Checkout', 'About', 'Contact'],
    tone: 'Confident and inviting',
    style: 'Product-first layout with generous imagery',
    colors: ['#111111', '#F5F1EA', '#E4572E'],
  },
  saas: {
    industry: 'Software',
    customers: ['Teams evaluating the product', 'Trial users'],
    operators: ['Founder / admin', 'Customer success', 'Support'],
    features: [
      ['Pricing & plans', 'Tier comparison with trial or signup CTA', 'must'],
      ['Sign-up & onboarding', 'Account creation and first-run checklist', 'must'],
      ['User & team management', 'Invite members and assign roles', 'must'],
      ['Usage analytics', 'Track the key usage metric per account', 'must'],
      ['Billing & subscriptions', 'Plans, upgrades and invoices', 'should'],
      ['Demo request', 'Sales-assisted demo booking form', 'should'],
      ['Changelog', 'Product updates feed', 'could'],
    ],
    entities: [['Account', 'Customer workspace / company'], ['User', 'Member with role and status'], ['Subscription', 'Plan, status and renewal date'], ['Usage Event', 'Metered activity for analytics']],
    workflows: [['Trial started', 'New sign-up', 'Welcome email and onboarding checklist created'], ['Trial ending', 'Trial ends in 3 days', 'Upgrade reminder sent']],
    integrations: ['stripe', 'email', 'analytics'],
    pages: ['Home', 'Features', 'Pricing', 'Customers', 'Docs', 'Sign up'],
    tone: 'Sharp and credible',
    style: 'Crisp product UI screenshots, clean grid',
    colors: ['#0B1220', '#F8FAFC', '#6366F1'],
  },
  restaurant: {
    industry: 'Food & hospitality',
    customers: ['Local diners', 'Takeaway customers'],
    operators: ['Owner', 'Floor manager', 'Kitchen staff'],
    features: [
      ['Digital menu', 'Categorized menu with prices and dietary tags', 'must'],
      ['Table reservations', 'Book a table by date, time and party size', 'must'],
      ['Online ordering', 'Pickup or delivery orders', 'should'],
      ['Opening hours & location', 'Hours, map and contact details', 'must'],
      ['Specials & events', 'Weekly specials and private events', 'could'],
    ],
    entities: [['Menu Item', 'Dish with category, price and dietary tags'], ['Reservation', 'Table booking with party size and time'], ['Order', 'Pickup/delivery order with items and status'], ['Customer', 'Guest contact details']],
    workflows: [['Reservation confirmation', 'Reservation submitted', 'Guest receives confirmation; status Pending → Confirmed'], ['Order to kitchen', 'Online order placed', 'Order appears in the kitchen queue']],
    integrations: ['email', 'sms', 'payments'],
    pages: ['Home', 'Menu', 'Reservations', 'Order Online', 'About', 'Contact'],
    tone: 'Warm and appetizing',
    style: 'Rich food photography, inviting textures',
    colors: ['#2B1D14', '#FBF6EE', '#C8553D'],
  },
  booking: {
    industry: 'Appointments & services',
    customers: ['Clients booking appointments'],
    operators: ['Owner', 'Front desk', 'Practitioners'],
    features: [
      ['Online booking', 'Pick a service, practitioner and time slot', 'must'],
      ['Service menu', 'Services with durations and prices', 'must'],
      ['Staff schedules', 'Availability per practitioner', 'must'],
      ['Reminders', 'Automatic reminders before appointments', 'should'],
      ['Deposits', 'Optional deposit to reduce no-shows', 'could'],
      ['Client records', 'History and notes per client', 'should'],
    ],
    entities: [['Appointment', 'Booked slot with service, staff and status'], ['Service', 'Offering with duration and price'], ['Staff Member', 'Practitioner with schedule'], ['Client', 'Customer contact and history']],
    workflows: [['Booking confirmation', 'Appointment requested', 'Client gets confirmation; front desk notified'], ['Reminder', '24 hours before appointment', 'Reminder sent to client']],
    integrations: ['email', 'sms', 'google-calendar'],
    pages: ['Home', 'Services', 'Team', 'Book Now', 'About', 'Contact'],
    tone: 'Calm and reassuring',
    style: 'Clean, airy layout with soft accents',
    colors: ['#0F2A3D', '#F4F8FA', '#2FA4A9'],
  },
  agency: {
    industry: 'Professional services',
    customers: ['Businesses looking to hire the agency'],
    operators: ['Founder', 'Account manager', 'Project lead'],
    features: [
      ['Services overview', 'What the agency offers and for whom', 'must'],
      ['Case studies', 'Portfolio of work with outcomes', 'must'],
      ['Lead capture', 'Project inquiry form with budget and timeline', 'must'],
      ['Lead pipeline', 'Track leads from new to won', 'must'],
      ['Client projects', 'Projects with status and owners', 'should'],
      ['Testimonials', 'Client quotes and logos', 'should'],
    ],
    entities: [['Lead', 'Inbound inquiry with budget and stage'], ['Client', 'Company the agency works with'], ['Project', 'Engagement with scope, status and dates'], ['Case Study', 'Published work sample']],
    workflows: [['New lead triage', 'Inquiry submitted', 'Lead created in New stage; founder notified'], ['Project kickoff', 'Lead moved to Won', 'Client and project records created']],
    integrations: ['email', 'calendar', 'crm'],
    pages: ['Home', 'Services', 'Work', 'About', 'Contact'],
    tone: 'Confident and expert',
    style: 'Bold editorial typography, big imagery',
    colors: ['#0A0A0A', '#FAFAF7', '#FF5A1F'],
  },
}

/** Website forms that submit into the backend, per project type. */
const FORMS: Record<ProjectType, string[]> = {
  ecommerce: ['Checkout / order form (items, size/variant, name, email, phone, shipping address)', 'Newsletter signup (email)'],
  saas: ['Sign up / start trial (name, work email, company, plan)', 'Demo request (name, email, company size, message)'],
  restaurant: ['Table reservation (name, phone, party size, date, time, notes)', 'Online order (items, pickup or delivery, address, phone)'],
  booking: ['Appointment booking (service, staff, preferred date & time, name, email, phone, notes)'],
  agency: ['Project inquiry (name, email, company, services, budget, timeline, message)'],
  portfolio: ['Contact / commission inquiry (name, email, project type, budget, message)'],
  events: ['Event registration (name, email, ticket type, quantity)'],
  education: ['Enrollment / application (name, email, course, start date)'],
  nonprofit: ['Donation pledge (name, email, amount, recurring)', 'Volunteer sign-up (name, email, availability)'],
  marketplace: ['Listing submission (title, category, price, photos, seller contact)', 'Buyer inquiry (listing, name, email, message)'],
  community: ['Membership application (name, email, interests)'],
  custom: ['Contact / inquiry form (name, email, message)'],
}

export function presetFor(type: ProjectType): Preset {
  return PRESETS[type] ?? CUSTOM
}

export function formsFor(type: ProjectType): string[] {
  return FORMS[type] ?? FORMS.custom
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s)
const titleCase = (s: string) => s.replace(/\b([a-z])/g, (m) => m.toUpperCase())

function guessName(idea: string): string {
  const cleaned = idea
    .replace(/^\s*(i want to|i'd like to|i need|we need|we want|please)\s+/i, '')
    .replace(/^\s*(build|create|make|launch|design)\s+/i, '')
    .replace(/^\s*(an?|the|my|our)\s+/i, '')
  const head = cleaned.split(/\s+(?:for|with|that|which|where|in|to|so|called)\s+|[,.;:!?\n(]/i)[0] || ''
  const words = head.trim().split(/\s+/).filter(Boolean).slice(0, 4).join(' ')
  return words ? clip(titleCase(words), 60) : 'Untitled Project'
}

const splitList = (answer: string) =>
  answer.split(/,|;|\n|\s+and\s+|\s*\/\s*/i).map((s) => s.trim()).filter(Boolean).slice(0, 8)

/** Answered question keys (from server-issued ids like `r2-integrations-1`). */
export function answeredKeys(answers: DiscoveryAnswer[]): Set<string> {
  const keys = new Set<string>()
  for (const a of answers) {
    const m = /^r\d+-([a-z]+)/.exec(a.questionId)
    if (m) keys.add(m[1])
  }
  return keys
}

/** Number of answered rounds, derived from the `r{n}-` id prefix (fallback: ~3 answers per round). */
export function countAnsweredRounds(answers: DiscoveryAnswer[]): number {
  const rounds = new Set<string>()
  for (const a of answers) {
    const m = /^r(\d+)-/.exec(a.questionId)
    if (m) rounds.add(m[1])
  }
  if (rounds.size) return rounds.size
  return answers.length ? Math.ceil(answers.length / 3) : 0
}

const JUST_BUILD = /\b(just build|build it( now)?|go ahead and build|start building|no more questions|stop asking|enough questions|skip (the )?(rest|questions|discovery|all|this step)|you decide( everything)?|surprise me)\b/i

/** True when the user explicitly wants to stop answering ("skip", "just build it"). */
export function saysJustBuild(idea: string, answers: DiscoveryAnswer[]): boolean {
  if (/\bjust build\b/i.test(idea)) return true
  return answers.some((a) => {
    const t = a.answer.trim()
    if (!t || t === SKIPPED_ANSWER) return false
    return JUST_BUILD.test(t) || (t.length <= 24 && /^(skip|skip it|just build|build|go)[.! ]*$/i.test(t))
  })
}

/** Apply raw answers onto a spec without an LLM (fallback mode). */
function applyAnswers(spec: ProjectSpec, answers: DiscoveryAnswer[]): ProjectSpec {
  const next: ProjectSpec = structuredClone(spec)
  for (const a of answers) {
    const answer = a.answer.trim()
    if (!answer || answer === SKIPPED_ANSWER) continue
    const key = /^r\d+-([a-z]+)/.exec(a.questionId)?.[1] ?? ''
    const items = splitList(answer)
    switch (key) {
      case 'name': next.name = clip(answer, 60); break
      case 'customers': case 'audience': next.audience.customers = items.slice(0, 6); break
      case 'operators': next.audience.operators = items.slice(0, 6); break
      case 'brand': next.brand.tone = clip(answer, 120); break
      case 'integrations':
        next.integrations = [...new Set([...next.integrations, ...items.map((i) => i.toLowerCase().replace(/\s+/g, '-'))])].slice(0, 10)
        break
      case 'features':
        for (const name of items) {
          const hit = next.features.find((f) => f.name.toLowerCase() === name.toLowerCase())
          if (hit) hit.priority = 'must'
          else next.features.unshift({ name: clip(name, 60), description: `Requested by the owner: ${clip(name, 120)}`, priority: 'must' })
        }
        next.features = next.features.slice(0, 12)
        break
      default:
        next.constraints = [...next.constraints, clip(`${a.question} → ${answer}`, 200)].slice(0, 8)
    }
  }
  return next
}

/** Build-ready spec from the idea alone (+ answers), used when the LLM is unavailable. */
export function heuristicSpec(idea: string, answers: DiscoveryAnswer[], prev: ProjectSpec | null): ProjectSpec {
  const type = prev?.projectType ?? inferProjectType(`${idea} ${answers.map((a) => a.answer).join(' ')}`)
  const p = presetFor(type)
  const firstSentence = idea.split(/(?<=[.!?])\s/)[0]?.trim() || idea.trim()
  const base: ProjectSpec = prev ?? {
    name: guessName(idea),
    tagline: clip(firstSentence.charAt(0).toUpperCase() + firstSentence.slice(1), 140),
    summary: clip(idea.trim(), 600),
    projectType: type,
    industry: p.industry,
    audience: { customers: [...p.customers], operators: [...p.operators] },
    features: p.features.map(([name, description, priority]) => ({ name, description, priority })),
    entities: p.entities.map(([name, description]) => ({ name, description })),
    workflows: p.workflows.map(([name, trigger, outcome]) => ({ name, trigger, outcome })),
    integrations: [...p.integrations],
    pages: [...p.pages],
    brand: { tone: p.tone, style: p.style, colors: [...p.colors] },
    constraints: [],
  }
  return applyAnswers(base, answers)
}

export function namingQuestion(spec: ProjectSpec, round: number): DiscoveryQuestion {
  return { id: `r${round}-name`, question: 'What should the project be called?', why: 'The name anchors the logo, page titles and dashboard branding.', kind: 'text', options: [], placeholder: `e.g. ${spec.name}`, field: 'name' }
}

/** Generic (type-aware options) questions for fallback mode or topping up a thin LLM round. */
export function fallbackQuestions(spec: ProjectSpec, answers: DiscoveryAnswer[], round: number, exclude: Set<string> = new Set()): DiscoveryQuestion[] {
  const p = presetFor(spec.projectType)
  const taken = new Set([...answeredKeys(answers), ...exclude])
  const bank: (Omit<DiscoveryQuestion, 'id'> & { key: string })[] = [
    { key: 'features', question: 'Which capabilities must be live at launch?', why: 'Must-haves decide the pages, forms and database tables generated first.', kind: 'multi', options: p.features.map((f) => f[0]).slice(0, 6), placeholder: '', field: 'features' },
    { key: 'customers', question: 'Who is the primary customer for the website?', why: 'Audience shapes the copy, page structure and calls to action.', kind: 'text', options: [], placeholder: `e.g. ${p.customers[0]}`, field: 'audience' },
    { key: 'brand', question: 'What should the brand feel like?', why: 'Tone steers typography, color and imagery across all three designs.', kind: 'single', options: ['Premium & minimal', 'Bold & energetic', 'Warm & friendly', 'Clean & technical', 'Playful & colorful'], placeholder: '', field: 'brand' },
    { key: 'name', ...namingQuestion(spec, round) },
    { key: 'operators', question: 'Who will run the dashboard day to day?', why: 'Operator roles decide which dashboard modules and permissions we set up.', kind: 'multi', options: [...p.operators, 'Just me'].slice(0, 6), placeholder: '', field: 'audience' },
    { key: 'integrations', question: 'Which integrations do you need on day one?', why: 'Integrations drive payment, notification and sync workflows in the backend.', kind: 'multi', options: [...new Set([...p.integrations, 'email', 'sms', 'whatsapp', 'google-calendar', 'stripe'])].slice(0, 6), placeholder: '', field: 'integrations' },
  ]
  return bank
    .filter((q) => !taken.has(q.key))
    .slice(0, 3)
    .map(({ key, ...q }) => ({ ...q, id: `r${round}-${key}` }))
}

/** Deterministic, generation-ready brief rendered from a spec. */
export function specToBrief(spec: ProjectSpec): string {
  const must = spec.features.filter((f) => f.priority === 'must')
  const rest = spec.features.filter((f) => f.priority !== 'must')
  const lines = [
    `Build "${spec.name}" — ${spec.tagline}`,
    spec.summary,
    '',
    `Project type: ${spec.projectType} · Industry: ${spec.industry}`,
    `Customers (public website): ${spec.audience.customers.join(', ') || 'general visitors'}`,
    `Operators (admin dashboard): ${spec.audience.operators.join(', ') || 'owner'}`,
    '',
    'Pages:',
    ...spec.pages.map((p) => `- ${p}`),
    '',
    'Key forms (submit to the backend and appear in the dashboard):',
    ...formsFor(spec.projectType).map((f) => `- ${f}`),
    '',
    'Must-have features:',
    ...must.map((f) => `- ${f.name}: ${f.description}`),
    ...(rest.length ? ['', 'Nice to have:', ...rest.map((f) => `- ${f.name} (${f.priority}): ${f.description}`)] : []),
    '',
    `Data: ${spec.entities.map((e) => e.name).join(', ')}`,
    ...(spec.workflows.length ? ['Workflows:', ...spec.workflows.map((w) => `- ${w.name}: when ${w.trigger} → ${w.outcome}`)] : []),
    ...(spec.integrations.length ? [`Integrations: ${spec.integrations.join(', ')}`] : []),
    '',
    `Brand: ${spec.brand.tone}. Style: ${spec.brand.style}.${spec.brand.colors.length ? ` Colors: ${spec.brand.colors.join(', ')}.` : ''}`,
    ...(spec.constraints.length ? ['Constraints:', ...spec.constraints.map((c) => `- ${c}`)] : []),
    'Use realistic, specific copy (real product/service names, prices, locations); no lorem ipsum.',
  ]
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

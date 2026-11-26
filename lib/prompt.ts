import type { ProjectSpec } from '@/lib/platform/types'
import { Templates, templatesToPrompt } from '@/lib/templates'

/** Collections the CONNECTOR bridge knows how to route website form submissions into. */
export const FORM_COLLECTIONS = ['orders', 'reservations', 'appointments', 'leads', 'signups'] as const
export type FormCollection = (typeof FORM_COLLECTIONS)[number]

const FORM_GUIDE: Record<FormCollection, { action: string; fields: string }> = {
  orders: { action: 'order / checkout (e.g. "Place order", "Checkout")', fields: 'customer_name, email, phone, items (or product), quantity, fulfillment (pickup|delivery), address, notes, total' },
  reservations: { action: 'table / ticket / room reservation', fields: 'customer_name, email, phone, date, time, party_size, notes' },
  appointments: { action: 'appointment / session / service booking', fields: 'customer_name, email, phone, service, staff (optional), date, time, notes' },
  leads: { action: 'contact / quote / inquiry', fields: 'name, email, phone, company, budget, message' },
  signups: { action: 'signup / waitlist / newsletter / registration', fields: 'name, email, plan (optional), company (optional)' },
}

const TYPE_DEFAULTS: Record<ProjectSpec['projectType'], FormCollection[]> = {
  ecommerce: ['orders', 'signups', 'leads'],
  restaurant: ['reservations', 'orders', 'leads'],
  booking: ['appointments', 'leads'],
  saas: ['signups', 'leads'],
  agency: ['leads'],
  portfolio: ['leads'],
  events: ['reservations', 'signups', 'leads'],
  education: ['signups', 'leads'],
  nonprofit: ['signups', 'leads'],
  marketplace: ['orders', 'signups', 'leads'],
  community: ['signups', 'leads'],
  custom: ['leads'],
}

const KEYWORDS: [FormCollection, RegExp][] = [
  ['orders', /\b(order|orders|cart|checkout|purchase|buy|shop|delivery|pickup|pre-?order)\b/i],
  ['reservations', /\b(reserv\w*|table|tickets?|rsvp)\b/i],
  ['appointments', /\b(appointments?|book(ing|ings)?|schedul\w*|sessions?|consultations?)\b/i],
  ['leads', /\b(contact|inquir\w*|enquir\w*|quotes?|leads?|estimate)\b/i],
  ['signups', /\b(sign ?-?ups?|register|registration|waitlist|newsletter|subscribe|enrol\w*|join|membership|trial)\b/i],
]

/** Which public forms a spec needs, in priority order (pure; used by the prompt and tests). */
export function specFormTargets(spec: ProjectSpec): FormCollection[] {
  const text = [
    ...spec.features.filter((f) => f.priority !== 'could').map((f) => `${f.name} ${f.description}`),
    ...spec.entities.map((e) => `${e.name} ${e.description}`),
    ...spec.workflows.map((w) => `${w.name} ${w.trigger}`),
  ].join(' \n ')
  const found = new Set<FormCollection>(TYPE_DEFAULTS[spec.projectType] ?? ['leads'])
  for (const [collection, re] of KEYWORDS) if (re.test(text)) found.add(collection)
  return FORM_COLLECTIONS.filter((c) => found.has(c))
}

const clip = (value: unknown, max = 240) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
const list = (items: string[], max = 12) => items.map((s) => clip(s, 120)).filter(Boolean).slice(0, max)

function specSection(spec: ProjectSpec): string {
  const targets = specFormTargets(spec)
  const lines = [
    'PROJECT SPECIFICATION (from discovery — build exactly this business, not a generic demo):',
    `- Name: ${clip(spec.name, 80)}${spec.tagline ? ` — ${clip(spec.tagline, 140)}` : ''}`,
    `- Type: ${spec.projectType}${spec.industry ? ` · industry: ${clip(spec.industry, 80)}` : ''}`,
    spec.summary ? `- Summary: ${clip(spec.summary, 400)}` : '',
    spec.audience?.customers?.length ? `- Website visitors: ${list(spec.audience.customers, 6).join('; ')}` : '',
    spec.features.length ? `- Features:\n${spec.features.slice(0, 14).map((f) => `  · [${f.priority}] ${clip(f.name, 80)}: ${clip(f.description, 160)}`).join('\n')}` : '',
    spec.entities.length ? `- Entities: ${spec.entities.slice(0, 12).map((e) => `${clip(e.name, 40)} (${clip(e.description, 80)})`).join('; ')}` : '',
    spec.workflows.length ? `- Workflows: ${spec.workflows.slice(0, 8).map((w) => `${clip(w.name, 60)}: when ${clip(w.trigger, 80)} → ${clip(w.outcome, 80)}`).join('; ')}` : '',
    spec.pages.length ? `- Pages/sections: ${list(spec.pages, 10).join(', ')}` : '',
    spec.brand ? `- Brand: tone ${clip(spec.brand.tone, 60) || 'n/a'}; style ${clip(spec.brand.style, 80) || 'n/a'}${spec.brand.colors?.length ? `; colors ${list(spec.brand.colors, 6).join(', ')}` : ''}` : '',
    spec.constraints.length ? `- Constraints: ${list(spec.constraints, 8).join('; ')}` : '',
    '',
    'REQUIRED WORKING FORMS — this site is wired to a real backend. Implement each of these as a real, working form in the page (not a fake button):',
    ...targets.map((c) => `  · data-evo-collection="${c}" — ${FORM_GUIDE[c].action}. Suggested name attributes: ${FORM_GUIDE[c].fields}.`),
  ]
  return lines.filter(Boolean).join('\n')
}

const FORMS_CONTRACT = `Website forms contract (the EvoStack bridge captures submissions and stores them in the project's backend): every form for a key business action — order/checkout, reservation/booking, appointment, contact/lead, signup/waitlist/newsletter — must be a real <form> element with data-evo-collection set to exactly one of: orders | reservations | appointments | leads | signups. Every input/select/textarea inside it has a meaningful snake_case name attribute (customer_name, email, phone, date, time, party_size, quantity, message…), a visible <label>, and the right type (email, tel, date, time, number). Use required where the business needs it. Handle onSubmit with event.preventDefault(), read the values via new FormData(event.currentTarget), validate, then show a clear in-page success state (e.g. "Thanks — your order is in") and reset the form. Never navigate away, never post to a made-up URL, and never call fetch for form submission yourself. Do not wrap inputs in <div onClick> fakes; buttons that submit use type="submit".`

const IMAGE_RULES = `Images: whenever a real photograph is needed, write src="evo-image://<query>" (or background-image: url("evo-image://<query>")). EvoStack replaces each reference with a matching photo file before the preview starts. Never invent image URLs, never use remote stock/Unsplash/Pexels/Wikimedia URLs, and never use placeholder services (picsum, placeholder.com, unsplash.it, lorempixel, via.placeholder, placehold.co, dummyimage). Queries must be literal and descriptive: subject + setting + style, specific to this business, e.g. src="evo-image://black Rolls-Royce Ghost sedan in a dark luxury showroom, studio lighting" or "evo-image://portrait headshot of a smiling female architect, neutral background". Never build a query with a template literal, string concatenation or a variable (never write evo-image:// followed by an interpolated value such as an item name): put the full literal "evo-image://…" string in each data item (e.g. image: "evo-image://hand-thrown ceramic coffee mug on an oak table, morning light") and render it with src={item.image}. Queries use plain words only: no quotes, apostrophes, backslashes, parentheses or emoji. Optionally end a query with an aspect hint: #landscape (default; heroes and banners), #portrait (tall cards, fashion), or #square (avatars, team headshots, product tiles), e.g. "evo-image://portrait headshot of a smiling chef in a white jacket#square". Always render images inside a fixed-aspect container (e.g. aspect-[4/3], aspect-square, or a fixed height) with object-cover (or background-size: cover) so any photo fits, and give every <img> meaningful alt text describing the subject. Hero images are landscape. Use 4-10 distinct images per page, each section with its own relevant query; do not reuse one image everywhere. Do not use evo-image:// for icons, logos, gradients, decorative shapes or simple UI graphics.`

export function toPrompt(template: Templates, spec?: ProjectSpec | null) {
  return `
    You are a skilled software engineer.
    You do not make mistakes.
    Generate a complete, runnable project.
    You can install additional dependencies. If you import a package that is not already in the template (framer-motion, gsap, three, etc), list it in additional_dependencies and set has_additional_dependencies true. Never import a package you did not list — the sandbox will also install detected imports, but you must still declare them.
    Do not touch project dependencies files like package.json, package-lock.json, requirements.txt, etc.
    Do not wrap code in backticks.
    Always break the lines correctly.
    Project output: file_path identifies the template entry and code contains its complete source. files contains the full source of every supporting file, with file_path and file_content. Never repeat the entry in files. For every new web project create a real folder structure with at least two meaningful supporting files: reusable UI in components/ plus content/mock data in data/ or lib/, or styles in CSS modules. The entry page composes these modules instead of containing the whole app. Each extracted component must implement and render real UI; every data/style/helper file must be used. Do not create empty components, token files, fabricated stubs, TODOs, or omitted-source markers just to satisfy the structure. Include every custom local import target, including nested imports; relative imports and @/ aliases are allowed. Preserve existing template modules such as @/components/ui/* and @/lib/utils.
    When editing an existing project, return its full updated entry and ALL supporting files, including unchanged files. Never collapse a multi-file project into one file or drop supporting source. Python notebook/script apps may remain a single script with files: []. Keep the existing framework/router and entry path supplied by the template. Use project-relative source paths; never create absolute/traversal paths, hidden files, environment files, package manifests, lockfiles, or build configuration.
    Motion/framer-motion: spring and inertia only accept two keyframes. Never write type: "spring" or type: "inertia" (and do not rely on the default spring) with arrays of 3+ values such as scale: [1.13, 0.97, 1] or rotate: [0, 2, 0]. Use a single target with spring (scale: 1), or set type: "tween" for multi-keyframe sequences.
    Next.js pages router server-renders React, then React hydrates that HTML in the browser. The server and first client render must match exactly. Prefer locally imported CSS modules; do not import global CSS from a page or component. If a style tag is needed, use <style dangerouslySetInnerHTML={{ __html: css }} />. Initialize useState with deterministic literals, restore browser preferences in useEffect, and gate next-themes useTheme/resolvedTheme icons on a mounted flag. Never read window, localStorage, matchMedia, dates, or randomness during render/state initialization. Never hide mismatches with suppressHydrationWarning or disabled SSR.
    ${IMAGE_RULES}
    ${FORMS_CONTRACT}
    You can use one of the following templates:
    ${templatesToPrompt(template)}
  ${spec ? `\n${specSection(spec)}\n` : ''}`
}

/**
 * Ask EvoStack — request composition for the existing single-candidate Improve pipeline.
 *
 * ZERO automatic LLM / provider / E2B / network calls.
 * Submit only happens when the user explicitly clicks Improve (or Ctrl/Cmd+Enter).
 *
 * All request kinds share ONE underlying evolution path:
 * active version → 1 generation → architecture → verify → repair≤1 → smoke → promote.
 */
import {
  buildIterationContext,
  ITERATION_CANDIDATE_COUNT,
  type EvolutionIterationContext,
} from '@/lib/evolution'
import type { ProjectBrain } from '@/lib/project-brain'
import type { FragmentSchema } from '@/lib/schema'
import type { DeepPartial } from '@evostack/shared'

export type AskRequestKind =
  | 'general'
  | 'design'
  | 'mobile'
  | 'ux'
  | 'feature'

export type AskQuickAction = {
  id: AskRequestKind
  label: string
  icon: string
  /** Seed text for the input — never auto-submits. */
  seedText: string
}

/** Documented focus blocks embedded into the evolution userRequest. */
export const IMPROVEMENT_FOCUS: Record<AskRequestKind, string> = {
  general:
    'GENERAL: Modify the existing application according to the user\'s request. Preserve working behavior unless the request changes it.',
  design:
    'DESIGN: Prioritize visual hierarchy, typography, spacing, color system, component styling, responsiveness, and polish while preserving existing functionality.',
  mobile:
    'MOBILE: Prioritize responsive layouts, touch targets, navigation, overflow, and mobile usability while preserving functionality.',
  ux:
    'UX: Prioritize interaction flow, feedback states, empty/loading/error states, navigation, and usability while preserving functionality.',
  feature:
    'FEATURE: Add the requested capability while preserving existing functionality and architecture.',
}

export const ASK_QUICK_ACTIONS: AskQuickAction[] = [
  {
    id: 'design',
    label: 'Design',
    icon: '🎨',
    seedText: 'Make the dashboard look more premium and polished.',
  },
  {
    id: 'mobile',
    label: 'Mobile',
    icon: '📱',
    seedText: 'Improve mobile responsiveness and touch-friendly navigation.',
  },
  {
    id: 'ux',
    label: 'UX',
    icon: '⚡',
    seedText: 'Improve interaction flow, feedback states, and overall usability.',
  },
  {
    id: 'feature',
    label: 'Feature',
    icon: '💡',
    seedText: 'Add a useful capability that fits the current product.',
  },
]

/** Design Mode starter prompts — fill the input only; never auto-submit. */
export const DESIGN_STARTER_PROMPTS: string[] = [
  'Make it feel like a premium SaaS product',
  'Improve visual hierarchy',
  'Modernize the color palette',
  'Improve mobile responsiveness',
]

export type AskEvoStackSuggestion = {
  id: string
  title: string
  /** Text to put into the input (user must still click Improve). */
  text: string
}

export type ComposeAskResult = {
  kind: AskRequestKind
  rawText: string
  /** Full request sent into buildIterationContext / handleEvolve. */
  userRequest: string
  /** Always 1 — single-candidate Improve. */
  generationCount: typeof ITERATION_CANDIDATE_COUNT
  /** Quick actions / starters never set this true. */
  autoSubmit: false
}

/**
 * Build the improvement request string for the existing evolution prompt path.
 * Focus instructions travel inside userRequest so buildEvolutionPrompt picks them up.
 */
export function composeAskEvoStackRequest(opts: {
  kind?: AskRequestKind
  text: string
}): ComposeAskResult {
  const kind = opts.kind || 'general'
  const rawText = opts.text.trim()
  const focus = IMPROVEMENT_FOCUS[kind]
  const userRequest = rawText
    ? `${focus}\n\nUser request:\n${rawText}`
    : focus

  return {
    kind,
    rawText,
    userRequest,
    generationCount: ITERATION_CANDIDATE_COUNT,
    autoSubmit: false,
  }
}

/** Quick action: set kind + seed text. Never triggers a provider call. */
export function applyAskQuickAction(kind: AskRequestKind): {
  kind: AskRequestKind
  seedText: string
  autoSubmit: false
} {
  const action =
    ASK_QUICK_ACTIONS.find((a) => a.id === kind) || ASK_QUICK_ACTIONS[0]
  return {
    kind: action.id,
    seedText: action.seedText,
    autoSubmit: false,
  }
}

/** Design starter click: populate input only. */
export function applyDesignStarter(prompt: string): {
  kind: 'design'
  seedText: string
  autoSubmit: false
} {
  return {
    kind: 'design',
    seedText: prompt.trim(),
    autoSubmit: false,
  }
}

export function canSubmitAskEvoStack(opts: {
  hasActiveVersion: boolean
  text: string
  busy?: boolean
  minLength?: number
}): { ok: boolean; reason?: string } {
  if (!opts.hasActiveVersion) {
    return {
      ok: false,
      reason: 'Generate or select an application first (Use this version).',
    }
  }
  if (opts.busy) {
    return { ok: false, reason: 'An improvement is already running.' }
  }
  const min = opts.minLength ?? 3
  if (opts.text.trim().length < min) {
    return { ok: false, reason: 'Describe what you want to change.' }
  }
  return { ok: true }
}

/**
 * Prepare a single Improve submission for the existing pipeline.
 * Does not call any API — returns the payload the UI should pass to handleEvolve once.
 */
export function prepareAskEvoStackSubmit(opts: {
  kind?: AskRequestKind
  text: string
  hasActiveVersion: boolean
  busy?: boolean
}): {
  ok: boolean
  reason?: string
  composed?: ComposeAskResult
  /** Confirms exactly one generation when ok. */
  generationCount: number
} {
  const gate = canSubmitAskEvoStack({
    hasActiveVersion: opts.hasActiveVersion,
    text: opts.text,
    busy: opts.busy,
  })
  if (!gate.ok) {
    return { ok: false, reason: gate.reason, generationCount: 0 }
  }
  const composed = composeAskEvoStackRequest({
    kind: opts.kind,
    text: opts.text,
  })
  return {
    ok: true,
    composed,
    generationCount: composed.generationCount,
  }
}

/**
 * Build iteration context for Ask EvoStack using the existing evolution helper.
 * Always single-candidate (ITERATION_CANDIDATE_COUNT = 1).
 */
export function buildAskEvoStackIterationContext(opts: {
  brain: ProjectBrain
  kind?: AskRequestKind
  text: string
  baselineFragment?: DeepPartial<FragmentSchema> | FragmentSchema | null
  previousScore?: number
}): {
  context: EvolutionIterationContext
  composed: ComposeAskResult
  generationCount: typeof ITERATION_CANDIDATE_COUNT
} {
  const composed = composeAskEvoStackRequest({
    kind: opts.kind,
    text: opts.text,
  })
  const context = buildIterationContext({
    brain: opts.brain,
    userRequest: composed.userRequest,
    baselineFragment: opts.baselineFragment,
    previousScore: opts.previousScore,
  })
  return {
    context,
    composed,
    generationCount: ITERATION_CANDIDATE_COUNT,
  }
}

/** Tiny active-version label for the command center. */
export function formatActiveVersionLabel(opts: {
  version?: number | null
  productName?: string | null
}): string | null {
  if (opts.version == null || opts.version < 1) return null
  const name = (opts.productName || '').trim() || 'Untitled'
  return `Active: v${opts.version} · ${name}`
}

/**
 * Cost transparency copy — no fake token estimates.
 * Always "1 generation" for Ask EvoStack / Improve.
 */
export function askEvoStackCostCopy(): {
  title: string
  detail: string
  generations: number
} {
  return {
    title: 'Improve active app',
    detail: '1 generation · existing verification pipeline',
    generations: ITERATION_CANDIDATE_COUNT,
  }
}

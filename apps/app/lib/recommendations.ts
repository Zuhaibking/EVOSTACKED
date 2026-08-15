/**
 * Deterministic EvoStack Recommendations — zero provider / LLM calls.
 * Derived only from Project Brain + verification / smoke / architecture / contracts.
 */
import type { ProjectBrain } from '@/lib/project-brain'
import type { SourceDiff } from '@/lib/source-diff'

export type RecommendationPriority = 'high' | 'medium' | 'low'

export type EvoStackRecommendation = {
  id: string
  title: string
  explanation: string
  priority: RecommendationPriority
  /** Ready-to-send Improve-this-app request (one generation). */
  improveRequest: string
  icon: 'ui' | 'ux' | 'speed' | 'a11y' | 'quality' | 'architecture'
}

function pushUnique(
  list: EvoStackRecommendation[],
  item: EvoStackRecommendation,
  max = 3,
) {
  if (list.length >= max) return
  if (list.some((x) => x.id === item.id)) return
  list.push(item)
}

/**
 * Build up to 3 local recommendations for the active app.
 * Never calls a model.
 */
export function buildRecommendations(opts: {
  brain: ProjectBrain
  diff?: SourceDiff | null
}): EvoStackRecommendation[] {
  const { brain, diff } = opts
  const out: EvoStackRecommendation[] = []

  if (brain.architectureCompliance?.status === 'failed') {
    pushUnique(out, {
      id: 'fix-architecture',
      title: 'Fix architecture gaps',
      explanation:
        brain.architectureCompliance.summary ||
        'Architecture compliance failed — align implementation with the shared plan.',
      priority: 'high',
      improveRequest:
        'Fix architecture compliance issues so the app matches the shared ApplicationPlan requirements without adding unnecessary infrastructure.',
      icon: 'architecture',
    })
  }

  if (brain.verification?.status === 'failed') {
    pushUnique(out, {
      id: 'fix-runtime',
      title: 'Stabilize runtime',
      explanation:
        brain.verification.errors?.[0] ||
        'Runtime verification failed — repair boot and preview reliability.',
      priority: 'high',
      improveRequest:
        'Fix runtime errors so the app boots reliably and the preview becomes reachable without changing the product goal.',
      icon: 'quality',
    })
  }

  if (
    brain.smoke?.status === 'failed' ||
    brain.smoke?.status === 'timeout'
  ) {
    pushUnique(out, {
      id: 'fix-smoke',
      title: 'Improve interaction flow',
      explanation:
        brain.smoke.summary ||
        'Smoke tests failed — tighten critical user interactions and accessible names.',
      priority: 'high',
      improveRequest:
        'Fix failing interactions and smoke-test flows. Keep accessible names aligned with interaction contracts and make the primary user journey reliable.',
      icon: 'speed',
    })
  }

  const contracts = brain.plan?.interactionContracts || []
  if (contracts.length > 0 && brain.smoke?.status !== 'passed') {
    pushUnique(out, {
      id: 'honor-contracts',
      title: 'Complete interaction contracts',
      explanation: `${contracts.length} shared contract(s) should remain fully working after iteration.`,
      priority: 'medium',
      improveRequest: `Ensure every interaction contract still works with exact accessible names: ${contracts
        .map((c) => c.name || c.id)
        .filter(Boolean)
        .slice(0, 5)
        .join(', ')}.`,
      icon: 'ux',
    })
  }

  if (brain.verification?.warnings && brain.verification.warnings.length > 0) {
    pushUnique(out, {
      id: 'clear-warnings',
      title: 'Clear runtime warnings',
      explanation: brain.verification.warnings[0],
      priority: 'medium',
      improveRequest:
        'Address runtime warnings while preserving existing features and layout.',
      icon: 'quality',
    })
  }

  // Visual / mobile heuristics from plan + file tree.
  const tree = brain.fileTree || []
  const hasChart = tree.some((p) => /chart|graph|analytics/i.test(p))
  const hasNav = tree.some((p) => /nav|sidebar|menu/i.test(p))
  const pages = brain.plan?.pages?.length || 0

  if (!hasChart && /dashboard|stats|analytics|attendance/i.test(
    `${brain.plan?.productName || ''} ${brain.plan?.coreFeatures?.join(' ') || ''}`,
  )) {
    pushUnique(out, {
      id: 'visual-hierarchy',
      title: 'Improve visual hierarchy',
      explanation:
        'Dashboard-style products benefit from clearer hierarchy and a focused primary chart or summary.',
      priority: 'medium',
      improveRequest:
        'Improve visual hierarchy on the main dashboard: clearer typography scale, spacing, and a focused summary/chart without clutter.',
      icon: 'ui',
    })
  }

  if (pages > 1 || !hasNav) {
    pushUnique(out, {
      id: 'mobile-ux',
      title: 'Improve mobile UX',
      explanation:
        'Multi-screen apps need a clearer mobile navigation and touch-friendly controls.',
      priority: out.length ? 'low' : 'medium',
      improveRequest:
        'Improve the mobile experience: responsive layout, clearer mobile navigation, and touch-friendly primary actions.',
      icon: 'ux',
    })
  }

  if (diff && diff.modifiedFiles.length === 0 && out.length < 3) {
    pushUnique(out, {
      id: 'polish-interactions',
      title: 'Improve interaction flow',
      explanation:
        'Strengthen the primary user journey with clearer feedback and fewer dead ends.',
      priority: 'low',
      improveRequest:
        'Improve interaction flow: clearer empty states, form validation feedback, and smoother primary task completion.',
      icon: 'speed',
    })
  }

  // Always offer at least one gentle polish if nothing else fired.
  if (out.length === 0) {
    pushUnique(out, {
      id: 'visual-hierarchy',
      title: 'Improve visual hierarchy',
      explanation:
        'Tighten typography, spacing, and section hierarchy for a more productized feel.',
      priority: 'medium',
      improveRequest:
        'Improve visual hierarchy and polish: consistent spacing, stronger headings, and a cleaner primary view without changing core features.',
      icon: 'ui',
    })
    pushUnique(out, {
      id: 'mobile-ux',
      title: 'Improve mobile UX',
      explanation: 'Make the active layout more comfortable on small screens.',
      priority: 'medium',
      improveRequest:
        'Improve mobile UX: responsive layout, readable tap targets, and clearer mobile navigation.',
      icon: 'ux',
    })
    pushUnique(out, {
      id: 'interaction-flow',
      title: 'Improve interaction flow',
      explanation: 'Reduce friction in the primary task path.',
      priority: 'low',
      improveRequest:
        'Improve interaction flow for the primary user goal with clearer feedback and fewer steps.',
      icon: 'speed',
    })
  }

  return out.slice(0, 3)
}

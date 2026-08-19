/**
 * Tournament candidate generation queue helpers.
 * Pure / testable — no network. Route uses these policies.
 */
import type { ApplicationPlan } from '@/lib/plan'
import { adviseStacks } from '@/lib/stack-advisor'
import { PROVIDER_MAX_ATTEMPTS } from '@/lib/provider-retry'
import { getTemplateId, stackLabelForTemplate, type Templates } from '@/lib/templates'
import { VARIANTS, type VariantId } from '@/lib/tournament'

export type GenerationQueueItem = {
  id: VariantId
  label: string
  order: number
}

export type AssignedVariantTemplate = {
  id: string
  catalog: Templates
  stackLabel: string
  repeated?: boolean
}

function assignedFromId(
  catalog: Templates,
  id: string,
  repeated = false,
): AssignedVariantTemplate {
  const subset = pickTemplateSubset(catalog, id) || catalog
  const assignedId = Object.keys(subset)[0] || id
  const label = stackLabelForTemplate(assignedId)
  return {
    id: assignedId,
    catalog: subset,
    stackLabel: repeated ? `${label} (repeat)` : label,
    repeated,
  }
}

/**
 * When the user selected Auto (full catalog) and there is no single strong
 * template preference, assign different templates to Product / Premium / Innovate.
 * Uses the deterministic stack advisor (prompt + plan). Falls back to repeats
 * if the catalog is small or the plan needs a web stack.
 */
export function assignDiverseTemplates(opts: {
  catalog: Templates
  variantIds: VariantId[]
  plan?: ApplicationPlan | null
  prompt?: string | null
}): Record<VariantId, AssignedVariantTemplate> {
  const catalog = opts.catalog
  const keys = Object.keys(catalog)
  const fallbackId = keys[0] || ''
  const out = {} as Record<VariantId, AssignedVariantTemplate>
  if (!fallbackId) {
    for (const id of opts.variantIds) {
      out[id] = { id: '', catalog, stackLabel: 'Unknown' }
    }
    return out
  }

  if (!catalogLooksLikeAuto(catalog)) {
    const assigned = assignedFromId(catalog, fallbackId)
    for (const id of opts.variantIds) {
      out[id] = assigned
    }
    return out
  }

  const advice = adviseStacks({
    prompt: opts.prompt,
    plan: opts.plan,
    catalog,
    count: opts.variantIds.length,
  })
  opts.variantIds.forEach((variantId, index) => {
    const pick = advice.picks[index] || advice.picks[0]
    out[variantId] = assignedFromId(
      catalog,
      pick?.templateId || fallbackId,
      pick?.repeated,
    )
    if (pick?.stackLabel) {
      out[variantId] = {
        ...out[variantId],
        stackLabel: pick.stackLabel,
        repeated: pick.repeated,
      }
    }
  })
  return out
}

export function catalogLooksLikeAuto(catalog: Templates | null | undefined): boolean {
  return !!catalog && Object.keys(catalog).length > 1
}

export function pickTemplateSubset(
  catalog: Templates,
  id: string,
): Templates | null {
  if (!id || !catalog) return null
  if (Object.prototype.hasOwnProperty.call(catalog, id)) {
    const entry = catalog[id as keyof Templates]
    if (!entry) return null
    return { [id]: entry } as Templates
  }
  const base = getTemplateId(id)
  for (const key of Object.keys(catalog)) {
    if (getTemplateId(key) === base) {
      const entry = catalog[key as keyof Templates]
      if (!entry) continue
      return { [key]: entry } as Templates
    }
  }
  return null
}

/** Stamp the assigned template id/port so sandbox + fragment stay aligned. */
export function applyAssignedTemplate(
  fragment: any,
  assigned: AssignedVariantTemplate | undefined,
): any {
  if (!fragment || typeof fragment !== 'object' || !assigned?.id) return fragment
  const meta = assigned.catalog[assigned.id as keyof Templates] as
    | { port?: number | null }
    | undefined
  return {
    ...fragment,
    template: assigned.id,
    port: meta && 'port' in meta ? meta.port : fragment.port,
  }
}

export type ParallelJobResult<T> =
  | { item: GenerationQueueItem; ok: true; value: T }
  | { item: GenerationQueueItem; ok: false; error: unknown }

/** Product → Premium → Innovate order used as the parallel input order. */
export function buildCandidateGenerationQueue(
  ids?: VariantId[],
): GenerationQueueItem[] {
  const list = ids
    ? VARIANTS.filter((v) => ids.includes(v.id))
    : [...VARIANTS]
  return list.map((v, order) => ({
    id: v.id,
    label: v.label,
    order,
  }))
}

export function assertConcurrentGenerationPolicy(): {
  concurrent: true
  queueSize: number
  maxAttemptsPerCandidate: number
} {
  return {
    concurrent: true,
    queueSize: VARIANTS.length,
    maxAttemptsPerCandidate: PROVIDER_MAX_ATTEMPTS,
  }
}

/**
 * Fan out candidate jobs so every job is invoked before any awaited work
 * inside a job can complete. One thrown error never drops sibling results.
 */
export async function runParallelCandidateJobs<T>(
  queue: GenerationQueueItem[],
  job: (item: GenerationQueueItem) => Promise<T>,
): Promise<ParallelJobResult<T>[]> {
  return Promise.all(
    queue.map(async (item) => {
      try {
        const value = await job(item)
        return { item, ok: true as const, value }
      } catch (error) {
        return { item, ok: false as const, error }
      }
    }),
  )
}

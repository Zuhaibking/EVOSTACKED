/**
 * Sequential tournament candidate generation queue helpers.
 * Pure / testable — no network. Route uses these policies.
 */
import { VARIANTS, type VariantId } from '@/lib/tournament'
import { PROVIDER_MAX_ATTEMPTS } from '@/lib/provider-retry'

export type GenerationQueueItem = {
  id: VariantId
  label: string
  order: number
}

/** Exact Product → Premium → Innovate order (never concurrent policy). */
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

export function assertSequentialGenerationPolicy(): {
  concurrent: false
  queueSize: number
  maxAttemptsPerCandidate: number
} {
  return {
    concurrent: false,
    queueSize: VARIANTS.length,
    maxAttemptsPerCandidate: PROVIDER_MAX_ATTEMPTS,
  }
}

/**
 * Simulate a sequential runner for tests — invokes one at a time.
 */
export async function runSequentialCandidateJobs<T>(
  queue: GenerationQueueItem[],
  job: (item: GenerationQueueItem) => Promise<T>,
): Promise<T[]> {
  const out: T[] = []
  for (const item of queue) {
    out.push(await job(item))
  }
  return out
}

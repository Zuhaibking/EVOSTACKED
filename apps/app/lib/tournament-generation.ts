/**
 * Tournament candidate generation queue helpers.
 * Pure / testable — no network. Route uses these policies.
 */
import { VARIANTS, type VariantId } from '@/lib/tournament'
import { PROVIDER_MAX_ATTEMPTS } from '@/lib/provider-retry'

export type GenerationQueueItem = {
  id: VariantId
  label: string
  order: number
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

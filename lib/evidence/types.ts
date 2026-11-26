/** Evidence-based judging — measured facts per tournament candidate (shared contract). */
export type EvidenceMetrics = {
  measuredAt: string
  coldStartMs: number | null // sandbox create → first healthy HTTP response
  ttfbP50Ms: number | null
  ttfbP95Ms: number | null
  requests: number // requests fired in the load burst
  errorRate: number // 0..1 non-2xx/failed in the burst
  rps: number | null // achieved throughput in the burst
  htmlBytes: number | null
  jsBytes: number | null
  cssBytes: number | null
  imageCount: number | null
  a11y: { score: number; issues: string[] } // 0..100 heuristic audit
  seo: { score: number; issues: string[] }
  bestPractices: { score: number; issues: string[] }
  typecheckOk: boolean | null
  repairs: number | null
  runtimeErrors: number | null
  notes: string[]
}

export type EvidenceWeights = { performance: number; reliability: number; quality: number; design: number }
export const DEFAULT_WEIGHTS: EvidenceWeights = { performance: 30, reliability: 30, quality: 20, design: 20 }

export type EvidenceScore = {
  total: number // 0..100
  parts: { performance: number; reliability: number; quality: number; design: number } // each 0..100
  disqualified: boolean
  reasons: string[] // plain-language evidence lines ("p95 212 ms — fastest of 3")
}

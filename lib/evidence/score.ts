/**
 * Evidence scoring — turns measured EvidenceMetrics (+ optional judge scores) into a
 * weighted, field-relative score with plain-language reasons. Pure & isomorphic.
 *
 * - performance (p50 / p95 / rps / page weight) is RELATIVE to the field: the best
 *   candidate scores 100, the rest scale by ratio (with small noise floors so 12 ms vs
 *   18 ms on a dev server is not treated as a 33% gap).
 * - reliability (error rate, typecheck, repairs, runtime errors) and quality
 *   (a11y / SEO / best-practice audits) are already absolute 0–100 signals.
 * - design is the judge's clarity / fit / polish when present.
 * A part nobody in the field has data for is dropped and its weight redistributed.
 */
import { DEFAULT_WEIGHTS, type EvidenceMetrics, type EvidenceScore, type EvidenceWeights } from './types'

export type JudgeScores = { clarity: number; fit: number; polish: number }

export type EvidenceCandidate = {
  id: string
  label?: string
  modelName?: string
  evidence?: EvidenceMetrics | null
  judge?: JudgeScores | null
  healthy?: boolean | null
}

export type RankedCandidate<T extends EvidenceCandidate = EvidenceCandidate> = {
  id: string
  candidate: T
  score: EvidenceScore
  /** 1-based. Measured & eligible first, then not-yet-measured, then disqualified. */
  rank: number
  measured: boolean
}

type PartKey = keyof EvidenceWeights
export const PART_KEYS: PartKey[] = ['performance', 'reliability', 'quality', 'design']

/** Noise floors for lower-is-better metrics (values below are treated as equal). */
const FLOOR = { p50: 15, p95: 30, bytes: 50 * 1024 }
const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n))
const isNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)

/* ───────────────────────────── formatting ───────────────────────────── */

export function formatMs(ms: number | null | undefined): string {
  if (!isNum(ms)) return '—'
  return ms < 10 ? `${ms.toFixed(1)} ms` : `${Math.round(ms).toLocaleString('en-US')} ms`
}

export function formatKB(bytes: number | null | undefined): string {
  if (!isNum(bytes)) return '—'
  const kb = bytes / 1024
  if (kb >= 1024) return `${(kb / 1024).toFixed(1)} MB`
  return `${kb < 10 ? kb.toFixed(1) : Math.round(kb).toLocaleString('en-US')} KB`
}

export function formatPercent(rate: number | null | undefined): string {
  if (!isNum(rate)) return '—'
  const pct = rate * 100
  return `${pct === 0 ? '0' : pct < 10 ? pct.toFixed(1) : Math.round(pct)}%`
}

/** Judge scores arrive as 0–1 (tournament), 0–10 or 0–100 — normalise to 0–100. */
export function normalizeJudgeValue(v: number | null | undefined): number | null {
  if (!isNum(v)) return null
  if (v <= 1) return clamp(v * 100)
  if (v <= 10) return clamp(v * 10)
  return clamp(v)
}

export function designScore(judge?: JudgeScores | null): number | null {
  if (!judge) return null
  const vals = [judge.clarity, judge.fit, judge.polish].map(normalizeJudgeValue).filter(isNum)
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null
}

export function pageWeight(e?: EvidenceMetrics | null): number | null {
  if (!e) return null
  const parts = [e.htmlBytes, e.jsBytes, e.cssBytes].filter(isNum)
  return parts.length ? parts.reduce((a, b) => a + b, 0) : null
}

/* ───────────────────────────── relative helpers ───────────────────────────── */

/** 100 for the best (lowest) value in `field`, ratio-scaled otherwise. */
export function relLower(value: number | null | undefined, field: (number | null | undefined)[], floor = 0): number | null {
  if (!isNum(value)) return null
  const vals = field.filter(isNum)
  if (!vals.length) return null
  const best = Math.max(Math.min(...vals), floor)
  return clamp((100 * best) / Math.max(value, best))
}

/** 100 for the best (highest) value in `field`, ratio-scaled otherwise. */
export function relHigher(value: number | null | undefined, field: (number | null | undefined)[]): number | null {
  if (!isNum(value)) return null
  const vals = field.filter(isNum)
  if (!vals.length) return null
  const best = Math.max(...vals)
  return best > 0 ? clamp((100 * value) / best) : 100
}

/** Weighted mean over components; a component nobody has is skipped, one only others have counts as 0. */
function blend(items: { weight: number; value: number | null; fieldHas: boolean }[]): number | null {
  const used = items.filter((i) => i.fieldHas)
  if (!used.length) return null
  const w = used.reduce((s, i) => s + i.weight, 0)
  return used.reduce((s, i) => s + i.weight * (i.value ?? 0), 0) / w
}

/* ───────────────────────────── disqualification ───────────────────────────── */

export function disqualification(c: EvidenceCandidate): string | null {
  if (c.healthy === false) return 'Preview failed its health checks'
  const e = c.evidence
  if (e && e.errorRate > 0.5) {
    if (!e.requests) return 'Server never returned a response'
    return `${formatPercent(e.errorRate)} of ${e.requests} requests failed`
  }
  return null
}

/* ───────────────────────────── field statistics ───────────────────────────── */

type Field = {
  eligible: EvidenceCandidate[]
  p50: (number | null)[]
  p95: (number | null)[]
  rps: (number | null)[]
  weight: (number | null)[]
  quality: (number | null)[]
  design: (number | null)[]
  has: Record<PartKey, boolean>
}

function qualityScore(e?: EvidenceMetrics | null): number | null {
  if (!e || e.htmlBytes == null) return null
  return 0.4 * e.a11y.score + 0.3 * e.seo.score + 0.3 * e.bestPractices.score
}

function reliabilityScore(e?: EvidenceMetrics | null): number | null {
  if (!e) return null
  return blend([
    { weight: 0.45, value: e.requests ? clamp(100 * (1 - Math.min(1, e.errorRate * 2))) : null, fieldHas: e.requests > 0 },
    { weight: 0.2, value: e.typecheckOk == null ? null : e.typecheckOk ? 100 : 0, fieldHas: e.typecheckOk != null },
    { weight: 0.15, value: isNum(e.repairs) ? clamp(100 - 25 * e.repairs) : null, fieldHas: isNum(e.repairs) },
    { weight: 0.2, value: isNum(e.runtimeErrors) ? clamp(100 - 50 * e.runtimeErrors) : null, fieldHas: isNum(e.runtimeErrors) },
  ])
}

function buildField(all: EvidenceCandidate[]): Field {
  const eligible = all.filter((c) => !disqualification(c))
  const ev = eligible.map((c) => c.evidence)
  const field: Field = {
    eligible,
    p50: ev.map((e) => e?.ttfbP50Ms ?? null),
    p95: ev.map((e) => e?.ttfbP95Ms ?? null),
    rps: ev.map((e) => e?.rps ?? null),
    weight: ev.map(pageWeight),
    quality: ev.map(qualityScore),
    design: eligible.map((c) => designScore(c.judge)),
    has: { performance: false, reliability: false, quality: false, design: false },
  }
  field.has.performance = [...field.p50, ...field.p95, ...field.rps, ...field.weight].some(isNum)
  field.has.reliability = ev.some((e) => reliabilityScore(e) != null)
  field.has.quality = field.quality.some(isNum)
  field.has.design = field.design.some(isNum)
  return field
}

/* ───────────────────────────── scoring ───────────────────────────── */

type Reason = { text: string; strength: number }

function normWeights(w: EvidenceWeights, has: Record<PartKey, boolean>): Record<PartKey, number> {
  const raw = Object.fromEntries(PART_KEYS.map((k) => [k, has[k] ? Math.max(0, isNum(w[k]) ? w[k] : 0) : 0])) as Record<PartKey, number>
  const sum = PART_KEYS.reduce((s, k) => s + raw[k], 0)
  if (sum > 0) return raw
  // Every weight at zero → treat available parts equally.
  return Object.fromEntries(PART_KEYS.map((k) => [k, has[k] ? 1 : 0])) as Record<PartKey, number>
}

function scoreWithField(c: EvidenceCandidate, field: Field, weights: EvidenceWeights): EvidenceScore {
  const reasons: Reason[] = []
  const dq = disqualification(c)
  const e = c.evidence ?? null
  // "fastest of N" counts only eligible candidates that actually have the metric.
  const ofN = (what: string, vals: (number | null)[]) => {
    const n = vals.filter(isNum).length
    return n > 1 ? ` — ${what} of ${n}` : ''
  }
  const isBest = (v: number | null, vals: (number | null)[], lower: boolean) => {
    if (dq) return false // no comparative claims for a disqualified candidate
    const xs = vals.filter(isNum)
    if (!isNum(v) || xs.length < 2) return false
    return lower ? v <= Math.min(...xs) : v >= Math.max(...xs)
  }

  // Performance
  const p50 = e?.ttfbP50Ms ?? null
  const p95 = e?.ttfbP95Ms ?? null
  const rps = e?.rps ?? null
  const weight = pageWeight(e)
  const performance = blend([
    { weight: 0.25, value: relLower(p50, field.p50, FLOOR.p50), fieldHas: field.p50.some(isNum) },
    { weight: 0.35, value: relLower(p95, field.p95, FLOOR.p95), fieldHas: field.p95.some(isNum) },
    { weight: 0.2, value: relHigher(rps, field.rps), fieldHas: field.rps.some(isNum) },
    { weight: 0.2, value: relLower(weight, field.weight, FLOOR.bytes), fieldHas: field.weight.some(isNum) },
  ])
  if (isNum(p95)) {
    const best = Math.min(...field.p95.filter(isNum))
    reasons.push(isBest(p95, field.p95, true)
      ? { text: `p95 ${formatMs(p95)}${ofN('fastest', field.p95)}`, strength: 5 }
      : { text: `p95 ${formatMs(p95)}${isNum(best) && best !== p95 ? ` (fastest ${formatMs(best)})` : ''}`, strength: 1 })
  }
  if (isNum(p50) && isBest(p50, field.p50, true)) reasons.push({ text: `p50 ${formatMs(p50)}${ofN('fastest', field.p50)}`, strength: 3 })
  if (isNum(rps)) {
    reasons.push(isBest(rps, field.rps, false)
      ? { text: `${rps.toFixed(rps < 10 ? 1 : 0)} req/s${ofN('highest throughput', field.rps)}`, strength: 3 }
      : { text: `${rps.toFixed(rps < 10 ? 1 : 0)} req/s throughput`, strength: 0 })
  }
  if (isNum(weight)) {
    const js = e?.jsBytes
    const detail = isNum(js) ? ` (JS ${formatKB(js)})` : ''
    reasons.push(isBest(weight, field.weight, true)
      ? { text: `Page weight ${formatKB(weight)}${detail}${ofN('lightest', field.weight)}`, strength: 3 }
      : { text: `Page weight ${formatKB(weight)}${detail}`, strength: 0 })
  }

  // Reliability
  const reliability = reliabilityScore(e)
  if (e) {
    if (e.requests > 0) {
      const errs = Math.round(e.errorRate * e.requests)
      reasons.push(errs === 0
        ? { text: `0 errors in ${e.requests} requests`, strength: 4 }
        : { text: `${errs} error${errs === 1 ? '' : 's'} in ${e.requests} requests (${formatPercent(e.errorRate)})`, strength: -2 })
    }
    if (e.typecheckOk === true) reasons.push({ text: 'Typecheck passed', strength: 2 })
    if (e.typecheckOk === false) reasons.push({ text: 'Typecheck failed', strength: -2 })
    if (isNum(e.repairs)) reasons.push(e.repairs === 0
      ? { text: 'No auto-repairs needed', strength: 2 }
      : { text: `Needed ${e.repairs} auto-repair${e.repairs === 1 ? '' : 's'}`, strength: -1 })
    if (isNum(e.runtimeErrors) && e.runtimeErrors > 0) {
      reasons.push({ text: `${e.runtimeErrors} runtime error${e.runtimeErrors === 1 ? '' : 's'} reported`, strength: -2 })
    }
  }

  // Quality
  const quality = qualityScore(e)
  if (e && e.htmlBytes != null) {
    const audits: [string, { score: number; issues: string[] }][] = [
      ['A11y', e.a11y],
      ['SEO', e.seo],
      ['Best practices', e.bestPractices],
    ]
    for (const [name, a] of audits) {
      const issues = a.issues.length
      const bestOfField = isBest(quality, field.quality, false)
      reasons.push({
        text: `${name} ${a.score} (${issues === 0 ? 'no issues' : `${issues} issue${issues === 1 ? '' : 's'}`})`,
        strength: a.score >= 90 ? (bestOfField ? 3 : 2) : a.score >= 70 ? 0 : -1,
      })
    }
  }

  // Design
  const design = designScore(c.judge)
  if (isNum(design) && c.judge) {
    const [cl, fi, po] = [c.judge.clarity, c.judge.fit, c.judge.polish].map((v) => Math.round(normalizeJudgeValue(v) ?? 0))
    reasons.push({
      text: `Judge: clarity ${cl} · fit ${fi} · polish ${po}${isBest(design, field.design, false) ? ofN('best design', field.design) : ''}`,
      strength: isBest(design, field.design, false) ? 3 : 0,
    })
  }

  const parts = { performance, reliability, quality, design }
  const w = normWeights(weights, field.has)
  const wSum = PART_KEYS.reduce((s, k) => s + w[k], 0)
  const total = wSum ? PART_KEYS.reduce((s, k) => s + w[k] * (parts[k] ?? 0), 0) / wSum : 0

  if (!e && !dq) reasons.unshift({ text: 'Not measured yet', strength: 10 })
  if (dq) reasons.unshift({ text: `Disqualified — ${dq}`, strength: 99 })

  return {
    total: dq ? 0 : Math.round(clamp(total) * 10) / 10,
    parts: {
      performance: Math.round(parts.performance ?? 0),
      reliability: Math.round(parts.reliability ?? 0),
      quality: Math.round(parts.quality ?? 0),
      design: Math.round(parts.design ?? 0),
    },
    disqualified: !!dq,
    reasons: reasons
      .map((r, i) => ({ ...r, i }))
      .sort((a, b) => b.strength - a.strength || a.i - b.i)
      .map((r) => r.text),
  }
}

/** Score one candidate relative to `all` (which should include it). */
export function evidenceScore(
  candidate: EvidenceCandidate,
  all: EvidenceCandidate[],
  weights: EvidenceWeights = DEFAULT_WEIGHTS,
): EvidenceScore {
  const field = buildField(all.some((c) => c.id === candidate.id) ? all : [...all, candidate])
  return scoreWithField(candidate, field, weights)
}

/** Score and sort a field. Eligible measured candidates first (by total), then unmeasured, then DQ. */
export function rankCandidates<T extends EvidenceCandidate>(
  all: T[],
  weights: EvidenceWeights = DEFAULT_WEIGHTS,
): RankedCandidate<T>[] {
  const field = buildField(all)
  const tier = (r: { candidate: T; score: EvidenceScore }) => (r.score.disqualified ? 2 : r.candidate.evidence ? 0 : 1)
  return all
    .map((candidate) => ({ candidate, score: scoreWithField(candidate, field, weights) }))
    .sort((a, b) =>
      tier(a) - tier(b) ||
      b.score.total - a.score.total ||
      (a.candidate.evidence?.ttfbP95Ms ?? Infinity) - (b.candidate.evidence?.ttfbP95Ms ?? Infinity) ||
      a.candidate.id.localeCompare(b.candidate.id))
    .map((r, i) => ({ id: r.candidate.id, candidate: r.candidate, score: r.score, rank: i + 1, measured: !!r.candidate.evidence }))
}

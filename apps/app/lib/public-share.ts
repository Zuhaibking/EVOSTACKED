/**
 * Sanitize tournament artifacts for the unlisted public share page.
 * No API keys. Fragment file bodies are secret-scrubbed.
 */
import { getFragmentFiles } from '@/lib/fragment'
import { scrubSecrets } from '@/lib/source-diff'
import { VARIANTS, type VariantId } from '@/lib/tournament'
import type { GenerationCostSummary } from '@/lib/generation-cost'
import type { ProjectExportMeta } from '@/lib/project-export'

export type PublicShareScores = {
  clarity?: number
  fit?: number
  polish?: number
  composite?: number
  comment?: string
}

export type PublicShareCandidate = {
  variantId: VariantId
  variant: string
  status: string
  scores: PublicShareScores | null
  previewUrl: string | null
  previewExpired: boolean
  template: string | null
  error: string | null
  verificationSummary: string | null
  smokeSummary: string | null
  architectureSummary: string | null
  repairNotes: string | null
  fragment: {
    title?: string
    template?: string
    file_path?: string
    code: Array<{ file_path: string; file_content: string }>
  } | null
}

export type PublicSharePayload = {
  runId: string
  prompt: string
  productName: string
  plan: {
    productName: string
    productGoal: string
    coreFeatures: string[]
    pages: Array<{ name: string; path: string; purpose: string }>
  } | null
  recommendation: {
    winnerId: VariantId
    reasoning: string
  } | null
  health: { score: number; statusLabel: string } | null
  usage: Pick<
    GenerationCostSummary,
    'modelId' | 'inputTokens' | 'outputTokens' | 'totalTokens' | 'estimatedUsd'
  > | null
  candidates: PublicShareCandidate[]
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function textFromMessage(content: unknown): string {
  if (typeof content === 'string') return content.trim()
  if (Array.isArray(content)) {
    return content
      .map((c) =>
        c && typeof c === 'object' && (c as { type?: string }).type === 'text'
          ? String((c as { text?: string }).text || '')
          : '',
      )
      .join('\n')
      .trim()
  }
  if (content && typeof content === 'object') {
    const nested = (content as { content?: unknown }).content
    if (nested != null) return textFromMessage(nested)
  }
  return ''
}

export function promptFromMessages(messages: unknown[]): string {
  for (const raw of messages) {
    const row = asRecord(raw)
    if (!row) continue
    const inner = asRecord(row.content) || row
    const role = String(inner.role || row.role || '')
    if (role !== 'user') continue
    const text = textFromMessage(inner.content ?? row.content)
    if (text) return scrubSecrets(text).slice(0, 4000)
  }
  return ''
}

function compactPlan(brain: Record<string, unknown> | null): PublicSharePayload['plan'] {
  const plan = asRecord(brain?.plan)
  if (!plan) return null
  const pages = Array.isArray(plan.pages)
    ? plan.pages
        .map((p) => {
          const row = asRecord(p)
          if (!row) return null
          return {
            name: String(row.name || ''),
            path: String(row.path || ''),
            purpose: String(row.purpose || ''),
          }
        })
        .filter((p): p is { name: string; path: string; purpose: string } => !!p)
    : []
  return {
    productName: String(plan.productName || 'Untitled'),
    productGoal: String(plan.productGoal || ''),
    coreFeatures: Array.isArray(plan.coreFeatures)
      ? plan.coreFeatures.filter((x): x is string => typeof x === 'string')
      : [],
    pages,
  }
}

function scrubFragment(raw: unknown): PublicShareCandidate['fragment'] {
  if (!raw || typeof raw !== 'object') return null
  const frag = raw as {
    title?: string
    template?: string
    file_path?: string
    code?: Array<{ file_path?: string; file_content?: string }> | string
  }
  const files = getFragmentFiles(frag).map((f) => ({
    file_path: f.file_path,
    file_content: scrubSecrets(f.file_content),
  }))
  if (!files.length) return null
  return {
    title: typeof frag.title === 'string' ? frag.title : undefined,
    template: typeof frag.template === 'string' ? frag.template : undefined,
    file_path: typeof frag.file_path === 'string' ? frag.file_path : undefined,
    code: files,
  }
}

function asVariantId(id: string): VariantId | null {
  if (id === 'minimal' || id === 'rich' || id === 'playful') return id
  return null
}

export function buildPublicSharePayload(input: {
  runId: string
  messages: unknown[]
  brain?: unknown
  candidates: Array<{
    variantId: string
    status: string
    data: unknown
  }>
}): PublicSharePayload {
  const brain = asRecord(input.brain)
  const plan = compactPlan(brain)
  const judge = asRecord(brain?.judge)
  const healthRaw = asRecord(brain?.generationHealth) || asRecord(brain?.health)
  const usageRaw = asRecord(brain?.generationUsage)
  const prompt =
    promptFromMessages(input.messages) ||
    (Array.isArray(brain?.userRequests)
      ? String(brain.userRequests[0] || '')
      : '')

  const latest = new Map<VariantId, PublicShareCandidate>()
  for (const row of input.candidates) {
    const id = asVariantId(row.variantId)
    if (!id) continue
    const data = asRecord(row.data) || {}
    const scores = asRecord(data.scores)
    const previewUrl =
      typeof data.previewUrl === 'string' && data.previewUrl.startsWith('http')
        ? data.previewUrl
        : null
    latest.set(id, {
      variantId: id,
      variant:
        typeof data.variant === 'string'
          ? data.variant
          : VARIANTS.find((v) => v.id === id)?.label || id,
      status: row.status,
      scores: scores
        ? {
            clarity: Number(scores.clarity),
            fit: Number(scores.fit),
            polish: Number(scores.polish),
            composite: Number(scores.composite),
            comment:
              typeof scores.comment === 'string' ? scores.comment : undefined,
          }
        : null,
      previewUrl,
      previewExpired: !previewUrl,
      template: typeof data.template === 'string' ? data.template : null,
      error: typeof data.error === 'string' ? data.error : null,
      verificationSummary:
        typeof data.verificationSummary === 'string'
          ? data.verificationSummary
          : null,
      smokeSummary:
        typeof data.smokeSummary === 'string' ? data.smokeSummary : null,
      architectureSummary:
        typeof data.architectureSummary === 'string'
          ? data.architectureSummary
          : null,
      repairNotes:
        typeof data.repairNotes === 'string' ? data.repairNotes : null,
      fragment: scrubFragment(data.fragment),
    })
  }

  const candidates = VARIANTS.map(
    (v) =>
      latest.get(v.id) || {
        variantId: v.id,
        variant: v.label,
        status: 'missing',
        scores: null,
        previewUrl: null,
        previewExpired: true,
        template: null,
        error: null,
        verificationSummary: null,
        smokeSummary: null,
        architectureSummary: null,
        fragment: null,
        repairNotes: null,
      },
  )

  const winnerId = asVariantId(String(judge?.winnerId || ''))
  return {
    runId: input.runId,
    prompt: scrubSecrets(prompt).slice(0, 4000),
    productName: plan?.productName || 'EvoStack tournament',
    plan,
    recommendation: winnerId
      ? {
          winnerId,
          reasoning: scrubSecrets(String(judge?.reasoning || '')).slice(0, 400),
        }
      : null,
    health:
      healthRaw && typeof healthRaw.score === 'number'
        ? {
            score: Number(healthRaw.score),
            statusLabel: String(healthRaw.statusLabel || ''),
          }
        : null,
    usage:
      usageRaw && typeof usageRaw.inputTokens === 'number'
        ? {
            modelId: String(usageRaw.modelId || ''),
            inputTokens: Number(usageRaw.inputTokens),
            outputTokens: Number(usageRaw.outputTokens),
            totalTokens: Number(
              usageRaw.totalTokens ??
                Number(usageRaw.inputTokens) + Number(usageRaw.outputTokens),
            ),
            estimatedUsd: Number(usageRaw.estimatedUsd || 0),
          }
        : null,
    candidates,
  }
}

export function shareExportMeta(
  payload: PublicSharePayload,
  candidate: PublicShareCandidate,
): ProjectExportMeta {
  return {
    prompt: payload.prompt,
    plan: payload.plan,
    variantId: candidate.variantId,
    variantLabel: candidate.variant,
    scores: candidate.scores,
    health: payload.health,
    architectureSummary: candidate.architectureSummary,
    verificationSummary: candidate.verificationSummary,
    smokeSummary: candidate.smokeSummary,
    repairNotes: candidate.repairNotes,
    templateId: candidate.template || candidate.fragment?.template,
  }
}

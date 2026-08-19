/**
 * Display-only token / cost estimates. Never blocks generation.
 * Prefers provider usage when present; otherwise chars/4.
 */
import type { ApplicationPlan } from '@/lib/plan'
import { getFragmentFiles } from '@/lib/fragment'
import type { Candidate } from '@/lib/tournament-client'
import type { VariantId } from '@/lib/tournament'
import type { LLMModel } from '@/lib/model-catalog'

export type TokenUsage = {
  inputTokens: number
  outputTokens: number
}

export type ModelTokenRates = {
  /** USD per 1M input tokens */
  inputPerMillion: number
  /** USD per 1M output tokens */
  outputPerMillion: number
}

export type GenerationCostSummary = {
  modelId: string
  modelName: string
  inputTokens: number
  outputTokens: number
  totalTokens: number
  estimatedUsd: number
  calls: number
  source: 'provider' | 'estimate'
}

/** Rough public list prices — enough for a sidebar hint, not billing. */
export const MODEL_TOKEN_RATES: Record<string, ModelTokenRates> = {
  'gemini-2.0-flash': { inputPerMillion: 0.1, outputPerMillion: 0.4 },
  'gemini-2.5-flash': { inputPerMillion: 0.15, outputPerMillion: 0.6 },
  'gemini-3.6-flash': { inputPerMillion: 0.15, outputPerMillion: 0.6 },
  'llama-3.1-8b-instant': { inputPerMillion: 0.05, outputPerMillion: 0.08 },
  'openai/gpt-oss-20b': { inputPerMillion: 0.07, outputPerMillion: 0.3 },
  'llama3.1-8b': { inputPerMillion: 0.1, outputPerMillion: 0.1 },
  'openai/gpt-4o-mini': { inputPerMillion: 0.15, outputPerMillion: 0.6 },
  'mistral-small-latest': { inputPerMillion: 0.2, outputPerMillion: 0.6 },
  'minimaxai/minimax-m3': { inputPerMillion: 0.3, outputPerMillion: 1.2 },
  'google/gemma-4-31b-it': { inputPerMillion: 0.2, outputPerMillion: 0.2 },
  'gpt-4.1': { inputPerMillion: 2, outputPerMillion: 8 },
  'llama3.2': { inputPerMillion: 0, outputPerMillion: 0 },
}

const DEFAULT_RATES: ModelTokenRates = {
  inputPerMillion: 0.15,
  outputPerMillion: 0.6,
}

export function ratesForModel(modelId?: string | null): ModelTokenRates {
  if (!modelId) return DEFAULT_RATES
  if (MODEL_TOKEN_RATES[modelId]) return MODEL_TOKEN_RATES[modelId]
  const loose = Object.keys(MODEL_TOKEN_RATES).find(
    (id) => modelId.includes(id) || id.includes(modelId),
  )
  return loose ? MODEL_TOKEN_RATES[loose] : DEFAULT_RATES
}

export function estimateTokensFromText(text: string): number {
  const trimmed = text || ''
  if (!trimmed) return 0
  return Math.max(1, Math.ceil(trimmed.length / 4))
}

export function costUsd(
  usage: TokenUsage,
  rates: ModelTokenRates = DEFAULT_RATES,
): number {
  const input = (usage.inputTokens / 1_000_000) * rates.inputPerMillion
  const output = (usage.outputTokens / 1_000_000) * rates.outputPerMillion
  return Math.round((input + output) * 10000) / 10000
}

export function readProviderUsage(raw: unknown): TokenUsage {
  if (!raw || typeof raw !== 'object') {
    return { inputTokens: 0, outputTokens: 0 }
  }
  const u = raw as Record<string, unknown>
  const nested =
    u.usage && typeof u.usage === 'object'
      ? (u.usage as Record<string, unknown>)
      : u
  const input = Number(nested.promptTokens ?? nested.inputTokens ?? 0)
  const output = Number(nested.completionTokens ?? nested.outputTokens ?? 0)
  return {
    inputTokens: Number.isFinite(input) ? Math.max(0, Math.round(input)) : 0,
    outputTokens: Number.isFinite(output) ? Math.max(0, Math.round(output)) : 0,
  }
}

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
  }
}

function jsonText(value: unknown): string {
  try {
    return JSON.stringify(value) || ''
  } catch {
    return ''
  }
}

function messageText(messages: unknown[] | undefined): string {
  if (!messages?.length) return ''
  return messages
    .map((m) => {
      if (!m || typeof m !== 'object') return ''
      const content = (m as { content?: unknown }).content
      if (typeof content === 'string') return content
      if (Array.isArray(content)) {
        return content
          .map((c) =>
            c && typeof c === 'object' && (c as { type?: string }).type === 'text'
              ? String((c as { text?: string }).text || '')
              : '',
          )
          .join('\n')
      }
      return ''
    })
    .join('\n')
}

/**
 * Estimate plan + N candidate generation calls from artifacts already on the client.
 * Repair is counted when a candidate has a repairAttempt.
 */
export function estimateTournamentCost(opts: {
  model?: Pick<LLMModel, 'id' | 'name'> | { id?: string; name?: string } | null
  plan?: ApplicationPlan | null
  messages?: unknown[]
  candidates?: Partial<Record<VariantId, Candidate>> | Candidate[] | null
  isEvolution?: boolean
  providerUsage?: TokenUsage | null
}): GenerationCostSummary {
  const modelId = opts.model?.id || 'unknown'
  const modelName =
    (opts.model && 'name' in opts.model && opts.model.name) || modelId
  const rates = ratesForModel(modelId)

  if (
    opts.providerUsage &&
    (opts.providerUsage.inputTokens > 0 || opts.providerUsage.outputTokens > 0)
  ) {
    const total =
      opts.providerUsage.inputTokens + opts.providerUsage.outputTokens
    return {
      modelId,
      modelName,
      inputTokens: opts.providerUsage.inputTokens,
      outputTokens: opts.providerUsage.outputTokens,
      totalTokens: total,
      estimatedUsd: costUsd(opts.providerUsage, rates),
      calls: opts.isEvolution ? 1 : 4,
      source: 'provider',
    }
  }

  const list: Candidate[] = Array.isArray(opts.candidates)
    ? opts.candidates
    : opts.candidates
      ? Object.values(opts.candidates).filter(Boolean)
      : []

  const prompt = messageText(opts.messages)
  const planText = opts.plan ? jsonText(opts.plan) : ''
  let input = 0
  let output = 0
  let calls = 0

  if (!opts.isEvolution) {
    input += estimateTokensFromText(prompt) + 1800
    output += estimateTokensFromText(planText)
    calls += 1
  }

  for (const c of list) {
    if (!c) continue
    const files = getFragmentFiles(c.fragment)
    if (!files.length && !c.error) continue
    input += estimateTokensFromText(prompt) + estimateTokensFromText(planText) + 2400
    output += estimateTokensFromText(
      files.map((f) => f.file_content).join('\n'),
    )
    calls += 1
    if (c.repairAttempt?.attempted) {
      input += 1200
      output += 800
      calls += 1
    }
  }

  const usage = { inputTokens: input, outputTokens: output }
  return {
    modelId,
    modelName,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.inputTokens + usage.outputTokens,
    estimatedUsd: costUsd(usage, rates),
    calls,
    source: 'estimate',
  }
}

export function formatCostSummary(summary: GenerationCostSummary): string {
  const tokens = `${summary.totalTokens.toLocaleString()} tok`
  const usd =
    summary.estimatedUsd <= 0
      ? '$0'
      : summary.estimatedUsd < 0.01
        ? `~$${summary.estimatedUsd.toFixed(4)}`
        : `~$${summary.estimatedUsd.toFixed(2)}`
  return `${tokens} · ${usd}`
}

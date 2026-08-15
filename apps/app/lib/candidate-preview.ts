/**
 * Pure helpers for tournament candidate → existing workspace Preview pane.
 * No network / provider calls. Does not promote activeVersion.
 */
import { hasFragmentCode } from '@/lib/fragment'
import {
  resolveCandidateIsolatedPreview,
  type IsolatedPreview,
} from '@/lib/tournament-candidates'
import type { Candidate } from '@/lib/tournament-client'
import type { VariantId } from '@/lib/tournament'
import type { ExecutionResult } from '@/lib/types'
import type { DeepPartial } from '@evostack/shared'
import type { FragmentSchema } from '@/lib/schema'

export type CandidatePreviewAction = {
  candidateId: VariantId
  /** Select / highlight this candidate (does NOT set activeVersion). */
  select: true
  /** Switch existing workspace tab to Preview ("fragment"). */
  tab: 'fragment'
  fragment?: DeepPartial<FragmentSchema> | FragmentSchema
  /** Isolated execution for FragmentPreview — never another candidate's URL. */
  result?: ExecutionResult
  unavailableReason?: string
  /** True when the Preview pane should show an iframe. */
  showIframe: boolean
  /** True when action promotes activeVersion — always false for Preview. */
  promotesActiveVersion: false
}

/**
 * Build the exact workspace state for [PREVIEW] on a tournament candidate.
 * Preview must not require or create activeVersion.
 */
export function buildCandidatePreviewAction(
  candidate: Candidate | undefined,
): CandidatePreviewAction | null {
  if (!candidate) return null

  const isolated: IsolatedPreview = resolveCandidateIsolatedPreview(candidate)
  const fragment = hasFragmentCode(candidate.fragment)
    ? candidate.fragment
    : undefined

  if (isolated.available && isolated.execution) {
    return {
      candidateId: candidate.id,
      select: true,
      tab: 'fragment',
      fragment,
      result: isolated.execution,
      showIframe: true,
      promotesActiveVersion: false,
    }
  }

  return {
    candidateId: candidate.id,
    select: true,
    tab: 'fragment',
    fragment,
    result: undefined,
    unavailableReason:
      isolated.reason ||
      'Runtime deployment did not produce a preview URL for this candidate.',
    showIframe: false,
    promotesActiveVersion: false,
  }
}

/** URL extracted for isolation assertions. */
export function previewActionUrl(
  action: CandidatePreviewAction | null,
): string | undefined {
  if (!action?.result || !('url' in action.result)) return undefined
  return action.result.url
}

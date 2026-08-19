/**
 * Decide when a small Design / Mobile / UX / Feature request should use Morph
 * instead of a full single-candidate Improve tournament.
 *
 * Morph toggle off, long requests, or rebuild-scale language → full Improve.
 */
import type { AskRequestKind } from '@/lib/ask-evostack'

export const MORPH_SMALL_REQUEST_MAX_CHARS = 320

const CHIP_KINDS: AskRequestKind[] = ['design', 'mobile', 'ux', 'feature']

const LARGE_CHANGE_RE =
  /\b(rewrite|rebuild|from scratch|overhaul|migrate|replace entire|add auth|authentication|database|new page|new route|start over)\b/i

export type MorphPreference = {
  prefer: boolean
  reason:
    | 'morph_disabled'
    | 'no_active_fragment'
    | 'not_chip_kind'
    | 'too_long'
    | 'large_change'
    | 'small_chip_request'
}

export function shouldPreferMorph(opts: {
  morphEnabled: boolean
  hasActiveFragment: boolean
  kind?: AskRequestKind | null
  text: string
}): MorphPreference {
  if (!opts.morphEnabled) {
    return { prefer: false, reason: 'morph_disabled' }
  }
  if (!opts.hasActiveFragment) {
    return { prefer: false, reason: 'no_active_fragment' }
  }
  const kind = opts.kind || 'general'
  if (!CHIP_KINDS.includes(kind)) {
    return { prefer: false, reason: 'not_chip_kind' }
  }
  const text = (opts.text || '').trim()
  if (text.length > MORPH_SMALL_REQUEST_MAX_CHARS) {
    return { prefer: false, reason: 'too_long' }
  }
  if (LARGE_CHANGE_RE.test(text)) {
    return { prefer: false, reason: 'large_change' }
  }
  return { prefer: true, reason: 'small_chip_request' }
}

import type { InspectedNode, StylePatch } from './protocol'

export type DesignInspectController = {
  enabled: boolean
  node: InspectedNode | null
  patches: StylePatch[]
  canStyleApply: boolean
  applyHint: string | null
  setEnabled: (enabled: boolean) => void
  select: (node: InspectedNode | null) => void
  patch: (patch: StylePatch) => void
  undo: () => void
  reset: () => void
  apply: () => void
  seedStructural: (instruction: string) => void
}

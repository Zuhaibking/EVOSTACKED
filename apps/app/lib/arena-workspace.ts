export type WorkspaceMode = 'preview' | 'design' | 'code' | 'database'

export type PreviewViewport = 'desktop' | 'tablet' | 'mobile'

export const WORKSPACE_MODES: { id: WorkspaceMode; label: string }[] = [
  { id: 'preview', label: 'Preview' },
  { id: 'design', label: 'Design' },
  { id: 'code', label: 'Code' },
  { id: 'database', label: 'Database' },
]

export const PREVIEW_VIEWPORTS: { id: PreviewViewport; label: 'Desktop' | 'Tablet' | 'Mobile' }[] = [
  { id: 'desktop', label: 'Desktop' },
  { id: 'tablet', label: 'Tablet' },
  { id: 'mobile', label: 'Mobile' },
]

/** Device frames for the generated preview only. `null` = fill the pane. */
export const PREVIEW_VIEWPORT_FRAMES: Record<
  PreviewViewport,
  { width: number; height: number } | null
> = {
  desktop: null,
  tablet: { width: 768, height: 1024 },
  mobile: { width: 390, height: 844 },
}

/** CommandBar docks in the sidebar after the first prompt/run, not before. */
export function isArenaCommandDocked(opts: {
  messageCount: number
  tournamentPhase: string
  hasFragment: boolean
}): boolean {
  return (
    opts.messageCount > 0 ||
    opts.tournamentPhase !== 'idle' ||
    opts.hasFragment
  )
}

/**
 * Pure timeline for the landing Arena product-demo.
 * ZERO provider / E2B / network. Does not touch the real Arena.
 */

export const DEMO_CYCLE_MS = 24_000

export const DEMO_PROMPT =
  'Build a cinematic landing page for a productivity app — hero, features, and pricing.'

export const DEMO_TAGLINE =
  'Describe it. EvoStack builds it. Three candidates. One working product.'

export const DEMO_TABS = ['Preview', 'Design', 'Code', 'Database'] as const

export const DEMO_CANDIDATES = [
  { id: 'minimal', label: 'Product', sigil: 'P' },
  { id: 'rich', label: 'Premium', sigil: 'R' },
  { id: 'playful', label: 'Innovate', sigil: 'I' },
] as const

export type DemoCandidateId = (typeof DEMO_CANDIDATES)[number]['id']

export type DemoPhase =
  | 'idle'
  | 'typing'
  | 'submit'
  | 'planning'
  | 'generating'
  | 'verifying'
  | 'switching'
  | 'ready'

export type DemoChipStatus = 'Waiting' | 'Generating' | 'Building' | 'Ready'

export type DemoTab = (typeof DEMO_TABS)[number]

export type DemoClock = {
  t: number
  phase: DemoPhase
  typed: string
  docked: boolean
  selected: DemoCandidateId
  statuses: Record<DemoCandidateId, DemoChipStatus>
  activity: string[]
  tab: DemoTab
  cursor: { x: number; y: number; visible: boolean; clicking: boolean }
  previewReady: boolean
  zoom: number
}

function clamp01(n: number) {
  return Math.max(0, Math.min(1, n))
}

function lerp(a: number, b: number, u: number) {
  return a + (b - a) * clamp01(u)
}

function inRange(t: number, start: number, end: number) {
  return t >= start && t < end
}

function typeThrough(full: string, start: number, duration: number, t: number) {
  if (t <= start) return ''
  if (t >= start + duration) return full
  const u = (t - start) / duration
  return full.slice(0, Math.max(0, Math.floor(u * full.length)))
}

export function demoPhaseAt(t: number): DemoPhase {
  if (t < 1_400) return 'idle'
  if (t < 6_200) return 'typing'
  if (t < 7_200) return 'submit'
  if (t < 9_400) return 'planning'
  if (t < 13_600) return 'generating'
  if (t < 16_400) return 'verifying'
  if (t < 20_200) return 'switching'
  return 'ready'
}

function statusesAt(t: number): Record<DemoCandidateId, DemoChipStatus> {
  const waiting = {
    minimal: 'Waiting',
    rich: 'Waiting',
    playful: 'Waiting',
  } as const
  if (t < 9_400) return { ...waiting }
  if (t < 13_600) {
    return {
      minimal: 'Generating',
      rich: 'Generating',
      playful: 'Generating',
    }
  }
  if (t < 16_400) {
    return {
      minimal: 'Building',
      rich: 'Building',
      playful: 'Building',
    }
  }
  if (t < 17_600) {
    return {
      minimal: 'Ready',
      rich: 'Building',
      playful: 'Building',
    }
  }
  if (t < 18_800) {
    return {
      minimal: 'Ready',
      rich: 'Ready',
      playful: 'Building',
    }
  }
  return {
    minimal: 'Ready',
    rich: 'Ready',
    playful: 'Ready',
  }
}

function selectedAt(t: number): DemoCandidateId {
  if (t < 16_800) return 'minimal'
  if (t < 18_400) return 'rich'
  if (t < 20_200) return 'playful'
  return 'rich'
}

function activityAt(phase: DemoPhase): string[] {
  switch (phase) {
    case 'idle':
    case 'typing':
      return []
    case 'submit':
      return ['Prompt received']
    case 'planning':
      return ['Prompt received', 'Planning product…']
    case 'generating':
      return [
        'Shared plan ready',
        'Product generating',
        'Premium generating',
        'Innovate generating',
      ]
    case 'verifying':
      return [
        'Candidates generated',
        'Verifying integrity',
        'Deploying isolated previews',
      ]
    case 'switching':
      return [
        'Product preview live',
        'Premium preview live',
        'Innovate verifying',
      ]
    case 'ready':
      return [
        'Product READY',
        'Premium READY',
        'Innovate READY',
        'Three isolated previews',
      ]
  }
}

function cursorAt(t: number, phase: DemoPhase): DemoClock['cursor'] {
  if (phase === 'idle') {
    const u = t / 1_400
    return {
      x: lerp(72, 48, u),
      y: lerp(42, 58, u),
      visible: true,
      clicking: false,
    }
  }
  if (phase === 'typing') {
    return { x: 52, y: 62, visible: true, clicking: false }
  }
  if (phase === 'submit') {
    return {
      x: 71,
      y: 62,
      visible: true,
      clicking: inRange(t, 6_400, 6_750),
    }
  }
  if (phase === 'planning' || phase === 'generating') {
    return { x: 18, y: 36, visible: true, clicking: false }
  }
  if (phase === 'verifying') {
    return { x: 62, y: 22, visible: true, clicking: false }
  }
  if (phase === 'switching') {
    const target =
      selectedAt(t) === 'minimal'
        ? { x: 16, y: 28 }
        : selectedAt(t) === 'rich'
          ? { x: 16, y: 38 }
          : { x: 16, y: 48 }
    return { ...target, visible: true, clicking: true }
  }
  return { x: 64, y: 46, visible: true, clicking: false }
}

export function demoClock(ms: number): DemoClock {
  const t = ((ms % DEMO_CYCLE_MS) + DEMO_CYCLE_MS) % DEMO_CYCLE_MS
  const phase = demoPhaseAt(t)
  const docked = t >= 7_000
  const previewReady = t >= 14_800
  const zoom =
    phase === 'idle'
      ? 1
      : phase === 'typing'
        ? 1.02
        : phase === 'ready'
          ? 1.035
          : 1.018

  return {
    t,
    phase,
    typed: typeThrough(DEMO_PROMPT, 1_500, 4_400, t),
    docked,
    selected: selectedAt(t),
    statuses: statusesAt(t),
    activity: activityAt(phase),
    tab: 'Preview',
    cursor: cursorAt(t, phase),
    previewReady,
    zoom,
  }
}

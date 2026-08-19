export const EVO_INSPECT_CHANNEL = 'evo.inspect'

export const STYLE_PROPS = [
  'color',
  'background',
  'fontSize',
  'fontWeight',
  'fontFamily',
  'lineHeight',
  'letterSpacing',
  'textAlign',
  'textDecoration',
  'padding',
  'margin',
  'width',
  'height',
  'display',
  'flexDirection',
  'gap',
  'justifyContent',
  'alignItems',
  'border',
  'borderRadius',
  'opacity',
  'boxShadow',
  'content',
] as const

export type StyleProp = (typeof STYLE_PROPS)[number]

export type StylePatch = {
  prop: StyleProp
  value: string
}

export type InspectedNode = {
  tag: string
  text: string
  className: string
  xpath: string
  computed: Record<string, string>
  rect: { top: number; left: number; width: number; height: number }
  oid?: string
  sourceFile?: string
  sourceLine?: number
}

export type EvoInspectChildMessage =
  | { channel: typeof EVO_INSPECT_CHANNEL; type: 'ready' }
  | {
      channel: typeof EVO_INSPECT_CHANNEL
      type: 'select'
      node: InspectedNode
    }
  | { channel: typeof EVO_INSPECT_CHANNEL; type: 'clear' }

export type EvoInspectParentMessage =
  | { channel: typeof EVO_INSPECT_CHANNEL; type: 'enable' }
  | { channel: typeof EVO_INSPECT_CHANNEL; type: 'disable' }
  | {
      channel: typeof EVO_INSPECT_CHANNEL
      type: 'applyPending'
      patches: StylePatch[]
    }
  | { channel: typeof EVO_INSPECT_CHANNEL; type: 'resetPending' }

const STYLE_PROP_SET = new Set<string>(STYLE_PROPS)

export function isStyleProp(value: string): value is StyleProp {
  return STYLE_PROP_SET.has(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object'
}

export function parseInspectChildMessage(
  data: unknown,
): EvoInspectChildMessage | null {
  if (!isRecord(data) || data.channel !== EVO_INSPECT_CHANNEL) return null
  const type = String(data.type || '')
  if (type === 'ready' || type === 'clear') {
    return { channel: EVO_INSPECT_CHANNEL, type }
  }
  if (type === 'select' && isRecord(data.node)) {
    const node = data.node
    const rect = isRecord(node.rect) ? node.rect : {}
    const computed = isRecord(node.computed)
      ? Object.fromEntries(
          Object.entries(node.computed).filter(
            (entry): entry is [string, string] => typeof entry[1] === 'string',
          ),
        )
      : {}
    return {
      channel: EVO_INSPECT_CHANNEL,
      type: 'select',
      node: {
        tag: String(node.tag || ''),
        text: String(node.text || ''),
        className: String(node.className || ''),
        xpath: String(node.xpath || ''),
        computed,
        rect: {
          top: Number(rect.top) || 0,
          left: Number(rect.left) || 0,
          width: Number(rect.width) || 0,
          height: Number(rect.height) || 0,
        },
        oid: typeof node.oid === 'string' && node.oid ? node.oid : undefined,
        sourceFile:
          typeof node.sourceFile === 'string' && node.sourceFile
            ? node.sourceFile
            : undefined,
        sourceLine:
          typeof node.sourceLine === 'number' ? node.sourceLine : undefined,
      },
    }
  }
  return null
}

export function parseInspectParentMessage(
  data: unknown,
): EvoInspectParentMessage | null {
  if (!isRecord(data) || data.channel !== EVO_INSPECT_CHANNEL) return null
  const type = String(data.type || '')
  if (type === 'enable' || type === 'disable' || type === 'resetPending') {
    return { channel: EVO_INSPECT_CHANNEL, type }
  }
  if (type === 'applyPending' && Array.isArray(data.patches)) {
    const patches: StylePatch[] = []
    for (const item of data.patches) {
      if (!isRecord(item)) continue
      const prop = String(item.prop || '')
      if (!isStyleProp(prop)) continue
      patches.push({ prop, value: String(item.value ?? '') })
    }
    return { channel: EVO_INSPECT_CHANNEL, type: 'applyPending', patches }
  }
  return null
}

export function parentMessage(
  message: Omit<EvoInspectParentMessage, 'channel'>,
): EvoInspectParentMessage {
  return { channel: EVO_INSPECT_CHANNEL, ...message } as EvoInspectParentMessage
}

export function buildStructuralPrompt(node: InspectedNode, instruction: string): string {
  const where = [
    node.tag && `<${node.tag}>`,
    node.className && `class="${node.className}"`,
    node.oid && `oid=${node.oid}`,
    node.text && `text="${node.text.slice(0, 80)}"`,
  ]
    .filter(Boolean)
    .join(' ')
  return `DESIGN: Change only this selected element (${where}). ${instruction.trim()}`
}

export function supportsStyleApply(templateId: string | undefined): boolean {
  const id = String(templateId || '').replace(/-dev$/, '')
  return id === 'nextjs-developer' || id === 'vue-developer'
}

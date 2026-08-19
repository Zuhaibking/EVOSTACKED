'use client'

import type { DesignInspectController } from '@/lib/design-mode/controller'
import {
  applyPatchesToFragment,
  parseOid,
  serializePatchesForPrompt,
} from '@/lib/design-mode/rewrite-classes'
import {
  buildStructuralPrompt,
  supportsStyleApply,
  type InspectedNode,
  type StylePatch,
} from '@/lib/design-mode/protocol'
import type { FragmentSchema } from '@/lib/schema'
import type { DeepPartial } from '@evostack/shared'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AskRequestKind } from '@/lib/ask-evostack'

export function useDesignInspect({
  fragment,
  setFragment,
  setChatInput,
  setAskKind,
  resetKey,
}: {
  fragment: DeepPartial<FragmentSchema> | undefined
  setFragment: (next: DeepPartial<FragmentSchema>) => void
  setChatInput: (text: string) => void
  setAskKind: (kind: AskRequestKind | null) => void
  resetKey: string
}): DesignInspectController {
  const [enabled, setEnabled] = useState(false)
  const [node, setNode] = useState<InspectedNode | null>(null)
  const [patches, setPatches] = useState<StylePatch[]>([])
  const [applyHint, setApplyHint] = useState<string | null>(null)

  const canStyleApply = supportsStyleApply(
    typeof fragment?.template === 'string' ? fragment.template : undefined,
  )

  useEffect(() => {
    setEnabled(false)
    setNode(null)
    setPatches([])
    setApplyHint(null)
  }, [resetKey])

  const select = useCallback((next: InspectedNode | null) => {
    setApplyHint(null)
    setPatches([])
    if (!next) {
      setNode(null)
      return
    }
    const oidFile = parseOid(next.oid)?.filePath
    setNode({
      ...next,
      sourceFile: next.sourceFile || oidFile,
    })
  }, [])

  const patch = useCallback((next: StylePatch) => {
    setPatches((current) => [...current.filter((item) => item.prop !== next.prop), next])
  }, [])

  const undo = useCallback(() => {
    setPatches((current) => current.slice(0, -1))
  }, [])

  const reset = useCallback(() => {
    setPatches([])
    setApplyHint(null)
  }, [])

  const seedStructural = useCallback(
    (instruction: string) => {
      if (!node || !instruction.trim()) return
      setAskKind('design')
      setChatInput(buildStructuralPrompt(node, instruction))
    },
    [node, setAskKind, setChatInput],
  )

  const apply = useCallback(() => {
    if (!node || patches.length === 0 || !fragment) return
    if (!canStyleApply) {
      setAskKind('design')
      setChatInput(serializePatchesForPrompt(node, patches))
      setApplyHint('Style apply is Next.js + Tailwind. Improve is seeded with these edits.')
      return
    }
    const result = applyPatchesToFragment(fragment, node, patches)
    if (result.ok && result.code) {
      setFragment({ ...fragment, code: result.code })
      setNode({
        ...node,
        className: result.className,
        text: result.content ?? node.text,
      })
      setPatches([])
      setApplyHint(null)
      return
    }
    setAskKind('design')
    setChatInput(serializePatchesForPrompt(node, patches))
    setApplyHint(
      result.ok
        ? null
        : 'Could not uniquely locate this node in source. Improve is seeded with the patches.',
    )
  }, [
    canStyleApply,
    fragment,
    node,
    patches,
    setAskKind,
    setChatInput,
    setFragment,
  ])

  return useMemo(
    () => ({
      enabled,
      node,
      patches,
      canStyleApply,
      applyHint,
      setEnabled,
      select,
      patch,
      undo,
      reset,
      apply,
      seedStructural,
    }),
    [
      apply,
      applyHint,
      canStyleApply,
      enabled,
      node,
      patches,
      reset,
      seedStructural,
      select,
      undo,
      patch,
    ],
  )
}

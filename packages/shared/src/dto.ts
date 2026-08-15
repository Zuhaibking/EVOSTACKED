import { z } from 'zod'

export const memoryItemKindSchema = z.enum([
  'fact',
  'decision',
  'file_summary',
  'user_request',
])

export type MemoryItemKind = z.infer<typeof memoryItemKindSchema>

export type MemoryPack = {
  memoryVersion: number
  runId: string
  userId: string
  recentMessages: unknown[]
  memoryItems: Array<{
    id: string
    kind: MemoryItemKind
    text: string
    sourceMessageId?: string | null
    createdAt: string
  }>
  brain?: unknown
}

export type ChatSyncResponse = {
  runId: string
  memoryRevision: number
  messages: unknown[]
  fragment?: unknown
  error?: string
}

export type ClientRunMeta = {
  runId: string
  memoryRevision: number
  selectedCandidate?: string | null
  activeVersion?: number | null
  hasTournament: boolean
}

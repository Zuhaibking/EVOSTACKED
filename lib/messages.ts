import { FragmentSchema, fragmentCodeText, fragmentSourceText } from './schema'
import { ExecutionResult } from './types'
import { ModelMessage, DeepPartial } from 'ai'

export type MessageText = {
  type: 'text'
  text: string
}

export type MessageCode = {
  type: 'code'
  text: string
}

export type MessageImage = {
  type: 'image'
  image: string
}

export type Message = {
  role: 'assistant' | 'user'
  content: Array<MessageText | MessageCode | MessageImage>
  object?: DeepPartial<FragmentSchema>
  result?: ExecutionResult
}

export function toAISDKMessages(messages: Message[]): ModelMessage[] {
  return messages.map((message) => {
    const source = fragmentSourceText(message.object)
    let includedSource = false
    const parts = message.content.flatMap<MessageText | MessageImage>((content) => {
      if (content.type === 'image') {
        return [{ type: 'image' as const, image: content.image }]
      }
      // The UI displays entry code, but edit context must include the full bundle.
      if (content.type === 'code' && source) {
        if (includedSource) return []
        includedSource = true
        return [{ type: 'text' as const, text: source }]
      }
      const text = fragmentCodeText(content.text)
      return text ? [{ type: 'text' as const, text }] : []
    })
    if (source && !includedSource) parts.push({ type: 'text', text: source })

    // Assistant array parts must be text | tool-call. Non-string `code`
    // (stream partials / multi-file) used to blow up streamObject's Zod check.
    if (message.role === 'assistant') {
      return {
        role: 'assistant' as const,
        content: parts
          .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
          .map((p) => p.text)
          .join('\n\n'),
      }
    }

    return {
      role: 'user' as const,
      content: parts.length > 0 ? parts : '',
    }
  })
}

export async function toMessageImage(files: File[]) {
  if (files.length === 0) {
    return []
  }

  return Promise.all(
    files.map(async (file) => {
      const base64 = Buffer.from(await file.arrayBuffer()).toString('base64')
      return `data:${file.type};base64,${base64}`
    }),
  )
}

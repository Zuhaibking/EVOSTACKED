import { FragmentSchema, fragmentCodeText } from './schema'
import { ExecutionResult } from './types'
import { CoreMessage, DeepPartial } from 'ai'

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

type UserPart =
  | { type: 'image'; image: string }
  | { type: 'text'; text: string }

export function toAISDKMessages(messages: Message[]): CoreMessage[] {
  return messages.map((message): CoreMessage => {
    const parts = message.content.flatMap((content): UserPart[] => {
      if (content.type === 'image') {
        return [{ type: 'image', image: content.image }]
      }
      const text = fragmentCodeText(content.text)
      return text ? [{ type: 'text', text }] : []
    })

    // Assistant array parts must be text | tool-call. Non-string `code`
    // (stream partials / multi-file) used to blow up streamObject's Zod check.
    if (message.role === 'assistant') {
      return {
        role: 'assistant',
        content: parts
          .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
          .map((p) => p.text)
          .join('\n\n'),
      }
    }

    return {
      role: 'user',
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

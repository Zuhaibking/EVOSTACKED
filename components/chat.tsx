import { Message } from '@/lib/messages'
import { FragmentSchema } from '@/lib/schema'
import { ExecutionResult } from '@/lib/types'
import { DeepPartial } from 'ai'
import { LoaderIcon, Terminal } from 'lucide-react'
import { useEffect } from 'react'

export function Chat({
  messages,
  isLoading,
  setCurrentPreview,
}: {
  messages: Message[]
  isLoading: boolean
  setCurrentPreview: (preview: {
    fragment: DeepPartial<FragmentSchema> | undefined
    result: ExecutionResult | undefined
  }) => void
}) {
  useEffect(() => {
    const chatContainer = document.getElementById('chat-container')
    if (chatContainer) {
      chatContainer.scrollTop = chatContainer.scrollHeight
    }
  }, [JSON.stringify(messages)])

  return (
    <div
      id="chat-container"
      className="flex max-h-full flex-col gap-3 overflow-y-auto pb-4"
    >
      {messages.map((message: Message, index: number) => (
        <div
          className={`flex flex-col gap-2 whitespace-pre-wrap rounded-lg px-3 py-2.5 font-sans text-[13px] leading-6 ${message.role !== 'user' ? 'w-full border border-border/50 bg-card text-muted-foreground' : 'ml-auto max-w-full border border-border/30 bg-accent/60 text-foreground'}`}
          key={index}
        >
          {message.content.map((content, id) => {
            if (content.type === 'text') {
              return content.text
            }
            if (content.type === 'image') {
              return (
                <img
                  key={id}
                  src={content.image}
                  alt="fragment"
                  className="mr-2 mb-1 inline-block h-12 w-12 rounded-md bg-muted object-cover"
                />
              )
            }
          })}
          {message.object && (
            <button
              type="button"
              aria-label={`View source for ${message.object.title || 'generated app'}`}
              onClick={() =>
                setCurrentPreview({
                  fragment: message.object,
                  result: message.result,
                })
              }
              className="flex w-full items-center gap-2 rounded-md border border-border/60 bg-background/30 p-2 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-accent">
                <Terminal strokeWidth={1.5} className="h-3.5 w-3.5 text-brand-accent" />
              </div>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-xs font-medium leading-5 text-foreground">
                  {message.object.title}
                </span>
                <span className="text-[11px] leading-4 text-muted-foreground">
                  View source
                </span>
              </div>
            </button>
          )}
        </div>
      ))}
      {isLoading && (
        <div className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
          <LoaderIcon strokeWidth={1.5} className="h-3.5 w-3.5 animate-spin" />
          <span>Generating...</span>
        </div>
      )}
    </div>
  )
}

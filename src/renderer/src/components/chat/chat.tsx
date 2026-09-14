import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

import { createLogger } from '@shared/logger'
import type { OpencodeStreamEvent } from '@shared/opencode-stream'

import * as bench from '@/lib/bench-probe'

import { Marker, MarkerContent } from '@/components/ui/marker'
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from '@/components/ui/message-scroller'

import { ChatComposer } from './chat-composer'
import { ChatMessageItem } from './chat-message'
import type { ChatMessage } from './types'

const log = createLogger('app')

/** Update the in-flight assistant message for the given stream event. */
function applyStreamEvent(message: ChatMessage, event: OpencodeStreamEvent): ChatMessage {
  switch (event.type) {
    case 'text':
      return { ...message, content: message.content + event.text }
    case 'thinking':
      return { ...message, reasoning: (message.reasoning ?? '') + event.text }
    case 'tool':
      return { ...message, tool: { state: event.state, detail: event.detail } }
    case 'done':
      return { ...message, streaming: false }
    case 'error':
      return { ...message, streaming: false, content: message.content + `\n\n[${event.message}]` }
    case 'step':
      return message
  }
}

/**
 * The chat screen: transcript scroller + composer.
 *
 * Owns the message list only. Scroll behavior (anchoring, follow-output,
 * prepend preservation) lives in MessageScrollerProvider; rows are memoized
 * so appending or streaming into one message re-renders only that row.
 */
export function Chat() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const assistantIdRef = useRef<string | null>(null)

  // One subscription for the lifetime of the chat; events arrive for the
  // single in-flight assistant message tracked by the ref.
  useEffect(() => {
    return window.harness.opencode.onStream((event) => {
      bench.onStreamEvent(event)
      setMessages((prev) =>
        prev.map((message) =>
          message.id === assistantIdRef.current ? applyStreamEvent(message, event) : message,
        ),
      )
    })
  }, [])

  // The transcript has hit the DOM but is not painted yet — the point the
  // streaming benchmark measures to. Inert outside `?bench=stream`.
  useLayoutEffect(() => {
    bench.afterCommit()
  }, [messages])

  const handleSubmit = useCallback((text: string): boolean => {
    if (text === '/connect') {
      void window.harness.auth.test('opencode-go').then((ok) => {
        log.info('provider connection test', { provider: 'opencode-go', ok })
      })
      return false
    }

    const assistantId = crypto.randomUUID()
    assistantIdRef.current = assistantId
    setMessages((prev) => [
      ...prev,
      { id: crypto.randomUUID(), role: 'user', content: text },
      { id: assistantId, role: 'assistant', content: '', streaming: true },
    ])

    void window.harness.opencode.send(text).then((result) => {
      if (result.ok) return
      log.error('opencode send rejected', result.error)
      setMessages((prev) =>
        prev.map((message) =>
          message.id === assistantId
            ? { ...message, streaming: false, content: result.error ?? 'send failed' }
            : message,
        ),
      )
    })
    return true
  }, [])

  useEffect(() => {
    bench.autoSubmit(handleSubmit)
  }, [handleSubmit])

  return (
    <div className="app-no-drag absolute inset-0 flex min-h-0 flex-col">
      <MessageScrollerProvider autoScroll defaultScrollPosition="end">
        <MessageScroller>
          <MessageScrollerViewport aria-label="Conversation">
            <MessageScrollerContent className="mx-auto w-full max-w-3xl gap-3 px-4 pt-17 pb-22 sm:px-6">
              {messages.length === 0 ? (
                <MessageScrollerItem
                  messageId="empty"
                  className="flex flex-1 items-center justify-center [content-visibility:visible]"
                >
                  <Marker className="justify-center">
                    <MarkerContent>Type a message to begin</MarkerContent>
                  </Marker>
                </MessageScrollerItem>
              ) : (
                messages.map((message) => <ChatMessageItem key={message.id} message={message} />)
              )}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton className="bg-background/70 backdrop-blur-md data-[direction=end]:bottom-[5.75rem]" />
        </MessageScroller>
      </MessageScrollerProvider>
      <ChatComposer onSubmit={handleSubmit} />
    </div>
  )
}

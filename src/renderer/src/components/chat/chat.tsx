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
import { applyBatchToMessages } from './stream-reducer'
import type { ChatMessage } from './types'

const log = createLogger('app')

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

  // Inbound batches queue into a plain array; a single requestAnimationFrame
  // drains the queue and performs one setMessages per frame. React commits are
  // therefore capped at the refresh rate and independent of token rate.
  const queueRef = useRef<OpencodeStreamEvent[]>([])
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    const drain = () => {
      rafRef.current = null
      if (queueRef.current.length === 0) return
      const batch = queueRef.current
      queueRef.current = []
      setMessages((prev) => applyBatchToMessages(prev, assistantIdRef.current, batch))
    }

    const unsubscribe = window.harness.opencode.onStream((batch) => {
      for (const event of batch) bench.onStreamEvent(event)
      queueRef.current.push(...batch)
      rafRef.current ??= requestAnimationFrame(drain)
    })

    return () => {
      unsubscribe()
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
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

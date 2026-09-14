import { useCallback, useState } from 'react'

import { createLogger } from '@shared/logger'

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

/**
 * The chat screen: transcript scroller + composer.
 *
 * Owns the message list only. Scroll behavior (anchoring, follow-output,
 * prepend preservation) lives in MessageScrollerProvider; rows are memoized
 * so appending or streaming into one message re-renders only that row.
 */
export function Chat() {
  const [messages, setMessages] = useState<ChatMessage[]>([])

  const handleSubmit = useCallback((text: string): boolean => {
    if (text === '/connect') {
      void window.harness.auth.test('opencode-go').then((ok) => {
        log.info('provider connection test', { provider: 'opencode-go', ok })
      })
      return false
    }
    setMessages((prev) => [...prev, { id: Date.now(), content: text }])
    return true
  }, [])

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

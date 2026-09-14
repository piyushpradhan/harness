import { useCallback, useState } from 'react'

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

/**
 * The chat screen: transcript scroller + composer.
 *
 * Owns the message list only. Scroll behavior (anchoring, follow-output,
 * prepend preservation) lives in MessageScrollerProvider; rows are memoized
 * so this component re-rendering on append is cheap.
 */
export function Chat() {
  const [messages, setMessages] = useState<ChatMessage[]>([])

  const handleSubmit = useCallback((text: string) => {
    if (text === '/connect') {
      void window.harness.auth.test('opencode-go')
      return
    }
    setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: 'user', content: text }])
  }, [])

  return (
    <div className="app-no-drag relative flex h-full min-h-0 flex-col">
      <MessageScrollerProvider autoScroll defaultScrollPosition="end">
        <MessageScroller className="flex-1">
          <MessageScrollerViewport aria-label="Conversation">
            <MessageScrollerContent className="mx-auto w-full max-w-3xl gap-3 px-4 pt-[68px] pb-[88px] sm:px-6">
              {messages.length === 0 ? (
                <MessageScrollerItem
                  messageId="empty-state"
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

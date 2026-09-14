import { memo } from 'react'

import { Bubble, BubbleContent } from '@/components/ui/bubble'
import { Message, MessageContent } from '@/components/ui/message'
import { MessageScrollerItem } from '@/components/ui/message-scroller'

import type { ChatMessage } from './types'

interface ChatMessageItemProps {
  message: ChatMessage
}

/**
 * One transcript row. Memoized so an appended or streamed message only
 * re-renders its own row — the scroller owns scroll state imperatively
 * and never triggers row re-renders.
 */
export const ChatMessageItem = memo(function ChatMessageItem({ message }: ChatMessageItemProps) {
  const isUser = message.role === 'user'

  return (
    <MessageScrollerItem messageId={message.id} scrollAnchor={isUser}>
      <Message align={isUser ? 'end' : 'start'}>
        <MessageContent>
          <Bubble variant={isUser ? 'default' : 'muted'} align={isUser ? 'end' : 'start'}>
            <BubbleContent>{message.content}</BubbleContent>
          </Bubble>
        </MessageContent>
      </Message>
    </MessageScrollerItem>
  )
})

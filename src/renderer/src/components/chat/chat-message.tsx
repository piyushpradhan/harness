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
            <BubbleContent>
              {message.reasoning ? (
                <div className="mb-2 border-l-2 border-border pl-2 text-xs text-muted-foreground/80 whitespace-pre-wrap">
                  {message.reasoning}
                </div>
              ) : null}
              {message.tool ? (
                <div className="mb-2 text-xs text-muted-foreground/80 italic">
                  {message.tool.state === 'running' ? '⏳' : '✓'}{' '}
                  {message.tool.detail ?? 'running a tool'}
                </div>
              ) : null}
              {message.content || (message.streaming ? '…' : '')}
            </BubbleContent>
          </Bubble>
        </MessageContent>
      </Message>
    </MessageScrollerItem>
  )
})

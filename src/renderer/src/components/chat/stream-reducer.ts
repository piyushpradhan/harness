import type { OpencodeStreamBatch, OpencodeStreamEvent } from '@shared/opencode-stream'

import type { ChatMessage } from './types'

/** Update the in-flight assistant message for the given stream event. */
export function applyStreamEvent(message: ChatMessage, event: OpencodeStreamEvent): ChatMessage {
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
 * Fold a batch over one message with a single pass. Called once per animation
 * frame in the renderer, instead of once per token.
 */
export function applyBatch(message: ChatMessage, batch: OpencodeStreamBatch): ChatMessage {
  return batch.reduce(applyStreamEvent, message)
}
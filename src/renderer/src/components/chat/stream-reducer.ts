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

/**
 * Apply one batch to the transcript, targeting the in-flight assistant
 * message. Non-target rows keep their reference identity so the per-row memo
 * skips them — only the streamed row re-renders per frame.
 */
export function applyBatchToMessages(
  messages: ChatMessage[],
  targetId: string | null,
  batch: OpencodeStreamBatch,
): ChatMessage[] {
  if (targetId === null) return messages
  return messages.map((message) =>
    message.id === targetId ? applyBatch(message, batch) : message,
  )
}
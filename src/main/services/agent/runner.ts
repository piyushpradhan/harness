import type { ChatMessage, SessionEvent } from '../../../shared/types'
import type { LLMProvider } from '../llm/provider'

export interface AgentRunOptions {
  sessionId: string
  provider: LLMProvider
  model: string
  system?: string
  messages: ChatMessage[]
  onEvent: (evt: SessionEvent) => void
  signal?: AbortSignal
}

/**
 * Plain async agent loop: drives one LLMProvider stream and re-emits it as
 * SessionEvents. Electron-free so it can be unit-tested with a fake provider.
 * Cancellation: the abort signal stops the underlying stream; the provider's
 * own completion callbacks are then ignored and a single 'cancelled' status
 * event is emitted.
 */
export async function runAgent(opts: AgentRunOptions): Promise<void> {
  const { sessionId, provider, model, system, messages, onEvent, signal } = opts

  if (signal?.aborted) {
    onEvent({ sessionId, type: 'status', state: 'cancelled' })
    return
  }
  onEvent({ sessionId, type: 'status', state: 'connecting' })

  const payload: ChatMessage[] = system
    ? [{ role: 'system', content: system }, ...messages]
    : messages
  const startedAt = Date.now()

  await new Promise<void>((resolve) => {
    let settled = false
    let streaming = false
    const finish = (): void => {
      if (!settled) {
        settled = true
        resolve()
      }
    }

    const stream = provider.streamChat(
      { model, messages: payload },
      {
        onDelta: (text) => {
          if (signal?.aborted) return
          if (!streaming) {
            streaming = true
            onEvent({ sessionId, type: 'status', state: 'streaming' })
          }
          onEvent({ sessionId, type: 'delta', text })
        },
        onDone: (text) => {
          if (signal?.aborted) {
            finish()
            return
          }
          onEvent({ sessionId, type: 'done', text, durationMs: Date.now() - startedAt })
          finish()
        },
        onError: (error) => {
          if (signal?.aborted) {
            finish()
            return
          }
          onEvent({ sessionId, type: 'error', message: error.message })
          finish()
        }
      }
    )

    if (signal) {
      const onAbort = (): void => {
        if (settled) return
        settled = true
        stream.cancel()
        onEvent({ sessionId, type: 'status', state: 'cancelled' })
        resolve()
      }
      if (signal.aborted) onAbort()
      else signal.addEventListener('abort', onAbort, { once: true })
    }
  })
}
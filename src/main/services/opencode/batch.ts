/**
 * Coalesces a high-frequency event stream into batches flushed on a timer or a
 * size cap. The renderer consumes at most one batch per animation frame, so the
 * per-token IPC messages and per-token React commits become per-batch.
 *
 * Text deltas stay as individual elements rather than being concatenated: the
 * streaming benchmark stamps one `performance.now()` per `text` event, so
 * collapsing them would silently break the delta→paint measurement. The win —
 * fewer IPC messages, one reducer pass per frame — does not depend on it.
 */
import type { OpencodeStreamBatch, OpencodeStreamEvent } from '@shared/opencode-stream'

export interface StreamBatcherOptions {
  /** Flush interval in ms. Shorter than a frame so the renderer is never starved. */
  flushMs?: number
  /** Maximum events before an eager flush. */
  cap?: number
}

export interface StreamBatcher {
  push(event: OpencodeStreamEvent): void
  /** Deliver whatever is buffered now, if anything. */
  flush(): void
  /** Cancel the timer and drop the buffer. For teardown. */
  dispose(): void
}

const DEFAULT_FLUSH_MS = 8
const DEFAULT_CAP = 64

export function createBatcher(
  emit: (batch: OpencodeStreamBatch) => void,
  options: StreamBatcherOptions = {},
): StreamBatcher {
  const flushMs = options.flushMs ?? DEFAULT_FLUSH_MS
  const cap = options.cap ?? DEFAULT_CAP
  let pending: OpencodeStreamEvent[] = []
  let timer: ReturnType<typeof setTimeout> | null = null

  const flush = (): void => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    if (pending.length === 0) return
    const batch = pending
    pending = []
    emit(batch)
  }

  return {
    push(event) {
      pending.push(event)
      if (pending.length >= cap) return flush()
      timer ??= setTimeout(flush, flushMs)
    },
    flush,
    dispose() {
      if (timer !== null) clearTimeout(timer)
      timer = null
      pending = []
    },
  }
}
/**
 * Stream events forwarded from the OpenCode server (main process) to the
 * renderer over IPC. Mirrors the granular event vocabulary of the OpenCode
 * V2 event stream (`GET /api/event`) after session filtering and mapping.
 *
 * The channel carries batches, not single events: the service coalesces the
 * high-frequency delta stream on a timer before it crosses IPC, so one message
 * can carry many tokens. The renderer drains batches on the animation frame.
 */

export type OpencodeStreamBatch = OpencodeStreamEvent[]

export type OpencodeStreamEvent = (
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool'; state: 'running' | 'completed'; detail?: string }
  | { type: 'step'; finishReason: string }
  | { type: 'done' }
  | { type: 'error'; message: string }
) & {
  /**
   * The `opencode:send` this event belongs to — route by this, not by "the
   * latest message". Absent only for an error with no request in flight
   * (the server dying between prompts).
   */
  requestId?: string
}

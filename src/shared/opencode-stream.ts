/**
 * Stream events forwarded from the OpenCode server (main process) to the
 * renderer over IPC. Mirrors the granular event vocabulary of the OpenCode
 * V2 event stream (`GET /api/event`) after session filtering and mapping.
 */

export type OpencodeStreamEvent =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'step'; finishReason: string }
  | { type: 'done' }
  | { type: 'error'; message: string }

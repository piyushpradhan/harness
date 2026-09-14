/**
 * Incremental SSE (text/event-stream) decoder.
 *
 * Feed raw chunks from a fetch body reader; get back the parsed `data:`
 * payloads. Handles frames split across chunks and multi-line data blocks.
 * Comment lines (`: heartbeat`) and non-data fields (`event:`, `id:`) are
 * ignored, matching the OpenCode event stream.
 */

const decoder = new TextDecoder()

export class SseDecoder {
  private buffer = ''

  /** Returns every complete event payload parsed from the chunk. */
  push(chunk: Uint8Array): unknown[] {
    this.buffer += decoder.decode(chunk, { stream: true })

    const events: unknown[] = []
    let boundary = this.buffer.indexOf('\n\n')
    while (boundary !== -1) {
      const block = this.buffer.slice(0, boundary)
      this.buffer = this.buffer.slice(boundary + 2)

      const dataLines = block
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).replace(/^ /, ''))
      if (dataLines.length > 0) {
        const payload = dataLines.join('\n')
        try {
          events.push(JSON.parse(payload))
        } catch {
          // Not every event carries JSON; keep the raw text for the caller.
          events.push(payload)
        }
      }
      boundary = this.buffer.indexOf('\n\n')
    }
    return events
  }
}

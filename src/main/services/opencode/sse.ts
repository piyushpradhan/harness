/**
 * Incremental SSE (text/event-stream) decoder, per WHATWG HTML §9.2.6
 * ("Interpreting an event stream").
 *
 * Feed raw chunks from a fetch body reader; get back the parsed `data:`
 * payloads. Lines may end in CRLF, LF or a bare CR, and any of them — or a
 * multi-byte character — may be split across chunks. `id:` is tracked for
 * `Last-Event-ID` resumption; comments (`: heartbeat`), `event:` and `retry:`
 * carry nothing this client uses and are ignored.
 *
 * One instance per connection: a drop mid-frame leaves a partial line and a
 * half-decoded character behind, and neither may leak into the next stream.
 */

/** Pending, undispatched input past which a stream is treated as broken. */
export const MAX_SSE_BUFFER = 1024 * 1024

/** The stream sent more than the cap without completing a line or an event. */
export class SseBufferOverflowError extends Error {
  constructor(readonly limit: number) {
    super(`SSE stream exceeded ${limit} buffered characters without dispatching an event`)
    this.name = 'SseBufferOverflowError'
  }
}

export interface SseDecoderOptions {
  /** Last event ID carried over from a previous connection. */
  lastEventId?: string
  /** Cap on buffered characters (partial line + undispatched data). */
  maxBuffer?: number
}

export class SseDecoder {
  private readonly text = new TextDecoder()
  private readonly maxBuffer: number
  /** Unterminated tail of the input. */
  private line = ''
  /** The last chunk ended in CR; a leading LF in the next one belongs to it. */
  private pendingCR = false
  private data: string[] = []
  private dataLength = 0
  private idBuffer: string
  private committedId: string

  constructor(options: SseDecoderOptions = {}) {
    this.maxBuffer = options.maxBuffer ?? MAX_SSE_BUFFER
    this.idBuffer = this.committedId = options.lastEventId ?? ''
  }

  /** The id of the last dispatched event — send as `Last-Event-ID` on reconnect. */
  get lastEventId(): string {
    return this.committedId
  }

  /**
   * Returns every complete event payload parsed from the chunk. Throws
   * `SseBufferOverflowError` past the cap; the instance is then unusable.
   */
  push(chunk: Uint8Array): unknown[] {
    let input = this.text.decode(chunk, { stream: true })
    if (this.pendingCR && input.length > 0) {
      if (input.startsWith('\n')) input = input.slice(1)
      this.pendingCR = false
    }

    const buf = this.line + input
    const events: unknown[] = []
    let pos = 0
    // Both searches are cached and only re-run once passed, so a stream that
    // never uses one terminator does not rescan to the end on every line.
    let lf = buf.indexOf('\n')
    let cr = buf.indexOf('\r')
    while (lf !== -1 || cr !== -1) {
      const start = pos
      let end: number
      if (cr !== -1 && (lf === -1 || cr < lf)) {
        end = cr
        if (cr + 1 === buf.length) this.pendingCR = true
        pos = buf.charCodeAt(cr + 1) === 10 ? cr + 2 : cr + 1
      } else {
        end = lf
        pos = lf + 1
      }
      this.processLine(buf.slice(start, end), events)
      if (lf !== -1 && lf < pos) lf = buf.indexOf('\n', pos)
      if (cr !== -1 && cr < pos) cr = buf.indexOf('\r', pos)
    }

    this.line = buf.slice(pos)
    if (this.line.length + this.dataLength > this.maxBuffer) {
      throw new SseBufferOverflowError(this.maxBuffer)
    }
    return events
  }

  private processLine(line: string, events: unknown[]): void {
    if (line === '') return this.dispatch(events)
    if (line.startsWith(':')) return // comment

    const colon = line.indexOf(':')
    const field = colon === -1 ? line : line.slice(0, colon)
    let value = colon === -1 ? '' : line.slice(colon + 1)
    if (value.startsWith(' ')) value = value.slice(1)

    if (field === 'data') {
      this.data.push(value)
      this.dataLength += value.length + 1
    } else if (field === 'id' && !value.includes('\0')) {
      this.idBuffer = value
    }
  }

  private dispatch(events: unknown[]): void {
    this.committedId = this.idBuffer
    if (this.data.length === 0) return
    const payload = this.data.join('\n')
    this.data = []
    this.dataLength = 0
    try {
      events.push(JSON.parse(payload))
    } catch {
      // Not every event carries JSON; keep the raw text for the caller.
      events.push(payload)
    }
  }
}

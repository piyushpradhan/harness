import { describe, expect, it } from 'vitest'

import { SseDecoder } from './sse'

function chunk(s: string): Uint8Array {
  return new TextEncoder().encode(s)
}

describe('SseDecoder', () => {
  it('parses a complete frame', () => {
    const decoder = new SseDecoder()
    const events = decoder.push(chunk('data: {"type":"session.text.delta"}\n\n'))
    expect(events).toEqual([{ type: 'session.text.delta' }])
  })

  it('splits frames across chunk boundaries', () => {
    const decoder = new SseDecoder()
    const first = decoder.push(chunk('data: {"type":"session.text.del'))
    expect(first).toEqual([])
    const second = decoder.push(chunk('ta","delta":"hi"}\n\ndata: {"type":"session.step.ended"}\n\n'))
    expect(second).toEqual([
      { type: 'session.text.delta', delta: 'hi' },
      { type: 'session.step.ended' },
    ])
  })

  it('ignores comments and non-data fields', () => {
    const decoder = new SseDecoder()
    const events = decoder.push(
      chunk(': heartbeat\n\nevent: message\ndata: {"ok":true}\n\n\n\n'),
    )
    expect(events).toEqual([{ ok: true }])
  })

  it('joins multi-line data into one payload', () => {
    const decoder = new SseDecoder()
    const events = decoder.push(chunk('data: {"a":\ndata: 1}\n\n'))
    expect(events).toEqual([{ a: 1 }])
  })

  it('keeps non-JSON payloads as raw text', () => {
    const decoder = new SseDecoder()
    const events = decoder.push(chunk('data: not json\n\n'))
    expect(events).toEqual(['not json'])
  })

  it('returns nothing for a frame with no data lines', () => {
    const decoder = new SseDecoder()
    expect(decoder.push(chunk('event: ping\n\n'))).toEqual([])
  })
})

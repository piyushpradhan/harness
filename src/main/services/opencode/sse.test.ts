import { describe, expect, it } from 'vitest'

import { MAX_SSE_BUFFER, SseBufferOverflowError, SseDecoder } from './sse'

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
    const second = decoder.push(
      chunk('ta","delta":"hi"}\n\ndata: {"type":"session.step.ended"}\n\n'),
    )
    expect(second).toEqual([
      { type: 'session.text.delta', delta: 'hi' },
      { type: 'session.step.ended' },
    ])
  })

  it('ignores comments and non-data fields', () => {
    const decoder = new SseDecoder()
    const events = decoder.push(chunk(': heartbeat\n\nevent: message\ndata: {"ok":true}\n\n\n\n'))
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

describe('SseDecoder line terminators', () => {
  it('parses CRLF-terminated frames', () => {
    const decoder = new SseDecoder()
    const events = decoder.push(chunk('data: {"a":1}\r\n\r\ndata: {"b":2}\r\n\r\n'))
    expect(events).toEqual([{ a: 1 }, { b: 2 }])
  })

  it('parses bare-CR-terminated frames', () => {
    const decoder = new SseDecoder()
    expect(decoder.push(chunk('data: {"a":1}\r\rdata: {"b":2}\r\r'))).toEqual([{ a: 1 }, { b: 2 }])
  })

  it('treats a CRLF split across chunks as one terminator', () => {
    const decoder = new SseDecoder()
    expect(decoder.push(chunk('data: {"a":1}\r'))).toEqual([])
    expect(decoder.push(chunk('\n\r'))).toEqual([{ a: 1 }])
    expect(decoder.push(chunk('\ndata: {"b":2}\n\n'))).toEqual([{ b: 2 }])
  })

  it('accepts all three terminators mixed in one stream', () => {
    const decoder = new SseDecoder()
    const events = decoder.push(chunk('data: {"a":\r\ndata: 1}\n\rdata: "x"\r\n\n'))
    expect(events).toEqual([{ a: 1 }, 'x'])
  })
})

describe('SseDecoder byte-split sweep', () => {
  // Every framing feature at once: CRLF, CR, LF, a comment, `id:`, `event:`,
  // multi-line data, a field with no space after the colon, and multi-byte
  // UTF-8 — so a split lands inside each of them, including mid-codepoint.
  const fixture = chunk(
    ': heartbeat\r\n\r\n' +
      'id: 1\r\nevent: message\r\ndata: {"type":"session.text.delta","delta":"héllo — 世界 🌍"}\r\n\r\n' +
      'data:{"a":\ndata: 2}\n\n' +
      'id: 2\rdata: "raw text"\r\r' +
      'data: {"type":"session.step.ended"}\n\n',
  )
  const expected = [
    { type: 'session.text.delta', delta: 'héllo — 世界 🌍' },
    { a: 2 },
    'raw text',
    { type: 'session.step.ended' },
  ]

  it('parses the unsplit fixture', () => {
    expect(new SseDecoder().push(fixture)).toEqual(expected)
  })

  it.each(Array.from({ length: fixture.length + 1 }, (_, offset) => offset))(
    'yields identical events when split at byte %i',
    (offset) => {
      const decoder = new SseDecoder()
      const events = [
        ...decoder.push(fixture.subarray(0, offset)),
        ...decoder.push(fixture.subarray(offset)),
      ]
      expect(events).toEqual(expected)
      expect(decoder.lastEventId).toBe('2')
    },
  )

  it('yields identical events when fed one byte at a time', () => {
    const decoder = new SseDecoder()
    const events = Array.from(fixture, (_, i) => decoder.push(fixture.subarray(i, i + 1))).flat()
    expect(events).toEqual(expected)
  })
})

describe('SseDecoder buffer cap', () => {
  it('throws a typed error when a line grows past the cap without a terminator', () => {
    const decoder = new SseDecoder()
    expect(() => decoder.push(chunk('data: ' + 'x'.repeat(MAX_SSE_BUFFER)))).toThrow(
      SseBufferOverflowError,
    )
  })

  it('throws when an event accumulates data past the cap without dispatching', () => {
    const decoder = new SseDecoder({ maxBuffer: 64 })
    expect(() => {
      for (let i = 0; i < 16; i++) decoder.push(chunk('data: xxxxxxxx\n'))
    }).toThrow(SseBufferOverflowError)
  })

  it('accepts a frame under the cap that dispatches', () => {
    const decoder = new SseDecoder({ maxBuffer: 64 })
    expect(decoder.push(chunk(`data: "${'x'.repeat(40)}"\n\n`))).toEqual(['x'.repeat(40)])
  })
})

describe('SseDecoder event ids', () => {
  it('tracks the id of the last dispatched event', () => {
    const decoder = new SseDecoder()
    decoder.push(chunk('id: 7\ndata: 1\n\n'))
    expect(decoder.lastEventId).toBe('7')
  })

  it('keeps the id across later events that carry none', () => {
    const decoder = new SseDecoder()
    decoder.push(chunk('id: 7\ndata: 1\n\ndata: 2\n\n'))
    expect(decoder.lastEventId).toBe('7')
  })

  it('does not commit an id until its event dispatches', () => {
    const decoder = new SseDecoder()
    decoder.push(chunk('id: 7\ndata: 1\n\nid: 8\ndata: 2\n'))
    expect(decoder.lastEventId).toBe('7')
  })

  it('commits an id from an event with no data', () => {
    const decoder = new SseDecoder()
    decoder.push(chunk('id: 9\n\n'))
    expect(decoder.lastEventId).toBe('9')
  })

  it('ignores an id containing NULL, per spec', () => {
    const decoder = new SseDecoder({ lastEventId: '3' })
    decoder.push(chunk('id: a\0b\ndata: 1\n\n'))
    expect(decoder.lastEventId).toBe('3')
  })

  it('starts from the id it is given, for resumption', () => {
    expect(new SseDecoder({ lastEventId: '41' }).lastEventId).toBe('41')
  })
})

describe('SseDecoder instances', () => {
  it('do not share partial UTF-8 state', () => {
    const euro = chunk('€')
    new SseDecoder().push(euro.subarray(0, 1))
    expect(new SseDecoder().push(chunk('data: "ok"\n\n'))).toEqual(['ok'])
  })
})

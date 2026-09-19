import { describe, expect, it } from 'vitest'

import { applyBatch, applyBatchToMessages, applyStreamEvent } from './stream-reducer'
import type { ChatMessage } from './types'

function message(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return { id: 'm1', role: 'assistant', content: '', ...overrides }
}

describe('applyStreamEvent', () => {
  it('appends text', () => {
    expect(applyStreamEvent(message({ content: 'he' }), { type: 'text', text: 'llo' })).toEqual(
      message({ content: 'hello' }),
    )
  })

  it('appends thinking separately from content', () => {
    const result = applyStreamEvent(message({ content: 'hi' }), { type: 'thinking', text: '…' })
    expect(result.content).toBe('hi')
    expect(result.reasoning).toBe('…')
  })

  it('sets streaming false on done', () => {
    expect(applyStreamEvent(message({ streaming: true }), { type: 'done' }).streaming).toBe(false)
  })

  it('marks streaming false and records the error on error', () => {
    const result = applyStreamEvent(message({ content: 'partial', streaming: true }), {
      type: 'error',
      message: 'boom',
    })
    expect(result.streaming).toBe(false)
    expect(result.content).toBe('partial\n\n[boom]')
  })

  it('returns the same reference for step events', () => {
    const m = message()
    expect(applyStreamEvent(m, { type: 'step', finishReason: 'stop' })).toBe(m)
  })
})

describe('applyBatch', () => {
  it('folds a batch in order with a single pass', () => {
    const result = applyBatch(message(), [
      { type: 'text', text: 'one ' },
      { type: 'text', text: 'two ' },
      { type: 'done' },
    ])
    expect(result).toEqual(message({ content: 'one two ', streaming: false }))
  })

  it('returns the same reference for an empty batch', () => {
    const m = message()
    expect(applyBatch(m, [])).toBe(m)
  })

  it('returns the same reference for a batch of step events only', () => {
    const m = message()
    expect(applyBatch(m, [{ type: 'step', finishReason: 'stop' }])).toBe(m)
  })
})

describe('applyBatchToMessages', () => {
  it('streams only into the targeted message and keeps other rows identical', () => {
    const user = { id: 'u1', role: 'user', content: 'hi' } as const
    const other = message({ id: 'm2' })
    const target = message({ id: 'm1', content: 'par' })
    const result = applyBatchToMessages([user, other, target], 'm1', [
      { type: 'text', text: 'tial' },
      { type: 'done' },
    ])
    expect(result[0]).toBe(user)
    expect(result[1]).toBe(other)
    expect(result[2]).toEqual(message({ id: 'm1', content: 'partial', streaming: false }))
  })

  it('keeps every row identical when nothing targets the in-flight message', () => {
    const a = message({ id: 'm1' })
    const b = message({ id: 'm2' })
    const result = applyBatchToMessages([a, b], 'other', [{ type: 'text', text: 'x' }])
    expect(result[0]).toBe(a)
    expect(result[1]).toBe(b)
  })

  it('returns the same array when there is no in-flight message', () => {
    const messages = [message({ id: 'm1' })]
    expect(applyBatchToMessages(messages, null, [{ type: 'text', text: 'x' }])).toBe(messages)
  })

  it('keeps every row identical for an empty batch', () => {
    const a = message({ id: 'm1' })
    const b = message({ id: 'm2' })
    const result = applyBatchToMessages([a, b], 'm1', [])
    expect(result[0]).toBe(a)
    expect(result[1]).toBe(b)
  })
})
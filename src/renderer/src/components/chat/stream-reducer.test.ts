import { describe, expect, it } from 'vitest'

import { applyBatch, applyStreamEvent } from './stream-reducer'
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
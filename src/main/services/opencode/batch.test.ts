import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

import { createBatcher } from './batch'
import type { StreamBatcher } from './batch'

describe('createBatcher', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function make(
    emit: Mock<(batch: unknown[]) => void> = vi.fn<(batch: unknown[]) => void>(),
  ): { batcher: StreamBatcher; emit: Mock<(batch: unknown[]) => void> } {
    return { batcher: createBatcher(emit, { flushMs: 8 }), emit }
  }

  it('emits nothing before the flush interval elapses', () => {
    const { batcher, emit } = make()
    batcher.push({ type: 'text', text: 'a' })
    expect(emit).not.toHaveBeenCalled()
    vi.advanceTimersByTime(7)
    expect(emit).not.toHaveBeenCalled()
  })

  it('delivers buffered events as one batch on the timer', () => {
    const { batcher, emit } = make()
    batcher.push({ type: 'text', text: 'a' })
    batcher.push({ type: 'text', text: 'b' })
    vi.advanceTimersByTime(8)
    expect(emit).toHaveBeenCalledTimes(1)
    expect(emit).toHaveBeenCalledWith([
      { type: 'text', text: 'a' },
      { type: 'text', text: 'b' },
    ])
  })

  it('coalesces bursts within the window into one batch', () => {
    const { batcher, emit } = make()
    for (let i = 0; i < 50; i++) batcher.push({ type: 'text', text: 'x' })
    vi.advanceTimersByTime(8)
    expect(emit).toHaveBeenCalledTimes(1)
    expect(emit.mock.calls[0]?.[0].length).toBe(50)
  })

  it('flushes eagerly when the cap is reached', () => {
    const emit = vi.fn<(batch: unknown[]) => void>()
    const batcher = createBatcher(emit, { cap: 3, flushMs: 1_000 })
    batcher.push({ type: 'text', text: 'a' })
    batcher.push({ type: 'text', text: 'b' })
    expect(emit).not.toHaveBeenCalled()
    batcher.push({ type: 'text', text: 'c' })
    expect(emit).toHaveBeenCalledTimes(1)
  })

  it('starts a fresh window after a flush', () => {
    const { batcher, emit } = make()
    batcher.push({ type: 'text', text: 'a' })
    vi.advanceTimersByTime(8)
    batcher.push({ type: 'text', text: 'b' })
    vi.advanceTimersByTime(8)
    expect(emit).toHaveBeenCalledTimes(2)
    expect(emit.mock.calls[1]?.[0]).toEqual([{ type: 'text', text: 'b' }])
  })

  it('flush() delivers immediately', () => {
    const { batcher, emit } = make()
    batcher.push({ type: 'text', text: 'a' })
    batcher.flush()
    expect(emit).toHaveBeenCalledTimes(1)
  })

  it('flush() with nothing buffered is a no-op', () => {
    const { batcher, emit } = make()
    batcher.flush()
    expect(emit).not.toHaveBeenCalled()
  })

  it('dispose() drops the buffer and cancels the timer', () => {
    const { batcher, emit } = make()
    batcher.push({ type: 'text', text: 'a' })
    batcher.dispose()
    vi.advanceTimersByTime(100)
    expect(emit).not.toHaveBeenCalled()
  })
})
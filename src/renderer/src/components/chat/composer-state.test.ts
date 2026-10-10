import { describe, expect, it, vi } from 'vitest'

import {
  canSubmit,
  composerReducer,
  createComposerStore,
  IDLE,
  type ComposerState,
} from './composer-state'

const sending: ComposerState = { status: 'sending', assistantId: 'a1' }
const streaming: ComposerState = { status: 'streaming', assistantId: 'a1' }
const failed: ComposerState = { status: 'error', message: 'boom' }

describe('composerReducer', () => {
  it('moves idle to sending on submit', () => {
    expect(composerReducer(IDLE, { type: 'submit', assistantId: 'a1' })).toEqual(sending)
  })

  it('ignores submit while sending', () => {
    expect(composerReducer(sending, { type: 'submit', assistantId: 'a2' })).toBe(sending)
  })

  it('ignores submit while streaming', () => {
    expect(composerReducer(streaming, { type: 'submit', assistantId: 'a2' })).toBe(streaming)
  })

  it('allows submit from error so a failed send can be retried', () => {
    expect(composerReducer(failed, { type: 'submit', assistantId: 'a2' })).toEqual({
      status: 'sending',
      assistantId: 'a2',
    })
  })

  it('moves sending to streaming when the send is accepted', () => {
    expect(composerReducer(sending, { type: 'accepted', assistantId: 'a1' })).toEqual(streaming)
  })

  it('moves sending to error when the send is rejected', () => {
    expect(
      composerReducer(sending, { type: 'rejected', assistantId: 'a1', error: 'nope' }),
    ).toEqual({ status: 'error', message: 'nope' })
  })

  it('ignores accepted/rejected for a request that is no longer in flight', () => {
    const next: ComposerState = { status: 'sending', assistantId: 'a2' }
    expect(composerReducer(next, { type: 'accepted', assistantId: 'a1' })).toBe(next)
    expect(composerReducer(next, { type: 'rejected', assistantId: 'a1', error: 'x' })).toBe(next)
    expect(composerReducer(IDLE, { type: 'accepted', assistantId: 'a1' })).toBe(IDLE)
  })

  it('moves sending to streaming on the first stream content', () => {
    expect(
      composerReducer(sending, { type: 'stream', batch: [{ type: 'text', text: 'h' }] }),
    ).toEqual(streaming)
  })

  it('returns to idle on stream done', () => {
    expect(composerReducer(streaming, { type: 'stream', batch: [{ type: 'done' }] })).toBe(IDLE)
  })

  it('returns to idle on stream error (the error is shown in the message)', () => {
    expect(
      composerReducer(streaming, { type: 'stream', batch: [{ type: 'error', message: 'x' }] }),
    ).toBe(IDLE)
  })

  it('returns to idle when done arrives before the send is acknowledged', () => {
    const batch = [{ type: 'text', text: 'hi' } as const, { type: 'done' } as const]
    expect(composerReducer(sending, { type: 'stream', batch })).toBe(IDLE)
  })

  it('keeps the same reference for non-terminal stream events while streaming', () => {
    expect(
      composerReducer(streaming, { type: 'stream', batch: [{ type: 'text', text: 'x' }] }),
    ).toBe(streaming)
  })

  it('ignores stray stream events while idle or in error', () => {
    expect(composerReducer(IDLE, { type: 'stream', batch: [{ type: 'done' }] })).toBe(IDLE)
    expect(composerReducer(failed, { type: 'stream', batch: [{ type: 'done' }] })).toBe(failed)
  })

  it('dismisses an error back to idle', () => {
    expect(composerReducer(failed, { type: 'dismiss' })).toBe(IDLE)
  })

  it('ignores dismiss outside the error state', () => {
    expect(composerReducer(streaming, { type: 'dismiss' })).toBe(streaming)
  })
})

describe('canSubmit', () => {
  it('is true only when idle or in error', () => {
    expect(canSubmit(IDLE)).toBe(true)
    expect(canSubmit(failed)).toBe(true)
    expect(canSubmit(sending)).toBe(false)
    expect(canSubmit(streaming)).toBe(false)
  })
})

describe('createComposerStore', () => {
  it('blocks a second submit fired synchronously before any re-render', () => {
    const store = createComposerStore()
    expect(store.dispatch({ type: 'submit', assistantId: 'a1' })).toBe(true)
    expect(store.dispatch({ type: 'submit', assistantId: 'a2' })).toBe(false)
    expect(store.getState()).toEqual(sending)
  })

  it('admits the next submit only after the stream settles', () => {
    const store = createComposerStore()
    store.dispatch({ type: 'submit', assistantId: 'a1' })
    store.dispatch({ type: 'stream', batch: [{ type: 'done' }] })
    expect(store.dispatch({ type: 'submit', assistantId: 'a2' })).toBe(true)
  })

  it('notifies subscribers on change only', () => {
    const store = createComposerStore()
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)
    store.dispatch({ type: 'submit', assistantId: 'a1' })
    store.dispatch({ type: 'submit', assistantId: 'a2' })
    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
    store.dispatch({ type: 'accepted', assistantId: 'a1' })
    expect(listener).toHaveBeenCalledTimes(1)
  })
})

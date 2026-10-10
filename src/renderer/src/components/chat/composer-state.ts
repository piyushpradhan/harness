import type { OpencodeStreamBatch } from '@shared/opencode-stream'

/**
 * The composer's lifecycle for one request at a time:
 *
 *   idle ──submit──▶ sending ──accepted / first stream event──▶ streaming
 *     ▲                 │                                           │
 *     │              rejected                               done / error
 *     │                 ▼                                           │
 *     └──dismiss──── error ◀── (submit again retries) ──────────────┘ (to idle)
 *
 * Only `idle` and `error` admit a submit, so a second message cannot be sent
 * while one is in flight.
 */
export type ComposerState =
  | { status: 'idle' }
  | { status: 'sending'; assistantId: string }
  | { status: 'streaming'; assistantId: string }
  | { status: 'error'; message: string }

export type ComposerAction =
  /** User submitted a draft; `assistantId` names the reply placeholder. */
  | { type: 'submit'; assistantId: string }
  /** `opencode.send` resolved ok for the request with this id. */
  | { type: 'accepted'; assistantId: string }
  /** `opencode.send` resolved with an error for the request with this id. */
  | { type: 'rejected'; assistantId: string; error: string }
  /** A drained batch of stream events. */
  | { type: 'stream'; batch: OpencodeStreamBatch }
  /** User acknowledged an error. */
  | { type: 'dismiss' }

export const IDLE: ComposerState = { status: 'idle' }

/** Pure transition function. Returns the same reference when nothing changes. */
export function composerReducer(state: ComposerState, action: ComposerAction): ComposerState {
  switch (action.type) {
    case 'submit':
      return canSubmit(state) ? { status: 'sending', assistantId: action.assistantId } : state

    case 'accepted':
      return state.status === 'sending' && state.assistantId === action.assistantId
        ? { status: 'streaming', assistantId: state.assistantId }
        : state

    case 'rejected':
      return (state.status === 'sending' || state.status === 'streaming') &&
        state.assistantId === action.assistantId
        ? { status: 'error', message: action.error }
        : state

    case 'stream': {
      if (state.status !== 'sending' && state.status !== 'streaming') return state
      if (action.batch.some((event) => event.type === 'done' || event.type === 'error')) return IDLE
      if (state.status === 'sending' && action.batch.length > 0) {
        return { status: 'streaming', assistantId: state.assistantId }
      }
      return state
    }

    case 'dismiss':
      return state.status === 'error' ? IDLE : state
  }
}

export function canSubmit(state: ComposerState): boolean {
  return state.status === 'idle' || state.status === 'error'
}

/**
 * A synchronous holder for the composer state, shaped for
 * `useSyncExternalStore`. React state alone can't gate double-submit: two
 * Enter presses inside one frame both see the stale pre-render value. The
 * store updates immediately, so the second `dispatch` sees `sending`.
 */
export interface ComposerStore {
  getState: () => ComposerState
  /** Apply an action; returns true if the state changed. */
  dispatch: (action: ComposerAction) => boolean
  subscribe: (listener: () => void) => () => void
}

export function createComposerStore(): ComposerStore {
  let state = IDLE
  const listeners = new Set<() => void>()
  return {
    getState: () => state,
    dispatch(action) {
      const next = composerReducer(state, action)
      if (next === state) return false
      state = next
      for (const listener of listeners) listener()
      return true
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

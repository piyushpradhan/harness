import { describe, expect, it, vi } from 'vitest'
import { runAgent } from './runner'
import type { Cancellable, ChatStreamCallbacks, ChatStreamRequest, LLMProvider } from '../llm/provider'
import type { ChatMessage, SessionEvent } from '../../../shared/types'

type ScriptStep = { delta: string } | 'done' | 'error'

class FakeProvider implements LLMProvider {
  cancelCalls = 0
  streamCalls = 0
  lastRequest: ChatStreamRequest | null = null
  #script: ScriptStep[]
  #cancelled = false
  #accumulated = ''

  constructor(script: ScriptStep[]) {
    this.#script = script
  }

  listModels = vi.fn(async () => [])

  streamChat(req: ChatStreamRequest, cb: ChatStreamCallbacks): Cancellable {
    this.streamCalls += 1
    this.lastRequest = req
    void (async () => {
      for (const step of this.#script) {
        await new Promise((r) => setTimeout(r, 1))
        if (this.#cancelled) return
        if (step === 'done') {
          cb.onDone(this.#accumulated)
          return
        }
        if (step === 'error') {
          cb.onError(new Error('boom'))
          return
        }
        this.#accumulated += step.delta
        cb.onDelta(step.delta)
      }
    })()
    return {
      cancel: () => {
        this.#cancelled = true
        this.cancelCalls += 1
      }
    }
  }
}

function run(
  script: ScriptStep[],
  opts: { signal?: AbortSignal; system?: string; messages?: ChatMessage[] } = {}
): { provider: FakeProvider; events: SessionEvent[]; promise: Promise<void> } {
  const provider = new FakeProvider(script)
  const events: SessionEvent[] = []
  const promise = runAgent({
    sessionId: 's1',
    provider,
    model: 'm',
    system: opts.system,
    messages: opts.messages ?? [{ role: 'user', content: 'hi' }],
    onEvent: (e) => events.push(e),
    signal: opts.signal
  })
  return { provider, events, promise }
}

describe('AgentRunner', () => {
  it('emits connecting, streaming, deltas and done in order', async () => {
    const { events, promise } = run([{ delta: 'a' }, { delta: 'b' }, 'done'])
    await promise
    expect(events.map((e) => e.type)).toEqual(['status', 'status', 'delta', 'delta', 'done'])
    expect(events[0]).toEqual({ sessionId: 's1', type: 'status', state: 'connecting' })
    expect(events[1]).toEqual({ sessionId: 's1', type: 'status', state: 'streaming' })
    expect(events[2]).toEqual({ sessionId: 's1', type: 'delta', text: 'a' })
    expect(events[3]).toEqual({ sessionId: 's1', type: 'delta', text: 'b' })
    const done = events[4]
    expect(done.type).toBe('done')
    if (done.type === 'done') {
      expect(done.text).toBe('ab')
      expect(done.durationMs).toBeGreaterThanOrEqual(0)
    }
  })

  it('emits an error event when the provider fails', async () => {
    const { events, promise } = run([{ delta: 'a' }, 'error'])
    await promise
    expect(events.at(-1)).toEqual({ sessionId: 's1', type: 'error', message: 'boom' })
    expect(events.some((e) => e.type === 'done')).toBe(false)
  })

  it('prepends the system prompt to the provider payload', async () => {
    const { provider, events, promise } = run(['done'], { system: 'be terse' })
    await promise
    expect(events.at(-1)?.type).toBe('done')
    expect(provider.lastRequest?.messages).toEqual([
      { role: 'system', content: 'be terse' },
      { role: 'user', content: 'hi' }
    ])
  })

  it('cancels the underlying stream and emits a single cancelled status', async () => {
    const controller = new AbortController()
    const { provider, events, promise } = run([{ delta: 'a' }, { delta: 'b' }, { delta: 'c' }, 'done'], {
      signal: controller.signal
    })
    // wait until the stream is actually producing deltas, then abort mid-stream
    await new Promise<void>((resolve) => {
      const timer = setInterval(() => {
        if (events.some((e) => e.type === 'delta')) {
          clearInterval(timer)
          resolve()
        }
      }, 2)
    })
    controller.abort()
    await promise

    expect(provider.cancelCalls).toBe(1)
    expect(events.some((e) => e.type === 'done')).toBe(false)
    expect(events.some((e) => e.type === 'error')).toBe(false)
    expect(events.filter((e) => e.type === 'status' && e.state === 'cancelled')).toHaveLength(1)
    expect(events.at(-1)).toEqual({ sessionId: 's1', type: 'status', state: 'cancelled' })
  })

  it('never calls the provider when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const { provider, events } = run(['done'], { signal: controller.signal })
    expect(events).toEqual([{ sessionId: 's1', type: 'status', state: 'cancelled' }])
    expect(provider.streamCalls).toBe(0)
  })
})
import { EventEmitter } from 'node:events'
import { createServer } from 'node:net'
import type { AddressInfo } from 'node:net'
import { PassThrough } from 'node:stream'

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { setLogLevel } from '@shared/logger'
import type { OpencodeStreamEvent } from '@shared/opencode-stream'

import {
  FAKE_SESSION_ID,
  startFakeOpencode,
  type FakeOpencode,
} from '../../../../scripts/fake-opencode'
import { ensureServer, onStreamEvent, prewarm, sendMessage, stopServer } from '.'

/**
 * The service against the fake OpenCode server over real HTTP. The only seam
 * replaced is `spawn` — the process boundary — so tests that exercise the
 * spawn path get a "child" that starts a fake server on the requested port.
 */

const mocks = vi.hoisted(() => ({ spawn: vi.fn() }))
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }))

/** A ChildProcess stand-in whose "process" is a fake server on `--port`. */
class FakeChild extends EventEmitter {
  exitCode: number | null = null
  signalCode: NodeJS.Signals | null = null
  readonly stderr = new PassThrough()
  server: FakeOpencode | null = null

  exit(code: number | null, signal: NodeJS.Signals | null = null): void {
    if (this.exitCode !== null || this.signalCode !== null) return
    this.exitCode = code
    this.signalCode = signal
    void this.server?.close()
    this.emit('exit', code, signal)
  }

  kill(signal: NodeJS.Signals = 'SIGTERM'): boolean {
    this.exit(null, signal)
    return true
  }
}

const children: FakeChild[] = []

function spawnFakeServer(_cmd: string, args: string[]): FakeChild {
  const child = new FakeChild()
  children.push(child)
  const port = Number(args[args.indexOf('--port') + 1])
  startFakeOpencode({ deltas: 0, rate: 1000, port }).then(
    (server) => {
      if (child.exitCode !== null || child.signalCode !== null) void server.close()
      else child.server = server
    },
    () => child.exit(1),
  )
  return child
}

function spawnMissingBinary(): FakeChild {
  const child = new FakeChild()
  children.push(child)
  setImmediate(() =>
    child.emit('error', Object.assign(new Error('spawn opencode ENOENT'), { code: 'ENOENT' })),
  )
  return child
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer()
    probe.on('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as AddressInfo
      probe.close(() => resolve(port))
    })
  })
}

function collect(): OpencodeStreamEvent[] {
  const events: OpencodeStreamEvent[] = []
  onStreamEvent((batch) => events.push(...batch))
  return events
}

beforeAll(() => {
  setLogLevel('silent')
})

beforeEach(() => {
  mocks.spawn.mockReset()
  children.length = 0
  delete process.env.HARNESS_OPENCODE_URL
  delete process.env.HARNESS_OPENCODE_PORT
})

afterEach(async () => {
  stopServer()
  await Promise.all(children.flatMap((child) => (child.server ? [child.server.close()] : [])))
})

describe('event stream ordering', () => {
  let fake: FakeOpencode

  afterEach(async () => {
    await fake.close()
  })

  it('delivers a delta emitted the instant the prompt is admitted', async () => {
    fake = await startFakeOpencode({ deltas: 1, rate: 1000, token: 'first', startOnPrompt: true })
    process.env.HARNESS_OPENCODE_URL = fake.url
    const events = collect()

    await sendMessage('hi')

    await vi.waitFor(() => expect(events).toContainEqual({ type: 'text', text: 'first' }))
  })
})

describe('event stream reconnect', () => {
  let fake: FakeOpencode

  function frame(payload: unknown, id?: string): string {
    return `${id ? `id: ${id}\n` : ''}data: ${JSON.stringify(payload)}\n\n`
  }

  function delta(text: string): unknown {
    return { type: 'session.text.delta', data: { sessionID: FAKE_SESSION_ID, delta: text } }
  }

  beforeEach(async () => {
    // Full jitter with a zero draw: every reconnect is immediate.
    vi.spyOn(Math, 'random').mockReturnValue(0)
    fake = await startFakeOpencode({ deltas: 0, rate: 1000 })
    process.env.HARNESS_OPENCODE_URL = fake.url
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await fake.close()
  })

  it('discards a frame cut off by a drop instead of corrupting the next one', async () => {
    const events = collect()
    await sendMessage('hi')

    fake.write('data: {"type":"session.text.del')
    fake.drop()
    await vi.waitFor(() => expect(fake.eventRequests).toHaveLength(2))
    fake.write(frame(delta('after')))

    await vi.waitFor(() => expect(events).toContainEqual({ type: 'text', text: 'after' }))
  })

  it('sends the last seen event id as Last-Event-ID on reconnect', async () => {
    const events = collect()
    await sendMessage('hi')

    fake.write(frame(delta('one'), '41'))
    fake.write(frame(delta('two'), '42'))
    await vi.waitFor(() => expect(events).toContainEqual({ type: 'text', text: 'two' }))
    fake.drop()

    await vi.waitFor(() => expect(fake.eventRequests).toHaveLength(2))
    expect(fake.eventRequests[0]['last-event-id']).toBeUndefined()
    expect(fake.eventRequests[1]['last-event-id']).toBe('42')
  })

  it('reports an error to the sink after the retry ceiling instead of looping', async () => {
    const events = collect()
    await sendMessage('hi')

    fake.failEvents(503)
    fake.drop()

    await vi.waitFor(() => {
      const error = events.find((event) => event.type === 'error')
      expect(error?.message).toMatch(/503/)
    })
    const attempts = fake.eventRequests.length
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(fake.eventRequests).toHaveLength(attempts)
  })

  it('resubscribes on the next message after giving up', async () => {
    collect()
    await sendMessage('hi')
    fake.failEvents(503)
    fake.drop()
    await vi.waitFor(() => expect(fake.eventRequests.length).toBeGreaterThan(2))
    await new Promise((resolve) => setTimeout(resolve, 50))
    const attempts = fake.eventRequests.length

    fake.failEvents(null)
    await sendMessage('again')

    expect(fake.eventRequests).toHaveLength(attempts + 1)
  })
})

describe('pre-warm', () => {
  beforeEach(async () => {
    process.env.HARNESS_OPENCODE_PORT = String(await freePort())
  })

  it('shares one spawn between pre-warm and a message sent before it resolves', async () => {
    mocks.spawn.mockImplementation(spawnFakeServer)

    prewarm()
    await sendMessage('hi')

    expect(mocks.spawn).toHaveBeenCalledTimes(1)
  })

  it('logs a failed pre-warm instead of throwing, and lets the next caller retry', async () => {
    mocks.spawn.mockImplementation(spawnMissingBinary)
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)

    try {
      prewarm()
      await expect(ensureServer()).rejects.toThrow(/failed to start/)
      const spawnsAfterPrewarm = mocks.spawn.mock.calls.length

      mocks.spawn.mockImplementation(spawnFakeServer)
      const info = await ensureServer()
      expect(info.url).toMatch(/^http:\/\/127\.0\.0\.1:/)
      expect(mocks.spawn.mock.calls.length).toBeGreaterThan(spawnsAfterPrewarm)
      expect(unhandled).not.toHaveBeenCalled()
    } finally {
      process.off('unhandledRejection', unhandled)
    }
  })
})

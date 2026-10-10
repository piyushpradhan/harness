import { EventEmitter, once } from 'node:events'
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
  pid: number | undefined = 4242
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
  child.pid = undefined
  children.push(child)
  setImmediate(() =>
    child.emit('error', Object.assign(new Error('spawn opencode ENOENT'), { code: 'ENOENT' })),
  )
  return child
}

/** A server that complains on stderr and exits before it ever listens. */
function spawnBadConfig(): FakeChild {
  const child = new FakeChild()
  children.push(child)
  setImmediate(() => {
    child.stderr.write('Error: invalid opencode.json\n  at line 3: unexpected token\n')
    setImmediate(() => child.exit(1))
  })
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
  await stopServer()
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

describe('process supervision', () => {
  let basePort: number

  beforeEach(async () => {
    basePort = await freePort()
    process.env.HARNESS_OPENCODE_PORT = String(basePort)
  })

  function portsSpawnedOn(): number[] {
    return mocks.spawn.mock.calls.map(([, args]) => {
      const argv = args as string[]
      return Number(argv[argv.indexOf('--port') + 1])
    })
  }

  it('includes the server stderr in the startup error', async () => {
    mocks.spawn.mockImplementation(spawnBadConfig)
    await expect(ensureServer()).rejects.toThrow(/invalid opencode\.json[\s\S]*unexpected token/)
  })

  it('does not retry other ports when the server itself fails', async () => {
    mocks.spawn.mockImplementation(spawnBadConfig)
    await ensureServer().catch(() => undefined)
    expect(mocks.spawn).toHaveBeenCalledTimes(1)
  })

  it('skips a taken port without spawning on it', async () => {
    const holder = createServer().listen(basePort, '127.0.0.1')
    await once(holder, 'listening')
    mocks.spawn.mockImplementation(spawnFakeServer)
    try {
      await ensureServer()
      expect(portsSpawnedOn()).toEqual([basePort + 1])
    } finally {
      await new Promise((resolve) => holder.close(resolve))
    }
  })

  it('probes health immediately instead of sleeping first', async () => {
    mocks.spawn.mockImplementation(spawnFakeServer)
    const started = performance.now()
    await ensureServer()
    expect(performance.now() - started).toBeLessThan(150)
  })

  it('reports a server that dies mid-session to the sink, with its stderr', async () => {
    mocks.spawn.mockImplementation(spawnFakeServer)
    const events = collect()
    await sendMessage('hi')

    const [child] = children
    child.stderr.write('panic: out of memory\n')
    await new Promise((resolve) => setImmediate(resolve))
    child.exit(137)

    await vi.waitFor(() => {
      const error = events.find((event) => event.type === 'error')
      expect(error?.message).toMatch(/exited[\s\S]*137[\s\S]*out of memory/)
    })
  })

  it('respawns on the next message after the server died', async () => {
    mocks.spawn.mockImplementation(spawnFakeServer)
    collect()
    await sendMessage('hi')
    children[0].exit(1)

    await sendMessage('again')

    expect(mocks.spawn).toHaveBeenCalledTimes(2)
  })

  it('reports nothing when the server is stopped deliberately', async () => {
    mocks.spawn.mockImplementation(spawnFakeServer)
    const events = collect()
    await sendMessage('hi')
    const [child] = children

    await stopServer()

    expect(child.signalCode).toBe('SIGTERM')
    expect(events.filter((event) => event.type === 'error')).toEqual([])
  })

  it('kills a server that finishes starting after stop was requested', async () => {
    const stops: Promise<void>[] = []
    mocks.spawn.mockImplementation((cmd: string, args: string[]) => {
      const child = spawnFakeServer(cmd, args)
      stops.push(stopServer()) // quit lands while the child is still booting
      return child
    })

    await expect(ensureServer()).rejects.toThrow(/stopped/)
    await Promise.all(stops)
    expect(children[0].signalCode).toBe('SIGTERM')
  })
})

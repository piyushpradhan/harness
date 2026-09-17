/**
 * A stand-in for `opencode serve`, speaking just enough of its HTTP contract to
 * drive the streaming benchmark: health, session create, prompt admit, and the
 * `/api/event` SSE bus.
 *
 * Why a fake and not the real binary: the benchmark measures *our* transport —
 * IPC, React, paint — and a real agent's token rate is neither fixed nor
 * reproducible. Emitting N deltas at an exact rate is the only way the numbers
 * mean the same thing twice. It also means the benchmark runs on a CI box with
 * no `opencode` installed.
 *
 * ponytail: `node:http` with a hand-written SSE frame. The whole protocol
 * surface used here is four routes and one `data:` line; a framework would be
 * more code than the server.
 */
import { createServer, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

export interface FakeOpencodeOptions {
  /** Total `session.text.delta` events to emit before finishing. */
  deltas: number
  /** Emission rate in deltas per second. */
  rate: number
  /** Payload of each delta. Fixed width keeps per-event cost comparable. */
  token?: string
}

export interface FakeOpencode {
  url: string
  close(): Promise<void>
}

const SESSION_ID = 'bench-session'
const DEFAULT_TOKEN = 'lorem '

function sse(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`
}

/**
 * Starts the server on an ephemeral port and resolves once it is listening.
 *
 * Emission begins only when a prompt has been admitted **and** the event stream
 * is connected, in whichever order those happen. The app under test currently
 * POSTs the prompt before opening the stream, so waiting for both is what makes
 * the delta count deterministic — otherwise the benchmark would silently
 * measure a short stream and report flattering percentiles.
 */
export function startFakeOpencode(options: FakeOpencodeOptions): Promise<FakeOpencode> {
  const token = options.token ?? DEFAULT_TOKEN
  const intervalMs = 1000 / options.rate

  let prompted = false
  let stream: ServerResponse | null = null
  let timer: NodeJS.Timeout | null = null
  let sent = 0

  const stopTimer = (): void => {
    if (timer) clearInterval(timer)
    timer = null
  }

  const maybeStart = (): void => {
    if (!prompted || !stream || timer) return
    timer = setInterval(() => {
      if (!stream) return stopTimer()
      if (sent >= options.deltas) {
        stream.write(sse({ type: 'session.execution.succeeded', data: { sessionID: SESSION_ID } }))
        return stopTimer()
      }
      sent++
      stream.write(
        sse({ type: 'session.text.delta', data: { sessionID: SESSION_ID, delta: token } }),
      )
    }, intervalMs)
  }

  const server: Server = createServer((req, res) => {
    const url = req.url ?? '/'

    if (url === '/api/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' }).end('{}')
      return
    }

    if (url === '/api/session' && req.method === 'POST') {
      req.resume()
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ data: { id: SESSION_ID } }))
      return
    }

    if (url.endsWith('/prompt') && req.method === 'POST') {
      req.resume()
      req.on('end', () => {
        prompted = true
        maybeStart()
      })
      res.writeHead(200, { 'Content-Type': 'application/json' }).end('{}')
      return
    }

    if (url === '/api/event') {
      // Nagle would coalesce small frames into ~40 ms batches and the benchmark
      // would measure the kernel's buffering instead of the app's.
      req.socket.setNoDelay(true)
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      })
      res.flushHeaders()
      stream = res
      res.on('close', () => {
        if (stream === res) stream = null
        stopTimer()
      })
      maybeStart()
      return
    }

    res.writeHead(404).end()
  })

  return new Promise((resolve, reject) => {
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () =>
          new Promise<void>((done) => {
            stopTimer()
            stream?.end()
            server.close(() => {
              done()
            })
            server.closeAllConnections()
          }),
      })
    })
  })
}

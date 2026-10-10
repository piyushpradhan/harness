import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'

import { createLogger } from '@shared/logger'
import type { OpencodeStreamBatch, OpencodeStreamEvent } from '@shared/opencode-stream'

import { fullJitterDelay } from './backoff'
import { createBatcher } from './batch'
import { SseDecoder } from './sse'

/**
 * Talks to a headless OpenCode server over plain HTTP — no SDK.
 *
 * Lifecycle follows the OpenCode server contract:
 *   - `opencode serve --port <n>` runs the server; `OPENCODE_SERVER_PASSWORD`
 *     protects it with HTTP basic auth (username defaults to `opencode`).
 *   - `POST /api/session/{id}/prompt` durably admits a message and returns
 *     immediately; the agent loop runs server-side.
 *   - `GET /api/event` is the global SSE bus. We filter it down to our
 *     session and map the granular events to `OpencodeStreamEvent`.
 */

const log = createLogger('opencode')

const BASE_PORT = 4096
const PORT_ATTEMPTS = 4
const HEALTH_TIMEOUT_MS = 2_000
const HEALTH_POLL_MS = 250
const HEALTH_POLLS = 60 // ~15s startup budget
// Event-stream reconnects: full-jitter exponential backoff, 1 s → 30 s.
// Ten consecutive failures (~1.5 min expected) is a server that is gone.
const RECONNECT_BASE_MS = 1_000
const RECONNECT_MAX_MS = 30_000
const RECONNECT_ATTEMPTS = 10

interface ServerInfo {
  url: string
  password: string
}

/** Minimal shape of the events observed on the V2 event bus. */
interface RawEvent {
  type?: string
  data?: {
    sessionID?: string
    delta?: string
    finish?: string
    id?: string
    action?: string
    resources?: string[]
  }
}

let child: ChildProcess | null = null
let server: ServerInfo | null = null
/** In-flight start, shared by pre-warm and every caller that arrives before it settles. */
let starting: Promise<ServerInfo> | null = null
let sessionID: string | null = null
let activeSessionID: string | null = null
let streamAbort: AbortController | null = null
/** Resolves once the event stream is subscribed; shared like `starting`. */
let streamOpen: Promise<void> | null = null

/** Sink for batches leaving the service; wired to the renderer by main. */
let streamSink: ((batch: OpencodeStreamBatch) => void) | null = null

/**
 * Accumulate stream events on an 8 ms timer (or 64-event cap) and deliver them
 * as one array — one IPC message, one structured clone — instead of one per
 * token. The renderer then applies each batch in a single frame.
 */
const batcher = createBatcher((batch) => streamSink?.(batch))

function authHeaders(password: string): Record<string, string> {
  const token = Buffer.from(`opencode:${password}`).toString('base64')
  return { Authorization: `Basic ${token}` }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        resolve()
      },
      { once: true },
    )
  })
}

async function isHealthy(info: ServerInfo): Promise<boolean> {
  try {
    const res = await fetch(`${info.url}/api/health`, {
      headers: authHeaders(info.password),
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    })
    return res.ok
  } catch {
    return false
  }
}

/**
 * Start a dedicated `opencode serve` on a deterministic port with a
 * per-run random password. Tries the next port up when one is taken.
 *
 * Concurrent callers share one start: pre-warm and a message typed before
 * the server is up must not race two spawns onto the same ports. A failed
 * start is forgotten, so the next caller tries again.
 */
export function ensureServer(): Promise<ServerInfo> {
  if (server) return Promise.resolve(server)
  starting ??= startServer().finally(() => {
    starting = null
  })
  return starting
}

async function startServer(): Promise<ServerInfo> {
  // Point the service at an already-running server instead of spawning one.
  // scripts/bench.ts uses this to substitute a deterministic fake; it is also
  // the hook for attaching to an `opencode serve` you started yourself.
  const external = process.env.HARNESS_OPENCODE_URL
  if (external) {
    server = { url: external, password: process.env.HARNESS_OPENCODE_PASSWORD ?? '' }
    log.info('using external opencode server', { url: external })
    return server
  }

  const basePort = Number(process.env.HARNESS_OPENCODE_PORT) || BASE_PORT
  const lastPort = basePort + PORT_ATTEMPTS - 1
  const password = randomBytes(24).toString('base64url')
  for (let attempt = 0; attempt < PORT_ATTEMPTS; attempt++) {
    const port = basePort + attempt
    const candidate: ServerInfo = { url: `http://127.0.0.1:${port}`, password }

    const proc = spawn('opencode', ['serve', '--port', String(port), '--hostname', '127.0.0.1'], {
      env: { ...process.env, OPENCODE_SERVER_PASSWORD: password },
      stdio: 'ignore',
    })
    // A missing binary is reported as an `error` event, and an unhandled one
    // throws — at launch, now that the server is pre-warmed.
    let spawnError: Error | null = null
    proc.on('error', (err) => {
      spawnError = err
    })

    for (let poll = 0; poll < HEALTH_POLLS; poll++) {
      await sleep(HEALTH_POLL_MS)
      if (spawnError) throw new Error(`opencode serve failed to start: ${String(spawnError)}`)
      if (proc.exitCode !== null) break // died — port conflict or opencode missing
      if (await isHealthy(candidate)) {
        child = proc
        server = candidate
        log.info('opencode serve ready', { url: candidate.url })
        return candidate
      }
    }
    proc.kill()
  }
  throw new Error(
    `opencode serve failed to start (ports ${basePort}–${lastPort}); is \`opencode\` on PATH?`,
  )
}

/**
 * Boot the server in the background at launch so the first message does not
 * pay for it. Failure is logged, not thrown: `sendMessage` retries the start
 * and reports the error where the user can see it.
 */
export function prewarm(): void {
  ensureServer().catch((err: unknown) => {
    log.warn('pre-warm failed; will retry on first message', err)
  })
}

/**
 * Create a session lazily, once per app run, rooted at the harness cwd, and
 * make sure the event stream is subscribed before the caller prompts it.
 *
 * The bus does not replay: anything emitted between a prompt being admitted
 * and the stream connecting is lost — a response that intermittently starts
 * mid-sentence. Subscribing first is the only ordering that cannot drop.
 * The two requests are independent, so they run concurrently.
 */
async function ensureSession(info: ServerInfo): Promise<string> {
  const [id] = await Promise.all([createSession(info), ensureStream(info)])
  return id
}

async function createSession(info: ServerInfo): Promise<string> {
  if (sessionID) return sessionID
  const res = await fetch(`${info.url}/api/session`, {
    method: 'POST',
    headers: { ...authHeaders(info.password), 'Content-Type': 'application/json' },
    body: JSON.stringify({ location: { directory: process.cwd() } }),
  })
  if (!res.ok)
    throw new Error(`create session: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`)
  const result = (await res.json()) as { data: { id: string } }
  sessionID = result.data.id
  log.info('created session', { sessionID })
  return sessionID
}

/** Admit a user message into the session. Events arrive via `onStreamEvent`. */
export async function sendMessage(text: string): Promise<void> {
  const info = await ensureServer()
  const id = await ensureSession(info)
  // Set before the POST: the first events can arrive before its response does.
  activeSessionID = id

  const res = await fetch(`${info.url}/api/session/${id}/prompt`, {
    method: 'POST',
    headers: { ...authHeaders(info.password), 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  })
  if (!res.ok) throw new Error(`prompt: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`)
  log.info('message admitted', { sessionID: id })
}

function mapEvent(event: RawEvent, emit: (evt: OpencodeStreamEvent) => void): void {
  // The bus is global across sessions; drop everything that isn't ours.
  const eventSession = event.data?.sessionID
  if (eventSession && eventSession !== activeSessionID) return

  switch (event.type) {
    case 'session.text.delta':
      emit({ type: 'text', text: event.data?.delta ?? '' })
      break
    case 'session.reasoning.delta':
      emit({ type: 'thinking', text: event.data?.delta ?? '' })
      break
    case 'session.tool.called':
      emit({ type: 'tool', state: 'running' })
      break
    case 'session.tool.success':
      emit({ type: 'tool', state: 'completed' })
      break
    case 'session.step.ended':
      emit({ type: 'step', finishReason: event.data?.finish ?? 'stop' })
      break
    case 'session.execution.succeeded':
      emit({ type: 'done' })
      break
    case 'session.execution.failed':
      emit({ type: 'error', message: 'execution failed' })
      break
  }
}

/**
 * A permission request nobody answers stalls the agent loop forever — that
 * is what "thinking stops, no final text" looks like on the wire. The
 * harness auto-approves each request once and reports it in the UI.
 */
async function approvePermission(
  info: ServerInfo,
  sessionID: string,
  requestID: string,
): Promise<void> {
  try {
    const res = await fetch(`${info.url}/api/session/${sessionID}/permission/${requestID}/reply`, {
      method: 'POST',
      headers: { ...authHeaders(info.password), 'Content-Type': 'application/json' },
      body: JSON.stringify({ reply: 'once' }),
    })
    if (!res.ok) log.warn('permission reply rejected', { status: res.status })
    else log.info('permission auto-approved', { sessionID })
  } catch (err) {
    log.warn('permission reply failed', err)
  }
}

async function connectEvents(
  info: ServerInfo,
  signal: AbortSignal,
  lastEventId = '',
): Promise<ReadableStream<Uint8Array>> {
  const headers = authHeaders(info.password)
  // SSE resumption: a server that honors it replays what the drop lost. One
  // that does not (OpenCode's bus today, as far as we know) ignores a header.
  if (lastEventId) headers['Last-Event-ID'] = lastEventId
  const res = await fetch(`${info.url}/api/event`, { headers, signal })
  if (!res.ok || !res.body) throw new Error(`event stream: HTTP ${res.status}`)
  return res.body
}

/**
 * Subscribe to the event bus once. Resolves when the server has accepted the
 * connection (response headers received), which is the point from which
 * events are delivered; a failed first connect rejects and is forgotten.
 */
function ensureStream(info: ServerInfo): Promise<void> {
  streamOpen ??= (async () => {
    const abort = new AbortController()
    streamAbort = abort
    try {
      const body = await connectEvents(info, abort.signal)
      void pump(info, abort.signal, body)
    } catch (err) {
      if (streamAbort === abort) {
        streamAbort = null
        streamOpen = null
      }
      throw err
    }
  })()
  return streamOpen
}

/**
 * Drain the open stream, reconnecting whenever it drops, until aborted. Gives
 * up after `RECONNECT_ATTEMPTS` consecutive failures and tells the renderer,
 * rather than retrying a dead server forever behind a silent spinner; the
 * next `sendMessage` subscribes afresh.
 */
async function pump(
  info: ServerInfo,
  signal: AbortSignal,
  opened: ReadableStream<Uint8Array>,
): Promise<void> {
  let body: ReadableStream<Uint8Array> | null = opened
  let lastEventId = ''
  let attempt = 0
  let lastError: unknown
  while (!signal.aborted) {
    // Fresh per connection: a frame cut off by a drop must not prefix the
    // first bytes of the next stream. Only the event id carries over.
    const decoder = new SseDecoder({ lastEventId })
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null
    try {
      body ??= await connectEvents(info, signal, lastEventId)
      attempt = 0
      reader = body.getReader()
      for (;;) {
        const read = (await reader.read()) as { done: boolean; value?: Uint8Array }
        if (read.done || !read.value) break
        for (const raw of decoder.push(read.value)) {
          const evt = raw as RawEvent
          if (
            evt.type === 'permission.asked' &&
            evt.data?.sessionID === activeSessionID &&
            evt.data.id
          ) {
            const detail = `${evt.data.action ?? 'permission'} ${(evt.data.resources ?? []).join(', ')}`
            batcher.push({ type: 'tool', state: 'running', detail })
            void approvePermission(info, evt.data.sessionID, evt.data.id)
          }
          mapEvent(evt, (mapped) => batcher.push(mapped))
        }
      }
      lastError = new Error('event stream closed by server')
    } catch (err) {
      if (signal.aborted) return
      lastError = err
    } finally {
      lastEventId = decoder.lastEventId
      reader?.cancel().catch(() => undefined)
    }
    body = null

    if (attempt >= RECONNECT_ATTEMPTS) {
      const reason = lastError instanceof Error ? lastError.message : String(lastError)
      const message = `event stream lost after ${attempt} reconnect attempts: ${reason}`
      log.error(message)
      batcher.push({ type: 'error', message })
      batcher.flush()
      if (streamAbort?.signal === signal) {
        streamAbort = null
        streamOpen = null
      }
      return
    }
    const delayMs = fullJitterDelay(attempt++, RECONNECT_BASE_MS, RECONNECT_MAX_MS)
    log.warn(
      'event stream dropped, reconnecting',
      { attempt, delayMs: Math.round(delayMs) },
      lastError,
    )
    await sleep(delayMs, signal)
  }
}

export function onStreamEvent(sink: (batch: OpencodeStreamBatch) => void): void {
  streamSink = sink
}

/** Tear down the server child and all state. Called on app quit. */
export function stopServer(): void {
  streamAbort?.abort()
  streamAbort = null
  streamOpen = null
  starting = null
  if (child?.exitCode === null) child.kill()
  child = null
  server = null
  sessionID = null
  activeSessionID = null
  streamSink = null
  batcher.dispose()
  log.info('stopped')
}

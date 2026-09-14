import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'

import { createLogger } from '@shared/logger'
import type { OpencodeStreamEvent } from '@shared/opencode-stream'

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
const RECONNECT_DELAY_MS = 1_000

interface ServerInfo {
  url: string
  password: string
}

/** Minimal shape of the events observed on the V2 event bus. */
interface RawEvent {
  type?: string
  data?: { sessionID?: string; delta?: string; finish?: string }
}

let child: ChildProcess | null = null
let server: ServerInfo | null = null
let sessionID: string | null = null
let activeSessionID: string | null = null
let streamAbort: AbortController | null = null

function authHeaders(password: string): Record<string, string> {
  const token = Buffer.from(`opencode:${password}`).toString('base64')
  return { Authorization: `Basic ${token}` }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
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
 */
export async function ensureServer(): Promise<ServerInfo> {
  if (server) return server

  const password = randomBytes(24).toString('base64url')
  for (let attempt = 0; attempt < PORT_ATTEMPTS; attempt++) {
    const port = BASE_PORT + attempt
    const candidate: ServerInfo = { url: `http://127.0.0.1:${port}`, password }

    const proc = spawn('opencode', ['serve', '--port', String(port), '--hostname', '127.0.0.1'], {
      env: { ...process.env, OPENCODE_SERVER_PASSWORD: password },
      stdio: 'ignore',
    })

    for (let poll = 0; poll < HEALTH_POLLS; poll++) {
      await sleep(HEALTH_POLL_MS)
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
  throw new Error('opencode serve failed to start (ports 4096–4099); is `opencode` on PATH?')
}

/** Create a session lazily, once per app run, rooted at the harness cwd. */
async function ensureSession(info: ServerInfo): Promise<string> {
  if (sessionID) return sessionID
  const res = await fetch(`${info.url}/api/session`, {
    method: 'POST',
    headers: { ...authHeaders(info.password), 'Content-Type': 'application/json' },
    body: JSON.stringify({ location: { directory: process.cwd() } }),
  })
  if (!res.ok) throw new Error(`create session: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`)
  const result = (await res.json()) as { data: { id: string } }
  sessionID = result.data.id
  log.info('created session', { sessionID })
  return sessionID
}

/** Admit a user message and start (or resume) the event pump. */
export async function sendMessage(text: string): Promise<void> {
  const info = await ensureServer()
  const id = await ensureSession(info)

  const res = await fetch(`${info.url}/api/session/${id}/prompt`, {
    method: 'POST',
    headers: { ...authHeaders(info.password), 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  })
  if (!res.ok) throw new Error(`prompt: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`)

  activeSessionID = id
  if (!streamAbort) {
    streamAbort = new AbortController()
    void pump(info, streamAbort.signal)
  }
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

async function pump(info: ServerInfo, signal: AbortSignal): Promise<void> {
  const decoder = new SseDecoder()
  while (!signal.aborted) {
    try {
      const res = await fetch(`${info.url}/api/event`, { headers: authHeaders(info.password), signal })
      if (!res.ok || !res.body) throw new Error(`event stream: HTTP ${res.status}`)

      const reader = res.body.getReader()
      for (;;) {
        const read = (await reader.read()) as { done: boolean; value?: Uint8Array }
        if (read.done || !read.value) break
        for (const raw of decoder.push(read.value)) {
          mapEvent(raw as RawEvent, (evt) => streamSink?.(evt))
        }
      }
    } catch (err) {
      if (signal.aborted) return
      log.warn('event stream dropped, reconnecting', err)
    }
    await sleep(RECONNECT_DELAY_MS)
  }
}

/** Sink for events leaving the service; wired to the renderer by main. */
let streamSink: ((evt: OpencodeStreamEvent) => void) | null = null

export function onStreamEvent(sink: (evt: OpencodeStreamEvent) => void): void {
  streamSink = sink
}

/** Tear down the server child and all state. Called on app quit. */
export function stopServer(): void {
  streamAbort?.abort()
  streamAbort = null
  if (child?.exitCode === null) child.kill()
  child = null
  server = null
  sessionID = null
  activeSessionID = null
  streamSink = null
  log.info('stopped')
}

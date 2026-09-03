import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChatStreamCallbacks, ChatStreamRequest } from './provider'
import { OllamaProvider } from './ollama'

function ndjsonResponse(lines: string[]): Response {
  return new Response(lines.join('\n'), { status: 200, headers: { 'content-type': 'application/x-ndjson' } })
}

function frame(content: string, done = false): string {
  return JSON.stringify({ model: 'llama3.1', message: { role: 'assistant', content }, done })
}

interface Collected {
  text: string
  error: Error | null
  done: boolean
}

function collect(provider: OllamaProvider, req: ChatStreamRequest): Promise<Collected> {
  return new Promise((resolve) => {
    let text = ''
    const cb: ChatStreamCallbacks = {
      onDelta: (t) => {
        text += t
      },
      onDone: (t) => resolve({ text: t, error: null, done: true }),
      onError: (error) => resolve({ text, error, done: false })
    }
    provider.streamChat(req, cb)
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('OllamaProvider', () => {
  it('lists models from GET /api/tags without any auth header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ models: [{ name: 'llama3.1' }, { name: 'qwen2.5:7b' }] }), { status: 200 })
    )
    vi.stubGlobal('fetch', fetchMock)
    const provider = new OllamaProvider('http://localhost:11434', 'llama3.1')
    const models = await provider.listModels()
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit | undefined]
    expect(url).toBe('http://localhost:11434/api/tags')
    expect(init).toBeUndefined()
    expect(models).toEqual([
      { id: 'llama3.1', name: 'llama3.1' },
      { id: 'qwen2.5:7b', name: 'qwen2.5:7b' }
    ])
  })

  it('streams NDJSON from POST /api/chat and assembles deltas', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(ndjsonResponse([frame('Hel'), frame('lo '), frame('world', true)]))
    vi.stubGlobal('fetch', fetchMock)
    const provider = new OllamaProvider('http://localhost:11434', 'llama3.1')
    const res = await collect(provider, { model: 'llama3.1', messages: [{ role: 'user', content: 'hi' }] })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://localhost:11434/api/chat')
    expect(init.method).toBe('POST')
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body).toMatchObject({
      model: 'llama3.1',
      stream: true,
      messages: [{ role: 'user', content: 'hi' }]
    })
    expect(body.options).toBeUndefined()
    expect(res).toEqual({ text: 'Hello world', error: null, done: true })
  })

  it('sends temperature through options.temperature', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ndjsonResponse([frame('x', true)])))
    const provider = new OllamaProvider('http://localhost:11434', 'llama3.1')
    await collect(provider, { model: 'llama3.1', messages: [{ role: 'user', content: 'hi' }], temperature: 0.2 })
    const [, init] = (vi.mocked(fetch).mock.calls[0] ?? []) as [string, RequestInit]
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body.options).toEqual({ temperature: 0.2 })
  })

  it('reports HTTP errors through onError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('model not found', { status: 404 })))
    const provider = new OllamaProvider('http://localhost:11434', 'llama3.1')
    const res = await collect(provider, { model: 'nope', messages: [{ role: 'user', content: 'x' }] })
    expect(res.done).toBe(false)
    expect(res.error?.message).toContain('404')
  })

  it('tolerates a trailing slash on the base url', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ndjsonResponse([frame('ok', true)]))
    vi.stubGlobal('fetch', fetchMock)
    const provider = new OllamaProvider('http://localhost:11434/', 'llama3.1')
    await collect(provider, { model: 'llama3.1', messages: [{ role: 'user', content: 'x' }] })
    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).toBe('http://localhost:11434/api/chat')
  })
})
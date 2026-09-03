import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChatStreamCallbacks, ChatStreamRequest } from './provider'
import { OpenAICompatProvider } from './openaiCompat'
import type { ChatMessage } from '../../../shared/types'

function sseResponse(frames: string[]): Response {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) controller.enqueue(encoder.encode(frame))
      controller.close()
    }
  })
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

function dataFrame(delta: unknown): string {
  return `data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`
}

interface Collected {
  text: string
  error: Error | null
  done: boolean
}

function collect(provider: OpenAICompatProvider, req: ChatStreamRequest): Promise<Collected> {
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

describe('OpenAICompatProvider', () => {
  it('posts to {baseUrl}/chat/completions with stream:true and bearer auth', async () => {
    const fetchMock = vi.fn().mockResolvedValue(sseResponse([dataFrame({ content: 'hello' }), 'data: [DONE]\n\n']))
    vi.stubGlobal('fetch', fetchMock)

    const provider = new OpenAICompatProvider('https://api.openai.com/v1', 'sk-test-123', 'gpt-4o-mini')
    const res = await collect(provider, { model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'hi' }] })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.openai.com/v1/chat/completions')
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({ 'Content-Type': 'application/json', Authorization: 'Bearer sk-test-123' })
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body).toMatchObject({
      model: 'gpt-4o-mini',
      stream: true,
      messages: [{ role: 'user', content: 'hi' }]
    })
    expect(body.temperature).toBeUndefined()
    expect(body.max_tokens).toBeUndefined()
    expect(res).toEqual({ text: 'hello', error: null, done: true })
  })

  it('assembles SSE deltas split across arbitrary network chunks', async () => {
    const chunks = [
      'data: {"choices":[{"delta":{"conte',
      'nt":"Hel"}}]}\n\ndata: {"choices":[{"delta":{"content":"lo "}}]}\n',
      '\ndata: {"choices":[{"delta":{"content":"world"}}]}\n\ndata: [DONE]\n\n'
    ]
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseResponse(chunks)))

    const provider = new OpenAICompatProvider('http://localhost:1234/v1', '', 'm')
    const res = await collect(provider, { model: 'm', messages: [{ role: 'user', content: 'x' }] })
    expect(res.done).toBe(true)
    expect(res.text).toBe('Hello world')
  })

  it('skips empty (role-only) deltas and malformed keep-alive frames', async () => {
    const frames = [
      dataFrame({ role: 'assistant', content: '' }),
      'data: : keep-alive\n\n',
      'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n',
      dataFrame({ content: '' }),
      'data: [DONE]\n\n'
    ]
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseResponse(frames)))

    const provider = new OpenAICompatProvider('http://localhost:1234/v1', '', 'm')
    const res = await collect(provider, { model: 'm', messages: [{ role: 'user', content: 'x' }] })
    expect(res.text).toBe('ok')
    expect(res.done).toBe(true)
  })

  it('maps temperature and maxTokens onto the request body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseResponse(['data: [DONE]\n\n'])))
    const provider = new OpenAICompatProvider('https://api.openai.com/v1', 'sk', 'm')
    await collect(provider, {
      model: 'm',
      messages: [{ role: 'user', content: 'x' }],
      temperature: 0.7,
      maxTokens: 256
    })
    const [, init] = (vi.mocked(fetch).mock.calls[0] ?? []) as [string, RequestInit]
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body.temperature).toBe(0.7)
    expect(body.max_tokens).toBe(256)
  })

  it('reports HTTP errors through onError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('bad key', { status: 401 })))
    const provider = new OpenAICompatProvider('https://api.openai.com/v1', 'sk-wrong', 'm')
    const res = await collect(provider, { model: 'm', messages: [{ role: 'user', content: 'x' }] })
    expect(res.done).toBe(false)
    expect(res.error?.message).toContain('401')
  })

  it('lists models from GET /models', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: 'gpt-4o' }, { id: 'gpt-4o-mini' }] }), { status: 200 })
    )
    vi.stubGlobal('fetch', fetchMock)
    const provider = new OpenAICompatProvider('https://api.openai.com/v1', 'sk', 'm')
    const models = await provider.listModels()
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.openai.com/v1/models')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk')
    expect(models).toEqual([
      { id: 'gpt-4o', name: 'gpt-4o' },
      { id: 'gpt-4o-mini', name: 'gpt-4o-mini' }
    ])
  })

  it('streams with the default model when the request omits one', async () => {
    const fetchMock = vi.fn().mockResolvedValue(sseResponse(['data: [DONE]\n\n']))
    vi.stubGlobal('fetch', fetchMock)
    const provider = new OpenAICompatProvider('http://localhost:11434/v1', '', 'llama3.1')
    const messages: ChatMessage[] = [{ role: 'user', content: 'x' }]
    await collect(provider, { model: '', messages })
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body.model).toBe('llama3.1')
  })
})
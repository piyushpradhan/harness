import type { ModelInfo } from '../../../shared/types'
import type { Cancellable, ChatStreamCallbacks, ChatStreamRequest, LLMProvider } from './provider'
import { iterLines, joinUrl } from './http'

interface ChatCompletionDelta {
  choices?: Array<{ delta?: { content?: string } }>
}

/**
 * OpenAI-compatible chat provider over /v1/chat/completions with stream:true
 * and SSE response parsing. Works against OpenAI, OpenRouter, Groq, LM Studio,
 * llama.cpp server and Ollama's /v1 compat endpoint.
 *
 * Convention: baseUrl already includes the /v1 prefix, e.g.
 * `https://api.openai.com/v1` or `http://localhost:11434/v1`.
 */
export class OpenAICompatProvider implements LLMProvider {
  constructor(
    readonly baseUrl: string,
    readonly apiKey: string,
    readonly defaultModel: string
  ) {}

  async listModels(): Promise<ModelInfo[]> {
    const res = await fetch(joinUrl(this.baseUrl, 'models'), {
      headers: { Authorization: `Bearer ${this.apiKey}` }
    })
    if (!res.ok) throw new Error(`GET /models failed: HTTP ${res.status}`)
    const data = (await res.json()) as { data?: Array<{ id: string }> }
    return (data.data ?? []).map((m) => ({ id: m.id, name: m.id }))
  }

  streamChat(req: ChatStreamRequest, cb: ChatStreamCallbacks): Cancellable {
    const controller = new AbortController()
    void this.#stream(controller, req, cb)
    return { cancel: () => controller.abort() }
  }

  async #stream(controller: AbortController, req: ChatStreamRequest, cb: ChatStreamCallbacks): Promise<void> {
    try {
      const res = await fetch(joinUrl(this.baseUrl, 'chat/completions'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          model: req.model || this.defaultModel,
          messages: req.messages,
          stream: true,
          ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
          ...(req.maxTokens !== undefined ? { max_tokens: req.maxTokens } : {})
        }),
        signal: controller.signal
      })
      if (!res.ok || !res.body) throw new Error(`POST /chat/completions failed: HTTP ${res.status}`)

      let full = ''
      for await (const line of iterLines(res.body.getReader())) {
        if (controller.signal.aborted) return
        if (!line.startsWith('data:')) continue
        const payload = line.slice(5).trim()
        if (payload === '' || payload === '[DONE]') continue
        let frame: ChatCompletionDelta
        try {
          frame = JSON.parse(payload) as ChatCompletionDelta
        } catch {
          continue // ignore keep-alive / comment frames
        }
        const delta = frame.choices?.[0]?.delta?.content
        if (delta) {
          full += delta
          cb.onDelta(delta)
        }
      }
      if (controller.signal.aborted) return
      cb.onDone(full)
    } catch (err) {
      if (controller.signal.aborted) return // cancellation is not an error
      cb.onError(err instanceof Error ? err : new Error(String(err)))
    }
  }
}
import type { ModelInfo } from '../../../shared/types'
import type { Cancellable, ChatStreamCallbacks, ChatStreamRequest, LLMProvider } from './provider'
import { iterLines, joinUrl } from './http'

interface OllamaChatFrame {
  model?: string
  message?: { role?: string; content?: string }
  done?: boolean
}

/**
 * Ollama's native API: GET /api/tags for the model list, POST /api/chat with
 * stream:true and newline-delimited JSON responses. No apiKey involved.
 */
export class OllamaProvider implements LLMProvider {
  constructor(
    readonly baseUrl: string,
    readonly defaultModel: string
  ) {}

  async listModels(): Promise<ModelInfo[]> {
    const res = await fetch(joinUrl(this.baseUrl, 'api/tags'))
    if (!res.ok) throw new Error(`GET /api/tags failed: HTTP ${res.status}`)
    const data = (await res.json()) as { models?: Array<{ name: string }> }
    return (data.models ?? []).map((m) => ({ id: m.name, name: m.name }))
  }

  streamChat(req: ChatStreamRequest, cb: ChatStreamCallbacks): Cancellable {
    const controller = new AbortController()
    void this.#stream(controller, req, cb)
    return { cancel: () => controller.abort() }
  }

  async #stream(controller: AbortController, req: ChatStreamRequest, cb: ChatStreamCallbacks): Promise<void> {
    try {
      const res = await fetch(joinUrl(this.baseUrl, 'api/chat'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: req.model || this.defaultModel,
          messages: req.messages,
          stream: true,
          ...(req.temperature !== undefined ? { options: { temperature: req.temperature } } : {})
        }),
        signal: controller.signal
      })
      if (!res.ok || !res.body) throw new Error(`POST /api/chat failed: HTTP ${res.status}`)

      let full = ''
      for await (const line of iterLines(res.body.getReader())) {
        if (controller.signal.aborted) return
        if (!line.trim()) continue
        let frame: OllamaChatFrame
        try {
          frame = JSON.parse(line) as OllamaChatFrame
        } catch {
          continue
        }
        const content = frame.message?.content
        if (content) {
          full += content
          cb.onDelta(content)
        }
        if (frame.done) break
      }
      if (controller.signal.aborted) return
      cb.onDone(full)
    } catch (err) {
      if (controller.signal.aborted) return // cancellation is not an error
      cb.onError(err instanceof Error ? err : new Error(String(err)))
    }
  }
}
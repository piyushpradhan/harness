import type { ChatMessage, ModelInfo } from '../../../shared/types'

export interface ChatStreamRequest {
  model: string
  messages: ChatMessage[]
  temperature?: number
  maxTokens?: number
}

export interface ChatStreamCallbacks {
  onDelta(text: string): void
  onDone(text: string): void
  onError(error: Error): void
}

export interface Cancellable {
  cancel(): void
}

/**
 * Provider-agnostic chat interface. Adapters implement it for one upstream
 * (OpenAI-compatible REST, Ollama, ...) and nothing else in the app depends
 * on a concrete provider. Electron-free by design: unit-testable in isolation.
 */
export interface LLMProvider {
  listModels(): Promise<ModelInfo[]>
  streamChat(req: ChatStreamRequest, cb: ChatStreamCallbacks): Cancellable
}
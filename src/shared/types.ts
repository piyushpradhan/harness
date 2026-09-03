export type ProviderType = 'openai-compat' | 'ollama'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ModelInfo {
  id: string
  name?: string
}

export interface Profile {
  id: string
  type: ProviderType
  name: string
  baseUrl: string
  apiKey?: string
  /** Default model id used by chats that do not specify one. */
  model?: string
}

/**
 * Profile as exposed to the renderer. The stored apiKey is never sent back;
 * `hasApiKey` tells the UI whether one is configured.
 */
export interface ProfileSummary {
  id: string
  type: ProviderType
  name: string
  baseUrl: string
  model?: string
  hasApiKey: boolean
}

export type SessionEvent =
  | { sessionId: string; type: 'status'; state: 'connecting' | 'streaming' | 'cancelled' }
  | { sessionId: string; type: 'delta'; text: string }
  | { sessionId: string; type: 'done'; text: string; durationMs: number }
  | { sessionId: string; type: 'error'; message: string }